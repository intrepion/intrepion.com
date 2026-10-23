// MVP 1 compatibility: all content now lives in collections; DeleteTask uses Trash.
use crate::{
    auth::SharedAuth,
    lists::{Lists, valid_id, validate_text},
    proto::life::v1::*,
};
use connectrpc::{
    ConnectError, ErrorCode, RequestContext, Response, ServiceRequest, ServiceResult,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub struct Tasks(pub SharedAuth);
#[derive(Deserialize)]
struct Row {
    id: String,
    title: String,
    notes: String,
    completed: i32,
    revision: u32,
    sequence: u64,
    erasure_pending: i32,
}
impl From<Row> for Task {
    fn from(row: Row) -> Self {
        Self {
            id: row.id,
            title: row.title,
            notes: row.notes,
            completed: row.completed != 0,
            revision: row.revision,
            created_order: row.sequence,
            erasure_pending: row.erasure_pending != 0,
            ..Default::default()
        }
    }
}
fn task(c: Collection) -> Result<Task, ConnectError> {
    if c.kind.as_known() != Some(CollectionKind::Task) || c.trashed {
        return Err(ConnectError::not_found(
            "Task no longer exists. Reload the list.",
        ));
    }
    Ok(Task {
        id: c.id,
        title: c.title,
        notes: c.notes,
        completed: c.completed,
        revision: c.revision,
        created_order: c.created_order,
        erasure_pending: c.erasure_pending,
        ..Default::default()
    })
}
fn action_id(kind: &str, id: &str, revision: u32, values: &str) -> String {
    let hex = format!(
        "{:x}",
        Sha256::digest(format!("legacy/{kind}/{id}/{revision}/{values}"))
    );
    format!(
        "{}-{}-4{}-a{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[13..16],
        &hex[17..20],
        &hex[20..32]
    )
}
fn validate(t: &Task) -> Result<(), ConnectError> {
    if !valid_id(&t.id) {
        return Err(ConnectError::invalid_argument("Invalid task ID."));
    }
    validate_text(&t.title, &t.notes)
}
fn details(t: &Task) -> CollectionDetails {
    CollectionDetails {
        kind: CollectionKind::Task.into(),
        title: t.title.clone(),
        notes: t.notes.clone(),
        completed: t.completed,
        ..Default::default()
    }
}
#[allow(refining_impl_trait)]
impl TaskService for Tasks {
    async fn list_tasks(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<TaskList> {
        let lists = Lists::authorized(self.0.clone(), &ctx).await?;
        let rows=self.0.db.query::<Row>("SELECT c.id,c.title,c.notes,c.completed,c.revision,c.sequence,EXISTS(SELECT 1 FROM erasure_intents e WHERE e.collection_id=c.id) AS erasure_pending FROM collections c WHERE c.owner_sub=? AND c.kind=1 AND trashed=0 ORDER BY completed,sequence DESC",&[lists.owner()]).await?;
        Response::ok(TaskList {
            tasks: rows.into_iter().map(Into::into).collect(),
            ..Default::default()
        })
    }
    async fn create_task(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        let lists = Lists::authorized(self.0.clone(), &ctx).await?;
        let t = r.to_owned_message();
        validate(&t)?;
        match lists.get(&t.id).await {
            Ok(existing) => {
                let saved = task(existing)?;
                if saved.title != t.title
                    || saved.notes != t.notes
                    || saved.completed != t.completed
                {
                    return Err(ConnectError::failed_precondition(
                        "This action ID already belongs to a task with different values. Keep your draft and reload.",
                    ));
                }
                return Response::ok(saved);
            }
            Err(error) if error.code == ErrorCode::NotFound => {}
            Err(error) => return Err(error),
        }
        let retired = self
            .0
            .db
            .query::<serde_json::Value>(
                "SELECT id FROM retired_task_ids WHERE owner_sub=? AND id=?",
                &[lists.owner(), t.id.clone()],
            )
            .await?;
        if !retired.is_empty() {
            return Err(ConnectError::not_found("Task no longer exists."));
        }
        let result = lists
            .apply(ChangeRequest {
                operation_id: action_id("create", &t.id, 0, ""),
                collection_id: t.id.clone(),
                action: ChangeAction::CreateCollection.into(),
                details: details(&t).into(),
                ..Default::default()
            })
            .await?;
        Response::ok(task((*result.collection).clone())?)
    }
    async fn update_task(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        let lists = Lists::authorized(self.0.clone(), &ctx).await?;
        let t = r.to_owned_message();
        validate(&t)?;
        let saved = task(lists.get(&t.id).await?)?;
        if saved.title == t.title && saved.notes == t.notes && saved.completed == t.completed {
            return Response::ok(saved);
        }
        let values = serde_json::to_string(&details(&t))
            .map_err(|_| ConnectError::invalid_argument("Invalid task."))?;
        let result = lists
            .apply(ChangeRequest {
                operation_id: action_id("update", &t.id, t.revision, &values),
                collection_id: t.id.clone(),
                expected_revision: t.revision,
                action: ChangeAction::UpdateMetadata.into(),
                details: details(&t).into(),
                ..Default::default()
            })
            .await?;
        Response::ok(task((*result.collection).clone())?)
    }
    async fn delete_task(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, TaskId>,
    ) -> ServiceResult<Empty> {
        let lists = Lists::authorized(self.0.clone(), &ctx).await?;
        if !valid_id(r.id) {
            return Err(ConnectError::invalid_argument("Invalid task ID."));
        }
        if r.revision == 0 {
            return Err(ConnectError::failed_precondition(
                "Reload the application before removing this task; its current revision is required.",
            ));
        }
        match lists.get(r.id).await {
            Ok(c) if c.kind.as_known() != Some(CollectionKind::Task) => {
                return Err(ConnectError::not_found("Task no longer exists."));
            }
            Ok(c) if c.trashed => return Response::ok(Empty::default()),
            Ok(_) => {}
            Err(error) if error.code == ErrorCode::NotFound => {
                return Response::ok(Empty::default());
            }
            Err(error) => return Err(error),
        }
        lists
            .apply(ChangeRequest {
                operation_id: action_id("trash", r.id, r.revision, ""),
                collection_id: r.id.into(),
                expected_revision: r.revision,
                action: ChangeAction::TrashCollection.into(),
                ..Default::default()
            })
            .await?;
        Response::ok(Empty::default())
    }
}
