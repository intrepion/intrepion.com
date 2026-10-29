//! Invitations expose status to heads, and acceptance secrets only to the mail sender.
mod onboarding;
use crate::{
    auth::{self, SharedAuth},
    capacity,
    db::Statement,
    households::Households,
    lists::valid_id,
    proto::life::v1::*,
};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub(crate) struct Invitations(pub SharedAuth);
#[derive(Deserialize)]
pub(crate) struct InvitationRow {
    pub id: String,
    pub household_id: String,
    pub recipient_email: String,
    pub status: String,
    pub delivery_status: String,
    pub expires_at: i64,
    pub revision: u64,
    pub generation: u64,
}
fn unavailable() -> ConnectError {
    ConnectError::failed_precondition(
        "Invitation changed or is unavailable. Refresh and review again.",
    )
}
fn new_id() -> String {
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
pub(crate) fn email(value: &str) -> Result<String, ConnectError> {
    let value = value.trim().to_ascii_lowercase();
    let Some((local, domain)) = value.split_once('@') else {
        return Err(ConnectError::invalid_argument(
            "Enter the recipient's Google account email.",
        ));
    };
    if value.len() > 254
        || local.is_empty()
        || local.len() > 64
        || !domain.contains('.')
        || !value.is_ascii()
        || value
            .bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
        || domain.contains('@')
        || url::Host::parse(domain).is_err()
    {
        return Err(ConnectError::invalid_argument(
            "Enter the recipient's Google account email.",
        ));
    }
    Ok(value)
}
impl Invitations {
    pub(crate) fn token(&self, id: &str, generation: u64) -> Result<String, ConnectError> {
        let key = self
            .0
            .config
            .invitation_signing_key
            .as_ref()
            .ok_or_else(|| {
                ConnectError::failed_precondition("Email invitations are not configured.")
            })?;
        let bytes = (0..key.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&key[i..i + 2], 16))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ConnectError::internal("Invalid invitation configuration."))?;
        let key = aws_lc_rs::hmac::Key::new(aws_lc_rs::hmac::HMAC_SHA256, &bytes);
        let value = aws_lc_rs::hmac::sign(
            &key,
            format!("intrepion/email-invitation/v1/{id}/{generation}").as_bytes(),
        );
        Ok(value.as_ref().iter().map(|b| format!("{b:02x}")).collect())
    }
    async fn row(&self, id: &str) -> Result<InvitationRow, ConnectError> {
        self.0.db.query::<InvitationRow>("SELECT id,household_id,recipient_email,status,delivery_status,expires_at,revision,generation,created_by FROM email_invitations WHERE id=?",&[id.into()]).await?.pop().ok_or_else(unavailable)
    }
    fn public(&self, row: InvitationRow) -> EmailInvitation {
        let status = if row.status == "pending" && row.expires_at <= auth::now() as i64 {
            "expired".into()
        } else {
            row.status
        };
        EmailInvitation {
            id: row.id,
            recipient_email: row.recipient_email,
            status,
            delivery_status: match row.delivery_status.as_str() {
                "failed" => "failed".into(),
                v => v.into(),
            },
            expires_at: row.expires_at,
            revision: row.revision,
            ..Default::default()
        }
    }
    async fn change(
        &self,
        actor: &str,
        r: &EmailInvitationChange,
    ) -> Result<EmailInvitation, ConnectError> {
        if !r.confirmed || !valid_id(&r.operation_id) || !valid_id(&r.household_id) {
            return Err(ConnectError::invalid_argument(
                "Review and confirm this invitation action.",
            ));
        }
        if !capacity::normal_accounts(&self.0.db).await? {
            return Err(ConnectError::failed_precondition(
                "Normal accounts are not enabled.",
            ));
        }
        Households(self.0.clone())
            .require_head(&r.household_id, actor)
            .await?;
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(r)
                    .map_err(|_| ConnectError::invalid_argument("Invalid invitation change."))?
            )
        );
        #[derive(Deserialize)]
        struct Receipt {
            fingerprint: String,
            invitation_id: String,
        }
        if let Some(receipt)=self.0.db.query::<Receipt>("SELECT fingerprint,invitation_id FROM email_invitation_operations WHERE actor_sub=? AND operation_id=?",&[actor.into(),r.operation_id.clone()]).await?.pop(){if receipt.fingerprint!=fingerprint{return Err(ConnectError::already_exists("Action ID already used for another invitation change."));}return Ok(self.public(self.row(&receipt.invitation_id).await?));}
        let action = r
            .action
            .as_known()
            .ok_or_else(|| ConnectError::invalid_argument("Unknown invitation action."))?;
        let mut statements = vec![];
        let id;
        let authority = "EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)";
        let open_growth = "EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0)";
        match action {
            EmailInvitationAction::Create => {
                if self.0.config.mail.is_none() {
                    return Err(ConnectError::failed_precondition(
                        "Email delivery is not configured.",
                    ));
                }
                if r.expected_revision != 0 {
                    return Err(unavailable());
                }
                let recipient = email(&r.recipient_email)?;
                id = new_id();
                let token = self.token(&id, 1)?;
                let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
                statements.push(Statement::new("UPDATE email_invitations SET status='revoked',delivery_status='canceled',revision=revision+1 WHERE household_id=? AND recipient_email=? AND status='pending' AND expires_at<=?",vec![r.household_id.clone(),recipient.clone(),auth::now().to_string()]));
                statements.push(Statement::new(&format!("INSERT INTO email_invitations(id,household_id,recipient_email,token_hash,expires_at,created_by,last_operation) SELECT ?,?,?,?,?,?,? WHERE {authority} AND {open_growth}"),vec![id.clone(),r.household_id.clone(),recipient,token_hash,(auth::now()+7*86400).to_string(),actor.into(),r.operation_id.clone(),r.household_id.clone(),actor.into()]));
            }
            EmailInvitationAction::Replace | EmailInvitationAction::Revoke => {
                if !valid_id(&r.invitation_id) {
                    return Err(unavailable());
                }
                id = r.invitation_id.clone();
                let old = self.row(&id).await?;
                if old.household_id != r.household_id
                    || old.status != "pending"
                    || old.revision != r.expected_revision
                {
                    return Err(unavailable());
                }
                if action == EmailInvitationAction::Replace {
                    let token =
                        self.token(&id, old.generation.checked_add(1).ok_or_else(unavailable)?)?;
                    let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
                    statements.push(Statement::new(&format!("UPDATE email_invitations SET token_hash=?,generation=generation+1,expires_at=?,revision=revision+1,delivery_status='queued',attempts=0,claim_id='',claim_until=0,next_attempt_at=0,last_operation=? WHERE id=? AND revision=? AND status='pending' AND (consent_until=0 OR consent_until>?) AND {authority} AND {open_growth}"),vec![token_hash,(auth::now()+7*86400).to_string(),r.operation_id.clone(),id.clone(),r.expected_revision.to_string(),auth::now().to_string(),r.household_id.clone(),actor.into()]));
                } else {
                    statements.push(Statement::new(&format!("UPDATE email_invitations SET status='revoked',delivery_status='canceled',revision=revision+1,last_operation=? WHERE id=? AND revision=? AND status='pending' AND {authority}"),vec![r.operation_id.clone(),id.clone(),r.expected_revision.to_string(),r.household_id.clone(),actor.into()]));
                }
            }
            _ => {
                return Err(ConnectError::invalid_argument(
                    "Choose create, Send again or Revoke.",
                ));
            }
        }
        statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM email_invitations WHERE id=? AND last_operation=?)",vec![id.clone(),r.operation_id.clone()]));
        statements.push(Statement::new("INSERT INTO email_invitation_operations(actor_sub,operation_id,fingerprint,invitation_id) VALUES(?,?,?,?)",vec![actor.into(),r.operation_id.clone(),fingerprint,id.clone()]));
        statements.push(Statement::new(
            "INSERT INTO household_activity(household_id,actor_sub,action) VALUES(?,?,?)",
            vec![
                r.household_id.clone(),
                actor.into(),
                match action {
                    EmailInvitationAction::Create => "Invited a head by email",
                    EmailInvitationAction::Replace => "Replaced invitation link",
                    _ => "Revoked invitation",
                }
                .into(),
            ],
        ));
        if action != EmailInvitationAction::Revoke {
            statements.insert(
                0,
                capacity::snapshot(&format!("household:{}", r.household_id), actor, ""),
            );
            statements.extend(capacity::content_checks());
        }
        statements.push(Statement::new("DELETE FROM invariant_guards", vec![]));
        if let Err(e) = self.0.db.batch(&statements).await {
            if matches!(
                e.code,
                connectrpc::ErrorCode::Unavailable | connectrpc::ErrorCode::ResourceExhausted
            ) {
                return Err(e);
            }
            return Err(unavailable());
        }
        self.0.mail_wake.notify_one();
        Ok(self.public(self.row(&id).await?))
    }
}
#[allow(refining_impl_trait)]
impl EmailInvitationService for Invitations {
    async fn get_request_notifications(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdKey>,
    ) -> ServiceResult<RequestNotificationSettings> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Households(self.0.clone())
            .require_head(r.id, &session.user_sub)
            .await?;
        #[derive(Deserialize)]
        struct Settings {
            email: String,
            enabled: i32,
            confirmed_email: String,
        }
        let row=self.0.db.query::<Settings>("SELECT a.google_verified_email AS email,coalesce(s.enabled,0) AS enabled,coalesce(s.confirmed_email,'') AS confirmed_email FROM pilot_accounts a LEFT JOIN household_request_notification_settings s ON s.head_sub=a.subject AND s.household_id=? WHERE a.subject=? AND a.approved=1",&[r.id.into(),session.user_sub]).await?.pop().ok_or_else(unavailable)?;
        Response::ok(RequestNotificationSettings {
            enabled: row.enabled != 0,
            confirmation_required: row.enabled != 0
                && (row.email.is_empty() || row.email != row.confirmed_email),
            email: row.email,
            ..Default::default()
        })
    }
    async fn set_request_notifications(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, RequestNotificationChange>,
    ) -> ServiceResult<RequestNotificationSettings> {
        let session = self.0.authorize_rpc(&ctx).await?;
        if !r.confirmed || !valid_id(r.household_id) {
            return Err(ConnectError::invalid_argument(
                "Confirm notification settings.",
            ));
        }
        Households(self.0.clone())
            .require_head(r.household_id, &session.user_sub)
            .await?;
        let result=self.0.db.batch(&[
            Statement::new("INSERT INTO household_request_notification_settings(household_id,head_sub,enabled,confirmed_email) SELECT h.id,a.subject,?,CASE WHEN CAST(? AS INTEGER)=1 THEN a.google_verified_email ELSE '' END FROM households h JOIN household_heads m ON m.household_id=h.id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1 AND (CAST(? AS INTEGER)=0 OR a.google_verified_email<>'') ON CONFLICT(household_id,head_sub) DO UPDATE SET enabled=excluded.enabled,confirmed_email=excluded.confirmed_email",vec![(r.enabled as u8).to_string(),(r.enabled as u8).to_string(),r.household_id.into(),session.user_sub.clone(),(r.enabled as u8).to_string()]),
            Statement::new("SELECT s.enabled,a.google_verified_email AS email,s.confirmed_email FROM household_request_notification_settings s JOIN pilot_accounts a ON a.subject=s.head_sub JOIN household_heads m ON m.household_id=s.household_id AND m.subject=s.head_sub JOIN households h ON h.id=s.household_id WHERE s.household_id=? AND s.head_sub=? AND s.enabled=? AND m.active=1 AND a.approved=1 AND h.status='active' AND (s.enabled=0 OR (a.google_verified_email<>'' AND s.confirmed_email=a.google_verified_email))",vec![r.household_id.into(),session.user_sub,(r.enabled as u8).to_string()]),
        ]).await?;
        #[derive(Deserialize)]
        struct Settings {
            email: String,
            enabled: i32,
            confirmed_email: String,
        }
        let row: Settings = serde_json::from_value(
            result
                .last()
                .and_then(|v| v.first())
                .cloned()
                .ok_or_else(unavailable)?,
        )
        .map_err(|_| ConnectError::internal("Settings could not be read."))?;
        Response::ok(RequestNotificationSettings {
            enabled: row.enabled != 0,
            confirmation_required: row.enabled != 0
                && (row.email.is_empty() || row.email != row.confirmed_email),
            email: row.email,
            ..Default::default()
        })
    }
    async fn withdraw_invitation_request(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationRequestWithdraw>,
    ) -> ServiceResult<Empty> {
        if !r.confirmed || !valid_id(r.operation_id) || !valid_id(r.request_id) {
            return Err(ConnectError::invalid_argument("Confirm the withdrawal."));
        }
        let session = self
            .0
            .request_lookup_session(ctx.headers(), true)
            .await
            .map_err(|e| match e.0 {
                axum::http::StatusCode::UNAUTHORIZED => {
                    ConnectError::unauthenticated("Sign in to withdraw your request.")
                }
                axum::http::StatusCode::FORBIDDEN => {
                    ConnectError::permission_denied("Request session and CSRF token required.")
                }
                _ => ConnectError::unavailable("Requests are temporarily unavailable."),
            })?;
        let result=self.0.db.batch(&[
            Statement::new("UPDATE household_invitation_requests SET status='withdrawn',closed_at=?,last_decision=? WHERE id=? AND user_sub=? AND status IN('pending','approved') AND NOT EXISTS(SELECT 1 FROM household_request_withdrawals WHERE user_sub=? AND operation_id=?)",vec![auth::now().to_string(),r.operation_id.into(),r.request_id.into(),session.user_sub.clone(),session.user_sub.clone(),r.operation_id.into()]),
            Statement::new("UPDATE email_invitations SET status='revoked',delivery_status='canceled',claim_id='',claim_until=0,revision=revision+1 WHERE request_id=? AND status='pending' AND EXISTS(SELECT 1 FROM household_invitation_requests WHERE id=? AND user_sub=? AND status='withdrawn' AND last_decision=?)",vec![r.request_id.into(),r.request_id.into(),session.user_sub.clone(),r.operation_id.into()]),
            Statement::new("INSERT INTO household_request_withdrawals(user_sub,operation_id,request_id) SELECT user_sub,?,id FROM household_invitation_requests WHERE id=? AND user_sub=? AND status='withdrawn' AND last_decision=? ON CONFLICT(user_sub,operation_id) DO NOTHING",vec![r.operation_id.into(),r.request_id.into(),session.user_sub.clone(),r.operation_id.into()]),
            Statement::new("SELECT request_id FROM household_request_withdrawals WHERE user_sub=? AND operation_id=? AND request_id=?",vec![session.user_sub,r.operation_id.into(),r.request_id.into()]),
        ]).await?;
        if result.last().is_none_or(|rows| rows.is_empty()) {
            return Err(unavailable());
        }
        Response::ok(Empty::default())
    }
    async fn list_my_invitation_requests(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<MyInvitationRequestPage> {
        let session = self
            .0
            .request_lookup_session(ctx.headers(), true)
            .await
            .map_err(|e| match e.0 {
                axum::http::StatusCode::UNAUTHORIZED => {
                    ConnectError::unauthenticated("Sign in to view your requests.")
                }
                axum::http::StatusCode::FORBIDDEN => {
                    ConnectError::permission_denied("Request session and CSRF token required.")
                }
                _ => ConnectError::unavailable("Requests are temporarily unavailable."),
            })?;
        #[derive(Deserialize)]
        struct Row {
            id: String,
            household_name: String,
            email: String,
            status: String,
            requested_at: i64,
        }
        let rows=self.0.db.query::<Row>("SELECT q.id,h.name AS household_name,q.email,CASE WHEN q.status='pending' AND q.expires_at<=? THEN 'expired' ELSE q.status END AS status,q.requested_at FROM household_invitation_requests q JOIN households h ON h.id=q.household_id WHERE q.user_sub=? AND h.status<>'erased' ORDER BY q.requested_at DESC,q.id LIMIT 100",&[auth::now().to_string(),session.user_sub]).await?;
        Response::ok(MyInvitationRequestPage {
            requests: rows
                .into_iter()
                .map(|r| MyInvitationRequest {
                    id: r.id,
                    household_name: r.household_name,
                    email: r.email,
                    status: r.status,
                    requested_at: r.requested_at,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        })
    }
    async fn approve_invitation_request(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationRequestDecision>,
    ) -> ServiceResult<EmailInvitation> {
        let session = self.0.authorize_rpc(&ctx).await?;
        if !r.confirmed
            || !valid_id(r.operation_id)
            || !valid_id(r.household_id)
            || !valid_id(r.request_id)
        {
            return Err(ConnectError::invalid_argument(
                "Confirm the request decision.",
            ));
        }
        Households(self.0.clone())
            .require_head(r.household_id, &session.user_sub)
            .await?;
        if !capacity::normal_accounts(&self.0.db).await? || self.0.config.mail.is_none() {
            return Err(unavailable());
        }
        #[derive(Deserialize)]
        struct Decision {
            request_id: String,
            household_id: String,
            action: String,
        }
        if let Some(old)=self.0.db.query::<Decision>("SELECT request_id,household_id,action FROM household_request_decisions WHERE actor_sub=? AND operation_id=?",&[session.user_sub.clone(),r.operation_id.into()]).await?.pop() {
            if old.request_id!=r.request_id || old.household_id!=r.household_id || old.action!="approve" { return Err(ConnectError::already_exists("Action ID already belongs to another decision.")); }
            return Response::ok(self.public(self.row(r.request_id).await?));
        }
        let token = self.token(r.request_id, 1)?;
        let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
        let now = auth::now();
        let authority = "EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)";
        let statements = vec![
            capacity::snapshot(
                &format!("household:{}", r.household_id),
                &session.user_sub,
                "",
            ),
            Statement::new(
                "INSERT INTO email_monthly_attempts(month) VALUES(strftime('%Y-%m','now')) ON CONFLICT(month) DO NOTHING",
                vec![],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO email_invitations(id,household_id,recipient_email,token_hash,expires_at,created_by,last_operation,request_id,recipient_sub,consent_until) SELECT q.id,q.household_id,q.email,?,?,?,?,q.id,q.user_sub,q.requested_at+2592000 FROM household_invitation_requests q WHERE q.id=? AND q.household_id=? AND q.status='pending' AND q.expires_at>? AND {authority} AND EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) AND EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND enabled=1) AND (SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now'))+(SELECT count(*) FROM email_attempt_reservations WHERE month=strftime('%Y-%m','now'))<10000 AND NOT EXISTS(SELECT 1 FROM household_request_decisions WHERE actor_sub=? AND operation_id=?)"
                ),
                vec![
                    token_hash,
                    (now + 7 * 86400).to_string(),
                    session.user_sub.clone(),
                    r.operation_id.into(),
                    r.request_id.into(),
                    r.household_id.into(),
                    now.to_string(),
                    r.household_id.into(),
                    session.user_sub.clone(),
                    session.user_sub.clone(),
                    r.operation_id.into(),
                ],
            ),
            Statement::new(
                "INSERT INTO email_attempt_reservations(invitation_id,month) SELECT id,strftime('%Y-%m','now') FROM email_invitations WHERE id=? AND last_operation=? AND request_id=?",
                vec![
                    r.request_id.into(),
                    r.operation_id.into(),
                    r.request_id.into(),
                ],
            ),
            Statement::new(
                "UPDATE household_invitation_requests SET status='approved',last_decision=? WHERE id=? AND household_id=? AND status='pending' AND EXISTS(SELECT 1 FROM email_invitations WHERE id=? AND request_id=? AND last_operation=?)",
                vec![
                    r.operation_id.into(),
                    r.request_id.into(),
                    r.household_id.into(),
                    r.request_id.into(),
                    r.request_id.into(),
                    r.operation_id.into(),
                ],
            ),
            Statement::new(
                "INSERT INTO household_request_decisions(actor_sub,operation_id,request_id,household_id,action) SELECT ?,?,id,household_id,'approve' FROM household_invitation_requests WHERE id=? AND household_id=? AND status='approved' AND last_decision=? ON CONFLICT(actor_sub,operation_id) DO NOTHING",
                vec![
                    session.user_sub.clone(),
                    r.operation_id.into(),
                    r.request_id.into(),
                    r.household_id.into(),
                    r.operation_id.into(),
                ],
            ),
            Statement::new(
                "INSERT INTO household_activity(household_id,actor_sub,action) SELECT household_id,?,'Approved a household invitation request' FROM household_invitation_requests WHERE id=? AND status='approved' AND last_decision=?",
                vec![
                    session.user_sub.clone(),
                    r.request_id.into(),
                    r.operation_id.into(),
                ],
            ),
            Statement::new(
                "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM household_request_decisions WHERE actor_sub=? AND operation_id=? AND request_id=? AND household_id=? AND action='approve')",
                vec![
                    session.user_sub.clone(),
                    r.operation_id.into(),
                    r.request_id.into(),
                    r.household_id.into(),
                ],
            ),
        ];
        let mut statements = statements;
        statements.extend(capacity::content_checks());
        statements.push(Statement::new("DELETE FROM invariant_guards", vec![]));
        self.0.db.batch(&statements).await.map_err(|e| {
            if matches!(
                e.code,
                connectrpc::ErrorCode::Unavailable | connectrpc::ErrorCode::ResourceExhausted
            ) {
                e
            } else {
                unavailable()
            }
        })?;
        self.0.mail_wake.notify_one();
        Response::ok(self.public(self.row(r.request_id).await?))
    }
    async fn decline_invitation_request(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationRequestDecision>,
    ) -> ServiceResult<Empty> {
        let session = self.0.authorize_rpc(&ctx).await?;
        if !r.confirmed
            || !valid_id(r.operation_id)
            || !valid_id(r.household_id)
            || !valid_id(r.request_id)
        {
            return Err(ConnectError::invalid_argument(
                "Confirm the request decision.",
            ));
        }
        Households(self.0.clone())
            .require_head(r.household_id, &session.user_sub)
            .await?;
        let authority = "EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)";
        let result=self.0.db.batch(&[
            Statement::new(&format!("UPDATE household_invitation_requests SET status='declined',closed_at=?,last_decision=? WHERE id=? AND household_id=? AND status='pending' AND expires_at>? AND {authority} AND NOT EXISTS(SELECT 1 FROM household_request_decisions WHERE actor_sub=? AND operation_id=?)"),vec![auth::now().to_string(),r.operation_id.into(),r.request_id.into(),r.household_id.into(),auth::now().to_string(),r.household_id.into(),session.user_sub.clone(),session.user_sub.clone(),r.operation_id.into()]),
            Statement::new("INSERT INTO household_activity(household_id,actor_sub,action) SELECT household_id,?,'Declined a household invitation request' FROM household_invitation_requests WHERE id=? AND household_id=? AND status='declined' AND last_decision=? AND NOT EXISTS(SELECT 1 FROM household_request_decisions WHERE actor_sub=? AND operation_id=?)",vec![session.user_sub.clone(),r.request_id.into(),r.household_id.into(),r.operation_id.into(),session.user_sub.clone(),r.operation_id.into()]),
            Statement::new("INSERT INTO household_request_decisions(actor_sub,operation_id,request_id,household_id,action) SELECT ?,?,id,household_id,'decline' FROM household_invitation_requests WHERE id=? AND household_id=? AND status='declined' AND last_decision=? ON CONFLICT(actor_sub,operation_id) DO NOTHING",vec![session.user_sub.clone(),r.operation_id.into(),r.request_id.into(),r.household_id.into(),r.operation_id.into()]),
            Statement::new("SELECT request_id FROM household_request_decisions WHERE actor_sub=? AND operation_id=? AND request_id=? AND household_id=? AND action='decline'",vec![session.user_sub,r.operation_id.into(),r.request_id.into(),r.household_id.into()]),
        ]).await?;
        if result.last().is_none_or(|rows| rows.is_empty()) {
            return Err(unavailable());
        }
        Response::ok(Empty::default())
    }
    async fn submit_invitation_request(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationRequestSubmit>,
    ) -> ServiceResult<InvitationRequest> {
        if !r.confirmed || !valid_id(r.operation_id) {
            return Err(ConnectError::failed_precondition(
                "Confirm that you want an invitation email.",
            ));
        }
        let session = self
            .0
            .request_session(ctx.headers(), true)
            .await
            .map_err(|e| match e.0 {
                axum::http::StatusCode::UNAUTHORIZED => {
                    ConnectError::unauthenticated("Sign in to request an invitation.")
                }
                axum::http::StatusCode::FORBIDDEN => {
                    ConnectError::permission_denied("Request session and CSRF token required.")
                }
                _ => ConnectError::unavailable("Request verification is temporarily unavailable."),
            })?;
        #[derive(Deserialize)]
        struct RequestRow {
            id: String,
            display_name: String,
            email: String,
            status: String,
            requested_at: i64,
            link_id: String,
        }
        #[derive(Deserialize)]
        struct LinkScope {
            household_id: String,
        }
        let scope = self
            .0
            .db
            .query::<LinkScope>(
                "SELECT household_id FROM household_request_links WHERE id=?",
                std::slice::from_ref(&session.link_id),
            )
            .await?
            .pop()
            .ok_or_else(unavailable)?;
        let now = auth::now();
        let mut statements = vec![
            capacity::snapshot(
                &format!("household:{}", scope.household_id),
                &session.user_sub,
                "",
            ),
            Statement::new(
                "UPDATE household_invitation_requests SET status='expired',closed_at=expires_at WHERE status='pending' AND expires_at<=?",
                vec![now.to_string()],
            ),
            Statement::new(
                "INSERT INTO household_invitation_requests(id,household_id,link_id,user_sub,email,display_name,status,consent_version,requested_at,expires_at) SELECT ?,l.household_id,l.id,?,?,?,'pending','v1',?,? FROM household_request_links l JOIN households h ON h.id=l.household_id WHERE l.id=? AND l.revoked=0 AND l.expires_at>? AND h.status='active' AND EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) AND NOT EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=l.household_id AND m.subject=? AND m.active=1) AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=0) AND NOT EXISTS(SELECT 1 FROM protected_account_access p WHERE p.subject_hash=? AND p.active=0) AND NOT EXISTS(SELECT 1 FROM household_request_operations o WHERE o.user_sub=? AND o.operation_id=?) AND NOT EXISTS(SELECT 1 FROM household_invitation_requests d WHERE d.link_id=l.id AND d.user_sub=? AND d.status='declined' AND d.closed_at>?) ON CONFLICT DO NOTHING",
                vec![
                    r.operation_id.into(),
                    session.user_sub.clone(),
                    session.email.clone(),
                    session.display_name.clone(),
                    now.to_string(),
                    (now + 7 * 86400).to_string(),
                    session.link_id.clone(),
                    now.to_string(),
                    session.user_sub.clone(),
                    session.user_sub.clone(),
                    crate::security::subject_hash(&session.user_sub),
                    session.user_sub.clone(),
                    r.operation_id.into(),
                    session.user_sub.clone(),
                    now.saturating_sub(7 * 86400).to_string(),
                ],
            ),
            Statement::new(
                "INSERT INTO household_request_operations(user_sub,operation_id,link_id,request_id) SELECT ?,?,l.id,q.id FROM household_request_links l JOIN household_invitation_requests q ON q.household_id=l.household_id AND q.user_sub=? AND q.email=? AND q.status='pending' WHERE l.id=? AND l.revoked=0 AND l.expires_at>? AND EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) ON CONFLICT(user_sub,operation_id) DO NOTHING",
                vec![
                    session.user_sub.clone(),
                    r.operation_id.into(),
                    session.user_sub.clone(),
                    session.email.clone(),
                    session.link_id.clone(),
                    now.to_string(),
                ],
            ),
            Statement::new(
                "SELECT q.id,q.display_name,q.email,q.status,q.requested_at,o.link_id FROM household_request_operations o JOIN household_invitation_requests q ON q.id=o.request_id WHERE o.user_sub=? AND o.operation_id=?",
                vec![session.user_sub.clone(), r.operation_id.into()],
            ),
        ];
        let result_query = statements.pop().expect("request result query");
        statements.extend(capacity::content_checks());
        statements.push(Statement::new("DELETE FROM invariant_guards", vec![]));
        statements.push(result_query);
        let result = self.0.db.batch(&statements).await?;
        let row: RequestRow = serde_json::from_value(
            result
                .last()
                .and_then(|r| r.first())
                .cloned()
                .ok_or_else(unavailable)?,
        )
        .map_err(|_| ConnectError::internal("Request could not be read."))?;
        if row.link_id != session.link_id || row.email != session.email {
            return Err(unavailable());
        }
        Response::ok(InvitationRequest {
            id: row.id,
            display_name: row.display_name,
            email: row.email,
            status: row.status,
            requested_at: row.requested_at,
            ..Default::default()
        })
    }
    async fn list_invitation_requests(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdKey>,
    ) -> ServiceResult<InvitationRequestPage> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Households(self.0.clone())
            .require_head(r.id, &session.user_sub)
            .await?;
        #[derive(Deserialize)]
        struct Row {
            id: String,
            display_name: String,
            email: String,
            status: String,
            requested_at: i64,
        }
        let rows=self.0.db.query::<Row>("SELECT id,display_name,email,status,requested_at FROM household_invitation_requests WHERE household_id=? AND status='pending' AND expires_at>? ORDER BY requested_at,id LIMIT 100",&[r.id.into(),auth::now().to_string()]).await?;
        Response::ok(InvitationRequestPage {
            requests: rows
                .into_iter()
                .map(|r| InvitationRequest {
                    id: r.id,
                    display_name: r.display_name,
                    email: r.email,
                    status: r.status,
                    requested_at: r.requested_at,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        })
    }
    async fn get_request_preview(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<RequestPreview> {
        let session = self
            .0
            .request_session(ctx.headers(), true)
            .await
            .map_err(|e| match e.0 {
                axum::http::StatusCode::UNAUTHORIZED => {
                    ConnectError::unauthenticated("Sign in to review this request.")
                }
                axum::http::StatusCode::FORBIDDEN => {
                    ConnectError::permission_denied("Request session and CSRF token required.")
                }
                _ => ConnectError::unavailable("Request verification is temporarily unavailable."),
            })?;
        #[derive(Deserialize)]
        struct Preview {
            household_name: String,
            already_head: i32,
        }
        let row=self.0.db.query::<Preview>("SELECT h.name AS household_name, EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=h.id AND m.subject=? AND m.active=1) AS already_head FROM household_request_links l JOIN households h ON h.id=l.household_id WHERE l.id=? AND l.revoked=0 AND l.expires_at>? AND h.status='active'",&[session.user_sub,session.link_id,auth::now().to_string()]).await?.pop().ok_or_else(unavailable)?;
        Response::ok(RequestPreview {
            household_name: row.household_name,
            email: session.email,
            display_name: session.display_name,
            already_head: row.already_head != 0,
            ..Default::default()
        })
    }
    async fn revoke_request_link(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, RequestLinkRevoke>,
    ) -> ServiceResult<Empty> {
        let session = self.0.authorize_rpc(&ctx).await?;
        if !valid_id(r.household_id) || !valid_id(r.link_id) {
            return Err(ConnectError::invalid_argument(
                "Invalid request link action.",
            ));
        }
        Households(self.0.clone())
            .require_head(r.household_id, &session.user_sub)
            .await?;
        let result = self.0.db.batch(&[
            Statement::new("UPDATE household_request_links SET revoked=1 WHERE id=? AND household_id=? AND EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)", vec![r.link_id.into(),r.household_id.into(),r.household_id.into(),session.user_sub.clone()]),
            Statement::new("UPDATE household_invitation_requests SET status='canceled',closed_at=? WHERE link_id=? AND status='pending' AND EXISTS(SELECT 1 FROM household_request_links l JOIN household_heads m ON m.household_id=l.household_id JOIN households h ON h.id=l.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE l.id=? AND l.household_id=? AND l.revoked=1 AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)", vec![auth::now().to_string(),r.link_id.into(),r.link_id.into(),r.household_id.into(),session.user_sub.clone()]),
            Statement::new("SELECT id FROM household_request_links WHERE id=? AND household_id=? AND revoked=1 AND EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1)", vec![r.link_id.into(),r.household_id.into(),r.household_id.into(),session.user_sub]),
        ]).await?;
        if result.last().is_none_or(|rows| rows.is_empty()) {
            return Err(unavailable());
        }
        Response::ok(Empty::default())
    }
    async fn create_request_link(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, RequestLinkCreate>,
    ) -> ServiceResult<RequestLink> {
        let session = self.0.authorize_rpc(&ctx).await?;
        if !valid_id(r.operation_id) || !valid_id(r.household_id) {
            return Err(ConnectError::invalid_argument(
                "Invalid request link action.",
            ));
        }
        Households(self.0.clone())
            .require_head(r.household_id, &session.user_sub)
            .await?;
        if !capacity::normal_accounts(&self.0.db).await? {
            return Err(ConnectError::failed_precondition(
                "Normal accounts are not enabled.",
            ));
        }
        #[derive(Deserialize)]
        struct LinkRow {
            id: String,
            household_id: String,
            created_by: String,
            expires_at: i64,
            revoked: i64,
        }
        let params = vec![r.operation_id.into()];
        let read = || {
            self.0.db.query::<LinkRow>("SELECT id,household_id,created_by,expires_at,revoked FROM household_request_links WHERE id=?", &params)
        };
        let token = self.token(r.operation_id, 0)?;
        let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
        let existing = read().await?;
        if existing.is_empty() {
            let expires = (auth::now() + 7 * 86400).to_string();
            let mut statements = vec![capacity::snapshot(
                &format!("household:{}", r.household_id),
                &session.user_sub,
                "",
            )];
            statements.push(
                Statement::new("INSERT INTO household_request_links(id,household_id,created_by,token_hash,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND paused=0) AND EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1) ON CONFLICT(id) DO NOTHING", vec![r.operation_id.into(),r.household_id.into(),session.user_sub.clone(),token_hash,expires,r.household_id.into(),session.user_sub.clone()]),
            );
            statements.extend(capacity::content_checks());
            statements.push(Statement::new("DELETE FROM invariant_guards", vec![]));
            self.0.db.batch(&statements).await?;
        }
        let row = read().await?.pop().ok_or_else(unavailable)?;
        if row.household_id != r.household_id
            || row.created_by != session.user_sub
            || row.revoked != 0
        {
            return Err(unavailable());
        }
        Response::ok(RequestLink {
            id: row.id,
            token,
            expires_at: row.expires_at,
            ..Default::default()
        })
    }
    async fn get_onboarding(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<OnboardingPreview> {
        let context = self.onboarding_context(&ctx).await?;
        let preview = self.onboarding_preview(&context).await?;
        if preview.status == "accepted" {
            crate::security::protect(&self.0).await?;
            let (_, token) = self.0.new_session(&context.user_sub).await.map_err(|_| {
                ConnectError::unavailable("Account joined; retry sign-in recovery.")
            })?;
            return Ok(Response::new(preview).with_header(
                "set-cookie",
                self.0.set_cookie("session", &token, 7 * 86400),
            ));
        }
        Response::ok(preview)
    }
    async fn accept_invitation(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationAcceptance>,
    ) -> ServiceResult<AccountSession> {
        let context = self.onboarding_context(&ctx).await?;
        let mut result = self.accept(&context, &r.to_owned_message()).await?;
        crate::security::protect(&self.0).await?;
        let (session, token) = self.0.new_session(&context.user_sub).await.map_err(|_| {
            ConnectError::unavailable("Account joined; sign in again or retry the same acceptance.")
        })?;
        result.csrf = session.csrf;
        result.expires_at = session.expires_at;
        result.display_name = session.display_name;
        result.user_sub = session.user_sub;
        Ok(Response::new(result).with_header(
            "set-cookie",
            self.0.set_cookie("session", &token, 7 * 86400),
        ))
    }
    async fn list_invitations(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdKey>,
    ) -> ServiceResult<EmailInvitationPage> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Households(self.0.clone())
            .require_head(r.id, &session.user_sub)
            .await?;
        let rows=self.0.db.query::<InvitationRow>("SELECT id,household_id,recipient_email,status,delivery_status,expires_at,revision,generation,created_by FROM email_invitations WHERE household_id=? ORDER BY created_at DESC,id LIMIT 100",&[r.id.into()]).await?;
        Response::ok(EmailInvitationPage {
            invitations: rows.into_iter().map(|r| self.public(r)).collect(),
            ..Default::default()
        })
    }
    async fn change_invitation(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, EmailInvitationChange>,
    ) -> ServiceResult<EmailInvitation> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Response::ok(
            self.change(&session.user_sub, &r.to_owned_message())
                .await?,
        )
    }
}
