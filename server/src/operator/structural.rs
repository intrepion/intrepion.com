use super::*;
#[derive(Deserialize)]
struct Structural {
    revision: u64,
    max_items_per_collection: u64,
    max_sections_per_collection: u64,
    largest_retained_item_count: u64,
    largest_retained_section_count: u64,
}
impl Operator {
    pub(super) async fn structural(&self) -> Result<PilotStructuralPolicy, ConnectError> {
        let row=self.0.db.query::<Structural>("SELECT revision,max_items_per_collection,max_sections_per_collection,coalesce((SELECT max(n) FROM (SELECT count(*) n FROM list_items GROUP BY owner_sub,collection_id)),0) largest_retained_item_count,coalesce((SELECT max(n) FROM (SELECT count(*) n FROM list_sections GROUP BY owner_sub,collection_id)),0) largest_retained_section_count FROM operator_settings WHERE id=1",&[]).await?.pop().ok_or_else(changed)?;
        Ok(PilotStructuralPolicy {
            revision: row.revision,
            max_items_per_collection: row.max_items_per_collection,
            max_sections_per_collection: row.max_sections_per_collection,
            largest_retained_item_count: row.largest_retained_item_count,
            largest_retained_section_count: row.largest_retained_section_count,
            ..Default::default()
        })
    }
    pub(super) async fn set_structural(
        &self,
        r: &PilotStructuralChange,
    ) -> Result<PilotStructuralPolicy, ConnectError> {
        if !r.confirmed {
            return Err(ConnectError::failed_precondition(
                "Review the current and proposed structural limits and explicitly confirm this change.",
            ));
        }
        if !valid_id(&r.operation_id)
            || r.max_items_per_collection > 9_007_199_254_740_991
            || r.max_sections_per_collection > 9_007_199_254_740_991
        {
            return Err(ConnectError::invalid_argument(
                "Use an action UUID and finite safe whole structural limits.",
            ));
        }
        let fingerprint = hash(r)?;
        if let Some(receipt) = self.receipt(&r.operation_id).await? {
            if receipt.fingerprint != fingerprint {
                return Err(changed());
            }
            return Ok(result(receipt));
        }
        if self.structural().await?.revision != r.expected_revision {
            return Err(changed());
        }
        let next = r.expected_revision.checked_add(1).ok_or_else(changed)?;
        self.0.db.batch(&[
   Statement::new("UPDATE operator_settings SET max_items_per_collection=?,max_sections_per_collection=?,revision=revision+1,last_operation=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM pilot_operator_operations WHERE operation_id=?)",vec![r.max_items_per_collection.to_string(),r.max_sections_per_collection.to_string(),r.operation_id.clone(),r.expected_revision.to_string(),r.operation_id.clone()]),
   Statement::new("INSERT INTO pilot_operator_operations(operation_id,fingerprint,subject,public_id,revision,max_items,max_sections) SELECT ?,?,'system:structural','',revision,max_items_per_collection,max_sections_per_collection FROM operator_settings WHERE id=1 AND revision=? AND last_operation=? ON CONFLICT(operation_id) DO NOTHING",vec![r.operation_id.clone(),fingerprint.clone(),next.to_string(),r.operation_id.clone()]),
   Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_operator_operations WHERE operation_id=? AND fingerprint=?)",vec![r.operation_id.clone(),fingerprint]),
   Statement::new("DELETE FROM invariant_guards",vec![]),
  ]).await?;
        Ok(result(
            self.receipt(&r.operation_id).await?.ok_or_else(changed)?,
        ))
    }
}
fn result(receipt: Receipt) -> PilotStructuralPolicy {
    PilotStructuralPolicy {
        revision: receipt.revision,
        max_items_per_collection: receipt.max_items,
        max_sections_per_collection: receipt.max_sections,
        ..Default::default()
    }
}
