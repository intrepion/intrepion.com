use crate::{config::Config, db::Database, login_limit::LoginLimiter};
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

mod onboarding;
mod requests;
pub(crate) use onboarding::Onboarding;

pub type SharedAuth = Arc<Auth>;
pub struct Auth {
    pub config: Config,
    pub db: Database,
    pub(crate) erasure_ledger: Option<crate::erasure_ledger::ErasureLedger>,
    pub(crate) http: reqwest::Client,
    pub(crate) mail_lock: Mutex<()>,
    pub(crate) security_lock: Mutex<()>,
    pub(crate) retention_lock: Mutex<u64>,
    pub(crate) mail_wake: tokio::sync::Notify,
    pub(crate) feedback: crate::feedback::Verifier,
    keys: Mutex<Option<(Instant, Duration, JwkSet)>>,
    login_limit: Mutex<LoginLimiter>,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    nonce: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    email_verified: bool,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
pub struct Login {
    pub credential: String,
    pub nonce: String,
    #[serde(default)]
    pub invitation_token: Option<String>,
    #[serde(default)]
    pub request_token: Option<String>,
    #[cfg(feature = "dev-auth")]
    #[serde(default)]
    pub development_email: Option<String>,
    #[cfg(feature = "dev-auth")]
    #[serde(default)]
    pub development_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub csrf: String,
    pub expires_at: u64,
    pub user_sub: String,
    pub display_name: String,
    #[serde(default)]
    pub is_admin: bool,
}

#[derive(Debug)]
pub struct AuthError(pub StatusCode, pub &'static str);
impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error":self.1}))).into_response()
    }
}
impl From<connectrpc::ConnectError> for AuthError {
    fn from(_: connectrpc::ConnectError) -> Self {
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "Sign-in service temporarily unavailable.",
        )
    }
}
fn unauthorized() -> AuthError {
    AuthError(StatusCode::UNAUTHORIZED, "Please sign in again.")
}
fn forbidden() -> AuthError {
    AuthError(StatusCode::FORBIDDEN, "This account does not have access.")
}
fn render_client_ip(headers: &HeaderMap) -> Result<IpAddr, AuthError> {
    // Only Render's public edge is trusted to supply the original caller first.
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .and_then(|value| value.trim().parse().ok())
        .ok_or(AuthError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Sign-in service temporarily unavailable.",
        ))
}
pub fn now() -> u64 {
    #[cfg(feature = "dev-auth")]
    if std::env::var("APP_ENV").as_deref() == Ok("development")
        && let Some(now) = std::env::var("APP_TEST_NOW")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|n| *n > 0 && *n <= 253_402_300_799)
    {
        return now;
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_secs()
}
pub fn secret() -> String {
    rand::random::<[u8; 32]>()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

impl Auth {
    pub async fn authorize_rpc(
        &self,
        ctx: &connectrpc::RequestContext,
    ) -> Result<Session, connectrpc::ConnectError> {
        self.session(ctx.headers(), true)
            .await
            .map_err(|error| match error.0 {
                StatusCode::UNAUTHORIZED => {
                    connectrpc::ConnectError::unauthenticated("Please sign in again.")
                }
                StatusCode::FORBIDDEN => connectrpc::ConnectError::permission_denied(
                    "Approved session and CSRF token required.",
                ),
                _ => connectrpc::ConnectError::unavailable(
                    "Session service temporarily unavailable.",
                ),
            })
    }
    pub fn new(config: Config, db: Database) -> Result<SharedAuth, reqwest::Error> {
        let erasure_ledger = config
            .erasure_ledger
            .clone()
            .map(crate::erasure_ledger::ErasureLedger::new)
            .transpose()?;
        Ok(Arc::new(Self {
            config,
            db,
            erasure_ledger,
            http: reqwest::Client::builder()
                .retry(reqwest::retry::never())
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            keys: Mutex::new(None),
            mail_lock: Mutex::new(()),
            security_lock: Mutex::new(()),
            retention_lock: Mutex::new(0),
            mail_wake: tokio::sync::Notify::new(),
            feedback: crate::feedback::Verifier::new(),
            login_limit: Mutex::new(LoginLimiter::new()),
        }))
    }
    fn name(&self, kind: &str) -> String {
        if self.config.local {
            format!("local_{kind}")
        } else {
            format!("__Host-{kind}")
        }
    }
    pub(crate) fn set_cookie(&self, kind: &str, value: &str, age: u64) -> String {
        format!(
            "{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
            self.name(kind),
            if self.config.local { "" } else { "; Secure" }
        )
    }
    pub fn check_origin(&self, headers: &HeaderMap) -> Result<(), AuthError> {
        if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
            != Some(self.config.web_origin.as_str())
        {
            return Err(forbidden());
        }
        Ok(())
    }
    pub async fn session(&self, headers: &HeaderMap, write: bool) -> Result<Session, AuthError> {
        let token = cookie(headers, &self.name("session"))
            .filter(|value| value.len() == 64)
            .ok_or_else(unauthorized)?;
        let mut rows = self.db.query::<Session>("SELECT s.csrf,s.expires_at,s.owner_sub AS user_sub,a.display_name FROM sessions s JOIN pilot_accounts a ON a.subject=s.owner_sub AND a.approved=1 WHERE s.token_hash=? AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM protected_account_access p WHERE p.public_id=a.public_id AND p.active=0)", &[hash(token), now().to_string()]).await?;
        let mut session = rows.pop().ok_or_else(unauthorized)?;
        session.is_admin = session.user_sub == self.config.owner_sub;
        if write {
            self.check_origin(headers)?;
            if headers
                .get("x-csrf-token")
                .and_then(|value| value.to_str().ok())
                != Some(session.csrf.as_str())
            {
                return Err(forbidden());
            }
        }
        Ok(session)
    }
    async fn limit_login(&self, headers: &HeaderMap, peer: IpAddr) -> Result<(), AuthError> {
        let caller = if self.config.trust_render_proxy {
            render_client_ip(headers)?
        } else {
            peer
        };
        let mut limit = self.login_limit.lock().await;
        if !limit.allow(caller) {
            return Err(AuthError(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many sign-in attempts. Try again in a minute.",
            ));
        }
        Ok(())
    }
    async fn consume_challenge(&self, headers: &HeaderMap, nonce: &str) -> Result<(), AuthError> {
        self.check_origin(headers)?;
        if nonce.len() != 64 || cookie(headers, &self.name("login")) != Some(nonce) {
            return Err(unauthorized());
        }
        let rows = self.db.query::<serde_json::Value>("DELETE FROM login_challenges WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash", &[hash(nonce), now().to_string()]).await?;
        if rows.len() != 1 {
            return Err(unauthorized());
        }
        Ok(())
    }
    async fn verify_google(&self, token: &str, nonce: &str) -> Result<Claims, AuthError> {
        if token.len() > 16_384 {
            return Err(unauthorized());
        }
        let header = decode_header(token).map_err(|_| unauthorized())?;
        if header.alg != Algorithm::RS256 {
            return Err(unauthorized());
        }
        let kid = header.kid.ok_or_else(unauthorized)?;
        let mut cache = self.keys.lock().await;
        if cache
            .as_ref()
            .is_none_or(|(time, ttl, _)| time.elapsed() > *ttl)
        {
            let response = self
                .http
                .get("https://www.googleapis.com/oauth2/v3/certs")
                .send()
                .await
                .map_err(|_| {
                    AuthError(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "Google sign-in is temporarily unavailable.",
                    )
                })?;
            if !response.status().is_success() {
                return Err(AuthError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Google sign-in is temporarily unavailable.",
                ));
            }
            let max_age = response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok())
                .and_then(|value| {
                    value
                        .split(',')
                        .find_map(|part| part.trim().strip_prefix("max-age=")?.parse::<u64>().ok())
                })
                .unwrap_or(300)
                .clamp(60, 86400);
            let keys: JwkSet = response.json().await.map_err(|_| unauthorized())?;
            *cache = Some((Instant::now(), Duration::from_secs(max_age), keys));
        }
        let key = cache
            .as_ref()
            .and_then(|(_, _, keys)| keys.find(&kid))
            .ok_or_else(unauthorized)?;
        let key = DecodingKey::from_jwk(key).map_err(|_| unauthorized())?;
        let claims = verify_claims(token, nonce, &key, &self.config.google_client_id)?;
        Ok(claims)
    }
    async fn approved_identity(&self, subject: &str) -> Result<String, AuthError> {
        if !self
            .db
            .query::<serde_json::Value>(
                "SELECT 1 FROM protected_account_access WHERE subject_hash=? AND active=0",
                &[crate::security::subject_hash(subject)],
            )
            .await?
            .is_empty()
        {
            return Err(forbidden());
        }
        let public_id = crate::security::canonical_public_id(&self.db, subject)
            .await
            .map_err(|_| {
                AuthError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Identity recovery is temporarily unavailable.",
                )
            })?
            .unwrap_or_else(|| secret()[..32].into());
        if subject == self.config.owner_sub {
            self.db.query::<serde_json::Value>(
                "INSERT INTO pilot_accounts(subject,display_name,public_id) VALUES(?,'Owner',?) ON CONFLICT(subject) DO NOTHING",
                &[subject.into(),public_id.clone()],
            ).await?;
        }
        self.db.query::<serde_json::Value>("UPDATE pilot_accounts SET public_id=? WHERE subject=? AND public_id='' AND approved=1", &[public_id,subject.into()]).await?;
        #[derive(Deserialize)]
        struct Account {
            display_name: String,
        }
        self.db
            .query::<Account>(
                "SELECT display_name FROM pilot_accounts WHERE subject=? AND approved=1",
                &[subject.into()],
            )
            .await?
            .pop()
            .map(|account| account.display_name)
            .ok_or_else(forbidden)
    }
    pub(crate) async fn new_session(&self, subject: &str) -> Result<(Session, String), AuthError> {
        let display_name = self.approved_identity(subject).await?;
        let token = secret();
        let session = Session {
            csrf: secret(),
            expires_at: now() + 7 * 86400,
            user_sub: subject.into(),
            display_name,
            is_admin: subject == self.config.owner_sub,
        };
        self.db
            .query::<serde_json::Value>(
                "DELETE FROM sessions WHERE expires_at <= ?",
                &[now().to_string()],
            )
            .await?;
        self.db
            .query::<serde_json::Value>(
                "INSERT INTO sessions(token_hash, owner_sub, csrf, expires_at) VALUES(?, ?, ?, ?)",
                &[
                    hash(&token),
                    subject.into(),
                    session.csrf.clone(),
                    session.expires_at.to_string(),
                ],
            )
            .await?;
        Ok((session, token))
    }
    pub(crate) async fn issue_session(&self, subject: &str) -> Result<Response, AuthError> {
        let (session, token) = self.new_session(subject).await?;
        let mut response = Json(session).into_response();
        // Axum's array header conversion inserts, rather than appends, duplicate names.
        response.headers_mut().append(
            header::SET_COOKIE,
            self.set_cookie("session", &token, 7 * 86400)
                .parse()
                .expect("generated cookie"),
        );
        response.headers_mut().append(
            header::SET_COOKIE,
            self.set_cookie("login", "", 0)
                .parse()
                .expect("generated cookie"),
        );
        Ok(response)
    }
}

pub async fn configuration(
    State(auth): State<SharedAuth>,
) -> Result<Json<serde_json::Value>, AuthError> {
    let normal = crate::capacity::normal_accounts(&auth.db).await?;
    Ok(Json(
        serde_json::json!({"google_client_id":auth.config.google_client_id,"development":auth.config.local,"erasure_storage_configured":auth.erasure_ledger.is_some(),"schema_version":4,"customer_writes_frozen":auth.config.customer_writes_frozen,"normal_accounts":normal,"email_onboarding_configured":auth.config.mail.is_some(),"support_email":auth.config.mail.as_ref().map(|m|m.reply_to.as_str()).unwrap_or("")}),
    ))
}

pub async fn challenge(
    State(auth): State<SharedAuth>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    auth.check_origin(&headers)?;
    auth.limit_login(&headers, peer.ip()).await?;
    let nonce = secret();
    auth.db
        .query::<serde_json::Value>(
            "DELETE FROM login_challenges WHERE expires_at <= ?",
            &[now().to_string()],
        )
        .await?;
    auth.db
        .query::<serde_json::Value>(
            "INSERT INTO login_challenges(nonce_hash,expires_at) VALUES(?,?)",
            &[hash(&nonce), (now() + 300).to_string()],
        )
        .await?;
    Ok((
        [(header::SET_COOKIE, auth.set_cookie("login", &nonce, 300))],
        Json(serde_json::json!({"nonce":nonce})),
    )
        .into_response())
}
pub async fn login(
    State(auth): State<SharedAuth>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(login): Json<Login>,
) -> Result<Response, AuthError> {
    auth.check_origin(&headers)?;
    auth.limit_login(&headers, peer.ip()).await?;
    auth.consume_challenge(&headers, &login.nonce).await?;
    let claims = auth.verify_google(&login.credential, &login.nonce).await?;
    if login.request_token.is_some() && login.invitation_token.is_some() {
        return Err(forbidden());
    }
    if let Some(token) = login.request_token {
        if !claims.email_verified {
            return Err(forbidden());
        }
        return auth
            .begin_request(
                &claims.sub,
                claims.email.as_deref().ok_or_else(forbidden)?,
                claims.name.as_deref().unwrap_or(""),
                &token,
            )
            .await;
    }
    if let Some(token) = login.invitation_token {
        if !claims.email_verified {
            return Err(forbidden());
        }
        return auth
            .begin_invitation(
                &claims.sub,
                claims.email.as_deref().ok_or_else(forbidden)?,
                claims.name.as_deref().unwrap_or(""),
                &token,
            )
            .await;
    }
    auth.issue_session(&claims.sub).await
}
#[cfg(feature = "dev-auth")]
pub async fn development_login(
    State(auth): State<SharedAuth>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(login): Json<Login>,
) -> Result<Response, AuthError> {
    if !auth.config.local {
        return Err(forbidden());
    }
    auth.limit_login(&headers, peer.ip()).await?;
    auth.consume_challenge(&headers, &login.nonce).await?;
    let subject = if login.credential.is_empty() {
        &auth.config.owner_sub
    } else {
        &login.credential
    };
    if login.request_token.is_some() && login.invitation_token.is_some() {
        return Err(forbidden());
    }
    if let Some(token) = login.request_token.as_deref() {
        return auth
            .begin_request(
                subject,
                login.development_email.as_deref().ok_or_else(forbidden)?,
                login.development_name.as_deref().unwrap_or(""),
                token,
            )
            .await;
    }
    if let Some(token) = login.invitation_token.as_deref() {
        return auth
            .begin_invitation(
                subject,
                login.development_email.as_deref().ok_or_else(forbidden)?,
                login.development_name.as_deref().unwrap_or(""),
                token,
            )
            .await;
    }
    auth.issue_session(subject).await
}
pub async fn current_session(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AuthError> {
    if let Ok(session) = auth.session(&headers, false).await {
        return Ok(Json(serde_json::to_value(session).expect("session")));
    }
    let session = auth.onboarding(&headers, false).await?;
    Ok(Json(
        serde_json::json!({"onboarding":true,"csrf":session.csrf,"expires_at":session.expires_at,"user_sub":session.user_sub,"display_name":session.display_name,"email":session.email}),
    ))
}
pub async fn logout(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    if auth.session(&headers, true).await.is_err() {
        auth.onboarding(&headers, true).await?;
    }
    let session = cookie(&headers, &auth.name("session")).unwrap_or("");
    let onboarding = cookie(&headers, &auth.name("onboarding")).unwrap_or("");
    auth.db
        .batch(&[
            crate::db::Statement::new(
                "DELETE FROM sessions WHERE token_hash=?",
                vec![hash(session)],
            ),
            crate::db::Statement::new(
                "DELETE FROM onboarding_sessions WHERE token_hash=?",
                vec![hash(onboarding)],
            ),
        ])
        .await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    for kind in ["session", "onboarding"] {
        response.headers_mut().append(
            header::SET_COOKIE,
            auth.set_cookie(kind, "", 0)
                .parse()
                .expect("generated cookie"),
        );
    }
    Ok(response)
}

// Signature and required OIDC claims are checked together; no decoded claim is trusted first.
fn verify_claims(
    token: &str,
    nonce: &str,
    key: &DecodingKey,
    client_id: &str,
) -> Result<Claims, AuthError> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = 30;
    let claims = decode::<Claims>(token, key, &validation)
        .map_err(|_| unauthorized())?
        .claims;
    if claims.nonce != nonce {
        return Err(unauthorized());
    }
    if claims.sub.is_empty() || claims.sub.len() > 255 || claims.sub.contains('\0') {
        return Err(unauthorized());
    }
    Ok(claims)
}

#[cfg(test)]
fn verify_identity(
    token: &str,
    nonce: &str,
    key: &DecodingKey,
    client_id: &str,
    owner_sub: &str,
) -> Result<(), AuthError> {
    let claims = verify_claims(token, nonce, key, client_id)?;
    if claims.sub != owner_sub {
        return Err(forbidden());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode, jwk::Jwk};
    #[test]
    fn render_caller_requires_one_valid_edge_supplied_address() {
        let mut headers = HeaderMap::new();
        assert!(render_client_ip(&headers).is_err());
        headers.insert("x-forwarded-for", "not-an-ip, 192.0.2.1".parse().unwrap());
        assert!(render_client_ip(&headers).is_err());
        headers.insert(
            "x-forwarded-for",
            "198.51.100.1, 192.0.2.1".parse().unwrap(),
        );
        assert_eq!(
            render_client_ip(&headers).unwrap(),
            "198.51.100.1".parse::<IpAddr>().unwrap()
        );
    }
    #[test]
    fn google_identity_requires_signature_audience_issuer_expiry_nonce_and_exact_owner() {
        // Public test fixture only. Never use this key outside the test suite.
        let private =
            EncodingKey::from_rsa_der(include_bytes!("../tests/fixtures/signing-key.der"));
        let jwk: Jwk =
            serde_json::from_str(include_str!("../tests/fixtures/signing-jwk.json")).unwrap();
        let public = DecodingKey::from_jwk(&jwk).unwrap();
        let valid = serde_json::json!({"sub":"owner-sub","nonce":"challenge","aud":"client","iss":"https://accounts.google.com","exp":now()+300});
        let signed = |claims: &serde_json::Value| {
            encode(&Header::new(Algorithm::RS256), claims, &private).unwrap()
        };
        assert!(
            verify_identity(&signed(&valid), "challenge", &public, "client", "owner-sub").is_ok()
        );
        for (field, value, status) in [
            (
                "aud",
                serde_json::json!("other-client"),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "iss",
                serde_json::json!("https://stranger.example"),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "exp",
                serde_json::json!(now() - 300),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "nonce",
                serde_json::json!("other-challenge"),
                StatusCode::UNAUTHORIZED,
            ),
            ("sub", serde_json::json!("other-sub"), StatusCode::FORBIDDEN),
        ] {
            let mut claims = valid.clone();
            claims[field] = value;
            assert_eq!(
                verify_identity(
                    &signed(&claims),
                    "challenge",
                    &public,
                    "client",
                    "owner-sub"
                )
                .err()
                .unwrap()
                .0,
                status
            );
        }
        let forged = encode(
            &Header::default(),
            &valid,
            &EncodingKey::from_secret(b"attacker"),
        )
        .unwrap();
        assert!(verify_identity(&forged, "challenge", &public, "client", "owner-sub").is_err());
    }
}
