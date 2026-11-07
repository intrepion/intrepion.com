use std::time::Duration;

use axum::{body::Body, http::Request};
use connect_compat_spike::{SERVER_ID, app, proto::spike::v1::*};
use connectrpc::{
    ErrorCode,
    client::{ClientConfig, HttpClient},
};
use http_body_util::BodyExt;
use tower::ServiceExt;

const METHOD: &str = "/spike.v1.CompatibilityService/Ping";

#[tokio::test]
async fn json_response_and_validation() {
    for (client_name, status) in [
        (" web ".to_owned(), 200),
        ("".to_owned(), 400),
        ("  ".to_owned(), 400),
        ("a".repeat(64), 200),
        ("a".repeat(65), 400),
        ("é".repeat(32), 200),
        ("é".repeat(33), 400),
        (format!("  {}  ", "🙂".repeat(16)), 200),
        ("🙂".repeat(17), 400),
    ] {
        let message = format!("Hello, {}!", client_name.trim());
        let request = Request::post(METHOD)
            .header("content-type", "application/json")
            .header("connect-protocol-version", "1")
            .body(Body::from(
                serde_json::json!({"clientName": client_name}).to_string(),
            ))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), status);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        if status == 200 {
            assert_eq!(body["message"], message);
            assert_eq!(body["server"], SERVER_ID);
        } else {
            assert_eq!(body["code"], "invalid_argument");
        }
    }
}

#[tokio::test]
async fn only_local_web_origins_pass_cors_preflight() {
    for origin in [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://example.com",
    ] {
        let request = Request::builder()
            .method("OPTIONS")
            .uri(METHOD)
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                "content-type,connect-protocol-version,connect-timeout-ms",
            )
            .body(Body::empty())
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        let headers = response.headers();
        if origin == "https://example.com" {
            assert!(!headers.contains_key("access-control-allow-origin"));
        } else {
            assert_eq!(headers["access-control-allow-origin"], origin);
            assert_eq!(headers["access-control-allow-methods"], "POST");
            let allowed = headers["access-control-allow-headers"].to_str().unwrap();
            for name in [
                "content-type",
                "connect-protocol-version",
                "connect-timeout-ms",
            ] {
                assert!(allowed.contains(name));
            }
        }
        assert!(!headers.contains_key("access-control-allow-credentials"));
    }
}

/// Uses a real TCP listener and generated official client, not an HTTP mock.
#[tokio::test]
async fn rust_client_binary_and_json_round_trips_and_errors() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app()).await.unwrap() });
    // Abort the test's listener even if an assertion panics.
    struct StopServer(tokio::task::JoinHandle<()>);
    impl Drop for StopServer {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _server = StopServer(server);

    for json in [false, true] {
        let config = ClientConfig::new(format!("http://{address}").parse().unwrap())
            .with_default_timeout(Duration::from_secs(3));
        let config = if json { config.json() } else { config.proto() };
        let client = CompatibilityServiceClient::new(HttpClient::plaintext(), config);
        let response = client
            .ping(PingRequest {
                client_name: " rust-test ".into(),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(response.view().message, "Hello, rust-test!");
        assert_eq!(response.view().server, SERVER_ID);
        let error = client
            .ping(PingRequest::default())
            .await
            .expect_err("blank label is rejected");
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
}
