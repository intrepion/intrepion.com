use intrepion_server::{app, auth::Auth, config::Config, db::Database};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env().map_err(std::io::Error::other)?;
    let db = Database::new(config.db_url.clone(), config.db_token.clone())?;
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    eprintln!(
        "{}",
        serde_json::json!({"event":"startup","development":config.local,"render_proxy":config.trust_render_proxy})
    );
    let auth = Auth::new(config, db)?;
    let _mail_worker = intrepion_server::mail::spawn_worker(auth.clone());
    axum::serve(
        listener,
        app(auth).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
