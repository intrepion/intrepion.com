//! Identifier-only independent protection for account access and head membership.
use crate::{
    auth::SharedAuth,
    db::Statement,
    erasure_ledger::{ErasureRecord, SecurityChange},
};
use connectrpc::ConnectError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
#[derive(Deserialize)]
struct Pending {
    sequence: u64,
    event_id: String,
    scope: String,
    subject: String,
    subject_hash: String,
    public_id: String,
    household_id: String,
    active: i32,
}
pub(crate) fn subject_hash(subject: &str) -> String {
    format!("{:x}", Sha256::digest(subject.as_bytes()))
}
pub(crate) async fn canonical_public_id(
    db: &crate::db::Database,
    subject: &str,
) -> Result<Option<String>, ConnectError> {
    #[derive(Deserialize)]
    struct Identity {
        public_id: String,
    }
    let digest = subject_hash(subject);
    let ids = db.query::<Identity>("SELECT public_id FROM protected_account_access WHERE subject_hash=? UNION SELECT public_id FROM protected_membership_state WHERE subject_hash=? LIMIT 2", &[digest.clone(),digest]).await?;
    if ids.len() > 1
        || ids.iter().any(|i| {
            i.public_id.len() != 32
                || !i
                    .public_id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(ConnectError::failed_precondition(
            "Account recovery records need owner review. Your account has not been prepared; contact support.",
        ));
    }
    Ok(ids.into_iter().next().map(|i| i.public_id))
}
fn pending() -> ConnectError {
    ConnectError::unavailable(
        "Access changed; independent recovery protection is pending. Retry the same action.",
    )
}
pub(crate) async fn protect(auth: &SharedAuth) -> Result<(), ConnectError> {
    let _lock = auth.security_lock.lock().await;
    let rows = auth
        .db
        .query::<Pending>(
            "SELECT * FROM site_security_outbox WHERE published=0 ORDER BY sequence LIMIT 100",
            &[],
        )
        .await?;
    if rows.is_empty() {
        return Ok(());
    }
    let ledger = auth.erasure_ledger.as_ref().ok_or_else(pending)?;
    let database_id = if auth.config.local {
        "00000000-0000-0000-0000-000000000001".into()
    } else {
        auth.config
            .db_url
            .rsplit('/')
            .nth(1)
            .ok_or_else(pending)?
            .to_string()
    };
    for event in rows {
        let digest = if event.subject_hash.is_empty() {
            subject_hash(&event.subject)
        } else {
            event.subject_hash
        };
        let record = ErasureRecord {
            version: 4,
            database_id: database_id.clone(),
            operation_id: event.event_id,
            collection_id: event.household_id.clone(),
            scope: event.scope.clone(),
            target_id: String::new(),
            erase_due_at: None,
            collection_ids: None,
            security: Some(SecurityChange {
                subject_hash: digest.clone(),
                public_id: event.public_id.clone(),
                revision: event.sequence,
                active: event.active != 0,
            }),
        };
        // These UUIDs are allocated uniquely by the server outbox, never supplied
        // by a caller. Keep the same identity in the snapshot and journal so a
        // published event can be reconciled after recovery.
        ledger.publish(&record).await.map_err(|_| pending())?;
        let mut writes = vec![];
        if event.scope == "account_access" {
            writes.push(Statement::new("INSERT INTO protected_account_access(subject_hash,public_id,active,security_revision) VALUES(?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET public_id=excluded.public_id,active=excluded.active,security_revision=excluded.security_revision WHERE excluded.security_revision>protected_account_access.security_revision",vec![digest.clone(),event.public_id,event.active.to_string(),event.sequence.to_string()]));
        } else {
            writes.push(Statement::new("INSERT INTO protected_membership_state(household_id,subject_hash,public_id,active,security_revision) VALUES(?,?,?,?,?) ON CONFLICT(household_id,subject_hash) DO UPDATE SET public_id=excluded.public_id,active=excluded.active,security_revision=excluded.security_revision WHERE excluded.security_revision>protected_membership_state.security_revision",vec![event.household_id,digest.clone(),event.public_id,event.active.to_string(),event.sequence.to_string()]));
        }
        writes.push(Statement::new("UPDATE site_security_outbox SET published=1,subject='',subject_hash=? WHERE sequence=?",vec![digest,event.sequence.to_string()]));
        auth.db.batch(&writes).await?;
    }
    if !auth
        .db
        .query::<serde_json::Value>(
            "SELECT 1 FROM site_security_outbox WHERE published=0 LIMIT 1",
            &[],
        )
        .await?
        .is_empty()
    {
        return Err(pending());
    }
    Ok(())
}
