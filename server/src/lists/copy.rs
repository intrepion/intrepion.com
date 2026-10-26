use super::*;
use crate::capacity::{self, Amounts};
struct PreparedCopy {
    source: Collection,
    copied: Collection,
    events: Vec<Event>,
    required: Amounts,
}
fn fingerprint(actor: &str, r: &CopyRequest) -> Result<String, ConnectError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&serde_json::json!({"actor":actor,"copy":r}))
                .map_err(|_| ConnectError::invalid_argument("Invalid copy request."))?
        )
    ))
}
fn validate_copy(r: &CopyRequest) -> Result<(), ConnectError> {
    if [
        &r.operation_id,
        &r.source_collection_id,
        &r.household_id,
        &r.destination_collection_id,
    ]
    .iter()
    .any(|id| !valid_id(id))
        || r.expected_source_revision == 0
    {
        return Err(ConnectError::invalid_argument(
            "A copy requires fresh UUIDs and the current source revision.",
        ));
    }
    Ok(())
}
impl Lists {
    async fn prepare_copy(&self, r: &CopyRequest) -> Result<PreparedCopy, ConnectError> {
        validate_copy(r)?;
        let personal = Self(
            self.0.clone(),
            Scope {
                owner: self.1.actor.clone(),
                actor: self.1.actor.clone(),
            },
        );
        let source = personal.get(&r.source_collection_id).await?;
        if source.trashed || source.erasure_pending {
            return Err(ConnectError::failed_precondition(
                "Restore the personal source or finish its pending erasure before copying.",
            ));
        }
        if source.revision != r.expected_source_revision {
            return Err(conflict());
        }
        let derive = |id: &str| {
            let h = format!(
                "{:x}",
                Sha256::digest(format!("personal-copy/{}/{id}", r.operation_id))
            );
            format!(
                "{}-{}-4{}-a{}-{}",
                &h[..8],
                &h[8..12],
                &h[13..16],
                &h[17..20],
                &h[20..32]
            )
        };
        let mut copied = Collection {
            id: r.destination_collection_id.clone(),
            kind: source.kind,
            title: source.title.clone(),
            notes: source.notes.clone(),
            completed: source.completed,
            revision: 1,
            ..Default::default()
        };
        copied.sections = source
            .sections
            .iter()
            .map(|section| ListSection {
                id: derive(&section.id),
                title: section.title.clone(),
                position: section.position,
                ..Default::default()
            })
            .collect();
        copied.items = source
            .items
            .iter()
            .filter(|item| !item.trashed)
            .map(|item| ListItem {
                id: derive(&item.id),
                title: item.title.clone(),
                notes: item.notes.clone(),
                quantity: item.quantity.clone(),
                completed: item.completed,
                section_id: if item.section_id.is_empty() {
                    String::new()
                } else {
                    derive(&item.section_id)
                },
                position: item.position,
                ..Default::default()
            })
            .collect();
        let mut events = vec![Event {
            target: copied.id.clone(),
            title: copied.title.clone(),
            action: "Copied from personal space".into(),
            before: serde_json::Value::Null,
            after: collection_values(&copied),
        }];
        events.extend(copied.sections.iter().map(|section| Event {
            target: section.id.clone(),
            title: section.title.clone(),
            action: "Section copied".into(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"title":section.title,"position":section.position+1}),
        }));
        events.extend(copied.items.iter().map(|item| Event {
            target: item.id.clone(),
            title: item.title.clone(),
            action: "Item copied".into(),
            before: serde_json::Value::Null,
            after: item_values(&copied, item),
        }));
        let mut required = Amounts::default();
        match copied.kind.as_known() {
            Some(CollectionKind::Task) => required.items = 1,
            Some(CollectionKind::Shopping) => required.shopping = 1,
            Some(CollectionKind::Template) => required.templates = 1,
            Some(CollectionKind::Run) => required.runs = 1,
            _ => return Err(ConnectError::internal("Invalid source kind.")),
        }
        required.items += copied.items.len() as u64;
        required.bytes = (copied.title.len()
            + copied.notes.len()
            + copied.sections.iter().map(|s| s.title.len()).sum::<usize>()
            + copied
                .items
                .iter()
                .map(|i| i.title.len() + i.notes.len() + i.quantity.len())
                .sum::<usize>()
            + events
                .iter()
                .map(|event| {
                    event.title.len()
                        + event.before.to_string().len()
                        + event.after.to_string().len()
                })
                .sum::<usize>()) as u64;
        Ok(PreparedCopy {
            source,
            copied,
            events,
            required,
        })
    }
    async fn prepared_preview(&self, p: &PreparedCopy) -> Result<CopyPreview, ConnectError> {
        let normal = capacity::normal_accounts(&self.0.db).await?;
        let usage = capacity::usage(&self.0.db, &self.owner()).await?;
        let capacity =
            capacity::household_capacity(&self.0.db, self.owner().trim_start_matches("household:"))
                .await?;
        let mut result = CopyPreview {
            allowed: true,
            ..Default::default()
        };
        if !normal {
            result.required = p.required.clone().into();
            result.destination_usage = usage.clone().into();
            result.destination_capacity = capacity.clone().into();
        }
        let limits = capacity::structural_limits(&self.0.db).await?;
        if p.copied.items.len() as u64 > limits.max_items_per_collection
            || p.copied.sections.len() as u64 > limits.max_sections_per_collection
        {
            result.allowed = false;
            result.reason = "The source exceeds a per-collection structural cap.".into();
            return Ok(result);
        }
        for (index, key) in capacity::RESOURCES.iter().enumerate() {
            if usage.values()[index]
                .checked_add(p.required.values()[index])
                .is_none_or(|new| new > capacity.values()[index])
            {
                result.allowed = false;
                result.reason = format!(
                    "This complete copy would exceed the destination's {key} allowance. Trash and History remain counted."
                );
                return Ok(result);
            }
        }
        if normal {
            return Ok(result);
        }
        #[derive(Deserialize)]
        struct Ceilings {
            ceilings_json: String,
        }
        let ceiling=self.0.db.query::<Ceilings>("SELECT m.ceilings_json FROM household_heads m JOIN households h ON h.id=m.household_id WHERE h.scope_sub=? AND h.status='active' AND m.subject=? AND m.active=1", &[self.owner(),self.1.actor.clone()]).await?.pop().ok_or_else(||ConnectError::permission_denied("Household access ended."))?;
        let ceiling = serde_json::from_str::<Amounts>(&ceiling.ceilings_json)
            .map_err(|_| ConnectError::internal("Invalid own ceilings."))?;
        let own = capacity::creator_usage(&self.0.db, &self.owner(), &self.1.actor).await?;
        for index in 0..4 {
            if own.values()[index]
                .checked_add(p.required.values()[index])
                .is_none_or(|new| new > ceiling.values()[index])
            {
                result.allowed = false;
                result.reason =
                    "This complete copy would exceed your individual count ceiling.".into();
                return Ok(result);
            }
        }
        Ok(result)
    }
    pub(crate) async fn preview_personal_copy(
        &self,
        r: &CopyRequest,
    ) -> Result<CopyPreview, ConnectError> {
        let prepared = self.prepare_copy(r).await?;
        let mut preview = self.prepared_preview(&prepared).await?;
        if !preview.allowed && capacity::normal_accounts(&self.0.db).await? {
            preview.reason =
                "Your copy was not saved. Please try again later or contact support.".into();
        }
        Ok(preview)
    }
    pub(crate) async fn copy_personal(
        &self,
        r: &CopyRequest,
    ) -> Result<ChangeResult, ConnectError> {
        validate_copy(r)?;
        let fingerprint = fingerprint(&self.1.actor, r)?;
        if let Some(saved) = self.receipt(&r.operation_id).await? {
            if saved.fingerprint != fingerprint
                || saved.collection_id != r.destination_collection_id
                || !saved.erased_scope.is_empty()
            {
                return Err(conflict());
            }
            return Ok(ChangeResult {
                collection: self.get(&saved.collection_id).await?.into(),
                ..Default::default()
            });
        }
        let prepared = self.prepare_copy(r).await?;
        let preview = self.prepared_preview(&prepared).await?;
        if !preview.allowed {
            return Err(ConnectError::resource_exhausted(preview.reason));
        }
        let PreparedCopy {
            source,
            copied,
            events,
            ..
        } = prepared;
        self.ensure_not_retired("collection", &copied.id).await?;
        for item in &copied.items {
            self.ensure_not_retired("item", &item.id).await?;
        }
        for section in &copied.sections {
            self.ensure_not_retired("section", &section.id).await?;
        }
        let guard = format!(
            "EXISTS(SELECT 1 FROM collections WHERE owner_sub=? AND id=? AND last_operation=?) AND {NO_CONFLICTING_RECEIPT}"
        );
        let guard_params = || {
            vec![
                self.owner(),
                copied.id.clone(),
                r.operation_id.clone(),
                self.owner(),
                r.operation_id.clone(),
                fingerprint.clone(),
            ]
        };
        let mut first = vec![
            self.owner(),
            copied.id.clone(),
            copied.kind.to_i32().to_string(),
            copied.title.clone(),
            copied.notes.clone(),
            i32::from(copied.completed).to_string(),
            r.operation_id.clone(),
            self.1.actor.clone(),
            source.id.clone(),
            source.revision.to_string(),
            self.owner(),
            r.operation_id.clone(),
            fingerprint.clone(),
        ];
        let mut statements = vec![Statement::new(
            &format!(
                "INSERT INTO collections(owner_sub,id,kind,title,notes,completed,last_operation) SELECT ?,?,?,?,?,?,? FROM collections source WHERE source.owner_sub=? AND source.id=? AND source.revision=? AND source.trashed=0 AND NOT EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=source.id) AND {NO_CONFLICTING_RECEIPT} ON CONFLICT(owner_sub,id) DO NOTHING"
            ),
            std::mem::take(&mut first),
        )];
        let mut writes = Vec::new();
        for rows in json_chunks(copied.sections.iter().map(|section|serde_json::json!({"id":section.id,"title":section.title,"position":section.position})))?{writes.push(Statement::new("INSERT INTO list_sections(owner_sub,collection_id,id,title,position) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.position') FROM json_each(?) WHERE @guard ON CONFLICT(owner_sub,id) DO NOTHING",vec![self.owner(),copied.id.clone(),rows]));}
        for rows in json_chunks(copied.items.iter().map(|item|serde_json::json!({"id":item.id,"title":item.title,"notes":item.notes,"quantity":item.quantity,"section_id":item.section_id,"completed":i32::from(item.completed),"position":item.position})))?{writes.push(Statement::new("INSERT INTO list_items(owner_sub,collection_id,id,title,notes,quantity,section_id,completed,position) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.notes'),json_extract(value,'$.quantity'),json_extract(value,'$.section_id'),json_extract(value,'$.completed'),json_extract(value,'$.position') FROM json_each(?) WHERE @guard ON CONFLICT(owner_sub,id) DO NOTHING",vec![self.owner(),copied.id.clone(),rows]));}
        writes.extend(history_writes(
            &self.owner(),
            &copied.id,
            &r.operation_id,
            events,
        )?);
        writes.push(Statement::new("INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint) SELECT ?,?,?,? WHERE @guard ON CONFLICT(owner_sub,operation_id) DO NOTHING",vec![self.owner(),r.operation_id.clone(),copied.id.clone(),fingerprint.clone()]));
        for mut statement in writes {
            statement.sql = statement.sql.replace("@guard", &guard);
            statement.params.extend(guard_params());
            statements.push(statement);
        }
        self.write_batch(statements, &r.operation_id, &copied.id)
            .await?;
        let saved = self.receipt(&r.operation_id).await?.ok_or_else(conflict)?;
        if saved.fingerprint != fingerprint || saved.collection_id != copied.id {
            return Err(conflict());
        }
        Ok(ChangeResult {
            collection: self.get(&copied.id).await?.into(),
            ..Default::default()
        })
    }
}
