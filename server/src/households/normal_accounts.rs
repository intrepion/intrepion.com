use super::*;
impl Households {
    pub(super) async fn create_without_allocation(
        &self,
        account: &Account,
        r: &HouseholdChange,
        fingerprint: &str,
    ) -> Result<HouseholdMutationResult, ConnectError> {
        let name = r.name.trim();
        if name.is_empty()
            || name.chars().count() > 100
            || name.contains('\0')
            || r.expected_revision != 0
        {
            return Err(ConnectError::invalid_argument(
                "Enter a household name of 1–100 characters.",
            ));
        }
        if Amounts::from(&*r.amounts).values().iter().any(|n| *n != 0) || r.amounts.households != 0
        {
            return Err(ConnectError::invalid_argument(
                "Household creation asks only for a name.",
            ));
        }
        let scope = format!("household:{}", r.household_id);
        let guard =
            "EXISTS(SELECT 1 FROM households WHERE id=? AND created_by=? AND last_operation=?)";
        let mut guarded = vec![
            r.household_id.clone(),
            account.subject.clone(),
            r.operation_id.clone(),
        ];
        let mut head_params = vec![
            r.household_id.clone(),
            account.subject.clone(),
            Amounts::default().json(),
        ];
        head_params.extend(guarded.clone());
        let mut history_params = vec![r.household_id.clone(), account.subject.clone()];
        history_params.extend(guarded.clone());
        let mut receipt_params = vec![
            account.subject.clone(),
            r.operation_id.clone(),
            fingerprint.into(),
            r.household_id.clone(),
        ];
        receipt_params.append(&mut guarded);
        self.0.db.batch(&[
            Statement::new("INSERT INTO households(id,scope_sub,name,created_by,last_operation) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM site_safety_policy WHERE id=1 AND enabled=1) AND EXISTS(SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=1) AND NOT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=?) ON CONFLICT(id) DO NOTHING",vec![r.household_id.clone(),scope,name.into(),account.subject.clone(),r.operation_id.clone(),account.subject.clone(),account.subject.clone(),r.operation_id.clone()]),
            Statement::new(&format!("INSERT INTO household_heads(household_id,subject,ceilings_json) SELECT ?,?,? WHERE {guard} AND NOT EXISTS(SELECT 1 FROM household_heads WHERE household_id=? AND subject=?)"),{head_params.extend([r.household_id.clone(),account.subject.clone()]);head_params}),
            Statement::new(&format!("INSERT INTO household_activity(household_id,actor_sub,action) SELECT ?,?,'Created household' WHERE {guard} AND NOT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=?)"),{history_params.extend([account.subject.clone(),r.operation_id.clone()]);history_params}),
            Statement::new(&format!("INSERT INTO household_operations(actor_sub,operation_id,fingerprint,household_id) SELECT ?,?,?,? WHERE {guard} ON CONFLICT(actor_sub,operation_id) DO NOTHING"),receipt_params),
            capacity::account_guard(&account.subject),
            capacity::household_source_guard(&r.household_id),
            Statement::new("INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=? AND fingerprint=?)",vec![account.subject.clone(),r.operation_id.clone(),fingerprint.into()]),
            Statement::new("DELETE FROM invariant_guards",vec![]),
        ]).await.map_err(|e|if e.code==connectrpc::ErrorCode::Unavailable{e}else{ConnectError::resource_exhausted("Your change was not saved. Please try again later or contact support.")})?;
        Ok(HouseholdMutationResult {
            household_id: r.household_id.clone(),
            ..Default::default()
        })
    }
}
