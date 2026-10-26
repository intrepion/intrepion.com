use super::*;
// One latest diagnostic per account bounds storage even if a client repeatedly
// retries a rejected write. Only fixed server reasons and public scope IDs enter
// this owner-only view; request content and unknown error strings never do.
pub(crate) async fn record_resource_rejection(
    auth: &SharedAuth,
    headers: &axum::http::HeaderMap,
    message: &str,
) -> Result<(), ConnectError> {
    let Ok(session) = auth.session(headers, true).await else {
        return Ok(());
    };
    let reason = capacity::LIMIT_ERRORS
        .iter()
        .find_map(|(code, text)| (*text == message).then_some(*code))
        .or_else(|| capacity::RESOURCES.iter().enumerate().find_map(|(index, resource)| {
            (message == format!("This complete copy would exceed the destination's {resource} allowance. Trash and History remain counted.")).then_some(capacity::LIMIT_ERRORS[index].0)
        }))
        .unwrap_or(match message {
            "A change exceeds the database value budget." => "database_value_budget",
            "Combined capacity exceeds the supported integer range." => "capacity_integer_range",
            "The source exceeds a per-collection structural cap." => "copy_collection_structure",
            _ => "resource_safety_guard",
        });
    let scope = headers
        .get("x-space-id")
        .and_then(|h| h.to_str().ok())
        .filter(|s| crate::lists::valid_id(s))
        .unwrap_or("personal");
    let account = capacity::account(&auth.db, &session.user_sub).await?;
    let operation = format!("resource-rejection:{}", account.public_id);
    auth.db.batch(&[
        crate::db::Statement::new("DELETE FROM site_audit WHERE operation_id=?",vec![operation.clone()]),
        crate::db::Statement::new("INSERT INTO site_audit(operation_id,actor_sub,action) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=1) AND (?='personal' OR EXISTS(SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.household_id=? AND m.subject=? AND m.active=1 AND h.status='active'))",vec![operation,session.user_sub.clone(),format!("Blocked resource write: {reason}; scope {scope}. Latest rejection for this account."),session.user_sub.clone(),scope.into(),scope.into(),session.user_sub]),
    ]).await?;
    Ok(())
}
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
