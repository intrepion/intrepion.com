pub mod auth;
pub mod config;
pub mod db;
mod login_limit;
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
    async fn one_caller_cannot_exhaust_another_callers_login_allowance() {
        for trust_render_proxy in [false, true] {
            let config = crate::config::Config {
                bind: "127.0.0.1:8788".parse().unwrap(),
                web_origin: "https://intrepion.com".into(),
                db_url: "http://127.0.0.1:1/query".into(),
                db_token: "unused-test-token".into(),
                google_client_id: "client".into(),
                owner_sub: "owner".into(),
                local: false,
                trust_render_proxy,
            };
            let db =
                crate::db::Database::new(config.db_url.clone(), config.db_token.clone()).unwrap();
            let router = app(crate::auth::Auth::new(config, db).unwrap());
            for attempt in 0..31 {
                let response = router
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri("/auth/google")
                            .header("content-type", "application/json")
                            .header("origin", "https://intrepion.com")
                            .header(
                                "x-forwarded-for",
                                if trust_render_proxy {
                                    "198.51.100.1".to_string()
                                } else {
                                    format!("198.51.100.{}", attempt + 1)
                                },
                            )
                            .extension(axum::extract::ConnectInfo(
                                "192.0.2.1:1234".parse::<std::net::SocketAddr>().unwrap(),
                            ))
                            .body(axum::body::Body::from(r#"{"nonce":"","credential":""}"#))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    if attempt < 30 {
                        axum::http::StatusCode::UNAUTHORIZED
                    } else {
                        axum::http::StatusCode::TOO_MANY_REQUESTS
                    }
                );
            }
            let response = router
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/auth/google")
                        .header("content-type", "application/json")
                        .header("origin", "https://intrepion.com")
                        .header("x-forwarded-for", "198.51.100.2")
                        .extension(axum::extract::ConnectInfo(
                            "192.0.2.2:1234".parse::<std::net::SocketAddr>().unwrap(),
                        ))
                        .body(axum::body::Body::from(r#"{"nonce":"","credential":""}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
        }
    }
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
            trust_render_proxy: false,
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
