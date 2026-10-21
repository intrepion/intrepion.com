use crate::{auth::SharedAuth, proto::life::v1::*};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;

pub struct Tasks(pub SharedAuth);

#[derive(Deserialize)]
struct Row {
    id: String,
    title: String,
    notes: String,
    completed: i32,
    revision: u32,
    sequence: u64,
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
            ..Default::default()
        }
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn validate(task: &Task) -> Result<(), ConnectError> {
    if !valid_id(&task.id)
        || task.title.trim().is_empty()
        || task.title.chars().count() > 200
        || task.notes.chars().count() > 10000
        || task.title.contains('\0')
        || task.notes.contains('\0')
    {
        return Err(ConnectError::invalid_argument(
            "Use a title of 1–200 characters and notes of at most 10,000 characters.",
        ));
    }
    Ok(())
}
impl Tasks {
    async fn authorize(&self, ctx: &RequestContext) -> Result<(), ConnectError> {
        self.0
            .session(ctx.headers(), true)
            .await
            .map(|_| ())
            .map_err(|error| match error.0 {
                axum::http::StatusCode::UNAUTHORIZED => {
                    ConnectError::unauthenticated("Please sign in again.")
                }
                axum::http::StatusCode::FORBIDDEN => {
                    ConnectError::permission_denied("Owner session and CSRF token required.")
                }
                _ => ConnectError::unavailable("Session service temporarily unavailable."),
            })
    }
    async fn get(&self, id: &str) -> Result<Task, ConnectError> {
        self.0.db.query::<Row>("SELECT id,title,notes,completed,revision,sequence FROM tasks WHERE owner_sub=? AND id=?", &[self.0.config.owner_sub.clone(),id.into()]).await?.pop().map(Into::into).ok_or_else(||ConnectError::not_found("Task no longer exists. Reload the list."))
    }
}

#[allow(refining_impl_trait)]
impl TaskService for Tasks {
    async fn list_tasks(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<TaskList> {
        self.authorize(&ctx).await?;
        let rows = self.0.db.query::<Row>("SELECT id,title,notes,completed,revision,sequence FROM tasks WHERE owner_sub=? ORDER BY completed ASC, sequence DESC", std::slice::from_ref(&self.0.config.owner_sub)).await?;
        Response::ok(TaskList {
            tasks: rows.into_iter().map(Into::into).collect(),
            ..Default::default()
        })
    }
    async fn create_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        self.authorize(&ctx).await?;
        let task = request.to_owned_message();
        validate(&task)?;
        self.0.db.query::<serde_json::Value>("INSERT INTO tasks(owner_sub,id,title,notes,completed) VALUES(?,?,?,?,?) ON CONFLICT(owner_sub,id) DO NOTHING", &[self.0.config.owner_sub.clone(),task.id.clone(),task.title.clone(),task.notes.clone(),i32::from(task.completed).to_string()]).await?;
        let stored = self.get(&task.id).await?;
        if stored.title != task.title
            || stored.notes != task.notes
            || stored.completed != task.completed
        {
            return Err(ConnectError::failed_precondition(
                "A task with this action ID was already saved with different values. Your draft is preserved. Reload the list before editing that task.",
            ));
        }
        Response::ok(stored)
    }
    async fn update_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        self.authorize(&ctx).await?;
        let task = request.to_owned_message();
        validate(&task)?;
        let updated=self.0.db.query::<Row>("UPDATE tasks SET title=?,notes=?,completed=?,revision=revision+1 WHERE owner_sub=? AND id=? AND revision=? RETURNING id,title,notes,completed,revision,sequence", &[task.title.clone(),task.notes.clone(),i32::from(task.completed).to_string(),self.0.config.owner_sub.clone(),task.id.clone(),task.revision.to_string()]).await?;
        if let Some(row) = updated.into_iter().next() {
            return Response::ok(row.into());
        }
        let stored = self.get(&task.id).await?;
        if stored.title == task.title
            && stored.notes == task.notes
            && stored.completed == task.completed
        {
            return Response::ok(stored);
        }
        Err(ConnectError::failed_precondition(
            "This task changed in another window. Keep your draft, reload the list, and reconcile the changes.",
        ))
    }
    async fn delete_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, TaskId>,
    ) -> ServiceResult<Empty> {
        self.authorize(&ctx).await?;
        if !valid_id(request.id) {
            return Err(ConnectError::invalid_argument("Invalid task ID."));
        }
        self.0
            .db
            .query::<serde_json::Value>(
                "DELETE FROM tasks WHERE owner_sub=? AND id=?",
                &[self.0.config.owner_sub.clone(), request.id.to_string()],
            )
            .await?;
        Response::ok(Empty::default())
    }
}
