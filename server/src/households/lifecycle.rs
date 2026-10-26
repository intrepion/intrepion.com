use super::*;
use crate::erasure_ledger::ErasureRecord;

#[derive(Deserialize)]
struct Closure {
    household_id: String,
    operation_id: String,
    erase_due_at: i64,
}
impl Households {
    // An owned receipt allows only completion of its content-free protection,
    // never renewed household access after the actor leaves.
    pub(super) async fn protect_closure(
        &self,
        subject: &str,
        operation: &str,
    ) -> Result<(), ConnectError> {
        let pending = self.0.db.query::<Closure>(
            "SELECT household_id,operation_id,erase_due_at FROM household_lifecycle WHERE actor_sub=? AND operation_id=? AND closure_published=0",
            &[subject.into(), operation.into()],
        ).await?.pop();
        let Some(pending) = pending else {
            return Ok(());
        };
        let ledger = self.0.erasure_ledger.as_ref().ok_or_else(closure_pending)?;
        let database_id = if self.0.config.local {
            "00000000-0000-0000-0000-000000000001".into()
        } else {
            self.0
                .config
                .db_url
                .rsplit('/')
                .nth(1)
                .ok_or_else(closure_pending)?
                .into()
        };
        ledger
            .publish(
                &ErasureRecord {
                    version: 2,
                    database_id,
                    operation_id: pending.operation_id.clone(),
                    collection_id: pending.household_id.clone(),
                    scope: "household_closed".into(),
                    target_id: String::new(),
                    erase_due_at: Some(pending.erase_due_at),
                    collection_ids: None,
                    security: None,
                }
                .namespaced(&format!("household:{}", pending.household_id)),
            )
            .await
            .map_err(|_| closure_pending())?;
        self.0.db.query::<serde_json::Value>(
            "UPDATE household_lifecycle SET closure_published=1 WHERE household_id=? AND actor_sub=? AND operation_id=?",
            &[pending.household_id,subject.into(),operation.into()],
        ).await?;
        Ok(())
    }
}
fn closure_pending() -> ConnectError {
    ConnectError::unavailable(
        "Household access has ended. Closure recovery protection is pending. Retry the same leave action; retained capacity stays reserved.",
    )
}

impl Households {
    async fn erase_closed(&self, h: &HouseholdRow) -> Result<(), ConnectError> {
        #[derive(Deserialize)]
        struct Marker {
            operation_id: String,
        }
        let marker = self.0.db.query::<Marker>(
            "SELECT operation_id FROM household_lifecycle WHERE household_id=? AND closure_published=1",
            std::slice::from_ref(&h.id),
        ).await?.pop().ok_or_else(closure_pending)?;
        self.0.db.batch(&[
            Statement::new("UPDATE households SET status='erasing' WHERE id=? AND status IN('closed','erasing') AND erase_due_at<=CAST(? AS INTEGER) AND NOT EXISTS(SELECT 1 FROM household_heads WHERE household_id=? AND active=1)",vec![h.id.clone(),self.clock_now().to_string(),h.id.clone()]),
            Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households WHERE id=? AND status='erasing')",vec![h.id.clone()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]).await?;
        let database_id = if self.0.config.local {
            "00000000-0000-0000-0000-000000000001".into()
        } else {
            self.0
                .config
                .db_url
                .rsplit('/')
                .nth(1)
                .ok_or_else(closure_pending)?
                .into()
        };
        let record = ErasureRecord {
            version: 2,
            database_id,
            operation_id: marker.operation_id,
            collection_id: h.id.clone(),
            scope: "household".into(),
            target_id: String::new(),
            erase_due_at: Some(h.erase_due_at),
            collection_ids: None,
            security: None,
        }
        .namespaced(&h.scope_sub);
        let ledger = self.0.erasure_ledger.as_ref().ok_or_else(closure_pending)?;
        ledger.publish(&record).await.map_err(|_|ConnectError::unavailable("Scheduled household erasure is delayed. Retained content and allocations remain reserved; operator retry is required."))?;
        let mut statements = vec![
            Statement::new(
                "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households WHERE id=? AND status='erasing' AND NOT EXISTS(SELECT 1 FROM household_heads WHERE household_id=? AND active=1))",
                vec![h.id.clone(), h.id.clone()],
            ),
            Statement::new(
                "INSERT INTO household_releases(household_id,subject,released_at) SELECT household_id,subject,? FROM household_allocations WHERE household_id=? ON CONFLICT(household_id,subject) DO NOTHING",
                vec![self.clock_now().to_string(), h.id.clone()],
            ),
        ];
        for (table, kind) in [
            ("collections", "collection"),
            ("list_items", "item"),
            ("list_sections", "section"),
        ] {
            statements.push(Statement::new(&format!("INSERT INTO retired_list_ids(kind,id) SELECT '{kind}',id FROM {table} WHERE owner_sub=? ON CONFLICT(kind,id) DO NOTHING"),vec![h.scope_sub.clone()]));
        }
        statements.push(Statement::new("INSERT INTO retired_task_ids(owner_sub,id) SELECT owner_sub,id FROM collections WHERE owner_sub=? AND kind=1 ON CONFLICT(owner_sub,id) DO NOTHING",vec![h.scope_sub.clone()]));
        for table in [
            "erasure_intents",
            "collection_operations",
            "collection_history",
            "list_items",
            "list_sections",
            "collections",
        ] {
            statements.push(Statement::new(
                &format!("DELETE FROM {table} WHERE owner_sub=?"),
                vec![h.scope_sub.clone()],
            ));
        }
        for sql in include_str!("../../household-email-erasure.sql")
            .split(';')
            .filter(|sql| !sql.trim().is_empty())
        {
            statements.push(Statement::new(sql, vec![h.id.clone()]));
        }
        for table in [
            "household_invitations",
            "household_content_erasures",
            "household_activity",
            "household_heads",
            "household_operations",
            "household_lifecycle",
            "household_allocations",
        ] {
            statements.push(Statement::new(
                &format!("DELETE FROM {table} WHERE household_id=?"),
                vec![h.id.clone()],
            ));
        }
        statements.extend([
            Statement::new("UPDATE households SET name='Erased household',status='erased',erasure_delayed=0,revision=revision+1,last_operation='erased' WHERE id=?",vec![h.id.clone()]),
            Statement::new("UPDATE closed_household_ids SET erased=1 WHERE id=?",vec![h.id.clone()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]);
        self.0.db.batch(&statements).await?;
        Ok(())
    }
    async fn maintain(&self, id: &str) -> Result<HouseholdMaintenanceResult, ConnectError> {
        if !id.is_empty() && !valid_id(id) {
            return Err(ConnectError::invalid_argument("Invalid household ID."));
        }
        #[derive(Deserialize)]
        struct Pending {
            actor_sub: String,
            operation_id: String,
        }
        let pending = self.0.db.query::<Pending>(
            "SELECT actor_sub,operation_id FROM household_lifecycle WHERE closure_published=0 AND (?='' OR household_id=?) ORDER BY household_id LIMIT 25", &[id.into(),id.into()],
        ).await?;
        let mut result = HouseholdMaintenanceResult::default();
        for p in pending {
            self.protect_closure(&p.actor_sub, &p.operation_id).await?;
            result.protected_closures += 1;
        }
        let due = self.0.db.query::<HouseholdRow>(
            "SELECT id,scope_sub,name,status,revision,erase_due_at,erasure_delayed FROM households WHERE status IN('closed','erasing') AND erase_due_at<=CAST(? AS INTEGER) AND (?='' OR id=?) ORDER BY id LIMIT 25",
            &[self.clock_now().to_string(),id.into(),id.into()],
        ).await?;
        let mut failed = false;
        for h in due {
            if self.erase_closed(&h).await.is_ok() {
                result.erased_households += 1;
            } else {
                failed = true;
                self.0.db.query::<serde_json::Value>("UPDATE households SET erasure_delayed=1 WHERE id=? AND status IN('closed','erasing')",std::slice::from_ref(&h.id)).await?;
            }
        }
        if failed {
            return Err(ConnectError::unavailable(
                "One or more household erasures are delayed. Capacity remains reserved. Retry operator maintenance.",
            ));
        }
        Ok(result)
    }
}
#[allow(refining_impl_trait)]
impl HouseholdMaintenanceService for Maintenance {
    async fn erase_due_households(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdMaintenanceQuery>,
    ) -> ServiceResult<HouseholdMaintenanceResult> {
        let configured = self
            .0
            .config
            .household_maintenance_token
            .as_deref()
            .ok_or_else(|| {
                ConnectError::unauthenticated("Operator automation authentication required.")
            })?;
        let supplied = ctx
            .headers()
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .unwrap_or("");
        if supplied.len() != 64
            || Sha256::digest(supplied.as_bytes()) != Sha256::digest(configured.as_bytes())
        {
            return Err(ConnectError::unauthenticated(
                "Operator automation authentication required.",
            ));
        }
        crate::retention::prune(&self.0).await?;
        crate::security::protect(&self.0).await?;
        Response::ok(Households(self.0.clone()).maintain(r.household_id).await?)
    }
}
