//! Bounded durable delivery; provider uncertainty consumes an attempt and may duplicate mail.
use crate::{
    auth::{self, SharedAuth},
    db::Statement,
    invitations::Invitations,
    proto::life::v1::*,
};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;
use std::{env, time::SystemTime};

#[derive(Clone)]
pub struct Settings {
    pub region: String,
    pub from: String,
    pub reply_to: String,
    pub configuration_set: String,
    pub feedback_topic_arn: String,
    pub access_key: String,
    pub secret_key: String,
    pub session_token: Option<String>,
    pub automatic: bool,
}
impl Settings {
    pub fn from_env(local: bool) -> Result<Option<Self>, String> {
        if local {
            return Ok(Some(Self {
                region: "us-west-2".into(),
                from: "intrepion@example.invalid".into(),
                reply_to: "support@example.invalid".into(),
                configuration_set: "local".into(),
                feedback_topic_arn: "arn:aws:sns:us-west-2:000000000000:local-email-feedback"
                    .into(),
                access_key: String::new(),
                secret_key: String::new(),
                session_token: None,
                automatic: env::var("LOCAL_EMAIL_AUTOMATIC").as_deref() == Ok("1"),
            }));
        }
        let names = [
            "SES_REGION",
            "SES_FROM_ADDRESS",
            "SES_REPLY_TO_ADDRESS",
            "SES_CONFIGURATION_SET",
            "SES_ACCESS_KEY_ID",
            "SES_SECRET_ACCESS_KEY",
            "SES_FEEDBACK_TOPIC_ARN",
        ];
        let present = names.iter().filter(|n| env::var(n).is_ok()).count();
        if present == 0 {
            return Ok(None);
        }
        if present != names.len() {
            return Err("Configure all SES delivery settings together".into());
        }
        let get = |name| env::var(name).map_err(|_| format!("Missing {name}"));
        let region = get(names[0])?;
        if region.len() > 32
            || region.is_empty()
            || !region
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err("Invalid SES_REGION".into());
        }
        let from = get(names[1])?;
        let reply_to = get(names[2])?;
        for address in [&from, &reply_to] {
            crate::invitations::email(address)
                .map_err(|_| "Use a valid SES sender/reply email address".to_string())?;
        }
        Ok(Some(Self {
            region: region.clone(),
            from,
            reply_to,
            feedback_topic_arn: {
                let topic = get(names[6])?;
                let parts = topic.split(':').collect::<Vec<_>>();
                if parts.len() != 6
                    || parts[0] != "arn"
                    || parts[1] != "aws"
                    || parts[2] != "sns"
                    || parts[3] != region
                    || parts[4].len() != 12
                    || !parts[4].bytes().all(|b| b.is_ascii_digit())
                    || parts[5].is_empty()
                {
                    return Err("Invalid SES_FEEDBACK_TOPIC_ARN for the configured region".into());
                }
                topic
            },
            configuration_set: get(names[3])?,
            access_key: get(names[4])?,
            secret_key: get(names[5])?,
            session_token: env::var("SES_SESSION_TOKEN").ok(),
            automatic: true,
        }))
    }
}
pub(crate) struct Delivery(pub SharedAuth);
#[derive(Deserialize)]
struct Pending {
    id: String,
    household_id: String,
    recipient_email: String,
    generation: u64,
    attempts: u64,
}
#[derive(Deserialize)]
struct Total {
    attempted: u64,
}
#[derive(Deserialize)]
struct PendingNotification {
    id: String,
    household_id: String,
    household_name: String,
    recipient_email: String,
    attempts: u64,
}
fn failure() -> ConnectError {
    ConnectError::unavailable("Email operations are temporarily unavailable.")
}
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
impl Delivery {
    pub(crate) async fn process(&self) -> Result<EmailQueueResult, ConnectError> {
        if self.0.config.customer_writes_frozen {
            return Ok(EmailQueueResult::default());
        }
        let token = crate::delivery_gate::acquire_with_wait(&self.0.db).await?;
        let result = self.process_locked().await;
        crate::delivery_gate::release(&self.0.db, &token).await?;
        result
    }
    async fn process_locked(&self) -> Result<EmailQueueResult, ConnectError> {
        crate::retention::prune(&self.0).await?;
        crate::security::protect(&self.0).await?;
        let _lock = self.0.mail_lock.lock().await;
        let settings = self.0.config.mail.as_ref().ok_or_else(|| {
            ConnectError::failed_precondition("Email delivery is not configured.")
        })?;
        let now = auth::now().to_string();
        // A stopped process can leave the last bounded attempt unacknowledged.
        // Its expired claim permits reconciliation, never another provider call.
        // Keep the attempt's conservative uncertainty and monthly charge count.
        self.0.db.query::<serde_json::Value>("UPDATE email_invitations SET delivery_status='uncertain',claim_id='',claim_until=0 WHERE status='pending' AND delivery_status='sending' AND attempts>=3 AND claim_until<=CAST(? AS INTEGER)",std::slice::from_ref(&now)).await?;
        // All eligibility checks are repeated in the transaction claiming the attempt.
        let eligible = "i.status='pending' AND i.delivery_status IN('queued','uncertain','sending') AND i.expires_at>CAST(? AS INTEGER) AND i.attempts<3 AND i.claim_until<=CAST(? AS INTEGER) AND i.next_attempt_at<=CAST(? AS INTEGER) AND (i.consent_until=0 OR i.consent_until>CAST(? AS INTEGER)) AND EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) AND EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND enabled=1) AND EXISTS(SELECT 1 FROM households h JOIN household_heads m ON m.household_id=h.id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=i.household_id AND h.status='active' AND m.subject=i.created_by AND m.active=1 AND a.approved=1) AND NOT EXISTS(SELECT 1 FROM email_suppressions x WHERE x.recipient_email=i.recipient_email)";
        let pending=self.0.db.query::<Pending>(&format!("SELECT i.id,i.household_id,i.recipient_email,i.generation,i.attempts FROM email_invitations i WHERE {eligible} ORDER BY i.created_at,i.id LIMIT 3"),&[now.clone(),now.clone(),now.clone(),now.clone()]).await?;
        let mut attempted = 0;
        for i in pending {
            let claim = auth::secret();
            let attempt = super_id();
            let now = auth::now();
            let claimed=self.0.db.batch(&[
    Statement::new("INSERT INTO email_monthly_attempts(month) VALUES(strftime('%Y-%m','now')) ON CONFLICT(month) DO NOTHING",vec![]),
    Statement::new(&format!("UPDATE email_invitations AS i SET claim_id=?,claim_until=?,attempts=attempts+1,delivery_status='sending' WHERE i.id=? AND i.generation=? AND {eligible} AND (SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now'))<10000 AND (EXISTS(SELECT 1 FROM email_attempt_reservations WHERE invitation_id=i.id AND month=strftime('%Y-%m','now')) OR (SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now'))+(SELECT count(*) FROM email_attempt_reservations WHERE month=strftime('%Y-%m','now'))<10000)"),vec![claim.clone(),(now+30).to_string(),i.id.clone(),i.generation.to_string(),now.to_string(),now.to_string(),now.to_string(),now.to_string()]),
    Statement::new("INSERT INTO email_send_attempts(id,invitation_id,generation,recipient_email,attempted_at) SELECT ?,id,generation,recipient_email,? FROM email_invitations WHERE id=? AND claim_id=? AND generation=?",vec![attempt.clone(),now.to_string(),i.id.clone(),claim.clone(),i.generation.to_string()]),
    Statement::new("DELETE FROM email_attempt_reservations WHERE invitation_id=? AND EXISTS(SELECT 1 FROM email_send_attempts WHERE id=?)",vec![i.id.clone(),attempt.clone()]),
    Statement::new("UPDATE email_monthly_attempts SET attempted=attempted+1 WHERE month=strftime('%Y-%m','now') AND EXISTS(SELECT 1 FROM email_send_attempts WHERE id=?)",vec![attempt.clone()]),
    Statement::new("SELECT id FROM email_send_attempts WHERE id=?",vec![attempt.clone()]),
   ]).await?;
            if claimed.last().is_none_or(|r| r.is_empty()) {
                continue;
            }
            attempted += 1;
            let token = Invitations(self.0.clone()).token(&i.id, i.generation)?;
            // Rendering uses only server-selected context; secrets never enter RPC responses.
            #[derive(Deserialize)]
            struct Name {
                name: String,
            }
            let household = self
                .0
                .db
                .query::<Name>(
                    "SELECT name FROM households WHERE id=?",
                    std::slice::from_ref(&i.household_id),
                )
                .await?
                .pop()
                .ok_or_else(failure)?;
            let link = format!("{}/#invite={token}", self.0.config.web_origin);
            let text = format!(
                "You're invited to {}\n\nJoin as an equal head with access to retained household content and History. Your personal lists stay private.\n\nReview invitation:\n{}\n\nUse {} with Google. The link is valid for seven days from the invitation or explicit Send again. Opening it does not accept.\n\nIf you did not expect this, ignore it or reply to {}.",
                household.name, link, i.recipient_email, settings.reply_to
            );
            let html = format!(
                r#"<!doctype html><html lang="en"><meta charset="utf-8"><title>Household invitation</title><body style="font-family:system-ui,sans-serif;background:#f5f7f4;color:#182a24;padding:24px"><main style="max-width:560px;margin:auto;background:white;border:1px solid #dbe4dc;border-radius:16px;padding:24px"><p>Intrepion</p><h1>You're invited to {}</h1><p>Join as an equal head with access to retained household content and History. Your personal lists stay private.</p><p><a href="{}" style="display:inline-block;background:#205c45;color:white;padding:12px 18px;border-radius:8px">Review invitation</a></p><p>Use {} with Google. The link is valid for seven days from the invitation or explicit Send again. Opening it does not accept.</p><p>If you did not expect this, ignore it or reply to <a href="mailto:{}">{}</a>.</p></main></body></html>"#,
                escape_html(&household.name),
                escape_html(&link),
                escape_html(&i.recipient_email),
                escape_html(&settings.reply_to),
                escape_html(&settings.reply_to)
            );
            let payload = serde_json::json!({"FromEmailAddress":settings.from,"ReplyToAddresses":[settings.reply_to],"Destination":{"ToAddresses":[i.recipient_email]},"ConfigurationSetName":settings.configuration_set,"Content":{"Simple":{"Subject":{"Data":format!("You're invited to {}",household.name),"Charset":"UTF-8"},"Body":{"Text":{"Data":text,"Charset":"UTF-8"},"Html":{"Data":html,"Charset":"UTF-8"}}}},"EmailTags":[{"Name":"invitation_id","Value":i.id},{"Name":"attempt_id","Value":attempt}]});
            let result = self.submit(settings, &payload).await;
            let (outcome, message_id) = match result {
                Ok(id) => ("submitted", id),
                Err(temporary) => (
                    if temporary { "uncertain" } else { "failed" },
                    String::new(),
                ),
            };
            self.0.db.batch(&[
    Statement::new("UPDATE email_send_attempts SET outcome=CASE WHEN feedback_at=0 THEN ? ELSE outcome END,provider_message_id=CASE WHEN provider_message_id='' THEN ? ELSE provider_message_id END WHERE id=?",vec![outcome.into(),message_id,attempt.clone()]),
    Statement::new("UPDATE email_invitations SET delivery_status=?,claim_id='',claim_until=0,next_attempt_at=? WHERE id=? AND generation=? AND claim_id=? AND status='pending' AND delivery_status='sending'",vec![outcome.into(),(now+if i.attempts==0{60}else{300}).to_string(),i.id,i.generation.to_string(),claim]),
   ]).await?;
        }
        attempted += self.process_notifications(settings).await?;
        let monthly = self
            .0
            .db
            .query::<Total>(
                "SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now')",
                &[],
            )
            .await?
            .pop()
            .map_or(0, |t| t.attempted);
        Ok(EmailQueueResult {
            attempted,
            monthly_attempts: monthly,
            warning: monthly >= 8000,
            ..Default::default()
        })
    }
    async fn process_notifications(&self, settings: &Settings) -> Result<u64, ConnectError> {
        let now = auth::now();
        self.0.db.query::<serde_json::Value>("UPDATE household_request_notifications SET status='uncertain',claim_id='',claim_until=0 WHERE status='sending' AND attempts>=3 AND claim_until<=?",&[now.to_string()]).await?;
        let eligible = "n.status IN('queued','uncertain','sending') AND n.attempts<3 AND n.claim_until<=CAST(? AS INTEGER) AND n.next_attempt_at<=CAST(? AS INTEGER) AND EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) AND EXISTS(SELECT 1 FROM household_invitation_requests q WHERE q.id=n.request_id AND q.status='pending' AND q.expires_at>CAST(? AS INTEGER)) AND EXISTS(SELECT 1 FROM households h JOIN household_heads m ON m.household_id=h.id JOIN pilot_accounts a ON a.subject=m.subject JOIN household_request_notification_settings s ON s.household_id=h.id AND s.head_sub=m.subject WHERE h.id=n.household_id AND h.status='active' AND m.subject=n.head_sub AND m.active=1 AND a.approved=1 AND s.enabled=1 AND s.confirmed_email=n.recipient_email AND a.google_verified_email=n.recipient_email) AND NOT EXISTS(SELECT 1 FROM email_suppressions x WHERE x.recipient_email=n.recipient_email)";
        let pending=self.0.db.query::<PendingNotification>(&format!("SELECT n.id,n.household_id,h.name AS household_name,n.recipient_email,n.attempts FROM household_request_notifications n JOIN households h ON h.id=n.household_id WHERE {eligible} ORDER BY n.created_at,n.id LIMIT 3"),&[now.to_string(),now.to_string(),now.to_string()]).await?;
        let mut attempted = 0;
        for n in pending {
            let now = auth::now();
            let claim = auth::secret();
            let attempt = super_id();
            let claimed=self.0.db.batch(&[
                Statement::new("INSERT INTO email_monthly_attempts(month) VALUES(strftime('%Y-%m','now')) ON CONFLICT(month) DO NOTHING",vec![]),
                Statement::new(&format!("UPDATE household_request_notifications AS n SET claim_id=?,claim_until=?,attempts=attempts+1,status='sending' WHERE n.id=? AND {eligible} AND (SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now'))+(SELECT count(*) FROM email_attempt_reservations WHERE month=strftime('%Y-%m','now'))<10000"),vec![claim.clone(),(now+30).to_string(),n.id.clone(),now.to_string(),now.to_string(),now.to_string()]),
                Statement::new("INSERT INTO email_send_attempts(id,invitation_id,generation,recipient_email,attempted_at) SELECT ?,id,1,recipient_email,? FROM household_request_notifications WHERE id=? AND claim_id=?",vec![attempt.clone(),now.to_string(),n.id.clone(),claim.clone()]),
                Statement::new("UPDATE email_monthly_attempts SET attempted=attempted+1 WHERE month=strftime('%Y-%m','now') AND EXISTS(SELECT 1 FROM email_send_attempts WHERE id=?)",vec![attempt.clone()]),
                Statement::new("SELECT id FROM email_send_attempts WHERE id=?",vec![attempt.clone()]),
            ]).await?;
            if claimed.last().is_none_or(|r| r.is_empty()) {
                continue;
            }
            attempted += 1;
            let review = format!("{}/#household={}", self.0.config.web_origin, n.household_id);
            let settings_link = format!(
                "{}/#household={}&notifications=1",
                self.0.config.web_origin, n.household_id
            );
            let text = format!(
                "A new invitation request is waiting for review in {}.\n\nReview in Intrepion: {}\n\nManage request notifications: {}\n\nFor help, contact {}.",
                n.household_name, review, settings_link, settings.reply_to
            );
            let html = format!(
                "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><body><h1>New household invitation request</h1><p>A request is waiting for review in {}.</p><p><a href=\"{}\">Review in Intrepion</a></p><p><a href=\"{}\">Manage request notifications</a></p></body></html>",
                escape_html(&n.household_name),
                escape_html(&review),
                escape_html(&settings_link)
            );
            let payload = serde_json::json!({"FromEmailAddress":settings.from,"ReplyToAddresses":[settings.reply_to],"Destination":{"ToAddresses":[n.recipient_email]},"ConfigurationSetName":settings.configuration_set,"Content":{"Simple":{"Subject":{"Data":"New household invitation request","Charset":"UTF-8"},"Body":{"Text":{"Data":text,"Charset":"UTF-8"},"Html":{"Data":html,"Charset":"UTF-8"}}}},"EmailTags":[{"Name":"invitation_id","Value":n.id},{"Name":"attempt_id","Value":attempt}]});
            let (outcome, message_id) = match self.submit(settings, &payload).await {
                Ok(id) => ("submitted", id),
                Err(temporary) => (
                    if temporary { "uncertain" } else { "failed" },
                    String::new(),
                ),
            };
            self.0.db.batch(&[
                Statement::new("UPDATE email_send_attempts SET outcome=CASE WHEN feedback_at=0 THEN ? ELSE outcome END,provider_message_id=CASE WHEN provider_message_id='' THEN ? ELSE provider_message_id END WHERE id=?",vec![outcome.into(),message_id,attempt]),
                Statement::new("UPDATE household_request_notifications SET status=?,claim_id='',claim_until=0,next_attempt_at=? WHERE id=? AND claim_id=? AND status='sending'",vec![outcome.into(),(now+if n.attempts==0{60}else{300}).to_string(),n.id,claim]),
            ]).await?;
        }
        Ok(attempted)
    }
    async fn submit(
        &self,
        settings: &Settings,
        payload: &serde_json::Value,
    ) -> Result<String, bool> {
        let body = serde_json::to_vec(payload).map_err(|_| false)?;
        let request = if self.0.config.local {
            self.0
                .http
                .post("http://127.0.0.1:8793/send")
                .bearer_auth("local-email-only")
                .header("content-type", "application/json")
                .body(body)
        } else {
            use aws_sigv4::{
                http_request::{SignableBody, SignableRequest, SigningSettings, sign},
                sign::v4,
            };
            let endpoint = format!(
                "https://email.{}.amazonaws.com/v2/email/outbound-emails",
                settings.region
            );
            let identity = aws_credential_types::Credentials::new(
                &settings.access_key,
                &settings.secret_key,
                settings.session_token.clone(),
                None,
                "configured-ses-sender",
            )
            .into();
            let params = v4::SigningParams::builder()
                .identity(&identity)
                .region(&settings.region)
                .name("ses")
                .time(SystemTime::now())
                .settings(SigningSettings::default())
                .build()
                .map_err(|_| false)?
                .into();
            let signable = SignableRequest::new(
                "POST",
                &endpoint,
                [("content-type", "application/json")].into_iter(),
                SignableBody::Bytes(&body),
            )
            .map_err(|_| false)?;
            let (instructions, _) = sign(signable, &params).map_err(|_| false)?.into_parts();
            let mut request = self
                .0
                .http
                .post(&endpoint)
                .header("content-type", "application/json")
                .body(body);
            for (name, value) in instructions.headers() {
                request = request.header(name, value);
            }
            request
        };
        let response = request.send().await.map_err(|_| true)?;
        let status = response.status();
        if !status.is_success() {
            return Err(status.as_u16() == 429 || status.is_server_error());
        }
        let response: serde_json::Value = response.json().await.map_err(|_| true)?;
        response
            .get("MessageId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or(true)
    }
}
fn super_id() -> String {
    let h = auth::secret();
    format!(
        "{}-{}-4{}-a{}-{}",
        &h[..8],
        &h[8..12],
        &h[13..16],
        &h[17..20],
        &h[20..32]
    )
}
#[allow(refining_impl_trait)]
impl EmailOperationsService for Delivery {
    async fn process_queue(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<EmailQueueResult> {
        let token = ctx
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        if self
            .0
            .config
            .email_operations_token
            .as_deref()
            .is_none_or(|expected| token != Some(expected))
        {
            return Err(ConnectError::permission_denied(
                "Email operations credential required.",
            ));
        }
        Response::ok(self.process().await?)
    }
}
pub fn spawn_worker(auth: SharedAuth) -> Option<tokio::task::JoinHandle<()>> {
    if !auth.config.mail.as_ref().is_some_and(|s| s.automatic) {
        return None;
    }
    Some(tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tokio::select! {_=tick.tick()=>{},_=auth.mail_wake.notified()=>{}}
            if Delivery(auth.clone()).process().await.is_err() {
                eprintln!("{{\"event\":\"email_queue\",\"ok\":false}}");
                // A wake can arrive while a consent-changing request still
                // holds the shared gate. Do not defer that queued mail for a
                // full periodic interval merely because of this contention.
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                auth.mail_wake.notify_one();
            }
        }
    }))
}
