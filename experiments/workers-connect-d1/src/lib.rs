use connectrpc::{ConnectError, RequestContext, Response, Router, ServiceRequest, ServiceResult};
use serde::Deserialize;
use std::sync::Arc;
use tower::Service;
use worker::{Context, D1Database, Env, HttpRequest, event, send::SendFuture};

mod proto {
    connectrpc::include_generated!();
}

use proto::experiment::v1::*;

struct TaskServiceImpl {
    db: D1Database,
}

fn authorize(ctx: &RequestContext) -> Result<(), ConnectError> {
    match ctx
        .header("authorization")
        .and_then(|value| value.to_str().ok())
    {
        Some("Bearer local-owner") => Ok(()),
        Some(_) => Err(ConnectError::permission_denied("owner access required")),
        None => Err(ConnectError::unauthenticated(
            "local test identity required",
        )),
    }
}

fn database_error(_: worker::Error) -> ConnectError {
    ConnectError::internal("experiment database operation failed")
}

fn validate(task: &Task) -> Result<(), ConnectError> {
    if task.id.is_empty()
        || task.title.trim().is_empty()
        || task.title.chars().count() > 200
        || task.notes.chars().count() > 10_000
    {
        return Err(ConnectError::invalid_argument("invalid task fields"));
    }
    Ok(())
}

#[derive(Deserialize)]
struct StoredTask {
    id: String,
    title: String,
    notes: String,
    completed: i32,
}

impl From<StoredTask> for Task {
    fn from(task: StoredTask) -> Self {
        Self {
            id: task.id,
            title: task.title,
            notes: task.notes,
            completed: task.completed != 0,
            ..Default::default()
        }
    }
}

// The generated trait intentionally permits refining the encoded response type.
#[allow(refining_impl_trait)]
impl TaskService for TaskServiceImpl {
    async fn echo(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, EchoRequest>,
    ) -> ServiceResult<EchoResponse> {
        authorize(&ctx)?;
        if request.title == "delay" {
            SendFuture::new(worker::Delay::from(std::time::Duration::from_millis(100))).await;
        }
        Response::ok(EchoResponse {
            title: request.title.to_string(),
            ..Default::default()
        })
    }

    async fn create_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        authorize(&ctx)?;
        let task = request.to_owned_message();
        validate(&task)?;
        SendFuture::new(async {
            let exists = self
                .db
                .prepare("SELECT id FROM tasks WHERE id = ?")
                .bind(&[task.id.clone().into()])
                .map_err(database_error)?
                .first::<String>(Some("id"))
                .await
                .map_err(database_error)?;
            if exists.is_some() {
                return Err(ConnectError::already_exists("task already exists"));
            }
            self.db
                .prepare("INSERT INTO tasks (id, title, notes, completed) VALUES (?, ?, ?, ?)")
                .bind(&[
                    task.id.clone().into(),
                    task.title.clone().into(),
                    task.notes.clone().into(),
                    i32::from(task.completed).into(),
                ])
                .map_err(database_error)?
                .run()
                .await
                .map_err(database_error)?;
            Response::ok(task)
        })
        .await
    }

    async fn list_tasks(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<TaskList> {
        authorize(&ctx)?;
        SendFuture::new(async {
            let tasks = self.db.prepare("SELECT id, title, notes, completed FROM tasks ORDER BY completed ASC, sequence DESC")
                .all().await.map_err(database_error)?
                .results::<StoredTask>().map_err(database_error)?;
            Response::ok(TaskList { tasks: tasks.into_iter().map(Into::into).collect(), ..Default::default() })
        }).await
    }

    async fn update_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        authorize(&ctx)?;
        let task = request.to_owned_message();
        validate(&task)?;
        SendFuture::new(async {
            let stored = self.db.prepare("UPDATE tasks SET title = ?, notes = ?, completed = ? WHERE id = ? RETURNING id, title, notes, completed")
                .bind(&[task.title.clone().into(), task.notes.clone().into(), i32::from(task.completed).into(), task.id.clone().into()])
                .map_err(database_error)?.first::<StoredTask>(None).await.map_err(database_error)?;
            match stored {
                Some(stored) => Response::ok(stored.into()),
                None => Err(ConnectError::not_found("task not found")),
            }
        }).await
    }

    async fn delete_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, TaskId>,
    ) -> ServiceResult<Empty> {
        authorize(&ctx)?;
        let id = request.id.to_string();
        SendFuture::new(async {
            let deleted = self
                .db
                .prepare("DELETE FROM tasks WHERE id = ? RETURNING id")
                .bind(&[id.into()])
                .map_err(database_error)?
                .first::<String>(Some("id"))
                .await
                .map_err(database_error)?;
            match deleted {
                Some(_) => Response::ok(Empty::default()),
                None => Err(ConnectError::not_found("task not found")),
            }
        })
        .await
    }
}

#[event(fetch)]
async fn fetch(
    request: HttpRequest,
    env: Env,
    _context: Context,
) -> worker::Result<http::Response<axum::body::Body>> {
    if !matches!(
        env.var("EXPERIMENT_LOCAL_ONLY")
            .map(|v| v.to_string())
            .as_deref(),
        Ok("true")
    ) {
        return Ok(http::Response::builder()
            .status(503)
            .body(axum::body::Body::from("local experiment disabled"))?);
    }
    let allowed_origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        == Some("http://localhost:4321");
    if request.method() == http::Method::OPTIONS {
        let mut response = http::Response::builder().status(if allowed_origin { 204 } else { 403 });
        if allowed_origin {
            response = response.header("access-control-allow-origin", "http://localhost:4321")
                .header("access-control-allow-methods", "POST, OPTIONS")
                .header("access-control-allow-headers", "authorization, content-type, connect-protocol-version, connect-timeout-ms, x-user-agent")
                .header("vary", "Origin");
        }
        return Ok(response.body(axum::body::Body::empty())?);
    }
    let mut router = Router::new()
        .add_service(Arc::new(TaskServiceImpl { db: env.d1("DB")? }))
        .into_axum_router();
    let mut response = router.call(request).await?;
    if allowed_origin {
        response.headers_mut().insert(
            "access-control-allow-origin",
            "http://localhost:4321".parse().unwrap(),
        );
        response
            .headers_mut()
            .insert("vary", "Origin".parse().unwrap());
    }
    Ok(response)
}
