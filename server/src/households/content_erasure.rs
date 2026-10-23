use super::*;
use crate::erasure_ledger::ErasureRecord;
#[derive(Deserialize)]
struct Manifest {
    actor_sub: String,
    fingerprint: String,
    target_json: String,
    published_batches: usize,
    completed: i32,
}
impl Households {
    pub(super) async fn pending_content_erasure(
        &self,
        id: &str,
    ) -> Result<Option<PendingHouseholdErasure>, ConnectError> {
        #[derive(Deserialize)]
        struct Pending {
            operation_id: String,
            expected_revision: u64,
            collections: u64,
        }
        Ok(self.0.db.query::<Pending>("SELECT operation_id,expected_revision,json_array_length(target_json) AS collections FROM household_content_erasures WHERE household_id=? AND completed=0",&[id.into()]).await?.pop().map(|p|PendingHouseholdErasure{operation_id:p.operation_id,expected_revision:p.expected_revision,collections:p.collections,..Default::default()}))
    }
    async fn manifest(&self, id: &str, operation: &str) -> Result<Option<Manifest>, ConnectError> {
        Ok(self.0.db.query::<Manifest>("SELECT actor_sub,fingerprint,target_json,published_batches,completed FROM household_content_erasures WHERE household_id=? AND operation_id=?",&[id.into(),operation.into()]).await?.pop())
    }
    pub(super) async fn erase_content(
        &self,
        account: &Account,
        r: &HouseholdChange,
        fingerprint: &str,
    ) -> Result<HouseholdMutationResult, ConnectError> {
        let h = self.require_head(&r.household_id, &account.subject).await?;
        if !r.confirm_content_erasure {
            return Err(ConnectError::failed_precondition(
                "Explicitly confirm erasure of all retained shared content and its History.",
            ));
        }
        if !r.name.is_empty()
            || !r.target_id.is_empty()
            || r.amounts.is_set()
            || !r.invitation_token.is_empty()
            || r.confirm_close
            || r.expected_erase_due_at != 0
        {
            return Err(ConnectError::invalid_argument(
                "Content erasure accepts only its confirmed household, action identity and revision.",
            ));
        }
        let ledger = self.0.erasure_ledger.as_ref().ok_or_else(|| {
            ConnectError::failed_precondition(
                "Content erasure requires configured recovery protection.",
            )
        })?;
        let existing = self.manifest(&h.id, &r.operation_id).await?;
        let manifest = if let Some(m) = existing {
            m
        } else {
            if h.revision != r.expected_revision {
                return Err(changed());
            }
            if self.pending_content_erasure(&h.id).await?.is_some() {
                return Err(ConnectError::failed_precondition(
                    "Resume the household's pending content erasure first.",
                ));
            }
            let next = h.revision.checked_add(1).ok_or_else(changed)?;
            self.0.db.batch(&[
                Statement::new("UPDATE households SET revision=revision+1,last_operation=? WHERE id=? AND revision=? AND status='active' AND EXISTS(SELECT 1 FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE m.household_id=households.id AND m.subject=? AND m.active=1 AND a.approved=1) AND NOT EXISTS(SELECT 1 FROM household_content_erasures WHERE household_id=households.id AND completed=0)",vec![r.operation_id.clone(),h.id.clone(),h.revision.to_string(),account.subject.clone()]),
                Statement::new("INSERT INTO household_content_erasures(household_id,operation_id,actor_sub,fingerprint,expected_revision,target_json) SELECT ?,?,?,?,?,(SELECT json_group_array(id) FROM (SELECT id FROM collections WHERE owner_sub=? ORDER BY id)) WHERE EXISTS(SELECT 1 FROM households WHERE id=? AND revision=? AND last_operation=?) ON CONFLICT(household_id,operation_id) DO NOTHING",vec![h.id.clone(),r.operation_id.clone(),account.subject.clone(),fingerprint.into(),r.expected_revision.to_string(),h.scope_sub.clone(),h.id.clone(),next.to_string(),r.operation_id.clone()]),
                Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM household_content_erasures WHERE household_id=? AND operation_id=? AND fingerprint=?)",vec![h.id.clone(),r.operation_id.clone(),fingerprint.into()]),
                Statement::new("DELETE FROM invariant_guards",vec![]),
            ]).await?;
            self.manifest(&h.id, &r.operation_id)
                .await?
                .ok_or_else(changed)?
        };
        if manifest.fingerprint != fingerprint {
            return Err(changed());
        }
        if manifest.completed != 0 {
            return Ok(HouseholdMutationResult {
                household_id: h.id,
                ..Default::default()
            });
        }
        let targets: Vec<String> = serde_json::from_str(&manifest.target_json)
            .map_err(|_| ConnectError::internal("Invalid erasure manifest."))?;
        let database_id: String = if self.0.config.local {
            "00000000-0000-0000-0000-000000000001".into()
        } else {
            self.0
                .config
                .db_url
                .rsplit('/')
                .nth(1)
                .ok_or_else(changed)?
                .into()
        };
        let began = std::time::Instant::now();
        for (index, chunk) in targets
            .chunks(100)
            .enumerate()
            .skip(manifest.published_batches)
        {
            if began.elapsed().as_secs() > 25 {
                return Err(pending());
            }
            ledger
                .publish(
                    &ErasureRecord {
                        version: 3,
                        database_id: database_id.clone(),
                        operation_id: r.operation_id.clone(),
                        collection_id: h.id.clone(),
                        scope: "household_content".into(),
                        target_id: String::new(),
                        erase_due_at: None,
                        collection_ids: Some(chunk.to_vec()),
                    }
                    .namespaced(&format!("household-content:{}:{index}", h.id)),
                )
                .await
                .map_err(|_| pending())?;
            self.0.db.query::<serde_json::Value>("UPDATE household_content_erasures SET published_batches=max(published_batches,CAST(? AS INTEGER)) WHERE household_id=? AND operation_id=? AND completed=0",&[(index+1).to_string(),h.id.clone(),r.operation_id.clone()]).await?;
        }
        let selector = "SELECT value FROM json_each((SELECT target_json FROM household_content_erasures WHERE household_id=? AND operation_id=? AND completed=0))";
        let target = || vec![h.scope_sub.clone(), h.id.clone(), r.operation_id.clone()];
        let mut statements = vec![Statement::new(
            "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households h JOIN household_heads m ON m.household_id=h.id JOIN pilot_accounts a ON a.subject=m.subject WHERE h.id=? AND h.status='active' AND m.subject=? AND m.active=1 AND a.approved=1) AND EXISTS(SELECT 1 FROM household_content_erasures WHERE household_id=? AND operation_id=? AND fingerprint=? AND published_batches>=?)",
            vec![
                h.id.clone(),
                account.subject.clone(),
                h.id.clone(),
                r.operation_id.clone(),
                fingerprint.into(),
                targets.len().div_ceil(100).to_string(),
            ],
        )];
        for (table, kind, column) in [
            ("collections", "collection", "id"),
            ("list_items", "item", "collection_id"),
            ("list_sections", "section", "collection_id"),
        ] {
            statements.push(Statement::new(&format!("INSERT INTO retired_list_ids(kind,id) SELECT '{kind}',id FROM {table} WHERE owner_sub=? AND {column} IN({selector}) ON CONFLICT(kind,id) DO NOTHING"),target()));
        }
        statements.push(Statement::new(&format!("INSERT INTO retired_task_ids(owner_sub,id) SELECT owner_sub,id FROM collections WHERE owner_sub=? AND kind=1 AND id IN({selector}) ON CONFLICT(owner_sub,id) DO NOTHING"),target()));
        for (table, column) in [
            ("erasure_intents", "collection_id"),
            ("collection_operations", "collection_id"),
            ("collection_history", "collection_id"),
            ("list_items", "collection_id"),
            ("list_sections", "collection_id"),
            ("collections", "id"),
        ] {
            statements.push(Statement::new(
                &format!("DELETE FROM {table} WHERE owner_sub=? AND {column} IN({selector})"),
                target(),
            ));
        }
        let pending_guard = "EXISTS(SELECT 1 FROM household_content_erasures WHERE household_id=? AND operation_id=? AND completed=0)";
        statements.extend([
            Statement::new(&format!("UPDATE households SET revision=revision+1,last_operation=? WHERE id=? AND {pending_guard}"),vec![r.operation_id.clone(),h.id.clone(),h.id.clone(),r.operation_id.clone()]),
            Statement::new(&format!("INSERT INTO household_activity(household_id,actor_sub,action,details_json) SELECT ?,?,'Erased all shared content',? WHERE {pending_guard}"),vec![h.id.clone(),account.subject.clone(),serde_json::json!({"collections":targets.len()}).to_string(),h.id.clone(),r.operation_id.clone()]),
            Statement::new("UPDATE household_content_erasures SET completed=1 WHERE household_id=? AND operation_id=?",vec![h.id.clone(),r.operation_id.clone()]),
            Statement::new("INSERT INTO household_operations(actor_sub,operation_id,fingerprint,household_id) VALUES(?,?,?,?) ON CONFLICT(actor_sub,operation_id) DO NOTHING",vec![manifest.actor_sub,r.operation_id.clone(),fingerprint.into(),h.id.clone()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]);
        self.0.db.batch(&statements).await?;
        Ok(HouseholdMutationResult {
            household_id: h.id,
            ..Default::default()
        })
    }
}
fn pending() -> ConnectError {
    ConnectError::unavailable(
        "Shared-content erasure is pending. Its confirmed snapshot is retained and writes are paused. Retry the same erasure; capacity is released only after protection succeeds.",
    )
}
