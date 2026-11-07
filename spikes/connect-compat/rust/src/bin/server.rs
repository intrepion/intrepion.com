use connect_compat_spike::{SERVER_ADDRESS, app};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Intentionally not configurable to a public interface for this spike.
    let listener = tokio::net::TcpListener::bind(SERVER_ADDRESS).await?;
    println!("Dummy ConnectRPC service: http://{SERVER_ADDRESS}");
    axum::serve(listener, app())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
