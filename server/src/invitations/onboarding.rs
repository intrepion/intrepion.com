use super::*;
use crate::auth::Onboarding;

fn authentication(error: crate::auth::AuthError) -> ConnectError {
    match error.0 {
        axum::http::StatusCode::UNAUTHORIZED => {
            ConnectError::unauthenticated("Open the invitation email and sign in again.")
        }
        axum::http::StatusCode::FORBIDDEN => {
            ConnectError::permission_denied("Invitation session and CSRF token required.")
        }
        _ => ConnectError::unavailable("Invitation verification is temporarily unavailable."),
    }
}
impl Invitations {
    pub(super) async fn onboarding_context(
        &self,
        ctx: &RequestContext,
    ) -> Result<Onboarding, ConnectError> {
        self.0
            .onboarding(ctx.headers(), true)
            .await
            .map_err(authentication)
    }
    pub(super) async fn onboarding_preview(
        &self,
        o: &Onboarding,
    ) -> Result<OnboardingPreview, ConnectError> {
        #[derive(Deserialize)]
        struct Preview {
            household_id: String,
            household_name: String,
            status: String,
            display_name: String,
            existing_account: i32,
            paused: i32,
        }
        let row=self.0.db.query::<Preview>("SELECT i.household_id,h.name AS household_name,i.status,coalesce(a.display_name,?) AS display_name,CASE WHEN a.subject IS NULL THEN 0 ELSE 1 END AS existing_account,g.paused FROM email_invitations i JOIN households h ON h.id=i.household_id JOIN invitation_growth g ON g.id=1 LEFT JOIN pilot_accounts a ON a.subject=? WHERE i.id=? AND i.generation=? AND h.status='active' AND (a.approved IS NULL OR a.approved=1)",&[o.display_name.clone(),o.user_sub.clone(),o.invitation_id.clone(),o.generation.to_string()]).await?.pop().ok_or_else(unavailable)?;
        Ok(OnboardingPreview {
            household_id: row.household_id,
            household_name: row.household_name,
            email: o.email.clone(),
            display_name: row.display_name,
            existing_account: row.existing_account != 0,
            growth_paused: row.paused != 0,
            status: row.status,
            ..Default::default()
        })
    }
    pub(super) async fn accept(
        &self,
        o: &Onboarding,
        r: &InvitationAcceptance,
    ) -> Result<AccountSession, ConnectError> {
        if !r.confirmed || !valid_id(&r.operation_id) {
            return Err(ConnectError::failed_precondition(
                "Review and explicitly accept equal head authority before joining.",
            ));
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    o.invitation_id.clone(),
                    o.generation,
                    r.display_name.clone()
                ))
                .expect("acceptance fingerprint")
            )
        );
        #[derive(Deserialize)]
        struct Receipt {
            fingerprint: String,
            household_id: String,
        }
        if let Some(receipt)=self.0.db.query::<Receipt>("SELECT fingerprint,household_id FROM invitation_acceptance_receipts WHERE user_sub=? AND operation_id=?",&[o.user_sub.clone(),r.operation_id.clone()]).await?.pop(){
   if receipt.fingerprint!=fingerprint{return Err(ConnectError::already_exists("This action ID belongs to another acceptance."));}
   return Ok(AccountSession{household_id:receipt.household_id,..Default::default()});
  }
        let row = self.row(&o.invitation_id).await?;
        if row.status != "pending"
            || row.generation != o.generation
            || row.recipient_email != o.email
            || row.expires_at <= auth::now() as i64
        {
            return Err(unavailable());
        }
        let name = r.display_name.trim();
        let preview = self.onboarding_preview(o).await?;
        if preview.growth_paused {
            return Err(ConnectError::failed_precondition(
                "Joining is temporarily paused. Your invitation has not been accepted.",
            ));
        }
        if !preview.existing_account
            && (name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control))
        {
            return Err(ConnectError::invalid_argument(
                "Enter a display name of 1–100 characters.",
            ));
        }
        let name = if preview.existing_account {
            preview.display_name.clone()
        } else {
            name.into()
        };
        // Re-evaluate recipient, issuer, membership, suspension, expiry and growth in
        // the same transaction as account/membership admission and durable receipt.
        let eligible = "EXISTS(SELECT 1 FROM email_invitations i JOIN households h ON h.id=i.household_id JOIN household_heads m ON m.household_id=h.id AND m.subject=i.created_by JOIN pilot_accounts a ON a.subject=m.subject JOIN invitation_growth g ON g.id=1 JOIN site_safety_policy p ON p.id=1 WHERE i.id=? AND i.generation=? AND i.recipient_email=? AND (i.recipient_sub='' OR i.recipient_sub=?) AND i.status='pending' AND i.expires_at>unixepoch() AND h.status='active' AND m.active=1 AND a.approved=1 AND g.paused=0 AND p.enabled=1 AND NOT EXISTS(SELECT 1 FROM protected_account_access x WHERE x.subject_hash=? AND x.active=0))";
        let guard_values = || {
            vec![
                o.invitation_id.clone(),
                o.generation.to_string(),
                o.email.clone(),
                o.user_sub.clone(),
                crate::security::subject_hash(&o.user_sub),
            ]
        };
        let guarded = |sql: &str, mut values: Vec<String>| {
            values.extend(guard_values());
            Statement::new(&sql.replace("@eligible", eligible), values)
        };
        let public_id = crate::security::canonical_public_id(&self.0.db, &o.user_sub)
            .await?
            .unwrap_or_else(|| auth::secret()[..32].into());
        let mut statements = vec![capacity::snapshot(
            &format!("household:{}", row.household_id),
            &o.user_sub,
            "",
        )];
        statements.push(Statement::new(&format!("INSERT INTO pilot_accounts(subject,display_name,public_id) SELECT ?,?,? WHERE {eligible} AND NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=?)"),{let mut v=vec![o.user_sub.clone(),name,public_id];v.extend(guard_values());v.push(o.user_sub.clone());v}));
        statements.push(guarded("INSERT INTO household_heads(household_id,subject,ceilings_json) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0) AND @eligible ON CONFLICT(household_id,subject) DO UPDATE SET active=1",vec![row.household_id.clone(),o.user_sub.clone(),capacity::Amounts::default().json(),o.user_sub.clone()]));
        statements.push(guarded("UPDATE households SET revision=revision+1,last_operation=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0) AND @eligible", vec![r.operation_id.clone(),row.household_id.clone(),o.user_sub.clone()]));
        statements.push(guarded("INSERT INTO household_activity(household_id,actor_sub,action) SELECT ?,?,'Joined as an equal head by emailed invitation' WHERE NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0) AND @eligible",vec![row.household_id.clone(),o.user_sub.clone(),o.user_sub.clone()]));
        statements.push(guarded("UPDATE email_invitations SET status='accepted',accepted_by=?,revision=revision+1,last_operation=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0) AND @eligible",vec![o.user_sub.clone(),r.operation_id.clone(),o.invitation_id.clone(),o.user_sub.clone()]));
        statements.push(Statement::new("INSERT INTO invitation_acceptance_receipts(user_sub,operation_id,fingerprint,invitation_id,household_id) SELECT ?,?,?,id,household_id FROM email_invitations WHERE id=? AND status='accepted' AND accepted_by=? AND last_operation=? ON CONFLICT(user_sub,operation_id) DO NOTHING",vec![o.user_sub.clone(),r.operation_id.clone(),fingerprint.clone(),o.invitation_id.clone(),o.user_sub.clone(),r.operation_id.clone()]));
        statements.push(capacity::account_guard(&o.user_sub));
        statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM invitation_acceptance_receipts WHERE user_sub=? AND operation_id=? AND fingerprint=?)",vec![o.user_sub.clone(),r.operation_id.clone(),fingerprint]));
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
        Ok(AccountSession {
            household_id: row.household_id,
            ..Default::default()
        })
    }
}
