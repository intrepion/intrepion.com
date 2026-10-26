use crate::{
    auth::{self, SharedAuth},
    db::Statement,
};
use connectrpc::ConnectError;

pub(crate) async fn prune(auth: &SharedAuth) -> Result<(), ConnectError> {
    if auth.config.customer_writes_frozen {
        return Ok(());
    }
    let mut last = auth.retention_lock.lock().await;
    let now = auth::now();
    if *last != 0 && now.saturating_sub(*last) < 3600 {
        return Ok(());
    }
    let mut statements = include_str!("../operational-retention.sql")
        .split(';')
        .filter(|s| !s.trim().is_empty())
        .map(|sql| Statement::new(sql, vec![]))
        .collect::<Vec<_>>();
    statements.push(Statement::new("INSERT INTO site_usage_samples(day,sampled_at,normal_enabled,account_count,household_count,logical_bytes) SELECT strftime('%Y-%m-%d',CAST(? AS INTEGER),'unixepoch'),?,enabled,(SELECT count(*) FROM pilot_accounts),(SELECT count(*) FROM households WHERE status<>'erased'),(SELECT coalesce(sum(bytes),0) FROM space_usage) FROM site_safety_policy WHERE id=1 ON CONFLICT(day) DO UPDATE SET sampled_at=excluded.sampled_at,normal_enabled=excluded.normal_enabled,account_count=excluded.account_count,household_count=excluded.household_count,logical_bytes=excluded.logical_bytes WHERE site_usage_samples.normal_enabled<>excluded.normal_enabled",vec![now.to_string(),now.to_string()]));
    auth.db.batch(&statements).await?;
    *last = now;
    Ok(())
}
