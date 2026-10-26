use super::*;
use crate::{db::Statement, lists::valid_id, security};
use sha2::{Digest, Sha256};
impl Administration {
    async fn access_account(&self, id: &str) -> Result<AdminAccount, ConnectError> {
        self.0
            .db
            .query::<AccountRow>(
                &format!("{} WHERE a.public_id=?", account_projection()),
                &[id.into()],
            )
            .await?
            .pop()
            .ok_or_else(|| ConnectError::not_found("Account unavailable."))?
            .into_admin(&self.0.config.owner_sub)
    }

    pub(super) async fn change_access(
        &self,
        actor: &str,
        r: &AccountAccessChange,
    ) -> Result<AdminAccount, ConnectError> {
        if !r.confirmed
            || !valid_id(&r.operation_id)
            || r.account_id.len() != 32
            || !r.account_id.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ConnectError::invalid_argument(
                "Review and confirm the account access change.",
            ));
        }
        #[derive(Deserialize)]
        struct Target {
            subject: String,
            access_revision: u64,
            approved: i32,
        }
        let target = self
            .0
            .db
            .query::<Target>(
                "SELECT subject,access_revision,approved FROM pilot_accounts WHERE public_id=?",
                std::slice::from_ref(&r.account_id),
            )
            .await?
            .pop()
            .ok_or_else(|| ConnectError::not_found("Account unavailable."))?;
        if target.subject == self.0.config.owner_sub {
            return Err(ConnectError::permission_denied(
                "The sole site owner must retain access. Use the separate recovery procedure if necessary.",
            ));
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    "account-access",
                    &r.account_id,
                    r.expected_revision,
                    r.suspended
                ))
                .expect("access fingerprint")
            )
        );
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
                    "Action ID already used for another change.",
                ));
            }
            security::protect(&self.0).await?;
            return self.access_account(&r.account_id).await;
        }
        if target.access_revision != r.expected_revision
            || target.approved == i32::from(!r.suspended)
        {
            return Err(ConnectError::failed_precondition(
                "Account access changed. Review the latest state.",
            ));
        }
        let next = r
            .expected_revision
            .checked_add(1)
            .ok_or_else(|| ConnectError::failed_precondition("Revision exhausted."))?;
        self.0.db.batch(&[
   Statement::new("UPDATE pilot_accounts SET approved=?,last_access_operation=? WHERE public_id=? AND access_revision=? AND approved<>?",vec![i32::from(!r.suspended).to_string(),r.operation_id.clone(),r.account_id.clone(),r.expected_revision.to_string(),i32::from(!r.suspended).to_string()]),
   Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_accounts WHERE public_id=? AND access_revision=? AND last_access_operation=?)",vec![r.account_id.clone(),next.to_string(),r.operation_id.clone()]),
   Statement::new("INSERT INTO site_admin_operations(operation_id,fingerprint,revision) VALUES(?,?,?) ON CONFLICT(operation_id) DO NOTHING",vec![r.operation_id.clone(),fingerprint.clone(),next.to_string()]),
   Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM site_admin_operations WHERE operation_id=? AND fingerprint=?)",vec![r.operation_id.clone(),fingerprint]),
   Statement::new("INSERT INTO site_audit(operation_id,actor_sub,action) VALUES(?,?,?) ON CONFLICT(operation_id) DO NOTHING",vec![r.operation_id.clone(),actor.into(),format!("{} {}",if r.suspended{"Suspended account"}else{"Restored account"},r.account_id)]),
   Statement::new("DELETE FROM invariant_guards",vec![]),
  ]).await.map_err(|e|if e.code==connectrpc::ErrorCode::Unavailable{e}else{ConnectError::failed_precondition("Account access changed. Refresh and review again.")})?;
        security::protect(&self.0).await?;
        self.access_account(&r.account_id).await
    }
}
