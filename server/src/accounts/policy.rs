use super::*;
use crate::{capacity::Amounts, db::Statement, lists::valid_id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Row {
    revision: u64,
    enabled: i32,
    personal_soft_json: String,
    personal_hard_json: String,
    household_soft_json: String,
    household_hard_json: String,
    max_items_per_collection: u64,
    max_sections_per_collection: u64,
}
#[derive(Serialize)]
struct Values {
    enabled: bool,
    personal_soft: String,
    personal_hard: String,
    household_soft: String,
    household_hard: String,
    max_items: u64,
    max_sections: u64,
}
impl Values {
    fn from_request(r: &SitePolicyChange) -> Result<Self, ConnectError> {
        if !valid_id(&r.operation_id) {
            return Err(ConnectError::invalid_argument("Use a fresh action ID."));
        }
        let p = &*r.policy;
        let personal_soft = Amounts::from(&*p.personal_soft);
        let personal_hard = Amounts::from(&*p.personal_hard);
        let household_soft = Amounts::from(&*p.household_soft);
        let household_hard = Amounts::from(&*p.household_hard);
        for (soft, hard) in [
            (&personal_soft, &personal_hard),
            (&household_soft, &household_hard),
        ] {
            soft.validate()?;
            hard.validate()?;
            if soft
                .values()
                .into_iter()
                .zip(hard.values())
                .any(|(a, b)| a == 0 || b < a)
                || soft.households == 0
                || hard.households < soft.households
            {
                return Err(ConnectError::invalid_argument(
                    "Choose positive finite review thresholds no greater than the corresponding hard thresholds.",
                ));
            }
        }
        if !p.enabled
            || p.max_items_per_collection == 0
            || p.max_sections_per_collection == 0
            || p.max_items_per_collection > 9_007_199_254_740_991
            || p.max_sections_per_collection > 9_007_199_254_740_991
        {
            return Err(ConnectError::invalid_argument(
                "Review finite structural thresholds before activation. Disabling normal accounts requires a separate migration.",
            ));
        }
        Ok(Self {
            enabled: p.enabled,
            personal_soft: personal_soft.json(),
            personal_hard: personal_hard.json(),
            household_soft: household_soft.json(),
            household_hard: household_hard.json(),
            max_items: p.max_items_per_collection,
            max_sections: p.max_sections_per_collection,
        })
    }
    fn fingerprint(&self, r: &SitePolicyChange) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(r.expected_revision, self)).expect("serializable policy")
            )
        )
    }
}
impl Administration {
    pub(super) async fn require_owner(
        &self,
        ctx: &RequestContext,
    ) -> Result<crate::auth::Session, ConnectError> {
        let session = self.0.authorize_rpc(ctx).await?;
        if session.user_sub != self.0.config.owner_sub {
            return Err(ConnectError::permission_denied("This page is unavailable."));
        }
        Ok(session)
    }
    pub(super) async fn policy(&self) -> Result<SiteSafetyPolicy, ConnectError> {
        let row = self
            .0
            .db
            .query::<Row>("SELECT * FROM site_safety_policy WHERE id=1", &[])
            .await?
            .pop()
            .ok_or_else(|| {
                ConnectError::failed_precondition("Safety policy migration is required.")
            })?;
        let amounts = |json: &str| -> Result<Amounts, ConnectError> {
            if json == "{}" {
                Ok(Amounts::default())
            } else {
                serde_json::from_str(json)
                    .map_err(|_| ConnectError::internal("Invalid safety policy."))
            }
        };
        Ok(SiteSafetyPolicy {
            revision: row.revision,
            enabled: row.enabled != 0,
            personal_soft: amounts(&row.personal_soft_json)?.into(),
            personal_hard: amounts(&row.personal_hard_json)?.into(),
            household_soft: amounts(&row.household_soft_json)?.into(),
            household_hard: amounts(&row.household_hard_json)?.into(),
            max_items_per_collection: row.max_items_per_collection,
            max_sections_per_collection: row.max_sections_per_collection,
            ..Default::default()
        })
    }
    pub(super) async fn review_policy(
        &self,
        r: &SitePolicyChange,
    ) -> Result<SitePolicyReview, ConnectError> {
        let values = Values::from_request(r)?;
        let current = self.policy().await?;
        if current.revision != r.expected_revision {
            return Err(ConnectError::failed_precondition(
                "Policy changed. Review the latest settings.",
            ));
        }
        #[derive(Deserialize)]
        struct Counts {
            accounts: u64,
            households: u64,
            pending: u64,
        }
        let count=self.0.db.query::<Counts>("SELECT (SELECT count(*) FROM pilot_accounts) AS accounts,(SELECT count(*) FROM households WHERE status<>'erased') AS households,(SELECT count(*) FROM household_invitations WHERE status='pending') AS pending",&[]).await?.pop().ok_or_else(||ConnectError::internal("Could not inspect policy effects."))?;
        if !current.enabled && count.pending > 0 {
            return Err(ConnectError::failed_precondition(
                "Legacy pending invitations require review before migration.",
            ));
        }
        let preview = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(values.fingerprint(r), current.revision, count.pending))
                    .expect("policy preview")
            )
        );
        Ok(SitePolicyReview {preview_token:preview,effect:"Existing content, History, attribution and legacy allocation records are preserved. Personal and household safety budgets become independent; member ceilings and contribution reservations stop applying. New increases above hard thresholds are rejected without deleting data.".into(),account_count:count.accounts,household_count:count.households,..Default::default()})
    }
    pub(super) async fn change_policy(
        &self,
        actor: &str,
        r: &SitePolicyChange,
    ) -> Result<SiteSafetyPolicy, ConnectError> {
        let values = Values::from_request(r)?;
        let fingerprint = values.fingerprint(r);
        #[derive(Deserialize)]
        struct Receipt {
            fingerprint: String,
        }
        if let Some(receipt) = self
            .0
            .db
            .query::<Receipt>(
                "SELECT fingerprint FROM site_admin_operations WHERE operation_id=?",
                std::slice::from_ref(&r.operation_id),
            )
            .await?
            .pop()
        {
            if receipt.fingerprint != fingerprint {
                return Err(ConnectError::already_exists(
                    "This action ID was used for different settings.",
                ));
            }
            crate::security::protect(&self.0).await?;
            return self.policy().await;
        }
        let review = self.review_policy(r).await?;
        if !r.confirmed || r.preview_token != review.preview_token {
            return Err(ConnectError::failed_precondition(
                "Review and explicitly confirm these policy effects first.",
            ));
        }
        let next = r
            .expected_revision
            .checked_add(1)
            .ok_or_else(|| ConnectError::failed_precondition("Policy revision exhausted."))?;
        self.0.db.batch(&[
            Statement::new("INSERT INTO site_security_outbox(scope,subject,public_id,active) SELECT 'account_access',subject,public_id,approved FROM pilot_accounts WHERE EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND enabled=0 AND revision=?)",vec![r.expected_revision.to_string()]),
            Statement::new("INSERT INTO site_security_outbox(scope,subject,public_id,household_id,active) SELECT 'head_membership',m.subject,a.public_id,m.household_id,m.active FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND enabled=0 AND revision=?)",vec![r.expected_revision.to_string()]),
            Statement::new("UPDATE site_safety_policy SET revision=revision+1,enabled=1,personal_soft_json=?,personal_hard_json=?,household_soft_json=?,household_hard_json=?,max_items_per_collection=?,max_sections_per_collection=?,last_operation=? WHERE id=1 AND revision=? AND (enabled=1 OR NOT EXISTS(SELECT 1 FROM household_invitations WHERE status='pending'))",vec![values.personal_soft,values.personal_hard,values.household_soft,values.household_hard,values.max_items.to_string(),values.max_sections.to_string(),r.operation_id.clone(),r.expected_revision.to_string()]),
            Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND revision=? AND last_operation=?)",vec![next.to_string(),r.operation_id.clone()]),
            Statement::new("UPDATE operator_settings SET max_items_per_collection=?,max_sections_per_collection=?,revision=revision+1,last_operation=? WHERE id=1",vec![values.max_items.to_string(),values.max_sections.to_string(),r.operation_id.clone()]),
            Statement::new("INSERT INTO site_admin_operations(operation_id,fingerprint,revision) VALUES(?,?,?)",vec![r.operation_id.clone(),fingerprint,next.to_string()]),
            Statement::new("INSERT INTO site_audit(operation_id,actor_sub,action) VALUES(?,?,'Changed independent safety policy')",vec![r.operation_id.clone(),actor.into()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]).await.map_err(|e|if e.code==connectrpc::ErrorCode::Unavailable{e}else{ConnectError::failed_precondition("Policy changed. Review the latest settings before retrying.")})?;
        *self.0.retention_lock.lock().await = 0;
        crate::security::protect(&self.0).await?;
        self.policy().await
    }
}
