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
                    statements.push(Statement::new(&format!("UPDATE email_invitations SET token_hash=?,generation=generation+1,expires_at=?,revision=revision+1,delivery_status='queued',attempts=0,claim_id='',claim_until=0,next_attempt_at=0,last_operation=? WHERE id=? AND revision=? AND status='pending' AND {authority} AND {open_growth}"),vec![token_hash,(auth::now()+7*86400).to_string(),r.operation_id.clone(),id.clone(),r.expected_revision.to_string(),r.household_id.clone(),actor.into()]));
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
