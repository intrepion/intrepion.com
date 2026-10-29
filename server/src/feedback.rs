//! SNS HTTPS is the trusted key-distribution endpoint (also used by AWS SDK
//! validators). TLS validates that endpoint's chain; this is not a separate PKI
//! path validation of the downloaded signing certificate. See the research note.
use crate::{
    auth::{self, SharedAuth},
    db::Statement,
    lists::valid_id,
    security::subject_hash,
};
use axum::{body::Bytes, extract::State, http::StatusCode};
use base64::Engine;
use serde::Deserialize;
use serde_json::Value;
use std::time::Instant;
use tokio::sync::{Mutex, Semaphore};
use url::Url;
use x509_cert::{Certificate, der::DecodePem};

struct CertificateKey {
    url: String,
    key: Vec<u8>,
    expires: u64,
    fetched: Instant,
}
pub(crate) struct Verifier {
    limit: Semaphore,
    certificates: Mutex<Vec<CertificateKey>>,
}
struct Verified {
    id: String,
    digest: String,
    kind: String,
    message: String,
    event_at: i64,
}
fn invalid() -> StatusCode {
    StatusCode::FORBIDDEN
}
fn temporary() -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, StatusCode> {
    value.get(key).and_then(Value::as_str).ok_or_else(invalid)
}
impl Verifier {
    pub(crate) fn new() -> Self {
        Self {
            limit: Semaphore::new(4),
            certificates: Mutex::new(vec![]),
        }
    }
    fn endpoint(&self, auth: &SharedAuth, url: &Url) -> bool {
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return false;
        }
        if auth.config.local {
            return url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(8793);
        }
        let Some(settings) = auth.config.mail.as_ref() else {
            return false;
        };
        url.scheme() == "https"
            && url.host_str() == Some(format!("sns.{}.amazonaws.com", settings.region).as_str())
            && url.port_or_known_default() == Some(443)
    }
    async fn key(&self, auth: &SharedAuth, address: &str) -> Result<Vec<u8>, StatusCode> {
        let url = Url::parse(address).map_err(|_| invalid())?;
        let name = url
            .path()
            .strip_prefix("/SimpleNotificationService-")
            .and_then(|s| s.strip_suffix(".pem"))
            .filter(|s| {
                !s.is_empty()
                    && s.len() < 160
                    && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
            .ok_or_else(invalid)?;
        if name.is_empty() || !self.endpoint(auth, &url) || url.query().is_some() {
            return Err(invalid());
        }
        let mut cache = self.certificates.lock().await;
        let now = auth::now();
        cache.retain(|c| c.expires > now && c.fetched.elapsed().as_secs() < 3600);
        if let Some(key) = cache.iter().find(|c| c.url == address) {
            return Ok(key.key.clone());
        }
        let mut response = auth.http.get(url).send().await.map_err(|_| temporary())?;
        if !response.status().is_success() {
            return Err(
                if response.status().is_server_error() || response.status().as_u16() == 429 {
                    temporary()
                } else {
                    invalid()
                },
            );
        }
        let mut pem = vec![];
        while let Some(chunk) = response.chunk().await.map_err(|_| temporary())? {
            if pem.len() + chunk.len() > 32768 {
                return Err(invalid());
            }
            pem.extend_from_slice(&chunk);
        }
        let cert = Certificate::from_pem(&pem).map_err(|_| invalid())?;
        let tbs = cert.tbs_certificate();
        let validity = tbs.validity();
        let before = validity.not_before.to_unix_duration().as_secs();
        let after = validity.not_after.to_unix_duration().as_secs();
        let spki = tbs.subject_public_key_info();
        if now < before || now > after || spki.algorithm.oid.to_string() != "1.2.840.113549.1.1.1" {
            return Err(invalid());
        }
        let key = spki
            .subject_public_key
            .as_bytes()
            .ok_or_else(invalid)?
            .to_vec();
        if cache.len() >= 8 {
            cache.remove(0);
        }
        cache.push(CertificateKey {
            url: address.into(),
            key: key.clone(),
            expires: after,
            fetched: Instant::now(),
        });
        Ok(key)
    }
    async fn verify(&self, auth: &SharedAuth, value: &Value) -> Result<Verified, StatusCode> {
        let settings = auth.config.mail.as_ref().ok_or_else(temporary)?;
        if string(value, "TopicArn")? != settings.feedback_topic_arn
            || string(value, "SignatureVersion")? != "2"
        {
            return Err(invalid());
        }
        let kind = string(value, "Type")?;
        let id = string(value, "MessageId")?;
        if !valid_id(id) {
            return Err(invalid());
        }
        let stamp = time::OffsetDateTime::parse(
            string(value, "Timestamp")?,
            &time::format_description::well_known::Rfc3339,
        )
        .map_err(|_| invalid())?;
        let event_at =
            i64::try_from(stamp.unix_timestamp_nanos() / 1_000_000).map_err(|_| invalid())?;
        if event_at < 0 || stamp.unix_timestamp() > auth::now() as i64 + 300 {
            return Err(invalid());
        }
        let mut names = match kind {
            "Notification" => vec!["Message", "MessageId"],
            "SubscriptionConfirmation" | "UnsubscribeConfirmation" => vec![
                "Message",
                "MessageId",
                "SubscribeURL",
                "Timestamp",
                "Token",
                "TopicArn",
                "Type",
            ],
            _ => return Err(invalid()),
        };
        if kind == "Notification" {
            if value.get("Subject").is_some() {
                names.push("Subject");
            }
            names.extend(["Timestamp", "TopicArn", "Type"]);
        }
        let mut canonical = String::new();
        for name in names {
            canonical.push_str(name);
            canonical.push('\n');
            canonical.push_str(string(value, name)?);
            canonical.push('\n');
        }
        let signature = base64::engine::general_purpose::STANDARD
            .decode(string(value, "Signature")?)
            .map_err(|_| invalid())?;
        if signature.len() < 256 || signature.len() > 1024 {
            return Err(invalid());
        }
        let key = self.key(auth, string(value, "SigningCertURL")?).await?;
        aws_lc_rs::signature::UnparsedPublicKey::new(
            &aws_lc_rs::signature::RSA_PKCS1_2048_8192_SHA256,
            &key,
        )
        .verify(canonical.as_bytes(), &signature)
        .map_err(|_| invalid())?;
        Ok(Verified {
            id: id.into(),
            digest: subject_hash(&canonical),
            kind: kind.into(),
            message: string(value, "Message")?.into(),
            event_at,
        })
    }
}
pub(crate) async fn receive(
    State(auth): State<SharedAuth>,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let _permit = auth.feedback.limit.try_acquire().map_err(|_| temporary())?;
    let value: Value = serde_json::from_slice(&body).map_err(|_| invalid())?;
    let verified = auth.feedback.verify(&auth, &value).await?;
    #[derive(Deserialize)]
    struct Receipt {
        digest: String,
    }
    if let Some(r) = auth
        .db
        .query::<Receipt>(
            "SELECT digest FROM email_feedback_receipts WHERE id=?",
            std::slice::from_ref(&verified.id),
        )
        .await
        .map_err(|_| temporary())?
        .pop()
    {
        return if r.digest == verified.digest {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(invalid())
        };
    }
    if verified.kind == "SubscriptionConfirmation" {
        let address = Url::parse(string(&value, "SubscribeURL")?).map_err(|_| invalid())?;
        if !auth.feedback.endpoint(&auth, &address) || (!auth.config.local && address.path() != "/")
        {
            return Err(invalid());
        }
        let params = address.query_pairs().collect::<Vec<_>>();
        let mut seen = std::collections::HashSet::new();
        if params.iter().any(|(k, _)| {
            !seen.insert(k.to_string())
                || !["Action", "TopicArn", "Token", "Version"].contains(&k.as_ref())
        }) {
            return Err(invalid());
        }
        let param = |name: &str| {
            params
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.as_ref())
        };
        if param("Action") != Some("ConfirmSubscription")
            || param("TopicArn") != Some(string(&value, "TopicArn")?)
            || param("Token") != Some(string(&value, "Token")?)
        {
            return Err(invalid());
        }
        let response = auth
            .http
            .get(address)
            .send()
            .await
            .map_err(|_| temporary())?;
        if !response.status().is_success() {
            return Err(temporary());
        }
        record_receipt(&auth, &verified, "").await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if verified.kind == "UnsubscribeConfirmation" {
        record_receipt(&auth, &verified, "").await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    let event: Value = serde_json::from_str(&verified.message).map_err(|_| invalid())?;
    let event_type = event
        .get("eventType")
        .or_else(|| event.get("notificationType"))
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let mail = event.get("mail").ok_or_else(invalid)?;
    let message_id = string(mail, "messageId")?;
    if message_id.len() > 256 {
        return Err(invalid());
    }
    let attempt_tag = mail
        .pointer("/tags/attempt_id/0")
        .and_then(Value::as_str)
        .filter(|s| valid_id(s));
    #[derive(Deserialize)]
    struct Attempt {
        id: String,
        invitation_id: String,
        generation: u64,
        recipient_email: String,
        provider_message_id: String,
    }
    let attempt = if let Some(id) = attempt_tag {
        auth.db.query::<Attempt>("SELECT id,invitation_id,generation,recipient_email,provider_message_id FROM email_send_attempts WHERE id=?",&[id.into()]).await.map_err(|_|temporary())?.pop()
    } else {
        auth.db.query::<Attempt>("SELECT id,invitation_id,generation,recipient_email,provider_message_id FROM email_send_attempts WHERE provider_message_id=? AND provider_message_id<>'' LIMIT 1",&[message_id.into()]).await.map_err(|_|temporary())?.pop()
    };
    let Some(attempt) = attempt else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if !attempt.provider_message_id.is_empty() && attempt.provider_message_id != message_id {
        return Err(invalid());
    }
    if mail
        .pointer("/tags/invitation_id/0")
        .and_then(Value::as_str)
        .is_some_and(|id| id != attempt.invitation_id)
    {
        return Err(invalid());
    }
    let contains = |value: Option<&Value>, field: Option<&str>| {
        value.and_then(Value::as_array).is_some_and(|values| {
            values.iter().any(|v| {
                let email = field.and_then(|f| v.get(f)).unwrap_or(v).as_str();
                email.is_some_and(|v| v.eq_ignore_ascii_case(&attempt.recipient_email))
            })
        })
    };
    if !contains(mail.get("destination"), None) {
        return Err(invalid());
    }
    let (outcome, delivery, suppression) = match event_type {
        "Delivery" => ("delivered", "delivered", None),
        "Bounce" => {
            if !contains(
                event.pointer("/bounce/bouncedRecipients"),
                Some("emailAddress"),
            ) {
                return Ok(StatusCode::NO_CONTENT);
            }
            (
                "bounced",
                "failed",
                (event.pointer("/bounce/bounceType").and_then(Value::as_str) == Some("Permanent"))
                    .then_some("hard_bounce"),
            )
        }
        "Complaint" => ("complaint", "failed", Some("complaint")),
        "DeliveryDelay" => ("delayed", "delayed", None),
        "Reject" | "Rendering Failure" => ("rejected", "failed", None),
        _ => return Ok(StatusCode::NO_CONTENT),
    };
    let claim = auth::secret();
    let guard =
        "EXISTS(SELECT 1 FROM email_feedback_receipts WHERE id=? AND digest=? AND claim_id=?)";
    let guarded = |sql: &str, mut params: Vec<String>| {
        params.extend([verified.id.clone(), verified.digest.clone(), claim.clone()]);
        Statement::new(&sql.replace("@feedback", guard), params)
    };
    let mut writes = vec![Statement::new(
        "INSERT INTO email_feedback_receipts(id,digest,claim_id,invitation_id) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
        vec![
            verified.id.clone(),
            verified.digest.clone(),
            claim.clone(),
            attempt.invitation_id.clone(),
        ],
    )];
    writes.push(guarded("UPDATE email_send_attempts SET outcome=?,provider_message_id=?,feedback_at=? WHERE id=? AND feedback_at<=CAST(? AS INTEGER) AND @feedback",vec![outcome.into(),message_id.into(),verified.event_at.to_string(),attempt.id,verified.event_at.to_string()]));
    writes.push(guarded("UPDATE email_invitations SET delivery_status=?,delivery_event_at=? WHERE id=? AND generation=? AND status='pending' AND delivery_event_at<=CAST(? AS INTEGER) AND @feedback",vec![delivery.into(),verified.event_at.to_string(),attempt.invitation_id.clone(),attempt.generation.to_string(),verified.event_at.to_string()]));
    writes.push(guarded("UPDATE household_request_notifications SET status=?,delivery_event_at=? WHERE id=? AND status<>'canceled' AND delivery_event_at<=CAST(? AS INTEGER) AND @feedback",vec![delivery.into(),verified.event_at.to_string(),attempt.invitation_id,verified.event_at.to_string()]));
    if let Some(reason) = suppression {
        writes.push(guarded("INSERT INTO email_suppressions(recipient_email,reason,last_event_at,revision) SELECT ?,?,?,coalesce((SELECT revision+1 FROM email_suppression_reviews WHERE recipient_hash=?),1) WHERE NOT EXISTS(SELECT 1 FROM email_suppression_reviews WHERE recipient_hash=? AND cleared_at>=CAST(? AS INTEGER)) AND @feedback ON CONFLICT(recipient_email) DO UPDATE SET reason=excluded.reason,last_event_at=excluded.last_event_at,revision=email_suppressions.revision+1 WHERE excluded.last_event_at>email_suppressions.last_event_at",vec![attempt.recipient_email.clone(),reason.into(),verified.event_at.to_string(),subject_hash(&attempt.recipient_email),subject_hash(&attempt.recipient_email),verified.event_at.to_string()]));
    }
    writes.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM email_feedback_receipts WHERE id=? AND digest=?)",vec![verified.id,verified.digest]));
    writes.push(Statement::new("DELETE FROM invariant_guards", vec![]));
    // Suppression must be ordered with handoffs across instances. A busy gate
    // returns 503 so SNS retries instead of recording suppression in the gap
    // between a claim and its provider request.
    let gate = if suppression.is_some() {
        Some(
            crate::delivery_gate::acquire_with_wait(&auth.db)
                .await
                .map_err(|_| temporary())?,
        )
    } else {
        None
    };
    let result = auth.db.batch(&writes).await.map_err(|_| temporary());
    if let Some(token) = gate {
        crate::delivery_gate::release(&auth.db, &token)
            .await
            .map_err(|_| temporary())?;
    }
    result?;
    Ok(StatusCode::NO_CONTENT)
}
async fn record_receipt(
    auth: &SharedAuth,
    verified: &Verified,
    invitation: &str,
) -> Result<(), StatusCode> {
    auth.db.query::<Value>("INSERT INTO email_feedback_receipts(id,digest,claim_id,invitation_id) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",&[verified.id.clone(),verified.digest.clone(),auth::secret(),invitation.into()]).await.map_err(|_|temporary())?;
    Ok(())
}
