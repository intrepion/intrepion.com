use crate::{config::Config, db::Database};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

pub type SharedAuth = Arc<Auth>;
pub struct Auth {
    pub config: Config,
    pub db: Database,
    http: reqwest::Client,
    keys: Mutex<Option<(Instant, Duration, JwkSet)>>,
    login_limit: Mutex<(Instant, u32)>,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    nonce: String,
}

#[derive(Deserialize)]
pub struct Login {
    pub credential: String,
    pub nonce: String,
}

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub csrf: String,
    pub expires_at: u64,
}

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
pub fn now() -> u64 {
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
    pub fn new(config: Config, db: Database) -> Result<SharedAuth, reqwest::Error> {
        Ok(Arc::new(Self {
            config,
            db,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            keys: Mutex::new(None),
            login_limit: Mutex::new((Instant::now(), 0)),
        }))
    }
    fn name(&self, kind: &str) -> String {
        if self.config.local {
            format!("local_{kind}")
        } else {
            format!("__Host-{kind}")
        }
    }
    fn set_cookie(&self, kind: &str, value: &str, age: u64) -> String {
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
        let mut rows = self.db.query::<Session>("SELECT csrf, expires_at FROM sessions WHERE token_hash = ? AND owner_sub = ? AND expires_at > ?", &[hash(token), self.config.owner_sub.clone(), now().to_string()]).await?;
        let session = rows.pop().ok_or_else(unauthorized)?;
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
    async fn limit_login(&self) -> Result<(), AuthError> {
        let mut limit = self.login_limit.lock().await;
        if limit.0.elapsed() >= Duration::from_secs(60) {
            *limit = (Instant::now(), 0);
        }
        if limit.1 >= 30 {
            return Err(AuthError(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many sign-in attempts. Try again in a minute.",
            ));
        }
        limit.1 += 1;
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
    async fn verify_google(&self, token: &str, nonce: &str) -> Result<(), AuthError> {
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
        verify_identity(
            token,
            nonce,
            &key,
            &self.config.google_client_id,
            &self.config.owner_sub,
        )
    }
    async fn issue_session(&self) -> Result<Response, AuthError> {
        let token = secret();
        let session = Session {
            csrf: secret(),
            expires_at: now() + 7 * 86400,
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
                    self.config.owner_sub.clone(),
                    session.csrf.clone(),
                    session.expires_at.to_string(),
                ],
            )
            .await?;
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

pub async fn configuration(State(auth): State<SharedAuth>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"google_client_id":auth.config.google_client_id,"development":auth.config.local}),
    )
}
pub async fn challenge(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    auth.check_origin(&headers)?;
    auth.limit_login().await?;
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
    headers: HeaderMap,
    Json(login): Json<Login>,
) -> Result<Response, AuthError> {
    auth.check_origin(&headers)?;
    auth.limit_login().await?;
    auth.consume_challenge(&headers, &login.nonce).await?;
    auth.verify_google(&login.credential, &login.nonce).await?;
    auth.issue_session().await
}
#[cfg(feature = "dev-auth")]
pub async fn development_login(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
    Json(login): Json<Login>,
) -> Result<Response, AuthError> {
    if !auth.config.local {
        return Err(forbidden());
    }
    auth.consume_challenge(&headers, &login.nonce).await?;
    auth.issue_session().await
}
pub async fn current_session(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
) -> Result<Json<Session>, AuthError> {
    Ok(Json(auth.session(&headers, false).await?))
}
pub async fn logout(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    auth.session(&headers, true).await?;
    let token = cookie(&headers, &auth.name("session")).ok_or_else(unauthorized)?;
    auth.db
        .query::<serde_json::Value>("DELETE FROM sessions WHERE token_hash = ?", &[hash(token)])
        .await?;
    Ok((
        [(header::SET_COOKIE, auth.set_cookie("session", "", 0))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}

// Signature and required OIDC claims are checked together; no decoded claim is trusted first.
fn verify_identity(
    token: &str,
    nonce: &str,
    key: &DecodingKey,
    client_id: &str,
    owner_sub: &str,
) -> Result<(), AuthError> {
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
