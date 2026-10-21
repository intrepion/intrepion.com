use std::{env, net::SocketAddr};
use url::Url;

#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub web_origin: String,
    pub db_url: String,
    pub db_token: String,
    pub google_client_id: String,
    pub owner_sub: String,
    pub local: bool,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let local = env::var("APP_ENV").as_deref() == Ok("development");
        if local && !cfg!(feature = "dev-auth") {
            return Err("development requires a build with --features dev-auth".into());
        }
        if !local && cfg!(feature = "dev-auth") {
            return Err("development-auth builds cannot run in production".into());
        }
        let web_origin = required("WEB_ORIGIN")?;
        let web = Url::parse(&web_origin).map_err(|_| "invalid WEB_ORIGIN")?;
        if web.origin().ascii_serialization() != web_origin
            || (!local && web.scheme() != "https")
            || (local && web.host_str() != Some("127.0.0.1"))
        {
            return Err(
                "WEB_ORIGIN must be an exact HTTPS origin (127.0.0.1 in development)".into(),
            );
        }
        let bind: SocketAddr = format!(
            "{}:{}",
            if local { "127.0.0.1" } else { "0.0.0.0" },
            env::var("PORT").unwrap_or_else(|_| "8788".into())
        )
        .parse()
        .map_err(|_| "invalid PORT")?;
        let (db_url, db_token, google_client_id, owner_sub) = if local {
            (
                "http://127.0.0.1:8791/query".into(),
                "local-d1-only".into(),
                String::new(),
                "development-owner".into(),
            )
        } else {
            let account = identifier("CLOUDFLARE_ACCOUNT_ID")?;
            let database = identifier("D1_DATABASE_ID")?;
            (
                format!(
                    "https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query"
                ),
                required("D1_API_TOKEN")?,
                required("GOOGLE_CLIENT_ID")?,
                required("GOOGLE_OWNER_SUB")?,
            )
        };
        Ok(Self {
            bind,
            web_origin,
            db_url,
            db_token,
            google_client_id,
            owner_sub,
            local,
        })
    }
}

fn required(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing {name}"))
}
fn identifier(name: &str) -> Result<String, String> {
    let value = required(name)?;
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(format!("invalid {name}"));
    }
    Ok(value)
}
