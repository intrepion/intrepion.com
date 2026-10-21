//! Loopback-only protocol/runtime comparison. No database or real authentication.
use connectrpc::{Response, Router, handler_fn};

mod proto {
    connectrpc::include_generated!();
}
use proto::experiment::v1::{EchoRequest, EchoResponse};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route(
            "experiment.v1.TaskService",
            "Echo",
            handler_fn(|_, request: EchoRequest| async {
                if request.title == "delay" {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Response::ok(EchoResponse {
                    title: request.title,
                    ..Default::default()
                })
            }),
        )
        .into_axum_router();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8788").await?;
    println!("Native protocol baseline on http://127.0.0.1:8788");
    axum::serve(listener, app).await?;
    Ok(())
}
