use super::*;
impl Administration {
    pub(super) async fn audit(&self, r: &AdminAuditQuery) -> Result<AdminAuditPage, ConnectError> {
        if r.page_size > 100 || r.before_sequence > 9_007_199_254_740_991 {
            return Err(ConnectError::invalid_argument("Invalid audit page."));
        }
        let size = if r.page_size == 0 {
            50
        } else {
            r.page_size as usize
        };
        #[derive(Deserialize)]
        struct Row {
            sequence: u64,
            operation_id: String,
            actor_name: String,
            actor_id: String,
            action: String,
            occurred_at: i64,
        }
        let mut rows = self.0.db.query::<Row>("SELECT e.sequence,e.operation_id,coalesce(a.display_name,'Former site owner') AS actor_name,coalesce(a.public_id,'') AS actor_id,e.action,e.occurred_at FROM site_audit e LEFT JOIN pilot_accounts a ON a.subject=e.actor_sub WHERE e.occurred_at>unixepoch('now','-1 year') AND (CAST(? AS INTEGER)=0 OR e.sequence<CAST(? AS INTEGER)) ORDER BY e.sequence DESC LIMIT ?", &[r.before_sequence.to_string(),r.before_sequence.to_string(),(size+1).to_string()]).await?;
        let more = rows.len() > size;
        rows.truncate(size);
        let next_before = if more {
            rows.last().map_or(0, |r| r.sequence)
        } else {
            0
        };
        Ok(AdminAuditPage {
            entries: rows
                .into_iter()
                .map(|r| AdminAuditEntry {
                    sequence: r.sequence,
                    operation_id: r.operation_id,
                    actor_name: r.actor_name,
                    actor_id: r.actor_id,
                    action: r.action,
                    occurred_at: r.occurred_at,
                    ..Default::default()
                })
                .collect(),
            next_before,
            ..Default::default()
        })
    }
}
