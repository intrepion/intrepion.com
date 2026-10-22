use super::*;
use crate::erasure_ledger::{ErasureRecord, unavailable};

#[derive(Deserialize)]
pub(super) struct Intent {
    pub(super) operation_id: String,
    fingerprint: String,
    pub(super) expected_revision: u32,
    pub(super) target_id: String,
    pub(super) scope: String,
}
impl Lists {
    pub(super) async fn ensure_not_retired(
        &self,
        kind: &str,
        id: &str,
    ) -> Result<(), ConnectError> {
        if !self
            .0
            .db
            .query::<serde_json::Value>(
                "SELECT id FROM retired_list_ids WHERE kind=? AND id=?",
                &[kind.into(), id.into()],
            )
            .await?
            .is_empty()
        {
            return Err(ConnectError::not_found(
                "This identifier was permanently erased. Use a new action and identifier.",
            ));
        }
        Ok(())
    }
    pub(super) async fn erase(
        &self,
        r: &ChangeRequest,
        fingerprint: &str,
    ) -> Result<ChangeResult, ConnectError> {
        let whole = r.action.as_known() == Some(ChangeAction::EraseCollection);
        let scope = if whole { "collection" } else { "item" };
        if (whole && !r.target_id.is_empty())
            || (!whole && !valid_id(&r.target_id))
            || r.details.is_set()
            || r.item.is_set()
            || r.section.is_set()
            || r.position != 0
            || !r.source_id.is_empty()
        {
            return Err(ConnectError::invalid_argument(
                "Erasure accepts only the confirmed collection and target identifiers.",
            ));
        }
        let ledger = self.0.erasure_ledger.as_ref().ok_or_else(|| {
            ConnectError::unavailable(
                "Permanent erasure storage is not configured. No content was erased.",
            )
        })?;
        let c = self.get(&r.collection_id).await?;
        if r.expected_revision == 0 || c.revision != r.expected_revision {
            return Err(conflict());
        }
        if whole {
            if !c.trashed {
                return Err(ConnectError::failed_precondition(
                    "Move this collection to Trash before erasing it.",
                ));
            }
        } else {
            let item = c
                .items
                .iter()
                .find(|i| i.id == r.target_id)
                .ok_or_else(|| ConnectError::not_found("Item no longer exists."))?;
            if !item.trashed {
                return Err(ConnectError::failed_precondition(
                    "Move this item to Trash before erasing it.",
                ));
            }
            c.revision.checked_add(1).ok_or_else(conflict)?;
        }
        self.0.db.query::<serde_json::Value>("INSERT INTO erasure_intents(owner_sub,collection_id,operation_id,fingerprint,expected_revision,target_id,scope) SELECT ?,?,?,?,?,?,? FROM collections WHERE owner_sub=? AND id=? AND revision=? ON CONFLICT(collection_id) DO NOTHING",&[self.owner(),c.id.clone(),r.operation_id.clone(),fingerprint.into(),r.expected_revision.to_string(),r.target_id.clone(),scope.into(),self.owner(),c.id.clone(),r.expected_revision.to_string()]).await?;
        let intent=self.0.db.query::<Intent>("SELECT operation_id,fingerprint,expected_revision,target_id,scope FROM erasure_intents WHERE owner_sub=? AND collection_id=?",&[self.owner(),c.id.clone()]).await?.pop().ok_or_else(conflict)?;
        if intent.operation_id != r.operation_id
            || intent.fingerprint != fingerprint
            || intent.target_id != r.target_id
            || intent.scope != scope
            || intent.expected_revision != r.expected_revision
        {
            return Err(ConnectError::failed_precondition(
                "Another erasure is pending for this collection. Retry that action first.",
            ));
        }
        let database_id = if self.0.config.local {
            "00000000-0000-0000-0000-000000000001".into()
        } else {
            self.0
                .config
                .db_url
                .rsplit('/')
                .nth(1)
                .ok_or_else(|| ConnectError::internal("Invalid database scope."))?
                .into()
        };
        ledger
            .publish(&ErasureRecord {
                version: 1,
                database_id,
                operation_id: r.operation_id.clone(),
                collection_id: c.id.clone(),
                scope: scope.into(),
                target_id: r.target_id.clone(),
            })
            .await?;
        let guard = "EXISTS(SELECT 1 FROM erasure_intents e JOIN collections c ON c.id=e.collection_id AND c.owner_sub=e.owner_sub WHERE e.owner_sub=? AND e.collection_id=? AND e.operation_id=? AND e.fingerprint=? AND c.revision=e.expected_revision)";
        let guard_params = vec![
            self.owner(),
            c.id.clone(),
            r.operation_id.clone(),
            fingerprint.into(),
        ];
        let mut statements = vec![];
        let mut writes: Vec<(&str, Vec<String>)> = if whole {
            vec![
                (
                    "INSERT INTO retired_list_ids(kind,id) SELECT 'collection',id FROM collections WHERE owner_sub=? AND id=? AND @guard ON CONFLICT(kind,id) DO NOTHING",
                    vec![self.owner(), c.id.clone()],
                ),
                (
                    "INSERT INTO retired_list_ids(kind,id) SELECT 'item',id FROM list_items WHERE owner_sub=? AND collection_id=? AND @guard ON CONFLICT(kind,id) DO NOTHING",
                    vec![self.owner(), c.id.clone()],
                ),
                (
                    "INSERT INTO retired_list_ids(kind,id) SELECT 'section',id FROM list_sections WHERE owner_sub=? AND collection_id=? AND @guard ON CONFLICT(kind,id) DO NOTHING",
                    vec![self.owner(), c.id.clone()],
                ),
                (
                    "INSERT INTO retired_task_ids(owner_sub,id) SELECT owner_sub,id FROM collections WHERE owner_sub=? AND id=? AND kind=1 AND @guard ON CONFLICT(owner_sub,id) DO NOTHING",
                    vec![self.owner(), c.id.clone()],
                ),
                (
                    "DELETE FROM collection_history WHERE owner_sub=? AND collection_id=? AND @guard",
                    vec![self.owner(), c.id.clone()],
                ),
            ]
        } else {
            vec![
                (
                    "INSERT INTO retired_list_ids(kind,id) SELECT 'item',id FROM list_items WHERE owner_sub=? AND collection_id=? AND id=? AND @guard ON CONFLICT(kind,id) DO NOTHING",
                    vec![self.owner(), c.id.clone(), r.target_id.clone()],
                ),
                (
                    "DELETE FROM list_items WHERE owner_sub=? AND collection_id=? AND id=? AND @guard",
                    vec![self.owner(), c.id.clone(), r.target_id.clone()],
                ),
                (
                    "DELETE FROM collection_history WHERE owner_sub=? AND collection_id=? AND target_id=? AND @guard",
                    vec![self.owner(), c.id.clone(), r.target_id.clone()],
                ),
            ]
        };
        // No content-derived action fingerprints survive erasure. Stale ordinary
        // retries are rejected by their revision; the new receipt contains IDs only.
        writes.push((
            "DELETE FROM collection_operations WHERE owner_sub=? AND collection_id=? AND @guard",
            vec![self.owner(), c.id.clone()],
        ));
        writes.push(("INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint,erased_scope) SELECT ?,?,?,?,? WHERE @guard",vec![self.owner(),r.operation_id.clone(),c.id.clone(),fingerprint.into(),scope.into()]));
        if whole {
            writes.push((
                "DELETE FROM collections WHERE owner_sub=? AND id=? AND @guard",
                vec![self.owner(), c.id.clone()],
            ));
        } else {
            writes.push(("UPDATE collections SET revision=revision+1,last_operation=? WHERE owner_sub=? AND id=? AND @guard",vec![r.operation_id.clone(),self.owner(),c.id.clone()]));
        }
        for (sql, mut params) in writes {
            params.extend(guard_params.clone());
            statements.push(Statement::new(&sql.replace("@guard", guard), params));
        }
        statements.push(Statement::new("DELETE FROM erasure_intents WHERE owner_sub=? AND collection_id=? AND operation_id=? AND EXISTS(SELECT 1 FROM collection_operations WHERE owner_sub=? AND operation_id=? AND fingerprint=? AND erased_scope=?)",vec![self.owner(),c.id.clone(),r.operation_id.clone(),self.owner(),r.operation_id.clone(),fingerprint.into(),scope.into()]));
        self.0
            .db
            .batch(&statements)
            .await
            .map_err(|_| unavailable())?;
        let receipt = self
            .receipt(&r.operation_id)
            .await?
            .ok_or_else(unavailable)?;
        if receipt.fingerprint != fingerprint || receipt.erased_scope != scope {
            return Err(unavailable());
        }
        Ok(ChangeResult {
            collection: if whole {
                Default::default()
            } else {
                self.get(&c.id).await?.into()
            },
            erased: true,
            ..Default::default()
        })
    }
}
