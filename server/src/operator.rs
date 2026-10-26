mod structural;
use crate::{
    auth::SharedAuth,
    capacity::{self, Amounts, RESOURCES},
    db::Statement,
    lists::valid_id,
    proto::life::v1::*,
};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub(crate) struct Operator(pub SharedAuth);
#[derive(Deserialize, Serialize)]
struct Account {
    subject: String,
    display_name: String,
    approved: i32,
    plan_json: String,
    plan_revision: u64,
    public_id: String,
}
#[derive(Deserialize, Serialize)]
struct Allocation {
    household_id: String,
    name: String,
    status: String,
    revision: u64,
    scope_sub: String,
    amounts_json: String,
}
#[derive(Serialize)]
struct Room {
    row: Allocation,
    usage: Amounts,
    capacity: Amounts,
}
#[derive(Serialize)]
struct Snapshot {
    account: Option<Account>,
    usage: Amounts,
    rooms: Vec<Room>,
}
#[derive(Deserialize)]
struct Receipt {
    fingerprint: String,
    public_id: String,
    revision: u64,
    max_items: u64,
    max_sections: u64,
}
fn changed() -> ConnectError {
    ConnectError::failed_precondition(
        "Policy or retained usage changed. Read the current policy and generate a new preview before applying it.",
    )
}
fn valid_subject(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 255
        && s.trim() == s
        && !s.chars().any(char::is_control)
        && !["household:", "system:"]
            .iter()
            .any(|p| s.to_ascii_lowercase().starts_with(p))
}
fn hash<T: Serialize>(value: &T) -> Result<String, ConnectError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(value)
                .map_err(|_| ConnectError::internal("Invalid operator policy."))?
        )
    ))
}
impl Operator {
    fn authorize(&self, ctx: &RequestContext) -> Result<(), ConnectError> {
        let expected = self
            .0
            .config
            .pilot_operator_token
            .as_deref()
            .ok_or_else(|| {
                ConnectError::unauthenticated("Operator policy authentication required.")
            })?;
        let supplied = ctx
            .headers()
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .unwrap_or("");
        if supplied.len() != 64
            || Sha256::digest(supplied.as_bytes()) != Sha256::digest(expected.as_bytes())
        {
            return Err(ConnectError::unauthenticated(
                "Operator policy authentication required.",
            ));
        }
        Ok(())
    }
    async fn account(&self, subject: &str) -> Result<Option<Account>, ConnectError> {
        if !valid_subject(subject) {
            return Err(ConnectError::invalid_argument(
                "Use the exact Google subject; household/system namespaces and control characters are reserved.",
            ));
        }
        Ok(self.0.db.query::<Account>("SELECT subject,display_name,approved,plan_json,plan_revision,public_id FROM pilot_accounts WHERE subject=?",&[subject.into()]).await?.pop())
    }
    async fn snapshot(&self, subject: &str) -> Result<Snapshot, ConnectError> {
        let account = self.account(subject).await?;
        let mut usage = capacity::usage(&self.0.db, subject).await?;
        #[derive(Deserialize)]
        struct Count {
            n: u64,
        }
        usage.households=self.0.db.query::<Count>("SELECT count(*) n FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.subject=? AND m.active=1 AND h.status='active'",&[subject.into()]).await?.pop().ok_or_else(changed)?.n;
        let rows=self.0.db.query::<Allocation>("SELECT x.household_id,h.name,h.status,h.revision,h.scope_sub,x.amounts_json FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=? ORDER BY x.household_id",&[subject.into()]).await?;
        let mut rooms = Vec::new();
        for row in rows {
            rooms.push(Room {
                usage: capacity::usage(&self.0.db, &row.scope_sub).await?,
                capacity: capacity::household_capacity(&self.0.db, &row.household_id).await?,
                row,
            });
        }
        Ok(Snapshot {
            account,
            usage,
            rooms,
        })
    }
    async fn preview(
        &self,
        r: &PilotPolicyChange,
    ) -> Result<(PilotPolicyPreview, Snapshot), ConnectError> {
        if !valid_id(&r.operation_id)
            || !valid_subject(&r.subject)
            || r.display_name.trim() != r.display_name
            || r.display_name.is_empty()
            || r.display_name.chars().count() > 100
            || r.display_name.contains('\0')
            || !r.plan.is_set()
            || r.expected_revision > i64::MAX as u64
        {
            return Err(ConnectError::invalid_argument(
                "Provide an action UUID, exact subject, display name, complete finite plan and expected revision.",
            ));
        }
        let plan = Amounts::from(&*r.plan);
        plan.validate()?;
        let state = self.snapshot(&r.subject).await?;
        let revision = state.account.as_ref().map_or(0, |a| a.plan_revision);
        if r.create_account != state.account.is_none() || r.expected_revision != revision {
            return Err(changed());
        }
        let blocked_new_identity = state.account.is_none()
            && r.approved
            && !self
                .0
                .db
                .query::<serde_json::Value>(
                    "SELECT 1 FROM protected_account_access WHERE subject_hash=? AND active=0",
                    &[crate::security::subject_hash(&r.subject)],
                )
                .await?
                .is_empty();
        let current = state
            .account
            .as_ref()
            .map(|a| serde_json::from_str::<Amounts>(&a.plan_json))
            .transpose()
            .map_err(|_| ConnectError::internal("Invalid current pilot plan."))?
            .unwrap_or_default();
        let mut replacements = std::collections::BTreeMap::new();
        for replacement in &r.replacements {
            let amounts = Amounts::from(&*replacement.amounts);
            amounts.validate()?;
            if !valid_id(&replacement.household_id)
                || !replacement.amounts.is_set()
                || amounts.households != 0
                || replacements
                    .insert(
                        replacement.household_id.clone(),
                        (replacement.expected_revision, amounts),
                    )
                    .is_some()
            {
                return Err(ConnectError::invalid_argument(
                    "Supply each existing allocation once, with its household revision and explicit resource amounts.",
                ));
            }
        }
        let mut reserved = Amounts::default();
        let mut next_reserved = Amounts::default();
        let mut next_capacities = std::collections::BTreeMap::new();
        let mut own_allocations = std::collections::BTreeMap::new();
        let mut withdraws_required_capacity = false;
        for room in &state.rooms {
            let own: Amounts = serde_json::from_str(&room.row.amounts_json)
                .map_err(|_| ConnectError::internal("Invalid retained allocation."))?;
            reserved = reserved.add(&own)?;
            let proposed = if let Some((revision, amounts)) =
                replacements.remove(&room.row.household_id)
            {
                if revision != room.row.revision {
                    return Err(changed());
                }
                if amounts
                    .values()
                    .iter()
                    .zip(own.values())
                    .any(|(new, old)| *new > old)
                {
                    return Err(ConnectError::invalid_argument(
                        "Operator replacements may retain or reduce allocations. Use the head's ordinary allocation controls for increases.",
                    ));
                }
                if room.row.status != "active" && amounts.values() != own.values() {
                    return Err(ConnectError::failed_precondition(
                        "Closed-household allocations stay reserved until protected erasure succeeds.",
                    ));
                }
                amounts
            } else {
                own.clone()
            };
            next_reserved = next_reserved.add(&proposed)?;
            own_allocations.insert(
                room.row.household_id.clone(),
                (own.clone(), proposed.clone()),
            );
            let next_capacity = room.capacity.subtract(&own)?.add(&proposed)?;
            // The overage exception belongs only to genuinely reduced plan dimensions.
            // Existing overages may remain unchanged during unrelated policy edits.
            for (index, cap) in next_capacity.values().iter().enumerate() {
                if *cap < room.capacity.values()[index]
                    && *cap < room.usage.values()[index]
                    && plan.values()[index] >= current.values()[index]
                {
                    withdraws_required_capacity = true;
                }
            }
            next_capacities.insert(room.row.household_id.clone(), next_capacity);
        }
        if !replacements.is_empty() {
            return Err(ConnectError::invalid_argument(
                "Replacement refers to an allocation this account does not hold.",
            ));
        }
        let after = plan.subtract(&next_reserved);
        let mut clean = r.clone();
        clean.preview_token.clear();
        let token = hash(&(&clean, &state))?;
        let mut preview = PilotPolicyPreview {
            allowed: after.is_ok() && !withdraws_required_capacity && !blocked_new_identity,
            reason: if blocked_new_identity {
                "This recovered identity remains suspended. Reconstruct it with access disabled, then explicitly review account restoration.".into()
            } else if withdraws_required_capacity {
                "Voluntary withdrawals must leave retained household usage funded. Only a genuine reduction of the corresponding plan allowance permits an overage.".into()
            } else if after.is_err() {
                "Existing household allocations exceed the proposed plan. Supply explicit replacements; closed allocations remain reserved.".into()
            } else {
                String::new()
            },
            preview_token: token,
            account_exists: state.account.is_some(),
            current_revision: revision,
            current_plan: current.clone().into(),
            ..Default::default()
        };
        let exceeds = after.as_ref().is_ok_and(|a| {
            state
                .usage
                .values()
                .iter()
                .zip(a.values())
                .any(|(used, cap)| *used > cap)
                || state.usage.households > plan.households
        });
        preview.spaces.push(PilotPolicySpace {
            id: "personal".into(),
            name: "Personal".into(),
            status: "private".into(),
            usage: state.usage.clone().into(),
            before: current.subtract(&reserved)?.into(),
            after: after.ok().map(Into::into).into(),
            exceeds_after: exceeds,
            ..Default::default()
        });
        for room in &state.rooms {
            preview.spaces.push(PilotPolicySpace {
                own_allocation_before: own_allocations[&room.row.household_id].0.clone().into(),
                own_allocation_after: own_allocations[&room.row.household_id].1.clone().into(),
                id: room.row.household_id.clone(),
                name: room.row.name.clone(),
                status: room.row.status.clone(),
                revision: room.row.revision,
                usage: room.usage.clone().into(),
                before: room.capacity.clone().into(),
                after: next_capacities[&room.row.household_id].clone().into(),
                exceeds_after: room
                    .usage
                    .values()
                    .iter()
                    .zip(next_capacities[&room.row.household_id].values())
                    .any(|(used, cap)| *used > cap),
                ..Default::default()
            });
        }
        Ok((preview, state))
    }
    async fn receipt(&self, operation: &str) -> Result<Option<Receipt>, ConnectError> {
        Ok(self.0.db.query::<Receipt>("SELECT fingerprint,public_id,revision,max_items,max_sections FROM pilot_operator_operations WHERE operation_id=?",&[operation.into()]).await?.pop())
    }
    async fn apply(&self, r: &PilotPolicyChange) -> Result<PilotPolicyResult, ConnectError> {
        let fingerprint = hash(r)?;
        if let Some(receipt) = self.receipt(&r.operation_id).await? {
            if receipt.fingerprint != fingerprint {
                return Err(changed());
            }
            return Ok(PilotPolicyResult {
                public_id: receipt.public_id,
                revision: receipt.revision,
                ..Default::default()
            });
        }
        let (preview, state) = self.preview(r).await?;
        if !preview.allowed
            || r.preview_token.is_empty()
            || r.preview_token != preview.preview_token
        {
            return Err(changed());
        }
        let public_id = crate::security::canonical_public_id(&self.0.db, &r.subject)
            .await?
            .unwrap_or_else(|| crate::auth::secret()[..32].into());
        let next = r.expected_revision.checked_add(1).ok_or_else(changed)?;
        let mut statements = vec![usage_guard(&r.subject, &state.usage)];
        statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT (SELECT count(*) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.subject=? AND m.active=1 AND h.status='active')=CAST(? AS INTEGER) AND (SELECT count(*) FROM household_allocations WHERE subject=?)=CAST(? AS INTEGER)",vec![r.subject.clone(),state.usage.households.to_string(),r.subject.clone(),state.rooms.len().to_string()]));
        for room in &state.rooms {
            statements.push(usage_guard(&room.row.scope_sub, &room.usage));
            statements.push(Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households h JOIN household_allocations x ON x.household_id=h.id WHERE h.id=? AND h.revision=? AND x.subject=? AND x.amounts_json=?)",vec![room.row.household_id.clone(),room.row.revision.to_string(),r.subject.clone(),room.row.amounts_json.clone()]));
        }
        let amounts = Amounts::from(&*r.plan);
        let no_receipt = "NOT EXISTS(SELECT 1 FROM pilot_operator_operations WHERE operation_id=?)";
        if state.account.is_none() {
            statements.push(Statement::new(&format!("INSERT INTO pilot_accounts(subject,display_name,approved,plan_json,plan_revision,public_id,last_policy_operation) SELECT ?,?,?,?,1,?,? WHERE {no_receipt} ON CONFLICT(subject) DO NOTHING"),vec![r.subject.clone(),r.display_name.clone(),i32::from(r.approved).to_string(),amounts.json(),public_id.clone(),r.operation_id.clone(),r.operation_id.clone()]));
        } else {
            statements.push(Statement::new(&format!("UPDATE pilot_accounts SET display_name=?,approved=?,plan_json=?,plan_revision=plan_revision+1,last_policy_operation=?,public_id=CASE WHEN public_id='' THEN ? ELSE public_id END WHERE subject=? AND plan_revision=? AND {no_receipt}"),vec![r.display_name.clone(),i32::from(r.approved).to_string(),amounts.json(),r.operation_id.clone(),public_id,r.subject.clone(),r.expected_revision.to_string(),r.operation_id.clone()]));
        }
        if !r.approved {
            statements.push(Statement::new("DELETE FROM sessions WHERE owner_sub=? AND EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0 AND plan_revision=? AND last_policy_operation=?)",vec![r.subject.clone(),r.subject.clone(),next.to_string(),r.operation_id.clone()]));
        }
        for replacement in &r.replacements {
            let room = state
                .rooms
                .iter()
                .find(|room| room.row.household_id == replacement.household_id)
                .ok_or_else(changed)?;
            let previous: Amounts =
                serde_json::from_str(&room.row.amounts_json).map_err(|_| changed())?;
            let proposed = Amounts::from(&*replacement.amounts);
            if previous.values() == proposed.values() {
                continue;
            }
            let hh_next = room.row.revision.checked_add(1).ok_or_else(changed)?;
            statements.push(Statement::new(&format!("UPDATE households SET revision=revision+1,last_operation=? WHERE id=? AND revision=? AND status='active' AND EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND plan_revision=? AND last_policy_operation=?) AND {no_receipt}"),vec![r.operation_id.clone(),room.row.household_id.clone(),room.row.revision.to_string(),r.subject.clone(),next.to_string(),r.operation_id.clone(),r.operation_id.clone()]));
            let guard =
                "EXISTS(SELECT 1 FROM households WHERE id=? AND revision=? AND last_operation=?)";
            statements.push(Statement::new(&format!("UPDATE household_allocations SET amounts_json=? WHERE household_id=? AND subject=? AND {guard}"),vec![proposed.json(),room.row.household_id.clone(),r.subject.clone(),room.row.household_id.clone(),hh_next.to_string(),r.operation_id.clone()]));
            statements.push(Statement::new(&format!("INSERT INTO household_activity(household_id,actor_sub,action,details_json) SELECT ?,'system:operator','Operator adjusted allocation',? WHERE {guard} AND {no_receipt}"),vec![room.row.household_id.clone(),serde_json::json!({"before":previous,"after":proposed}).to_string(),room.row.household_id.clone(),hh_next.to_string(),r.operation_id.clone(),r.operation_id.clone()]));
        }
        statements.extend([
   Statement::new("INSERT INTO pilot_operator_operations(operation_id,fingerprint,subject,public_id,revision) SELECT ?,?,subject,public_id,plan_revision FROM pilot_accounts WHERE subject=? AND plan_revision=? AND last_policy_operation=? ON CONFLICT(operation_id) DO NOTHING",vec![r.operation_id.clone(),fingerprint.clone(),r.subject.clone(),next.to_string(),r.operation_id.clone()]),
   Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_operator_operations WHERE operation_id=? AND fingerprint=?)",vec![r.operation_id.clone(),fingerprint]),
   Statement::new("DELETE FROM invariant_guards",vec![]),
  ]);
        self.0.db.batch(&statements).await?;
        let receipt = self.receipt(&r.operation_id).await?.ok_or_else(changed)?;
        Ok(PilotPolicyResult {
            public_id: receipt.public_id,
            revision: receipt.revision,
            ..Default::default()
        })
    }
}
fn usage_guard(scope: &str, usage: &Amounts) -> Statement {
    let checks = RESOURCES.map(|key| {
        format!("coalesce((SELECT {key} FROM space_usage WHERE owner_sub=?),0)=CAST(? AS INTEGER)")
    });
    let mut params = Vec::new();
    for amount in usage.values() {
        params.push(scope.into());
        params.push(amount.to_string());
    }
    Statement::new(
        &format!(
            "INSERT INTO invariant_guards(valid) SELECT {}",
            checks.join(" AND ")
        ),
        params,
    )
}
#[allow(refining_impl_trait)]
impl PilotOperatorService for Operator {
    async fn get_structural_policy(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<PilotStructuralPolicy> {
        self.authorize(&ctx)?;
        Response::ok(self.structural().await?)
    }
    async fn set_structural_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, PilotStructuralChange>,
    ) -> ServiceResult<PilotStructuralPolicy> {
        self.authorize(&ctx)?;
        Response::ok(self.set_structural(&r.to_owned_message()).await?)
    }
    async fn get_account_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, PilotAccountKey>,
    ) -> ServiceResult<PilotPolicyAccount> {
        self.authorize(&ctx)?;
        let a = self
            .account(r.subject)
            .await?
            .ok_or_else(|| ConnectError::not_found("Pilot account unavailable."))?;
        let plan: Amounts = serde_json::from_str(&a.plan_json)
            .map_err(|_| ConnectError::internal("Invalid pilot plan."))?;
        Response::ok(PilotPolicyAccount {
            subject: a.subject,
            display_name: a.display_name,
            approved: a.approved != 0,
            plan: plan.into(),
            revision: a.plan_revision,
            public_id: a.public_id,
            ..Default::default()
        })
    }
    async fn preview_account_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, PilotPolicyChange>,
    ) -> ServiceResult<PilotPolicyPreview> {
        self.authorize(&ctx)?;
        Response::ok(self.preview(&r.to_owned_message()).await?.0)
    }
    async fn apply_account_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, PilotPolicyChange>,
    ) -> ServiceResult<PilotPolicyResult> {
        self.authorize(&ctx)?;
        let result = self.apply(&r.to_owned_message()).await?;
        crate::security::protect(&self.0).await?;
        Response::ok(result)
    }
}
