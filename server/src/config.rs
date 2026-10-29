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
    pub invitation_signing_key: Option<String>,
    pub mail: Option<crate::mail::Settings>,
    pub email_operations_token: Option<String>,
    pub customer_writes_frozen: bool,
    pub trust_render_proxy: bool,
    pub household_maintenance_token: Option<String>,
    pub pilot_operator_token: Option<String>,
    pub erasure_ledger: Option<crate::erasure_ledger::LedgerSettings>,
    pub request_safety: RequestSafety,
}

#[derive(Clone)]
pub struct RequestSafety {
    pub active_links: u64,
    pub links_per_day: u64,
    pub pending_requests: u64,
    pub requests_per_identity_day: u64,
    pub notices_per_head_day: u64,
}
impl Default for RequestSafety {
    fn default() -> Self {
        Self {
            active_links: 100,
            links_per_day: 100,
            pending_requests: 500,
            requests_per_identity_day: 30,
            notices_per_head_day: 500,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let customer_writes_frozen = match env::var("CUSTOMER_WRITES_FROZEN") {
            Err(env::VarError::NotPresent) => false,
            Ok(value) if value == "false" => false,
            Ok(value) if value == "true" => true,
            _ => return Err("CUSTOMER_WRITES_FROZEN must be true or false".into()),
        };
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
        let erasure_ledger = if local {
            Some(local_ledger())
        } else {
            let names = [
                "ERASURE_B2_KEY_ID",
                "ERASURE_B2_APPLICATION_KEY",
                "ERASURE_B2_BUCKET_ID",
            ];
            let present = names.iter().filter(|name| env::var(name).is_ok()).count();
            if present == 0 {
                None
            } else if present != 3 {
                return Err("configure all three ERASURE_B2 settings together".into());
            } else {
                Some(crate::erasure_ledger::LedgerSettings::Backblaze {
                    key_id: required(names[0])?,
                    key: required(names[1])?,
                    bucket_id: identifier(names[2])?,
                })
            }
        };
        let household_maintenance_token = env::var("HOUSEHOLD_MAINTENANCE_TOKEN").ok();
        if household_maintenance_token
            .as_ref()
            .is_some_and(|token| token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(
                "HOUSEHOLD_MAINTENANCE_TOKEN must be 32 random bytes encoded as hex".into(),
            );
        }
        let pilot_operator_token = env::var("PILOT_OPERATOR_TOKEN").ok();
        if pilot_operator_token
            .as_ref()
            .is_some_and(|token| token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("PILOT_OPERATOR_TOKEN must be 32 random bytes encoded as hex".into());
        }
        if pilot_operator_token.is_some() && pilot_operator_token == household_maintenance_token {
            return Err("Operator and maintenance credentials must be different".into());
        }
        let invitation_signing_key = if local {
            Some("de".repeat(32))
        } else {
            env::var("INVITATION_SIGNING_KEY").ok()
        };
        if invitation_signing_key
            .as_ref()
            .is_some_and(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("INVITATION_SIGNING_KEY must be 32 random bytes encoded as hex".into());
        }
        let mail = crate::mail::Settings::from_env(local)?;
        let email_operations_token = env::var("EMAIL_OPERATIONS_TOKEN")
            .ok()
            .or_else(|| local.then(|| "ef".repeat(32)));
        if email_operations_token
            .as_ref()
            .is_some_and(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("EMAIL_OPERATIONS_TOKEN must be 32 random bytes encoded as hex".into());
        }
        if mail.is_some() && (invitation_signing_key.is_none() || email_operations_token.is_none())
        {
            return Err(
                "Configure invitation signing and email operations credentials with SES".into(),
            );
        }
        if email_operations_token.is_some()
            && (email_operations_token == pilot_operator_token
                || email_operations_token == household_maintenance_token)
        {
            return Err("Email operations credentials must be separate".into());
        }
        Ok(Self {
            request_safety: RequestSafety {
                active_links: safety_limit("MAX_REQUEST_LINKS_PER_HOUSEHOLD", 100)?,
                links_per_day: safety_limit("MAX_REQUEST_LINKS_PER_DAY", 100)?,
                pending_requests: safety_limit("MAX_PENDING_REQUESTS_PER_HOUSEHOLD", 500)?,
                requests_per_identity_day: safety_limit("MAX_REQUESTS_PER_IDENTITY_DAY", 30)?,
                notices_per_head_day: safety_limit("MAX_REQUEST_NOTICES_PER_HEAD_DAY", 500)?,
            },
            mail,
            email_operations_token,
            invitation_signing_key,
            customer_writes_frozen,
            pilot_operator_token,
            household_maintenance_token,
            bind,
            web_origin,
            db_url,
            db_token,
            google_client_id,
            owner_sub,
            local,
            erasure_ledger,
            // Render supplies this reserved environment variable. Never enable
            // forwarded-header trust for local or directly exposed deployments.
            trust_render_proxy: !local && env::var("RENDER").as_deref() == Ok("true"),
        })
    }
}

fn safety_limit(name: &str, default: u64) -> Result<u64, String> {
    match env::var(name) {
        Err(env::VarError::NotPresent) => Ok(default),
        Ok(value) => value
            .parse::<u64>()
            .ok()
            .filter(|n| (1..=100_000).contains(n))
            .ok_or_else(|| format!("{name} must be an integer from 1 through 100000")),
        Err(_) => Err(format!("Invalid {name}")),
    }
}

fn local_ledger() -> crate::erasure_ledger::LedgerSettings {
    #[cfg(feature = "dev-auth")]
    if env::var("ERASURE_LEDGER_B2_EMULATOR").as_deref() == Ok("1") {
        return crate::erasure_ledger::LedgerSettings::BackblazeEmulator;
    }
    crate::erasure_ledger::LedgerSettings::Local
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
