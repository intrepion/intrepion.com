mod accounts;
pub mod auth;
mod capacity;
pub mod config;
pub mod db;
pub mod erasure_ledger;
mod feedback;
mod households;
mod invitations;
mod lists;
mod login_limit;
pub mod mail;
mod operator;
mod retention;
mod security;
mod tasks;
pub mod proto {
    connectrpc::include_generated!();
}

use auth::SharedAuth;
use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
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
            axum::http::HeaderName::from_static("x-space-id"),
            axum::http::HeaderName::from_static("connect-protocol-version"),
            axum::http::HeaderName::from_static("connect-timeout-ms"),
            axum::http::HeaderName::from_static("x-user-agent"),
        ]);
    let router = Router::new()
        .route("/health/live", get(|| async { "ok" }))
        .route("/email/feedback", post(feedback::receive))
        .route("/auth/config", get(auth::configuration))
        .route("/auth/challenge", post(auth::challenge))
        .route("/auth/google", post(auth::login))
        .route("/auth/session", get(auth::current_session))
        .route("/auth/logout", post(auth::logout));
    #[cfg(feature = "dev-auth")]
    let router = router.route("/auth/development", post(auth::development_login));
    let mut rpc = connectrpc::Router::new()
        .add_service(Arc::new(households::Households(auth.clone())))
        .add_service(Arc::new(households::Maintenance(auth.clone())))
        .add_service(Arc::new(operator::Operator(auth.clone())))
        .add_service(Arc::new(accounts::Administration(auth.clone())))
        .add_service(Arc::new(invitations::Invitations(auth.clone())))
        .add_service(Arc::new(mail::Delivery(auth.clone())))
        .add_service(Arc::new(tasks::Tasks(auth.clone())))
        .add_service(Arc::new(lists::Lists(auth.clone(), Default::default())));
    for method in [
        "ListCollections",
        "GetCollection",
        "ApplyChange",
        "ListHistory",
        "ListTrashedItems",
    ] {
        rpc = rpc.with_route_limits(
            &format!("life.v1.ListService/{method}"),
            connectrpc::Limits::default()
                .with_max_request_body_size(64 * 1024)
                .with_max_message_size(64 * 1024),
        );
    }
    for method in [
        "GetOverview",
        "GetHousehold",
        "ChangeHousehold",
        "PreviewAllocation",
        "GetInvitation",
        "PreviewCopy",
        "CopyCollection",
        "ListHouseholdActivity",
    ] {
        rpc = rpc.with_route_limits(
            &format!("life.v1.HouseholdService/{method}"),
            connectrpc::Limits::default()
                .with_max_request_body_size(64 * 1024)
                .with_max_message_size(64 * 1024),
        );
    }
    for method in [
        "GetAccountPolicy",
        "PreviewAccountPolicy",
        "ApplyAccountPolicy",
        "GetStructuralPolicy",
        "SetStructuralPolicy",
    ] {
        rpc = rpc.with_route_limits(
            &format!("life.v1.PilotOperatorService/{method}"),
            connectrpc::Limits::default()
                .with_max_request_body_size(64 * 1024)
                .with_max_message_size(64 * 1024),
        );
    }
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
        .layer(middleware::from_fn_with_state(
            auth.clone(),
            resource_feedback,
        ))
        .layer(middleware::from_fn_with_state(
            auth.config.customer_writes_frozen,
            customer_write_freeze,
        ))
        .layer(cors)
        .layer(middleware::from_fn(observe))
}

// Keep resource enforcement detailed internally while normal-account clients
// receive actionable, non-numerical unsaved-change feedback.
async fn resource_feedback(
    State(auth): State<SharedAuth>,
    request: Request,
    next: Next,
) -> Response {
    let ordinary_rpc = request.uri().path().starts_with("/life.v1.")
        && !request
            .uri()
            .path()
            .starts_with("/life.v1.AccountAdminService/")
        && !request
            .uri()
            .path()
            .starts_with("/life.v1.PilotOperatorService/");
    let diagnostic_headers = ordinary_rpc.then(|| request.headers().clone());
    let response = next.run(request).await;
    if !ordinary_rpc
        || response.status() != StatusCode::TOO_MANY_REQUESTS
        || !capacity::normal_accounts(&auth.db).await.unwrap_or(true)
    {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, 16 * 1024)
        .await
        .unwrap_or_default();
    let body = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(mut error)
            if error.get("code").and_then(|v| v.as_str()) == Some("resource_exhausted") =>
        {
            if let Some(headers) = diagnostic_headers.as_ref()
                && accounts::record_resource_rejection(
                    &auth,
                    headers,
                    error.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                )
                .await
                .is_err()
            {
                eprintln!("{{\"event\":\"resource_diagnostic\",\"ok\":false}}");
            }
            error["message"] = serde_json::Value::String(
                "Your change was not saved. Please try again later or contact support.".into(),
            );
            axum::body::Body::from(serde_json::to_vec(&error).expect("serializable RPC error"))
        }
        _ => axum::body::Body::from(bytes),
    };
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, body)
}

// Default-deny during cutover: new routes must be reviewed before becoming
// available here. Operator bootstrap retains its separate bearer authentication.
async fn customer_write_freeze(
    State(frozen): State<bool>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let allowed = request.method() == Method::OPTIONS
        || path.starts_with("/life.v1.PilotOperatorService/")
        || matches!(
            (request.method(), path),
            (
                &Method::GET,
                "/health/live" | "/auth/config" | "/auth/session"
            ) | (
                &Method::POST,
                "/life.v1.TaskService/ListTasks"
                    | "/life.v1.ListService/ListCollections"
                    | "/life.v1.ListService/GetCollection"
                    | "/life.v1.ListService/ListHistory"
                    | "/life.v1.ListService/ListTrashedItems"
                    | "/life.v1.HouseholdService/GetOverview"
                    | "/life.v1.HouseholdService/GetHousehold"
                    | "/life.v1.HouseholdService/PreviewAllocation"
                    | "/life.v1.HouseholdService/GetInvitation"
                    | "/life.v1.HouseholdService/PreviewCopy"
                    | "/life.v1.HouseholdService/ListHouseholdActivity"
            )
        );
    if frozen && !allowed {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "60")],
            axum::Json(serde_json::json!({
                "code": "unavailable",
                "message": "Maintenance is in progress. Please retry after maintenance."
            })),
        )
            .into_response();
    }
    next.run(request).await
}

#[cfg(all(test, not(feature = "dev-auth")))]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn one_caller_cannot_exhaust_another_callers_login_allowance() {
        for trust_render_proxy in [false, true] {
            let config = crate::config::Config {
                invitation_signing_key: None,
                mail: None,
                email_operations_token: None,
                bind: "127.0.0.1:8788".parse().unwrap(),
                web_origin: "https://intrepion.com".into(),
                db_url: "http://127.0.0.1:1/query".into(),
                db_token: "unused-test-token".into(),
                google_client_id: "client".into(),
                owner_sub: "owner".into(),
                local: false,
                customer_writes_frozen: false,
                trust_render_proxy,
                household_maintenance_token: None,
                pilot_operator_token: None,
                erasure_ledger: None,
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
            invitation_signing_key: None,
            mail: None,
            email_operations_token: None,
            bind: "127.0.0.1:8788".parse().unwrap(),
            web_origin: "https://intrepion.com".into(),
            db_url: "http://127.0.0.1:1/query".into(),
            db_token: "unused-test-token".into(),
            google_client_id: "client".into(),
            owner_sub: "owner".into(),
            local: false,
            customer_writes_frozen: false,
            trust_render_proxy: false,
            household_maintenance_token: None,
            pilot_operator_token: None,
            erasure_ledger: None,
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
        "/life.v1.ListService/ListCollections" => "collections",
        "/life.v1.ListService/GetCollection" => "collection",
        "/life.v1.ListService/ApplyChange" => "change",
        "/life.v1.ListService/ListHistory" => "history",
        "/life.v1.ListService/ListTrashedItems" => "trash",
        "/life.v1.HouseholdService/GetOverview" => "account_overview",
        "/life.v1.HouseholdService/GetHousehold" => "household",
        "/life.v1.HouseholdService/ChangeHousehold" => "household_change",
        "/life.v1.HouseholdService/PreviewAllocation" => "allocation_preview",
        "/life.v1.HouseholdService/GetInvitation" => "invitation",
        "/life.v1.HouseholdService/PreviewCopy" => "copy_preview",
        "/life.v1.HouseholdService/CopyCollection" => "copy",
        "/life.v1.HouseholdService/ListHouseholdActivity" => "household_history",
        "/life.v1.HouseholdMaintenanceService/EraseDueHouseholds" => "household_maintenance",
        path if path.starts_with("/life.v1.PilotOperatorService/") => "operator_policy",
        "/health/live" => "health",
        path if path.starts_with("/auth/") => "auth",
        path if path.starts_with("/life.v1.AccountAdminService/") => "site_administration",
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
