use super::*;
use crate::{db::Statement, lists::valid_id};
use sha2::{Digest, Sha256};
impl Administration {
    pub(super) async fn growth(&self) -> Result<GrowthState, ConnectError> {
        #[derive(Deserialize)]
        struct Row {
            revision: u64,
            paused: i32,
        }
        let r = self
            .0
            .db
            .query::<Row>(
                "SELECT revision,paused FROM invitation_growth WHERE id=1",
                &[],
            )
            .await?
            .pop()
            .ok_or_else(|| {
                ConnectError::failed_precondition("Invitation migration is required.")
            })?;
        Ok(GrowthState {
            revision: r.revision,
            paused: r.paused != 0,
            ..Default::default()
        })
    }
    pub(super) async fn set_growth(
        &self,
        actor: &str,
        r: &GrowthChange,
    ) -> Result<GrowthState, ConnectError> {
        if !r.confirmed || !valid_id(&r.operation_id) {
            return Err(ConnectError::failed_precondition(
                "Review and confirm the growth change.",
            ));
        }
        if !r.paused
            && (!capacity::normal_accounts(&self.0.db).await?
                || self.0.config.invitation_signing_key.is_none()
                || self.0.config.mail.is_none())
        {
            return Err(ConnectError::failed_precondition(
                "Configure independent safety policy and email invitations before resuming growth.",
            ));
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&("growth", r.expected_revision, r.paused))
                    .expect("growth fingerprint")
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
            return self.growth().await;
        }
        if !r.paused {
            crate::security::protect(&self.0).await?;
        }
        let next = r
            .expected_revision
            .checked_add(1)
            .ok_or_else(|| ConnectError::failed_precondition("Revision exhausted."))?;
        self.0.db.batch(&[
            Statement::new("UPDATE invitation_growth SET revision=revision+1,paused=?,last_operation=? WHERE id=1 AND revision=?",vec![i32::from(r.paused).to_string(),r.operation_id.clone(),r.expected_revision.to_string()]),
            Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM invitation_growth WHERE id=1 AND revision=? AND last_operation=?)",vec![next.to_string(),r.operation_id.clone()]),
            Statement::new("INSERT INTO site_admin_operations(operation_id,fingerprint,revision) VALUES(?,?,?)",vec![r.operation_id.clone(),fingerprint,next.to_string()]),
            Statement::new("INSERT INTO site_audit(operation_id,actor_sub,action) VALUES(?,?,?)",vec![r.operation_id.clone(),actor.into(),if r.paused{"Paused invitation growth"}else{"Resumed invitation growth"}.into()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]).await.map_err(|e|if e.code==connectrpc::ErrorCode::Unavailable{e}else{ConnectError::failed_precondition("Growth settings changed. Refresh and review again.")})?;
        self.growth().await
    }
}
