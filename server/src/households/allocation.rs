use super::*;
impl Households {
    pub(super) async fn allocation_preview(
        &self,
        account: &Account,
        id: &str,
        requested: Amounts,
    ) -> Result<AllocationPreview, ConnectError> {
        requested.validate()?;
        if requested.households != 0 {
            return Err(ConnectError::invalid_argument(
                "Household membership limits cannot be allocated.",
            ));
        }
        let is_head = self.is_head(id, &account.subject).await?;
        let own = self.contribution(id, &account.subject).await?;
        if !is_head && own.is_none() {
            return Err(ConnectError::permission_denied(
                "This allocation is unavailable.",
            ));
        }
        let h = self.row(id).await?;
        let current = own.unwrap_or_default();
        let personal_before = capacity::personal_capacity(&self.0.db, account).await?;
        let mut result = AllocationPreview {
            allowed: false,
            current: current.clone().into(),
            requested: requested.clone().into(),
            personal_before: personal_before.clone().into(),
            ..Default::default()
        };
        if h.status != "active" {
            result.reason =
                "Closed household capacity remains reserved until protected erasure succeeds."
                    .into();
            return Ok(result);
        }
        let before = capacity::household_capacity(&self.0.db, id).await?;
        let usage = capacity::usage(&self.0.db, &h.scope_sub).await?;
        if is_head {
            result.household_before = before.clone().into();
            result.household_usage = usage.clone().into();
        }
        let increasing = current
            .values()
            .iter()
            .zip(requested.values())
            .any(|(old, new)| new > *old);
        let decreasing = current
            .values()
            .iter()
            .zip(requested.values())
            .any(|(old, new)| new < *old);
        if !is_head && increasing {
            result.reason="Former heads may keep or withdraw their existing allocation, but cannot add capacity without rejoining.".into();
            return Ok(result);
        }
        let personal_after = match personal_before.add(&current)?.subtract(&requested) {
            Ok(value) => value,
            Err(_) => {
                result.reason = "Your plan has insufficient unallocated capacity.".into();
                return Ok(result);
            }
        };
        result.personal_after = personal_after.clone().into();
        let after = before.subtract(&current)?.add(&requested)?;
        if is_head {
            result.household_after = after.clone().into();
        }
        let private_usage = capacity::usage(&self.0.db, &account.subject).await?;
        if increasing
            && private_usage
                .values()
                .iter()
                .zip(personal_after.values())
                .any(|(used, cap)| *used > cap)
        {
            result.reason="Your personal space needs that retained capacity. Obtain replacement capacity or explicitly erase retained content first.".into();
            return Ok(result);
        }
        if decreasing
            && usage
                .values()
                .iter()
                .zip(after.values())
                .any(|(used, cap)| *used > cap)
        {
            result.reason="Withdrawal would leave retained household content without enough backing capacity. Obtain replacement capacity or erase retained content first.".into();
            return Ok(result);
        }
        result.allowed = true;
        Ok(result)
    }
}
