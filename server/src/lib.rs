pub mod auth;
pub mod config;
pub mod db;
mod tasks;
pub mod proto {
    connectrpc::include_generated!();
}

use auth::SharedAuth;
use axum::{
    Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderValue, Method, header},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use std::{sync::Arc, time::Instant};
use tower_http::cors::CorsLayer;

pub fn app(auth: SharedAuth) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            auth.config
                .web_origin
                .parse::<HeaderValue>()
                .expect("validated origin"),
        )
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-csrf-token"),
            axum::http::HeaderName::from_static("connect-protocol-version"),
            axum::http::HeaderName::from_static("connect-timeout-ms"),
            axum::http::HeaderName::from_static("x-user-agent"),
        ]);
    let router = Router::new()
        .route("/health/live", get(|| async { "ok" }))
        .route("/auth/config", get(auth::configuration))
        .route("/auth/challenge", post(auth::challenge))
        .route("/auth/google", post(auth::login))
        .route("/auth/session", get(auth::current_session))
        .route("/auth/logout", post(auth::logout));
    #[cfg(feature = "dev-auth")]
    let router = router.route("/auth/development", post(auth::development_login));
    let mut rpc = connectrpc::Router::new().add_service(Arc::new(tasks::Tasks(auth.clone())));
    for method in ["ListTasks", "CreateTask", "UpdateTask", "DeleteTask"] {
        rpc = rpc.with_route_limits(
            &format!("life.v1.TaskService/{method}"),
            connectrpc::Limits::default()
                .with_max_request_body_size(64 * 1024)
                .with_max_message_size(64 * 1024),
        );
    }
    router
        .with_state(auth.clone())
        .merge(rpc.into_axum_router())
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(cors)
        .layer(middleware::from_fn(observe))
}

#[cfg(all(test, not(feature = "dev-auth")))]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn normal_build_does_not_expose_development_login() {
        let config = crate::config::Config {
            bind: "127.0.0.1:8788".parse().unwrap(),
            web_origin: "https://intrepion.com".into(),
            db_url: "http://127.0.0.1:1/query".into(),
            db_token: "unused-test-token".into(),
            google_client_id: "client".into(),
            owner_sub: "owner".into(),
            local: false,
        };
        let db = crate::db::Database::new(config.db_url.clone(), config.db_token.clone()).unwrap();
        let response = app(crate::auth::Auth::new(config, db).unwrap())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/development")
                    .header("content-type", "application/json")
                    .header("connect-protocol-version", "1")
                    .body(axum::body::Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }
}

async fn observe(request: Request, next: Next) -> Response {
    let start = Instant::now();
    let path = request.uri().path();
    let route = match path {
        "/life.v1.TaskService/ListTasks" => "list",
        "/life.v1.TaskService/CreateTask" => "create",
        "/life.v1.TaskService/UpdateTask" => "update",
        "/life.v1.TaskService/DeleteTask" => "delete",
        "/health/live" => "health",
        path if path.starts_with("/auth/") => "auth",
        _ => "other",
    };
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    eprintln!(
        "{}",
        serde_json::json!({"event":"request","route":route,"status":response.status().as_u16(),"duration_ms":start.elapsed().as_millis()})
    );
    response
}
