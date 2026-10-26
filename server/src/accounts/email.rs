use super::*;
use crate::{db::Statement, security::subject_hash};
impl Administration {
    pub(super) async fn clear_suppression(
        &self,
        actor: &str,
        r: &EmailSuppressionClear,
    ) -> Result<(), ConnectError> {
        if !r.confirmed || !crate::lists::valid_id(&r.operation_id) || r.expected_revision == 0 {
            return Err(ConnectError::invalid_argument(
                "Review the delivery issue and confirm clearing this block.",
            ));
        }
        let recipient = crate::invitations::email(&r.recipient_email)?;
        let hash = subject_hash(&recipient);
        let fingerprint = subject_hash(
            &serde_json::to_string(&("clear-suppression", &hash, r.expected_revision))
                .expect("suppression fingerprint"),
        );
        #[derive(Deserialize)]
        struct Receipt {
            fingerprint: String,
        }
        if let Some(saved) = self
            .0
            .db
            .query::<Receipt>(
                "SELECT fingerprint FROM site_admin_operations WHERE operation_id=?",
                std::slice::from_ref(&r.operation_id),
            )
            .await?
            .pop()
        {
            return if saved.fingerprint == fingerprint {
                Ok(())
            } else {
                Err(ConnectError::already_exists(
                    "Action ID already used for another change.",
                ))
            };
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_millis()
            .to_string();
        self.0.db.batch(&[
            Statement::new("INSERT INTO site_admin_operations(operation_id,fingerprint,revision) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM email_suppressions WHERE recipient_email=? AND revision=?) ON CONFLICT(operation_id) DO NOTHING", vec![r.operation_id.clone(),fingerprint.clone(),r.expected_revision.to_string(),recipient.clone(),r.expected_revision.to_string()]),
            Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM site_admin_operations WHERE operation_id=? AND fingerprint=?)",vec![r.operation_id.clone(),fingerprint]),
            Statement::new("INSERT INTO email_suppression_reviews(recipient_hash,cleared_at,revision) SELECT ?,max(CAST(? AS INTEGER),last_event_at),revision FROM email_suppressions WHERE recipient_email=? AND revision=? ON CONFLICT(recipient_hash) DO UPDATE SET cleared_at=max(email_suppression_reviews.cleared_at,excluded.cleared_at),revision=max(email_suppression_reviews.revision,excluded.revision)",vec![hash,now,recipient.clone(),r.expected_revision.to_string()]),
            Statement::new("DELETE FROM email_suppressions WHERE recipient_email=? AND revision=?",vec![recipient,r.expected_revision.to_string()]),
            Statement::new("INSERT INTO site_audit(operation_id,actor_sub,action) VALUES(?,?,'Cleared reviewed email suppression') ON CONFLICT(operation_id) DO NOTHING",vec![r.operation_id.clone(),actor.into()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]).await.map_err(|e|if e.code==connectrpc::ErrorCode::Unavailable { e } else { ConnectError::failed_precondition("Email block changed. Refresh and review it again.") })?;
        Ok(())
    }
    pub(super) async fn email_operations(
        &self,
        r: &EmailOperationsQuery,
    ) -> Result<EmailOperationsOverview, ConnectError> {
        if r.before_time < 0
            || (!r.before_id.is_empty() && !crate::lists::valid_id(&r.before_id))
            || r.after_suppression.len() > 254
        {
            return Err(ConnectError::invalid_argument(
                "Invalid email operations cursor.",
            ));
        }
        let recipient = if r.recipient_email.is_empty() {
            String::new()
        } else {
            crate::invitations::email(&r.recipient_email)?
        };
        #[derive(Deserialize)]
        struct Total {
            attempted: u64,
            accounting_state: String,
        }
        let monthly = self
            .0
            .db
            .query::<Total>(
                "SELECT attempted,accounting_state FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now')",
                &[],
            )
            .await?
            .pop()
            .map(|r| (r.attempted,r.accounting_state)).unwrap_or((0,"measured".into()));
        let (monthly, accounting_status) = monthly;
        #[derive(Deserialize)]
        struct Delivery {
            id: String,
            recipient_email: String,
            outcome: String,
            attempted_at: i64,
        }
        let mut rows=self.0.db.query::<Delivery>("SELECT id,recipient_email,outcome,attempted_at FROM email_send_attempts WHERE attempted_at>unixepoch()-30*86400 AND (CAST(? AS INTEGER)=0 OR attempted_at<CAST(? AS INTEGER) OR (attempted_at=CAST(? AS INTEGER) AND id<?)) AND (?='' OR recipient_email=?) ORDER BY attempted_at DESC,id DESC LIMIT 101",&[r.before_time.to_string(),r.before_time.to_string(),r.before_time.to_string(),r.before_id.clone(),recipient.clone(),recipient.clone()]).await?;
        let more = rows.len() > 100;
        rows.truncate(100);
        let (next_delivery_time, next_delivery_id) = if more {
            rows.last()
                .map(|r| (r.attempted_at, r.id.clone()))
                .unwrap_or_default()
        } else {
            (0, String::new())
        };
        #[derive(Deserialize)]
        struct Suppression {
            recipient_email: String,
            reason: String,
            revision: u64,
        }
        let mut blocks=self.0.db.query::<Suppression>("SELECT recipient_email,reason,revision FROM email_suppressions WHERE recipient_email>? AND (?='' OR recipient_email=?) ORDER BY recipient_email LIMIT 101",&[r.after_suppression.clone(),recipient.clone(),recipient]).await?;
        let more = blocks.len() > 100;
        blocks.truncate(100);
        let next_suppression = if more {
            blocks
                .last()
                .map(|b| b.recipient_email.clone())
                .unwrap_or_default()
        } else {
            String::new()
        };
        Ok(EmailOperationsOverview {
            accounting_status,
            monthly_attempts: monthly,
            monthly_budget: 10000,
            warning: monthly >= 8000,
            deliveries: rows
                .into_iter()
                .map(|r| EmailDeliveryRecord {
                    id: r.id,
                    recipient_email: r.recipient_email,
                    outcome: r.outcome,
                    attempted_at: r.attempted_at,
                    ..Default::default()
                })
                .collect(),
            suppressions: blocks
                .into_iter()
                .map(|r| EmailSuppression {
                    recipient_email: r.recipient_email,
                    reason: r.reason,
                    revision: r.revision,
                    ..Default::default()
                })
                .collect(),
            next_delivery_time,
            next_delivery_id,
            next_suppression,
            ..Default::default()
        })
    }
}
