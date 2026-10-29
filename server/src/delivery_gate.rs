use crate::{auth, db::Database};
use connectrpc::ConnectError;

// A crashed worker leaves the gate closed for operator recovery. Automatically
// expiring it could let a slow or partitioned worker send after a cancellation.
pub(crate) async fn acquire(db: &Database) -> Result<String, ConnectError> {
    let token = auth::secret();
    let rows = db.query::<serde_json::Value>(
        "UPDATE delivery_handoff_gate SET token=?,expires_at=unixepoch() WHERE id=1 AND token='' RETURNING id",
        std::slice::from_ref(&token),
    ).await?;
    if rows.is_empty() {
        return Err(ConnectError::unavailable(
            "An email action is in progress. Try again shortly.",
        ));
    }
    Ok(token)
}

pub(crate) async fn release(db: &Database, token: &str) -> Result<(), ConnectError> {
    db.query::<serde_json::Value>(
        "UPDATE delivery_handoff_gate SET token='',expires_at=0 WHERE id=1 AND token=?",
        &[token.to_owned()],
    )
    .await?;
    Ok(())
}
