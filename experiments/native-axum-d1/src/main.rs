mod d1;

use connectrpc::{ConnectError, RequestContext, Response, Router, ServiceRequest, ServiceResult};
use d1::D1Client;
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tower_http::cors::CorsLayer;

mod proto {
    connectrpc::include_generated!();
}
use proto::experiment::v1::*;

struct TaskServiceImpl {
    db: D1Client,
}

fn authorize(ctx: &RequestContext) -> Result<(), ConnectError> {
    match ctx.header("authorization").and_then(|v| v.to_str().ok()) {
        Some("Bearer local-owner") => Ok(()),
        Some(_) => Err(ConnectError::permission_denied("owner access required")),
        None => Err(ConnectError::unauthenticated(
            "local test identity required",
        )),
    }
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

#[allow(refining_impl_trait)]
impl TaskService for TaskServiceImpl {
    async fn echo(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, EchoRequest>,
    ) -> ServiceResult<EchoResponse> {
        authorize(&ctx)?;
        if request.title == "delay" {
            tokio::time::sleep(Duration::from_millis(100)).await;
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
        let mut rows = self.db.query::<StoredTask>(
            "INSERT INTO tasks (id, title, notes, completed) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id, title, notes, completed",
            &[task.id, task.title, task.notes, i32::from(task.completed).to_string()],
        ).await.map_err(d1::DatabaseError::into_rpc)?;
        match rows.pop() {
            Some(row) => Response::ok(row.into()),
            None => Err(ConnectError::already_exists("task already exists")),
        }
    }

    async fn list_tasks(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<TaskList> {
        authorize(&ctx)?;
        let rows = self.db.query::<StoredTask>(
            "SELECT id, title, notes, completed FROM tasks ORDER BY completed ASC, sequence DESC", &[],
        ).await.map_err(d1::DatabaseError::into_rpc)?;
        Response::ok(TaskList {
            tasks: rows.into_iter().map(Into::into).collect(),
            ..Default::default()
        })
    }

    async fn update_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, Task>,
    ) -> ServiceResult<Task> {
        authorize(&ctx)?;
        let task = request.to_owned_message();
        validate(&task)?;
        let mut rows = self.db.query::<StoredTask>(
            "UPDATE tasks SET title = ?, notes = ?, completed = ? WHERE id = ? RETURNING id, title, notes, completed",
            &[task.title, task.notes, i32::from(task.completed).to_string(), task.id],
        ).await.map_err(d1::DatabaseError::into_rpc)?;
        match rows.pop() {
            Some(row) => Response::ok(row.into()),
            None => Err(ConnectError::not_found("task not found")),
        }
    }

    async fn delete_task(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, TaskId>,
    ) -> ServiceResult<Empty> {
        authorize(&ctx)?;
        let rows = self
            .db
            .query::<serde_json::Value>(
                "DELETE FROM tasks WHERE id = ? RETURNING id",
                &[request.id.to_string()],
            )
            .await
            .map_err(d1::DatabaseError::into_rpc)?;
        if rows.is_empty() {
            return Err(ConnectError::not_found("task not found"));
        }
        Response::ok(Empty::default())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("EXPERIMENT_LOCAL_ONLY").as_deref() != Ok("true") {
        return Err("set EXPERIMENT_LOCAL_ONLY=true for synthetic local identities; this is not a deployable server".into());
    }
    let db = D1Client::new(
        "http://127.0.0.1:8791/client/v4/accounts/local/d1/database/local/query".into(),
        "local-d1-token".into(),
    )?;
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(|origin, _| {
            origin == "http://localhost:4321"
        }))
        .allow_methods([axum::http::Method::POST, axum::http::Method::OPTIONS])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("connect-protocol-version"),
            axum::http::HeaderName::from_static("connect-timeout-ms"),
            axum::http::HeaderName::from_static("x-user-agent"),
        ]);
    let app = Router::new()
        .add_service(Arc::new(TaskServiceImpl { db }))
        .into_axum_router()
        .layer(cors);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8790").await?;
    println!("Native Axum + local D1 bridge on http://127.0.0.1:8790 (synthetic identity only)");
    axum::serve(listener, app).await?;
    Ok(())
}
