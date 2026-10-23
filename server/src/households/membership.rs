use super::*;
use crate::auth;
#[derive(Deserialize)]
struct InvitationRow {
    id: String,
    household_id: String,
    household_name: String,
    household_status: String,
    status: String,
    expires_at: i64,
}
fn uuid() -> String {
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
fn token_hash(token: &str) -> Result<String, ConnectError> {
    if token.len() != 64
        || !token
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(ConnectError::invalid_argument(
            "Use a fresh 32-byte invitation token encoded as lowercase hex.",
        ));
    }
    Ok(format!("{:x}", Sha256::digest(token.as_bytes())))
}
impl Households {
    async fn invitation(&self, token: &str, subject: &str) -> Result<InvitationRow, ConnectError> {
        let hash = token_hash(token)?;
        self.0.db.query::<InvitationRow>("SELECT i.id,i.household_id,h.name AS household_name,h.status AS household_status,i.status,i.expires_at FROM household_invitations i JOIN households h ON h.id=i.household_id WHERE i.token_hash=? AND i.recipient_sub=?", &[hash,subject.into()]).await?.pop().ok_or_else(||ConnectError::permission_denied("This invitation is unavailable for the signed-in identity."))
    }
    pub(super) async fn invitation_preview(
        &self,
        token: &str,
        subject: &str,
    ) -> Result<InvitationPreview, ConnectError> {
        let i = self.invitation(token, subject).await?;
        let status = if i.household_status != "active" {
            "closed"
        } else if i.status == "pending" && i.expires_at <= self.clock_now() {
            "expired"
        } else {
            &i.status
        };
        Ok(InvitationPreview {
            household_id: i.household_id,
            household_name: i.household_name,
            status: status.into(),
            expires_at: i.expires_at,
            ..Default::default()
        })
    }
    pub(super) async fn change_membership(
        &self,
        account: &Account,
        r: &HouseholdChange,
        fingerprint: &str,
    ) -> Result<HouseholdMutationResult, ConnectError> {
        let subject = &account.subject;
        let action = r
            .action
            .as_known()
            .ok_or_else(|| ConnectError::invalid_argument("Unknown household action."))?;
        let accepting = action == HouseholdAction::AcceptInvitation;
        let own_allocation = if action == HouseholdAction::Allocate {
            self.contribution(&r.household_id, subject).await?
        } else {
            None
        };
        let allocating_former = action == HouseholdAction::Allocate
            && !self.is_head(&r.household_id, subject).await?
            && own_allocation.is_some();
        let h = if accepting || allocating_former {
            self.row(&r.household_id).await?
        } else {
            self.require_head(&r.household_id, subject).await?
        };
        if h.status != "active" {
            return Err(ConnectError::failed_precondition(
                "This household is closed.",
            ));
        }
        if !accepting && r.expected_revision != h.revision {
            return Err(changed());
        }
        let next = h.revision.checked_add(1).ok_or_else(changed)?;
        let no_receipt =
            "NOT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=?)";
        let guard = format!(
            "EXISTS(SELECT 1 FROM households WHERE id=? AND revision=? AND last_operation=?) AND {no_receipt}"
        );
        let guard_params = || {
            vec![
                h.id.clone(),
                next.to_string(),
                r.operation_id.clone(),
                subject.clone(),
                r.operation_id.clone(),
            ]
        };
        let guarded = |sql: &str, mut params: Vec<String>| {
            params.extend(guard_params());
            Statement::new(&sql.replace("@guard", &guard), params)
        };
        let mut statements = Vec::new();
        let mut permission =
            "EXISTS(SELECT 1 FROM household_heads WHERE household_id=? AND subject=? AND active=1)"
                .to_string();
        let mut permission_params = vec![h.id.clone(), subject.clone()];
        let mut result_id = String::new();
        let mut details = serde_json::json!({});
        let event = match action {
            HouseholdAction::Invite => {
                let hash = token_hash(&r.invitation_token)?;
                let target=self.0.db.query::<Account>("SELECT subject,public_id,display_name,plan_json,plan_revision FROM pilot_accounts WHERE public_id=? AND public_id<>'' AND approved=1", std::slice::from_ref(&r.target_id)).await?.pop().ok_or_else(||ConnectError::invalid_argument("Use the recipient ID supplied by an operator-approved person."))?;
                if self.is_head(&h.id, &target.subject).await? {
                    return Err(ConnectError::failed_precondition(
                        "This person is already a head.",
                    ));
                }
                if !self
                    .0
                    .db
                    .query::<serde_json::Value>(
                        "SELECT 1 FROM household_invitations WHERE token_hash=?",
                        std::slice::from_ref(&hash),
                    )
                    .await?
                    .is_empty()
                {
                    return Err(ConnectError::failed_precondition(
                        "Use a fresh token for this invitation.",
                    ));
                }
                result_id = uuid();
                details = serde_json::json!({"invitation":result_id,"recipient":r.target_id});
                statements.push(guarded("INSERT INTO household_invitations(id,household_id,recipient_sub,token_hash,expires_at,created_by) SELECT ?,?,?,?,unixepoch()+604800,? WHERE @guard",vec![result_id.clone(),h.id.clone(),target.subject,hash,subject.clone()]));
                "Invited an approved person as a head"
            }
            HouseholdAction::AcceptInvitation => {
                let invitation = self.invitation(&r.invitation_token, subject).await?;
                if invitation.household_id != h.id
                    || invitation.status != "pending"
                    || invitation.expires_at <= self.clock_now()
                {
                    return Err(ConnectError::failed_precondition(
                        "This invitation is expired, revoked or already accepted.",
                    ));
                }
                result_id = invitation.id.clone();
                permission="EXISTS(SELECT 1 FROM household_invitations WHERE id=? AND recipient_sub=? AND status='pending' AND expires_at>unixepoch())".into();
                permission_params = vec![invitation.id.clone(), subject.clone()];
                let defaults = capacity::household_capacity(&self.0.db, &h.id)
                    .await?
                    .counts_only();
                statements.push(guarded("INSERT INTO household_heads(household_id,subject,ceilings_json) SELECT ?,?,? WHERE @guard ON CONFLICT(household_id,subject) DO UPDATE SET active=1",vec![h.id.clone(),subject.clone(),defaults.json()]));
                statements.push(guarded("UPDATE household_invitations SET status='accepted' WHERE id=? AND recipient_sub=? AND status='pending' AND @guard",vec![invitation.id,subject.clone()]));
                statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=1 AND a.plan_revision>0 AND (SELECT count(*) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.subject=a.subject AND m.active=1 AND h.status='active')<=json_extract(a.plan_json,'$.households'))",vec![subject.clone()]));
                "Accepted head membership"
            }
            HouseholdAction::RemoveHead => {
                #[derive(Deserialize)]
                struct Target {
                    subject: String,
                }
                let target=self.0.db.query::<Target>("SELECT a.subject FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE m.household_id=? AND m.active=1 AND a.public_id=?", &[h.id.clone(),r.target_id.clone()]).await?.pop().ok_or_else(||ConnectError::not_found("This head is no longer present."))?;
                if target.subject == *subject {
                    return Err(ConnectError::invalid_argument(
                        "Use Leave household to leave yourself.",
                    ));
                }
                statements.push(guarded("UPDATE household_heads SET active=0 WHERE household_id=? AND subject=? AND active=1 AND @guard",vec![h.id.clone(),target.subject]));
                "Removed head membership"
            }
            HouseholdAction::SetOwnCeilings => {
                if !r.target_id.is_empty() && r.target_id != account.public_id {
                    return Err(ConnectError::permission_denied(
                        "Each head controls only their own ceilings.",
                    ));
                }
                let amounts = Amounts::from(&*r.amounts);
                amounts.validate()?;
                if amounts.bytes != 0 || amounts.households != 0 {
                    return Err(ConnectError::invalid_argument(
                        "Individual ceilings cover resource counts, not storage or household membership.",
                    ));
                }
                #[derive(Deserialize)]
                struct Previous {
                    ceilings_json: String,
                }
                let previous=self.0.db.query::<Previous>("SELECT ceilings_json FROM household_heads WHERE household_id=? AND subject=? AND active=1",&[h.id.clone(),subject.clone()]).await?.pop().ok_or_else(changed)?;
                let before: Amounts = serde_json::from_str(&previous.ceilings_json)
                    .map_err(|_| ConnectError::internal("Invalid member ceilings."))?;
                details =
                    serde_json::json!({"person":account.public_id,"before":before,"after":amounts});
                statements.push(guarded("UPDATE household_heads SET ceilings_json=? WHERE household_id=? AND subject=? AND active=1 AND @guard",vec![amounts.json(),h.id.clone(),subject.clone()]));
                "Changed own individual count ceilings"
            }
            HouseholdAction::Leave => {
                #[derive(Deserialize)]
                struct Count {
                    count: u64,
                }
                let count=self.0.db.query::<Count>("SELECT count(*) AS count FROM household_heads WHERE household_id=? AND active=1",std::slice::from_ref(&h.id)).await?.pop().ok_or_else(changed)?.count;
                let closing = count == 1;
                let due = if closing {
                    self.closure_cutoff().await?
                } else {
                    0
                };
                if closing && (!r.confirm_close || r.expected_erase_due_at != due) {
                    return Err(ConnectError::failed_precondition(
                        "Review and explicitly confirm final closure with the current UTC month-end erasure deadline.",
                    ));
                }
                if !closing && r.confirm_close {
                    return Err(changed());
                }
                statements.push(guarded("UPDATE household_heads SET active=0 WHERE household_id=? AND subject=? AND @guard",vec![h.id.clone(),subject.clone()]));
                if closing {
                    if self.0.erasure_ledger.is_none() {
                        return Err(ConnectError::failed_precondition(
                            "Final closure requires configured recovery protection.",
                        ));
                    }
                    statements.push(guarded(
                        "INSERT INTO closed_household_ids(id,erase_due_at) SELECT ?,? WHERE @guard",
                        vec![h.id.clone(), due.to_string()],
                    ));
                    statements.push(guarded("INSERT INTO household_lifecycle(household_id,actor_sub,operation_id,erase_due_at) SELECT ?,?,?,? WHERE @guard",vec![h.id.clone(),subject.clone(),r.operation_id.clone(),due.to_string()]));
                    statements.push(guarded("UPDATE households SET status='closed',erase_due_at=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM household_heads WHERE household_id=? AND active=1) AND @guard",vec![due.to_string(),h.id.clone(),h.id.clone()]));
                    statements.push(guarded("UPDATE household_invitations SET status='revoked' WHERE household_id=? AND status='pending' AND @guard",vec![h.id.clone()]));
                    statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households h WHERE h.id=? AND h.status='closed' AND h.erase_due_at=? AND NOT EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=h.id AND m.active=1))",vec![h.id.clone(),due.to_string()]));
                }
                details = serde_json::json!({"person":account.public_id,"erase_due_at":due});
                if closing {
                    "Left and permanently closed household"
                } else {
                    "Left household"
                }
            }
            HouseholdAction::Allocate => {
                let requested = Amounts::from(&*r.amounts);
                let preview = self
                    .allocation_preview(account, &h.id, requested.clone())
                    .await?;
                if !preview.allowed {
                    return Err(ConnectError::failed_precondition(preview.reason));
                }
                let current = own_allocation.unwrap_or_default();
                if allocating_former {
                    permission="EXISTS(SELECT 1 FROM household_allocations WHERE household_id=? AND subject=?)".into();
                    permission_params = vec![h.id.clone(), subject.clone()];
                }
                statements.push(guarded("INSERT INTO household_allocations(household_id,subject,amounts_json) SELECT ?,?,? WHERE @guard ON CONFLICT(household_id,subject) DO UPDATE SET amounts_json=excluded.amounts_json",vec![h.id.clone(),subject.clone(),requested.json()]));
                if current
                    .values()
                    .iter()
                    .zip(requested.values())
                    .any(|(old, new)| new > *old)
                {
                    statements.push(capacity::allocation_account_guard(subject));
                }
                if current
                    .values()
                    .iter()
                    .zip(requested.values())
                    .any(|(old, new)| new < *old)
                {
                    statements.push(capacity::household_source_guard(&h.id));
                }
                details = serde_json::json!({"before":current,"after":requested});
                "Changed own capacity allocation"
            }
            HouseholdAction::RevokeInvitation => {
                if self.0.db.query::<serde_json::Value>(
                    "SELECT 1 FROM household_invitations WHERE household_id=? AND id=? AND status='pending'",
                    &[h.id.clone(),r.target_id.clone()],
                ).await?.is_empty() {
                    return Err(ConnectError::failed_precondition("This invitation is no longer pending."));
                }
                details = serde_json::json!({"invitation":r.target_id});
                statements.push(guarded("UPDATE household_invitations SET status='revoked' WHERE household_id=? AND id=? AND status='pending' AND @guard",vec![h.id.clone(),r.target_id.clone()]));
                "Revoked invitation"
            }
            _ => {
                return Err(ConnectError::invalid_argument(
                    "Unsupported household action.",
                ));
            }
        };
        let mut initial = vec![
            r.operation_id.clone(),
            h.id.clone(),
            h.revision.to_string(),
            subject.clone(),
            r.operation_id.clone(),
        ];
        initial.extend(permission_params);
        statements.insert(0,Statement::new(&format!("UPDATE households SET revision=revision+1,last_operation=? WHERE id=? AND revision=? AND status='active' AND {no_receipt} AND {permission}"),initial));
        statements.push(guarded("INSERT INTO household_activity(household_id,actor_sub,action,details_json) SELECT ?,?,?,? WHERE @guard",vec![h.id.clone(),subject.clone(),event.into(),details.to_string()]));
        statements.push(Statement::new("INSERT INTO household_operations(actor_sub,operation_id,fingerprint,household_id,result_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM households WHERE id=? AND revision=? AND last_operation=?) ON CONFLICT(actor_sub,operation_id) DO NOTHING",vec![subject.clone(),r.operation_id.clone(),fingerprint.into(),h.id.clone(),result_id.clone(),h.id.clone(),next.to_string(),r.operation_id.clone()]));
        statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM household_operations o JOIN pilot_accounts a ON a.subject=o.actor_sub WHERE o.actor_sub=? AND o.operation_id=? AND o.fingerprint=? AND a.approved=1)",vec![subject.clone(),r.operation_id.clone(),fingerprint.into()]));
        statements.push(Statement::new("DELETE FROM invariant_guards", vec![]));
        self.0.db.batch(&statements).await.map_err(|error| {
            if error.code == connectrpc::ErrorCode::Unavailable {
                error
            } else {
                changed()
            }
        })?;
        let receipt = self
            .receipt(subject, &r.operation_id)
            .await?
            .ok_or_else(changed)?;
        if receipt.fingerprint != fingerprint {
            return Err(changed());
        }
        Ok(HouseholdMutationResult {
            household_id: receipt.household_id,
            invitation_id: receipt.result_id,
            ..Default::default()
        })
    }
}
