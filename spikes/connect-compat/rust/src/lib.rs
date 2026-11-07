use std::sync::Arc;

use axum::http::{HeaderName, HeaderValue, Method, header::CONTENT_TYPE};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use tower_http::cors::CorsLayer;

pub mod proto {
    connectrpc::include_generated!();
}

use proto::spike::v1::{CompatibilityService, PingRequest, PingResponse};

pub const SERVER_ID: &str = "connect-rust/axum";
pub const SERVER_ADDRESS: &str = "127.0.0.1:4100";

struct DummyCompatibilityService;

impl CompatibilityService for DummyCompatibilityService {
    async fn ping<'a>(
        &'a self,
        _ctx: RequestContext,
        request: ServiceRequest<'_, PingRequest>,
    ) -> ServiceResult<impl connectrpc::Encodable<PingResponse> + Send + use<'a>> {
        let client_name = request.client_name.trim();
        if client_name.is_empty() || client_name.len() > 64 {
            return Err(ConnectError::invalid_argument(
                "client_name must contain 1 to 64 UTF-8 bytes after trimming",
            ));
        }
        Response::ok(PingResponse {
            message: format!("Hello, {client_name}!"),
            server: SERVER_ID.into(),
            ..Default::default()
        })
    }
}

/// Development-only CORS: no wildcard origin and no credential support.
pub fn app() -> axum::Router {
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://127.0.0.1:5173"),
            HeaderValue::from_static("http://localhost:5173"),
        ])
        .allow_methods([Method::POST])
        .allow_headers([
            CONTENT_TYPE,
            HeaderName::from_static("connect-protocol-version"),
            HeaderName::from_static("connect-timeout-ms"),
            HeaderName::from_static("x-user-agent"),
        ]);
    let rpc = connectrpc::Router::new().add_service(Arc::new(DummyCompatibilityService));
    axum::Router::new()
        .fallback_service(rpc.into_axum_service())
        .layer(cors)
}
