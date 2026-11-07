use std::time::Duration;

use connect_compat_spike::{SERVER_ADDRESS, SERVER_ID, proto::spike::v1::*};
use connectrpc::client::{ClientConfig, HttpClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = ClientConfig::new(format!("http://{SERVER_ADDRESS}").parse()?)
        .with_default_timeout(Duration::from_secs(5));
    let client = CompatibilityServiceClient::new(HttpClient::plaintext(), config);
    let response = client
        .ping(PingRequest {
            client_name: "rust-cli".into(),
            ..Default::default()
        })
        .await?
        .into_owned();
    assert_eq!(response.message, "Hello, rust-cli!");
    assert_eq!(response.server, SERVER_ID);
    println!("{} [{}]", response.message, response.server);
    Ok(())
}
