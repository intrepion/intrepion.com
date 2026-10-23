mod erasure;
mod writes;
use crate::{auth::SharedAuth, db::Statement, proto::life::v1::*};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};
const NO_CONFLICTING_RECEIPT: &str = "NOT EXISTS(SELECT 1 FROM collection_operations WHERE owner_sub=? AND operation_id=? AND fingerprint<>?)";
use writes::{Writes, history_writes, json_chunks};

#[derive(Clone, Default)]
pub(crate) struct Scope {
    pub owner: String,
}
pub struct Lists(pub SharedAuth, pub(crate) Scope);
#[derive(Deserialize)]
struct CollectionRow {
    id: String,
    kind: i32,
    title: String,
    notes: String,
    completed: i32,
    archived: i32,
    trashed: i32,
    finished: i32,
    revision: u32,
    sequence: u64,
    source_id: String,
    source_title: String,
    #[serde(default)]
    item_count: u32,
    #[serde(default)]
    completed_count: u32,
    #[serde(default)]
    erasure_pending: i32,
}
impl From<CollectionRow> for Collection {
    fn from(c: CollectionRow) -> Self {
        Self {
            id: c.id,
            kind: c.kind.into(),
            title: c.title,
            notes: c.notes,
            completed: c.completed != 0,
            archived: c.archived != 0,
            trashed: c.trashed != 0,
            finished: c.finished != 0,
            revision: c.revision,
            created_order: c.sequence,
            source_id: c.source_id,
            source_title: c.source_title,
            item_count: c.item_count,
            completed_count: c.completed_count,
            erasure_pending: c.erasure_pending != 0,
            ..Default::default()
        }
    }
}
#[derive(Deserialize)]
struct Receipt {
    collection_id: String,
    fingerprint: String,
    erased_scope: String,
}
#[derive(Deserialize)]
struct HistoryRow {
    sequence: u64,
    target_id: String,
    target_title: String,
    action: String,
    occurred_at: i64,
    before_json: String,
    after_json: String,
}
#[derive(Deserialize)]
struct SectionRow {
    id: String,
    title: String,
    position: u32,
}
impl From<SectionRow> for ListSection {
    fn from(s: SectionRow) -> Self {
        Self {
            id: s.id,
            title: s.title,
            position: s.position,
            ..Default::default()
        }
    }
}
#[derive(Deserialize)]
struct ItemRow {
    id: String,
    title: String,
    notes: String,
    quantity: String,
    section_id: String,
    completed: i32,
    trashed: i32,
    position: u32,
}
#[derive(Deserialize)]
struct TrashedRow {
    #[serde(flatten)]
    item: ItemRow,
    parent_json: String,
}
impl From<ItemRow> for ListItem {
    fn from(i: ItemRow) -> Self {
        Self {
            id: i.id,
            title: i.title,
            notes: i.notes,
            quantity: i.quantity,
            section_id: i.section_id,
            completed: i.completed != 0,
            trashed: i.trashed != 0,
            position: i.position,
            ..Default::default()
        }
    }
}
#[derive(serde::Serialize)]
struct Event {
    target: String,
    title: String,
    action: String,
    before: serde_json::Value,
    after: serde_json::Value,
}
fn item_values(c: &Collection, item: &ListItem) -> serde_json::Value {
    serde_json::json!({"title":item.title,"notes":item.notes,"quantity":item.quantity,"section":c.sections.iter().find(|s|s.id==item.section_id).map(|s|s.title.as_str()).unwrap_or(if item.section_id.is_empty(){"Unsectioned"}else{"Former section"}),"completed":item.completed,"trashed":item.trashed})
}
fn collection_values(c: &Collection) -> serde_json::Value {
    serde_json::json!({"title":c.title,"notes":c.notes,"completed":c.completed,"archived":c.archived,"trashed":c.trashed,"finished":c.finished})
}
fn insert_item(owner: &str, c: &Collection, item: &ListItem) -> Statement {
    Statement::new(
        "INSERT INTO list_items(owner_sub,collection_id,id,title,notes,quantity,section_id,completed,trashed,position) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM list_items WHERE owner_sub=? AND collection_id=? AND id=?) AND @guard",
        vec![
            owner.into(),
            c.id.clone(),
            item.id.clone(),
            item.title.clone(),
            item.notes.clone(),
            item.quantity.clone(),
            item.section_id.clone(),
            i32::from(item.completed).to_string(),
            i32::from(item.trashed).to_string(),
            item.position.to_string(),
            owner.into(),
            c.id.clone(),
            item.id.clone(),
        ],
    )
}
fn validate_item(c: &Collection, item: &ListItem) -> Result<(), ConnectError> {
    validate_text(&item.title, &item.notes)?;
    if !valid_id(&item.id)
        || item.quantity.chars().count() > 100
        || item.quantity.contains('\0')
        || (!item.section_id.is_empty() && !c.sections.iter().any(|s| s.id == item.section_id))
        || (c.kind.as_known() != Some(CollectionKind::Shopping) && !item.quantity.is_empty())
        || (c.kind.as_known() == Some(CollectionKind::Template) && item.completed)
    {
        return Err(ConnectError::invalid_argument(
            "Invalid item, quantity or section.",
        ));
    }
    Ok(())
}
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
pub(crate) fn validate_text(title: &str, notes: &str) -> Result<(), ConnectError> {
    if title.trim().is_empty()
        || title.chars().count() > 200
        || notes.chars().count() > 10000
        || title.contains('\0')
        || notes.contains('\0')
    {
        return Err(ConnectError::invalid_argument(
            "Use a name of 1–200 characters and notes of at most 10,000 characters.",
        ));
    }
    Ok(())
}
fn conflict() -> ConnectError {
    ConnectError::failed_precondition(
        "This collection changed. Keep your draft and review the latest version before saving again.",
    )
}
impl Lists {
    fn operation_identity(&self, r: &ChangeRequest, fingerprint: &str) -> [String; 3] {
        [self.owner(), r.operation_id.clone(), fingerprint.into()]
    }
    pub(crate) fn owner(&self) -> String {
        self.1.owner.clone()
    }
    pub(crate) async fn authorized(
        auth: SharedAuth,
        ctx: &RequestContext,
    ) -> Result<Self, ConnectError> {
        let session = auth.authorize_rpc(ctx).await?;
        Ok(Self(
            auth,
            Scope {
                owner: session.user_sub,
            },
        ))
    }
    pub(crate) async fn get(&self, id: &str) -> Result<Collection, ConnectError> {
        if !valid_id(id) {
            return Err(ConnectError::invalid_argument("Invalid collection ID."));
        }
        let rows=self.0.db.batch(&[
            Statement::new("SELECT c.*,EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=c.id) AS erasure_pending FROM collections c WHERE owner_sub=? AND id=?",vec![self.owner(),id.into()]),
            Statement::new("SELECT id,title,position FROM list_sections WHERE owner_sub=? AND collection_id=? ORDER BY position,id",vec![self.owner(),id.into()]),
            Statement::new("SELECT * FROM list_items WHERE owner_sub=? AND collection_id=? ORDER BY position,id",vec![self.owner(),id.into()]),
            Statement::new("SELECT operation_id,fingerprint,expected_revision,target_id,scope FROM erasure_intents WHERE owner_sub=? AND collection_id=?",vec![self.owner(),id.into()]),
        ]).await?;
        let row = rows[0].first().ok_or_else(|| {
            ConnectError::not_found("Collection no longer exists. Reload the view.")
        })?;
        let mut collection: Collection = serde_json::from_value::<CollectionRow>(row.clone())
            .map_err(|_| ConnectError::internal("Invalid collection data."))?
            .into();
        collection.sections = rows[1]
            .iter()
            .map(|row| serde_json::from_value::<SectionRow>(row.clone()).map(Into::into))
            .collect::<Result<_, _>>()
            .map_err(|_| ConnectError::internal("Invalid section data."))?;
        collection.items = rows[2]
            .iter()
            .map(|row| serde_json::from_value::<ItemRow>(row.clone()).map(Into::into))
            .collect::<Result<_, _>>()
            .map_err(|_| ConnectError::internal("Invalid item data."))?;
        if let Some(row) = rows[3].first() {
            let intent: erasure::Intent = serde_json::from_value(row.clone())
                .map_err(|_| ConnectError::internal("Invalid pending erasure."))?;
            collection.pending_erasure = PendingErasure {
                operation_id: intent.operation_id,
                expected_revision: intent.expected_revision,
                target_id: intent.target_id,
                whole_collection: intent.scope == "collection",
                ..Default::default()
            }
            .into();
        }
        collection.item_count = collection.items.iter().filter(|i| !i.trashed).count() as u32;
        collection.completed_count = collection
            .items
            .iter()
            .filter(|i| !i.trashed && i.completed)
            .count() as u32;
        Ok(collection)
    }

    async fn create(
        &self,
        r: &ChangeRequest,
        fingerprint: &str,
    ) -> Result<ChangeResult, ConnectError> {
        self.ensure_not_retired("collection", &r.collection_id)
            .await?;
        validate_text(&r.details.title, &r.details.notes)?;
        let kind = r.details.kind.to_i32();
        if !(1..=3).contains(&kind) || r.expected_revision != 0 {
            return Err(ConnectError::invalid_argument(
                "Choose a task, shopping list or checklist template.",
            ));
        }
        let after=serde_json::json!({"title":r.details.title.trim(),"notes":r.details.notes,"completed":r.details.completed}).to_string();
        let guard =
            "EXISTS(SELECT 1 FROM collections WHERE owner_sub=? AND id=? AND last_operation=?)";
        let statements = vec![
            Statement::new(
                &format!(
                    "INSERT INTO collections(owner_sub,id,kind,title,notes,completed,last_operation) SELECT ?,?,?,?,?,?,? WHERE {NO_CONFLICTING_RECEIPT} ON CONFLICT(owner_sub,id) DO NOTHING"
                ),
                {
                    let mut parameters = vec![
                        self.owner(),
                        r.collection_id.clone(),
                        kind.to_string(),
                        r.details.title.trim().into(),
                        r.details.notes.clone(),
                        i32::from(r.details.completed).to_string(),
                        r.operation_id.clone(),
                    ];
                    parameters.extend(self.operation_identity(r, fingerprint));
                    parameters
                },
            ),
            Statement::new(
                &format!(
                    "INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint) SELECT ?,?,?,? WHERE {guard} ON CONFLICT(owner_sub,operation_id) DO NOTHING"
                ),
                vec![
                    self.owner(),
                    r.operation_id.clone(),
                    r.collection_id.clone(),
                    fingerprint.into(),
                    self.owner(),
                    r.collection_id.clone(),
                    r.operation_id.clone(),
                ],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json) SELECT ?,?,?,?,?,?,'null',? WHERE {guard} ON CONFLICT(owner_sub,operation_id,target_id) DO NOTHING"
                ),
                vec![
                    self.owner(),
                    r.collection_id.clone(),
                    r.operation_id.clone(),
                    r.collection_id.clone(),
                    r.details.title.trim().into(),
                    "Created".into(),
                    after,
                    self.owner(),
                    r.collection_id.clone(),
                    r.operation_id.clone(),
                ],
            ),
        ];
        self.0.db.batch(&statements).await?;
        let receipt = self.receipt(&r.operation_id).await?.ok_or_else(conflict)?;
        if receipt.collection_id != r.collection_id || receipt.fingerprint != fingerprint {
            return Err(conflict());
        }
        Ok(ChangeResult {
            collection: self.get(&r.collection_id).await?.into(),
            ..Default::default()
        })
    }
    async fn receipt(&self, id: &str) -> Result<Option<Receipt>, ConnectError> {
        Ok(self.0.db.query::<Receipt>("SELECT collection_id,fingerprint,erased_scope FROM collection_operations WHERE owner_sub=? AND operation_id=?",&[self.owner(),id.into()]).await?.pop())
    }
}
impl Lists {
    async fn commit(
        &self,
        c: &Collection,
        r: &ChangeRequest,
        fingerprint: &str,
        writes: Vec<Statement>,
        events: Vec<Event>,
    ) -> Result<ChangeResult, ConnectError> {
        let next_revision = c.revision.checked_add(1).ok_or_else(|| {
            ConnectError::failed_precondition("Collection revision limit reached.")
        })?;
        let guard = format!(
            "EXISTS(SELECT 1 FROM collections WHERE owner_sub=? AND id=? AND last_operation=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM erasure_intents WHERE collection_id=?) AND {NO_CONFLICTING_RECEIPT}"
        );
        let guard_params = {
            let mut parameters = vec![
                self.owner(),
                c.id.clone(),
                r.operation_id.clone(),
                next_revision.to_string(),
                c.id.clone(),
            ];
            parameters.extend(self.operation_identity(r, fingerprint));
            parameters
        };
        let mut statements = vec![Statement::new(
            &format!(
                "UPDATE collections SET revision=revision+1,last_operation=? WHERE owner_sub=? AND id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM erasure_intents WHERE collection_id=?) AND {NO_CONFLICTING_RECEIPT}"
            ),
            {
                let mut parameters = vec![
                    r.operation_id.clone(),
                    self.owner(),
                    c.id.clone(),
                    r.expected_revision.to_string(),
                    c.id.clone(),
                ];
                parameters.extend(self.operation_identity(r, fingerprint));
                parameters
            },
        )];
        for mut write in writes {
            write.sql = write.sql.replace("@guard", &guard);
            write.params.extend(guard_params.clone());
            statements.push(write);
        }
        for mut write in history_writes(&self.owner(), &c.id, &r.operation_id, events)? {
            write.sql = write.sql.replace("@guard", &guard);
            write.params.extend(guard_params.clone());
            statements.push(write);
        }
        let mut receipt = vec![
            self.owner(),
            r.operation_id.clone(),
            c.id.clone(),
            fingerprint.into(),
        ];
        receipt.extend(guard_params);
        statements.push(Statement::new(&format!("INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint) SELECT ?,?,?,? WHERE {guard} ON CONFLICT(owner_sub,operation_id) DO NOTHING"),receipt));
        self.0.db.batch(&statements).await?;
        let saved = self.receipt(&r.operation_id).await?.ok_or_else(conflict)?;
        if saved.collection_id != c.id || saved.fingerprint != fingerprint {
            return Err(conflict());
        }
        Ok(ChangeResult {
            collection: self.get(&c.id).await?.into(),
            ..Default::default()
        })
    }

    async fn mutate(
        &self,
        r: &ChangeRequest,
        fingerprint: &str,
    ) -> Result<ChangeResult, ConnectError> {
        let c = self.get(&r.collection_id).await?;
        if r.expected_revision == 0 || r.expected_revision != c.revision {
            return Err(conflict());
        }
        if c.erasure_pending {
            return Err(ConnectError::failed_precondition(
                "An erasure is pending. Retry that erasure before changing this collection.",
            ));
        }
        let action = r.action.as_known();
        let blocked = if c.trashed {
            action != Some(ChangeAction::RestoreCollection)
        } else if c.archived {
            !matches!(
                action,
                Some(ChangeAction::Unarchive | ChangeAction::TrashCollection)
            )
        } else if c.finished {
            !matches!(
                action,
                Some(
                    ChangeAction::ReopenRun | ChangeAction::Archive | ChangeAction::TrashCollection
                )
            )
        } else {
            false
        };
        if blocked {
            return Err(ConnectError::failed_precondition(
                "Restore, unarchive or reopen this collection before editing it.",
            ));
        }
        let mut writes = Writes::default();
        let mut events = vec![];
        match r.action.as_known() {
            Some(ChangeAction::RenameSection) => {
                let before = c
                    .sections
                    .iter()
                    .find(|s| s.id == r.section.id)
                    .ok_or_else(|| ConnectError::not_found("Section no longer exists."))?;
                self.ensure_not_retired("section", &r.section.id).await?;
                validate_text(&r.section.title, "")?;
                writes.push(Statement::new("UPDATE list_sections SET title=? WHERE owner_sub=? AND collection_id=? AND id=? AND @guard",vec![r.section.title.trim().into(),self.owner(),c.id.clone(),before.id.clone()]));
                events.push(Event {
                    target: before.id.clone(),
                    title: r.section.title.trim().into(),
                    action: "Section renamed".into(),
                    before: serde_json::json!({"title":before.title}),
                    after: serde_json::json!({"title":r.section.title.trim()}),
                });
            }
            Some(ChangeAction::MoveSection) => {
                let index = c
                    .sections
                    .iter()
                    .position(|s| s.id == r.target_id)
                    .ok_or_else(|| ConnectError::not_found("Section no longer exists."))?;
                if r.position as usize >= c.sections.len() {
                    return Err(ConnectError::invalid_argument("Invalid section position."));
                }
                let mut order = c.sections.clone();
                let moved = order.remove(index);
                order.insert(r.position as usize, moved);
                for (position, section) in order.iter().enumerate() {
                    let previous = c
                        .sections
                        .iter()
                        .position(|s| s.id == section.id)
                        .ok_or_else(conflict)?;
                    writes.section_position(&section.id, position);
                    if previous == position {
                        continue;
                    }
                    events.push(Event {
                        target: section.id.clone(),
                        title: section.title.clone(),
                        action: "Section order changed".into(),
                        before: serde_json::json!({"position":previous+1}),
                        after: serde_json::json!({"position":position+1}),
                    });
                }
            }
            Some(ChangeAction::MoveItem) => {
                let item = c
                    .items
                    .iter()
                    .find(|i| i.id == r.target_id && !i.trashed)
                    .ok_or_else(|| ConnectError::not_found("Item no longer available."))?;
                let mut members: Vec<_> = c
                    .items
                    .iter()
                    .filter(|i| i.section_id == item.section_id && !i.trashed)
                    .cloned()
                    .collect();
                if r.position as usize >= members.len() {
                    return Err(ConnectError::invalid_argument("Invalid item position."));
                }
                let index = members
                    .iter()
                    .position(|i| i.id == item.id)
                    .ok_or_else(conflict)?;
                let moved = members.remove(index);
                members.insert(r.position as usize, moved);
                for (position, mut moved) in members.into_iter().enumerate() {
                    let before = moved.clone();
                    moved.position = position as u32;
                    let previous = c
                        .items
                        .iter()
                        .filter(|i| i.section_id == moved.section_id && !i.trashed)
                        .position(|i| i.id == moved.id)
                        .ok_or_else(conflict)?;
                    if before.position != moved.position {
                        writes.update_item(&moved);
                    }
                    if previous == position {
                        continue;
                    }
                    events.push(Event {
                        target: moved.id.clone(),
                        title: moved.title.clone(),
                        action: "Item order changed".into(),
                        before: serde_json::json!({"position":previous+1}),
                        after: serde_json::json!({"position":position+1}),
                    });
                }
            }
            Some(ChangeAction::RemoveSection) => {
                let section = c
                    .sections
                    .iter()
                    .find(|s| s.id == r.target_id)
                    .ok_or_else(|| ConnectError::not_found("Section no longer exists."))?;
                let mut position = c
                    .items
                    .iter()
                    .filter(|i| i.section_id.is_empty())
                    .map(|i| i.position)
                    .max()
                    .unwrap_or(0);
                for before in c
                    .items
                    .iter()
                    .filter(|i| i.section_id == section.id && !i.trashed)
                {
                    position = position.checked_add(1).ok_or_else(conflict)?;
                    let mut item = before.clone();
                    item.section_id.clear();
                    item.position = position;
                    writes.update_item(&item);
                    events.push(Event {
                        target: item.id.clone(),
                        title: item.title.clone(),
                        action: "Moved to Unsectioned".into(),
                        before: item_values(&c, before),
                        after: item_values(&c, &item),
                    });
                }
                writes.push(Statement::new("DELETE FROM list_sections WHERE owner_sub=? AND collection_id=? AND id=? AND @guard",vec![self.owner(),c.id.clone(),section.id.clone()]));
                events.push(Event {
                    target: section.id.clone(),
                    title: section.title.clone(),
                    action: "Section removed".into(),
                    before: serde_json::json!({"title":section.title,"position":c.sections.iter().position(|s|s.id==section.id).unwrap_or(0)+1}),
                    after: serde_json::Value::Null,
                });
            }
            Some(action @ (ChangeAction::TrashItem | ChangeAction::RestoreItem)) => {
                let before = c
                    .items
                    .iter()
                    .find(|i| i.id == r.target_id)
                    .ok_or_else(|| ConnectError::not_found("Item no longer exists."))?;
                let mut item = before.clone();
                item.trashed = action == ChangeAction::TrashItem;
                if !item.trashed
                    && !item.section_id.is_empty()
                    && !c.sections.iter().any(|s| s.id == item.section_id)
                {
                    item.section_id.clear();
                    item.position = c
                        .items
                        .iter()
                        .filter(|i| i.section_id.is_empty())
                        .map(|i| i.position)
                        .max()
                        .unwrap_or(0)
                        .checked_add(1)
                        .ok_or_else(conflict)?;
                }
                writes.update_item(&item);
                events.push(Event {
                    target: item.id.clone(),
                    title: item.title.clone(),
                    action: if item.trashed {
                        "Moved to Trash"
                    } else {
                        "Restored"
                    }
                    .into(),
                    before: item_values(&c, before),
                    after: item_values(&c, &item),
                });
            }
            Some(
                action @ (ChangeAction::UpdateMetadata
                | ChangeAction::TrashCollection
                | ChangeAction::RestoreCollection
                | ChangeAction::Archive
                | ChangeAction::Unarchive
                | ChangeAction::FinishRun
                | ChangeAction::ReopenRun),
            ) => {
                let mut next = c.clone();
                let label = match action {
                    ChangeAction::UpdateMetadata => {
                        validate_text(&r.details.title, &r.details.notes)?;
                        if (r.details.kind.to_i32() != 0 && r.details.kind != c.kind)
                            || (c.kind.as_known() != Some(CollectionKind::Task)
                                && r.details.completed)
                        {
                            return Err(ConnectError::invalid_argument(
                                "Collection kind and checklist progress cannot be changed through metadata.",
                            ));
                        }
                        next.title = r.details.title.trim().into();
                        next.notes = r.details.notes.clone();
                        next.completed = r.details.completed;
                        "Details edited"
                    }
                    ChangeAction::TrashCollection => {
                        next.trashed = true;
                        "Moved to Trash"
                    }
                    ChangeAction::RestoreCollection => {
                        next.trashed = false;
                        "Restored"
                    }
                    ChangeAction::Archive | ChangeAction::Unarchive => {
                        if c.kind.as_known() == Some(CollectionKind::Task) {
                            return Err(ConnectError::invalid_argument(
                                "Tasks use completion and Trash, not Archive.",
                            ));
                        }
                        next.archived = action == ChangeAction::Archive;
                        if next.archived {
                            "Archived"
                        } else {
                            "Unarchived"
                        }
                    }
                    ChangeAction::FinishRun | ChangeAction::ReopenRun => {
                        if c.kind.as_known() != Some(CollectionKind::Run) {
                            return Err(ConnectError::invalid_argument(
                                "Only checklist runs can be finished or reopened.",
                            ));
                        }
                        next.finished = action == ChangeAction::FinishRun;
                        if next.finished {
                            "Run finished"
                        } else {
                            "Run reopened"
                        }
                    }
                    _ => unreachable!(),
                };
                writes.push(Statement::new("UPDATE collections SET title=?,notes=?,completed=?,archived=?,trashed=?,finished=? WHERE owner_sub=? AND id=? AND @guard",vec![next.title.clone(),next.notes.clone(),i32::from(next.completed).to_string(),i32::from(next.archived).to_string(),i32::from(next.trashed).to_string(),i32::from(next.finished).to_string(),self.owner(),c.id.clone()]));
                events.push(Event {
                    target: c.id.clone(),
                    title: next.title.clone(),
                    action: label.into(),
                    before: collection_values(&c),
                    after: collection_values(&next),
                });
            }
            Some(ChangeAction::CreateSection) => {
                if c.kind.as_known() == Some(CollectionKind::Task)
                    || !r.section.is_set()
                    || !valid_id(&r.section.id)
                    || c.sections.iter().any(|s| s.id == r.section.id)
                {
                    return Err(ConnectError::invalid_argument(
                        "A valid new section is required.",
                    ));
                }
                validate_text(&r.section.title, "")?;
                let position = c
                    .sections
                    .iter()
                    .map(|s| s.position)
                    .max()
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or_else(conflict)?;
                writes.push(Statement::new("INSERT INTO list_sections(owner_sub,collection_id,id,title,position) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM list_sections WHERE owner_sub=? AND collection_id=? AND id=?) AND @guard",vec![self.owner(),c.id.clone(),r.section.id.clone(),r.section.title.trim().into(),position.to_string(),self.owner(),c.id.clone(),r.section.id.clone()]));
                events.push(Event {
                    target: r.section.id.clone(),
                    title: r.section.title.trim().into(),
                    action: "Section created".into(),
                    before: serde_json::Value::Null,
                    after: serde_json::json!({"title":r.section.title.trim(),"position":c.sections.len()+1}),
                });
            }
            Some(ChangeAction::CreateItem) => {
                if c.kind.as_known() == Some(CollectionKind::Task)
                    || !r.item.is_set()
                    || !valid_id(&r.item.id)
                {
                    return Err(ConnectError::invalid_argument(
                        "A valid list item is required.",
                    ));
                }
                if c.items.iter().any(|item| item.id == r.item.id) {
                    return Err(conflict());
                }
                self.ensure_not_retired("item", &r.item.id).await?;
                let mut item = (*r.item).clone();
                validate_item(&c, &item)?;
                item.title = item.title.trim().into();
                item.trashed = false;
                if c.kind.as_known() == Some(CollectionKind::Template) {
                    item.completed = false;
                }
                item.position = c
                    .items
                    .iter()
                    .map(|i| i.position)
                    .max()
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or_else(conflict)?;
                writes.push(insert_item(&self.owner(), &c, &item));
                events.push(Event {
                    target: item.id.clone(),
                    title: item.title.clone(),
                    action: "Item added".into(),
                    before: serde_json::Value::Null,
                    after: item_values(&c, &item),
                });
            }
            Some(ChangeAction::UpdateItem) => {
                let before = c
                    .items
                    .iter()
                    .find(|i| i.id == r.item.id && !i.trashed)
                    .ok_or_else(|| ConnectError::not_found("Item no longer available."))?;
                let mut item = (*r.item).clone();
                validate_item(&c, &item)?;
                item.title = item.title.trim().into();
                item.trashed = false;
                item.position = if before.section_id == item.section_id {
                    before.position
                } else {
                    c.items
                        .iter()
                        .map(|i| i.position)
                        .max()
                        .unwrap_or(0)
                        .checked_add(1)
                        .ok_or_else(conflict)?
                };
                writes.update_item(&item);
                events.push(Event {
                    target: item.id.clone(),
                    title: item.title.clone(),
                    action: "Item edited".into(),
                    before: item_values(&c, before),
                    after: item_values(&c, &item),
                });
            }
            Some(ChangeAction::ResetPurchases) => {
                if c.kind.as_known() != Some(CollectionKind::Shopping) {
                    return Err(ConnectError::invalid_argument(
                        "Only shopping lists support this action.",
                    ));
                }
                for before in c.items.iter().filter(|i| !i.trashed && i.completed) {
                    let mut item = before.clone();
                    item.completed = false;
                    writes.update_item(&item);
                    events.push(Event {
                        target: item.id.clone(),
                        title: item.title.clone(),
                        action: "Marked needed".into(),
                        before: item_values(&c, before),
                        after: item_values(&c, &item),
                    });
                }
            }
            _ => {
                return Err(ConnectError::invalid_argument(
                    "Unsupported collection action.",
                ));
            }
        }
        self.commit(
            &c,
            r,
            fingerprint,
            writes.finish(&self.owner(), &c.id)?,
            events,
        )
        .await
    }
}
impl Lists {
    async fn start_run(
        &self,
        r: &ChangeRequest,
        fingerprint: &str,
    ) -> Result<ChangeResult, ConnectError> {
        self.ensure_not_retired("collection", &r.collection_id)
            .await?;
        let source = self.get(&r.source_id).await?;
        validate_text(&r.details.title, "")?;
        if source.kind.as_known() != Some(CollectionKind::Template)
            || source.erasure_pending
            || source.archived
            || source.trashed
            || source.items.iter().all(|i| i.trashed)
        {
            return Err(ConnectError::failed_precondition(
                "Choose an active template with at least one item.",
            ));
        }
        if r.expected_revision == 0 || r.expected_revision != source.revision {
            return Err(conflict());
        }
        let mut run = Collection {
            id: r.collection_id.clone(),
            kind: CollectionKind::Run.into(),
            title: r.details.title.trim().into(),
            notes: source.notes.clone(),
            source_id: source.id.clone(),
            source_title: source.title.clone(),
            revision: 1,
            ..Default::default()
        };
        let derive_id = |source_id: &str| {
            let hex = format!(
                "{:x}",
                Sha256::digest(format!("{}/{source_id}", r.operation_id))
            );
            format!(
                "{}-{}-4{}-a{}-{}",
                &hex[..8],
                &hex[8..12],
                &hex[13..16],
                &hex[17..20],
                &hex[20..32]
            )
        };
        run.sections = source
            .sections
            .iter()
            .map(|s| ListSection {
                id: derive_id(&s.id),
                title: s.title.clone(),
                position: s.position,
                ..Default::default()
            })
            .collect();
        run.items = source
            .items
            .iter()
            .filter(|i| !i.trashed)
            .map(|i| ListItem {
                id: derive_id(&i.id),
                title: i.title.clone(),
                notes: i.notes.clone(),
                section_id: if i.section_id.is_empty() {
                    String::new()
                } else {
                    derive_id(&i.section_id)
                },
                position: i.position,
                ..Default::default()
            })
            .collect();
        let section_json=json_chunks(run.sections.iter().map(|section|serde_json::json!({"id":section.id,"title":section.title,"position":section.position})))?;
        let item_json=json_chunks(run.items.iter().map(|item|serde_json::json!({"id":item.id,"title":item.title,"notes":item.notes,"section_id":item.section_id,"position":item.position})))?;
        let mut events = vec![Event {
            target: run.id.clone(),
            title: run.title.clone(),
            action: "Run started".into(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"title":run.title,"notes":run.notes,"source":run.source_title}),
        }];
        events.extend(run.sections.iter().enumerate().map(|(position, s)| Event {
            target: s.id.clone(),
            title: s.title.clone(),
            action: "Section copied".into(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"title":s.title,"position":position+1}),
        }));
        events.extend(run.items.iter().map(|i| Event {
            target: i.id.clone(),
            title: i.title.clone(),
            action: "Item copied".into(),
            before: serde_json::Value::Null,
            after: item_values(&run, i),
        }));
        let guard = format!(
            "EXISTS(SELECT 1 FROM collections WHERE owner_sub=? AND id=? AND last_operation=?) AND {NO_CONFLICTING_RECEIPT}"
        );
        let guard_params = {
            let mut parameters = vec![self.owner(), run.id.clone(), r.operation_id.clone()];
            parameters.extend(self.operation_identity(r, fingerprint));
            parameters
        };
        let mut statements = vec![Statement::new(
            &format!(
                "INSERT INTO collections(owner_sub,id,kind,title,notes,source_id,source_title,last_operation) SELECT ?,?,4,?,?,?,?,? FROM collections WHERE owner_sub=? AND id=? AND revision=? AND kind=3 AND archived=0 AND trashed=0 AND NOT EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=collections.id) AND {NO_CONFLICTING_RECEIPT} ON CONFLICT(owner_sub,id) DO NOTHING"
            ),
            {
                let mut parameters = vec![
                    self.owner(),
                    run.id.clone(),
                    run.title.clone(),
                    run.notes.clone(),
                    source.id.clone(),
                    source.title.clone(),
                    r.operation_id.clone(),
                    self.owner(),
                    source.id.clone(),
                    r.expected_revision.to_string(),
                ];
                parameters.extend(self.operation_identity(r, fingerprint));
                parameters
            },
        )];
        let mut copies = Vec::new();
        for rows in section_json {
            copies.push(Statement::new("INSERT INTO list_sections(owner_sub,collection_id,id,title,position) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.position') FROM json_each(?) AS input WHERE NOT EXISTS(SELECT 1 FROM list_sections WHERE owner_sub=? AND collection_id=? AND id=json_extract(input.value,'$.id')) AND @guard",vec![self.owner(),run.id.clone(),rows,self.owner(),run.id.clone()]));
        }
        for rows in item_json {
            copies.push(Statement::new("INSERT INTO list_items(owner_sub,collection_id,id,title,notes,section_id,position) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.notes'),json_extract(value,'$.section_id'),json_extract(value,'$.position') FROM json_each(?) AS input WHERE NOT EXISTS(SELECT 1 FROM list_items WHERE owner_sub=? AND collection_id=? AND id=json_extract(input.value,'$.id')) AND @guard",vec![self.owner(),run.id.clone(),rows,self.owner(),run.id.clone()]));
        }
        copies.extend(history_writes(
            &self.owner(),
            &run.id,
            &r.operation_id,
            events,
        )?);
        copies.push(Statement::new("INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint) SELECT ?,?,?,? WHERE @guard ON CONFLICT(owner_sub,operation_id) DO NOTHING",vec![self.owner(),r.operation_id.clone(),run.id.clone(),fingerprint.into()]));
        for mut copy in copies {
            copy.sql = copy.sql.replace("@guard", &guard);
            copy.params.extend(guard_params.clone());
            statements.push(copy);
        }
        self.0.db.batch(&statements).await?;
        let saved = self.receipt(&r.operation_id).await?.ok_or_else(conflict)?;
        if saved.collection_id != run.id || saved.fingerprint != fingerprint {
            return Err(conflict());
        }
        Ok(ChangeResult {
            collection: self.get(&run.id).await?.into(),
            ..Default::default()
        })
    }
}
#[allow(refining_impl_trait)]
impl ListService for Lists {
    async fn list_trashed_items(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, TrashQuery>,
    ) -> ServiceResult<TrashPage> {
        let service = Lists::authorized(self.0.clone(), &ctx).await?;
        if !r.cursor.is_empty() && !valid_id(r.cursor) {
            return Err(ConnectError::invalid_argument("Invalid Trash cursor."));
        }
        let mut rows=service.0.db.query::<TrashedRow>("SELECT i.*,json_object('id',c.id,'kind',c.kind,'title',c.title,'notes',c.notes,'completed',c.completed,'archived',c.archived,'trashed',c.trashed,'finished',c.finished,'revision',c.revision,'sequence',c.sequence,'source_id',c.source_id,'source_title',c.source_title,'erasure_pending',EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=c.id)) AS parent_json FROM list_items i JOIN collections c ON c.owner_sub=i.owner_sub AND c.id=i.collection_id WHERE i.owner_sub=? AND i.trashed=1 AND (?='' OR i.id>?) ORDER BY i.id LIMIT 51",&[service.owner(),r.cursor.into(),r.cursor.into()]).await?;
        let more = rows.len() > 50;
        rows.truncate(50);
        let next_cursor = if more {
            rows.last().map(|r| r.item.id.clone()).unwrap_or_default()
        } else {
            String::new()
        };
        let items = rows
            .into_iter()
            .map(|row| {
                let parent: Collection = serde_json::from_str::<CollectionRow>(&row.parent_json)
                    .map_err(|_| ConnectError::internal("Invalid parent data."))?
                    .into();
                Ok(TrashedItem {
                    parent: parent.into(),
                    item: ListItem::from(row.item).into(),
                    ..Default::default()
                })
            })
            .collect::<Result<_, ConnectError>>()?;
        Response::ok(TrashPage {
            items,
            next_cursor,
            ..Default::default()
        })
    }
    async fn get_collection(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, CollectionKey>,
    ) -> ServiceResult<Collection> {
        let service = Lists::authorized(self.0.clone(), &ctx).await?;
        Response::ok(service.get(r.id).await?)
    }
    async fn list_collections(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, CollectionQuery>,
    ) -> ServiceResult<CollectionPage> {
        let service = Lists::authorized(self.0.clone(), &ctx).await?;
        let kind = r.kind.to_i32();
        if !(0..=4).contains(&kind) {
            return Err(ConnectError::invalid_argument("Unknown collection kind."));
        }
        let cursor = if r.cursor.is_empty() {
            None
        } else {
            Some(service.get(r.cursor).await?)
        };
        let title = cursor.as_ref().map(|c| c.title.clone()).unwrap_or_default();
        let (page_filter, order, page_params) = if kind == 4 {
            (
                "(?='' OR sequence<CAST(? AS INTEGER))",
                "sequence DESC",
                vec![
                    r.cursor.to_string(),
                    cursor
                        .as_ref()
                        .map(|c| c.created_order)
                        .unwrap_or(0)
                        .to_string(),
                ],
            )
        } else if kind == 1 {
            (
                "(?='' OR completed>CAST(? AS INTEGER) OR (completed=CAST(? AS INTEGER) AND sequence<CAST(? AS INTEGER)))",
                "completed,sequence DESC",
                vec![
                    r.cursor.to_string(),
                    i32::from(cursor.as_ref().is_some_and(|c| c.completed)).to_string(),
                    i32::from(cursor.as_ref().is_some_and(|c| c.completed)).to_string(),
                    cursor
                        .as_ref()
                        .map(|c| c.created_order)
                        .unwrap_or(0)
                        .to_string(),
                ],
            )
        } else {
            (
                "(?='' OR title COLLATE NOCASE>? COLLATE NOCASE OR (title COLLATE NOCASE=? COLLATE NOCASE AND id>?))",
                "title COLLATE NOCASE,id",
                vec![
                    r.cursor.to_string(),
                    title.clone(),
                    title,
                    r.cursor.to_string(),
                ],
            )
        };
        let mut params = vec![
            service.owner(),
            kind.to_string(),
            kind.to_string(),
            i32::from(r.trashed).to_string(),
            i32::from(r.archived).to_string(),
            i32::from(r.trashed).to_string(),
            kind.to_string(),
            i32::from(r.finished).to_string(),
        ];
        params.extend(page_params);
        let sql = format!(
            "SELECT c.*,EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=c.id) AS erasure_pending,(SELECT count(*) FROM list_items i WHERE i.owner_sub=c.owner_sub AND i.collection_id=c.id AND i.trashed=0) AS item_count,(SELECT count(*) FROM list_items i WHERE i.owner_sub=c.owner_sub AND i.collection_id=c.id AND i.trashed=0 AND i.completed=1) AS completed_count FROM collections c WHERE owner_sub=? AND (CAST(? AS INTEGER)=0 OR kind=?) AND (CAST(? AS INTEGER)=1 OR archived=?) AND trashed=? AND (CAST(? AS INTEGER)!=4 OR finished=?) AND {page_filter} ORDER BY {order} LIMIT 51"
        );
        let mut rows = service.0.db.query::<CollectionRow>(&sql, &params).await?;
        let more = rows.len() > 50;
        rows.truncate(50);
        let next_cursor = if more {
            rows.last().map(|r| r.id.clone()).unwrap_or_default()
        } else {
            String::new()
        };
        Response::ok(CollectionPage {
            collections: rows.into_iter().map(Into::into).collect(),
            next_cursor,
            ..Default::default()
        })
    }
    async fn apply_change(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, ChangeRequest>,
    ) -> ServiceResult<ChangeResult> {
        let service = Lists::authorized(self.0.clone(), &ctx).await?;
        Response::ok(service.apply(r.to_owned_message()).await?)
    }
    async fn list_history(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HistoryQuery>,
    ) -> ServiceResult<HistoryPage> {
        let service = Lists::authorized(self.0.clone(), &ctx).await?;
        service.get(r.collection_id).await?;
        let mut rows=service.0.db.query::<HistoryRow>("SELECT sequence,target_id,target_title,action,occurred_at,before_json,after_json FROM collection_history WHERE owner_sub=? AND collection_id=? AND (CAST(? AS INTEGER)=0 OR sequence<?) ORDER BY sequence DESC LIMIT 51",&[service.owner(),r.collection_id.into(),r.before_sequence.to_string(),r.before_sequence.to_string()]).await?;
        let more = rows.len() > 50;
        rows.truncate(50);
        let next_before_sequence = if more {
            rows.last().map(|r| r.sequence).unwrap_or_default()
        } else {
            0
        };
        Response::ok(HistoryPage {
            entries: rows
                .into_iter()
                .map(|row| HistoryEntry {
                    sequence: row.sequence,
                    actor: "Owner".into(),
                    occurred_at: row.occurred_at,
                    target_id: row.target_id,
                    target_title: row.target_title,
                    action: row.action,
                    before_json: row.before_json,
                    after_json: row.after_json,
                    ..Default::default()
                })
                .collect(),
            next_before_sequence,
            ..Default::default()
        })
    }
}

impl Lists {
    pub(crate) async fn apply(&self, r: ChangeRequest) -> Result<ChangeResult, ConnectError> {
        if !valid_id(&r.operation_id) || !valid_id(&r.collection_id) {
            return Err(ConnectError::invalid_argument(
                "Valid action and collection IDs are required.",
            ));
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&r)
                    .map_err(|_| ConnectError::invalid_argument("Invalid change."))?
            )
        );
        if let Some(receipt) = self.receipt(&r.operation_id).await? {
            if receipt.collection_id != r.collection_id || receipt.fingerprint != fingerprint {
                return Err(conflict());
            }
            return Ok(ChangeResult {
                collection: if receipt.erased_scope == "collection" {
                    Default::default()
                } else {
                    self.get(&r.collection_id).await?.into()
                },
                erased: !receipt.erased_scope.is_empty(),
                ..Default::default()
            });
        }
        if matches!(
            r.action.as_known(),
            Some(ChangeAction::EraseItem | ChangeAction::EraseCollection)
        ) {
            return self.erase(&r, &fingerprint).await;
        }
        if r.action.as_known() == Some(ChangeAction::CreateCollection) {
            return self.create(&r, &fingerprint).await;
        }
        if r.action.as_known() == Some(ChangeAction::StartRun) {
            return self.start_run(&r, &fingerprint).await;
        }
        self.mutate(&r, &fingerprint).await
    }
}
