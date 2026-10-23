mod allocation;
mod content_erasure;
mod lifecycle;
mod membership;
use crate::{
    auth::SharedAuth,
    capacity::{self, Account, Amounts},
    db::Statement,
    lists::valid_id,
    proto::life::v1::*,
};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub(crate) struct Households(pub SharedAuth);
pub(crate) struct Maintenance(pub SharedAuth);
#[derive(Deserialize)]
pub(crate) struct HouseholdRow {
    pub id: String,
    pub scope_sub: String,
    pub name: String,
    pub status: String,
    pub revision: u64,
    pub erase_due_at: i64,
    pub erasure_delayed: i32,
}
#[derive(Deserialize)]
struct Receipt {
    fingerprint: String,
    household_id: String,
    result_id: String,
}
#[derive(Deserialize)]
struct HeadRow {
    subject: String,
    public_id: String,
    display_name: String,
    ceilings_json: String,
}
#[derive(Deserialize)]
struct AllocationRow {
    public_id: String,
    display_name: String,
    amounts_json: String,
    is_head: i32,
}
fn identity(id: String, name: String) -> PilotIdentity {
    PilotIdentity {
        id,
        name,
        ..Default::default()
    }
}
fn changed() -> ConnectError {
    ConnectError::failed_precondition(
        "Membership or capacity changed. Refresh the preview and retry the same action.",
    )
}
impl Households {
    pub(crate) fn clock_now(&self) -> i64 {
        #[cfg(feature = "dev-auth")]
        if self.0.config.local
            && let Some(now) = std::env::var("HOUSEHOLD_TEST_NOW")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|value| *value > 0 && *value <= 253_402_300_799)
        {
            return now;
        }
        crate::auth::now() as i64
    }
    async fn closure_cutoff(&self) -> Result<i64, ConnectError> {
        #[derive(Deserialize)]
        struct Cutoff {
            due: i64,
        }
        self.0.db.query::<Cutoff>("SELECT unixepoch(CAST(? AS INTEGER),'unixepoch','start of month','+1 month') AS due", &[self.clock_now().to_string()]).await?.pop().map(|row|row.due).ok_or_else(||ConnectError::unavailable("Could not calculate the closure deadline."))
    }
    pub(crate) async fn row(&self, id: &str) -> Result<HouseholdRow, ConnectError> {
        if !valid_id(id) {
            return Err(ConnectError::invalid_argument("Invalid household ID."));
        }
        self.0.db.query::<HouseholdRow>("SELECT id,scope_sub,name,status,revision,erase_due_at,erasure_delayed FROM households WHERE id=?", &[id.into()]).await?.pop().ok_or_else(||ConnectError::not_found("Household unavailable."))
    }
    pub(crate) async fn is_head(&self, id: &str, subject: &str) -> Result<bool, ConnectError> {
        Ok(!self.0.db.query::<serde_json::Value>("SELECT 1 FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.household_id=? AND m.subject=? AND m.active=1 AND h.status='active'", &[id.into(),subject.into()]).await?.is_empty())
    }
    pub(crate) async fn require_head(
        &self,
        id: &str,
        subject: &str,
    ) -> Result<HouseholdRow, ConnectError> {
        if !self.is_head(id, subject).await? {
            return Err(ConnectError::permission_denied(
                "Household access ended or is unavailable.",
            ));
        }
        self.row(id).await
    }
    async fn contribution(&self, id: &str, subject: &str) -> Result<Option<Amounts>, ConnectError> {
        #[derive(Deserialize)]
        struct Row {
            amounts_json: String,
        }
        self.0
            .db
            .query::<Row>(
                "SELECT amounts_json FROM household_allocations WHERE household_id=? AND subject=?",
                &[id.into(), subject.into()],
            )
            .await?
            .pop()
            .map(|r| {
                serde_json::from_str(&r.amounts_json)
                    .map_err(|_| ConnectError::internal("Invalid contribution."))
            })
            .transpose()
    }
    async fn summary(
        &self,
        h: &HouseholdRow,
        subject: &str,
    ) -> Result<HouseholdSummary, ConnectError> {
        let closure_protection_pending = matches!(h.status.as_str(), "closed" | "erasing") && !self.0.db.query::<serde_json::Value>("SELECT 1 FROM household_lifecycle WHERE household_id=? AND closure_published=0", std::slice::from_ref(&h.id)).await?.is_empty();
        Ok(HouseholdSummary {
            closure_protection_pending,
            id: h.id.clone(),
            name: h.name.clone(),
            status: h.status.clone(),
            is_head: self.is_head(&h.id, subject).await?,
            own_contribution: self
                .contribution(&h.id, subject)
                .await?
                .map(Into::into)
                .into(),
            erase_due_at: h.erase_due_at,
            erasure_delayed: h.erasure_delayed != 0,
            revision: h.revision,
            ..Default::default()
        })
    }
    async fn overview(&self, account: &Account) -> Result<AccountOverview, ConnectError> {
        let rows=self.0.db.query::<HouseholdRow>("SELECT h.id,h.scope_sub,h.name,h.status,h.revision,h.erase_due_at,h.erasure_delayed FROM households h WHERE EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=h.id AND m.subject=? AND m.active=1) OR EXISTS(SELECT 1 FROM household_allocations x WHERE x.household_id=h.id AND x.subject=?) OR EXISTS(SELECT 1 FROM household_releases x WHERE x.household_id=h.id AND x.subject=?) ORDER BY h.id", &[account.subject.clone(),account.subject.clone(),account.subject.clone()]).await?;
        let mut households = Vec::new();
        for h in rows {
            households.push(self.summary(&h, &account.subject).await?);
        }
        let limits = capacity::structural_limits(&self.0.db).await?;
        let mut personal_usage = capacity::usage(&self.0.db, &account.subject).await?;
        personal_usage.households = households.iter().filter(|h| h.is_head).count() as u64;
        Ok(AccountOverview {
            max_items_per_collection: limits.max_items_per_collection,
            max_sections_per_collection: limits.max_sections_per_collection,
            identity: identity(account.public_id.clone(), account.display_name.clone()).into(),
            plan: account.plan()?.into(),
            personal_capacity: capacity::personal_capacity(&self.0.db, account)
                .await?
                .into(),
            personal_usage: personal_usage.into(),
            households,
            plan_configured: account.plan_revision > 0,
            ..Default::default()
        })
    }
    async fn details(&self, id: &str, subject: &str) -> Result<HouseholdDetails, ConnectError> {
        let h = self.require_head(id, subject).await?;
        let rows=self.0.db.query::<HeadRow>("SELECT a.subject,a.public_id,a.display_name,m.ceilings_json FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE m.household_id=? AND m.active=1 ORDER BY a.public_id", &[id.into()]).await?;
        let mut heads = Vec::new();
        for row in rows {
            heads.push(HouseholdHead {
                identity: identity(row.public_id, row.display_name).into(),
                ceilings: serde_json::from_str::<Amounts>(&row.ceilings_json)
                    .map_err(|_| ConnectError::internal("Invalid member ceilings."))?
                    .counts_only()
                    .into(),
                usage: self.creator_usage(&h.scope_sub, &row.subject).await?.into(),
                ..Default::default()
            });
        }
        let rows=self.0.db.query::<AllocationRow>("SELECT a.public_id,a.display_name,x.amounts_json,EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=x.household_id AND m.subject=x.subject AND m.active=1) AS is_head FROM household_allocations x JOIN pilot_accounts a ON a.subject=x.subject WHERE x.household_id=? ORDER BY a.public_id", &[id.into()]).await?;
        let contributions = rows
            .into_iter()
            .map(|row| {
                Ok(HouseholdContribution {
                    identity: identity(row.public_id, row.display_name).into(),
                    capacity: serde_json::from_str::<Amounts>(&row.amounts_json)
                        .map_err(|_| ConnectError::internal("Invalid contribution."))?
                        .into(),
                    is_head: row.is_head != 0,
                    ..Default::default()
                })
            })
            .collect::<Result<Vec<_>, ConnectError>>()?;
        #[derive(Deserialize)]
        struct Invitation {
            id: String,
            public_id: String,
            display_name: String,
            status: String,
            expires_at: i64,
        }
        let invitations = self.0.db.query::<Invitation>(
            "SELECT i.id,a.public_id,a.display_name,CASE WHEN i.status='pending' AND i.expires_at<=CAST(? AS INTEGER) THEN 'expired' ELSE i.status END AS status,i.expires_at FROM household_invitations i JOIN pilot_accounts a ON a.subject=i.recipient_sub WHERE i.household_id=? ORDER BY i.id",
            &[self.clock_now().to_string(), id.into()],
        ).await?.into_iter().map(|i| HouseholdInvitation {
            id: i.id, recipient: identity(i.public_id, i.display_name).into(),
            status: i.status, expires_at: i.expires_at, ..Default::default()
        }).collect();
        let pending_content_erasure = self.pending_content_erasure(id).await?;
        Ok(HouseholdDetails {
            pending_content_erasure: pending_content_erasure.into(),
            invitations,
            closure_erase_due_at: self.closure_cutoff().await?,
            household: self.summary(&h, subject).await?.into(),
            capacity: capacity::household_capacity(&self.0.db, id).await?.into(),
            usage: capacity::usage(&self.0.db, &h.scope_sub).await?.into(),
            heads,
            contributions,
            ..Default::default()
        })
    }
    async fn creator_usage(&self, scope: &str, subject: &str) -> Result<Amounts, ConnectError> {
        let rows=self.0.db.query::<Amounts>("SELECT (SELECT count(*) FROM collections WHERE owner_sub=? AND creator_sub=? AND kind=1)+(SELECT count(*) FROM list_items WHERE owner_sub=? AND creator_sub=?) AS items,(SELECT count(*) FROM collections WHERE owner_sub=? AND creator_sub=? AND kind=2) AS shopping,(SELECT count(*) FROM collections WHERE owner_sub=? AND creator_sub=? AND kind=3) AS templates,(SELECT count(*) FROM collections WHERE owner_sub=? AND creator_sub=? AND kind=4) AS runs,0 AS bytes,0 AS households", &[scope.into(),subject.into(),scope.into(),subject.into(),scope.into(),subject.into(),scope.into(),subject.into(),scope.into(),subject.into()]).await?;
        Ok(rows.into_iter().next().unwrap_or_default())
    }
    async fn receipt(
        &self,
        subject: &str,
        operation: &str,
    ) -> Result<Option<Receipt>, ConnectError> {
        Ok(self.0.db.query::<Receipt>("SELECT fingerprint,household_id,result_id FROM household_operations WHERE actor_sub=? AND operation_id=?", &[subject.into(),operation.into()]).await?.pop())
    }
    async fn change(
        &self,
        account: &Account,
        r: HouseholdChange,
    ) -> Result<HouseholdMutationResult, ConnectError> {
        if !valid_id(&r.operation_id) || !valid_id(&r.household_id) {
            return Err(ConnectError::invalid_argument(
                "Use fresh UUIDs for household and operation identities.",
            ));
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&r)
                    .map_err(|_| ConnectError::invalid_argument("Invalid change."))?
            )
        );
        if let Some(receipt) = self.receipt(&account.subject, &r.operation_id).await? {
            if receipt.fingerprint != fingerprint {
                return Err(changed());
            }
            self.protect_closure(&account.subject, &r.operation_id)
                .await?;
            return Ok(HouseholdMutationResult {
                household_id: receipt.household_id,
                invitation_id: receipt.result_id,
                ..Default::default()
            });
        }
        if r.action.as_known() == Some(HouseholdAction::EraseContent) {
            return self.erase_content(account, &r, &fingerprint).await;
        }
        if r.action.as_known() != Some(HouseholdAction::Create) {
            let result = self.change_membership(account, &r, &fingerprint).await?;
            self.protect_closure(&account.subject, &r.operation_id)
                .await?;
            return Ok(result);
        }
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
        let amounts = Amounts::from(&*r.amounts);
        amounts.validate()?;
        if amounts.bytes < name.len() as u64 {
            return Err(ConnectError::resource_exhausted(
                "Allocate enough storage to retain the household name.",
            ));
        }
        if amounts.households != 0 {
            return Err(ConnectError::invalid_argument(
                "Household membership limits cannot be allocated.",
            ));
        }
        if account.plan_revision == 0 {
            return Err(ConnectError::failed_precondition(
                "The operator must assign this account's finite pilot plan first.",
            ));
        }
        capacity::personal_capacity(&self.0.db, account)
            .await?
            .subtract(&amounts)?;
        let subject = &account.subject;
        let scope = format!("household:{}", r.household_id);
        let no_receipt =
            "NOT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=?)";
        let created =
            "EXISTS(SELECT 1 FROM households WHERE id=? AND created_by=? AND last_operation=?)";
        let mut writes = vec![
            Statement::new(
                &format!(
                    "INSERT INTO households(id,scope_sub,name,created_by,last_operation) SELECT ?,?,?,?,? WHERE {no_receipt} ON CONFLICT(id) DO NOTHING"
                ),
                vec![
                    r.household_id.clone(),
                    scope,
                    name.into(),
                    subject.clone(),
                    r.operation_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                ],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO household_heads(household_id,subject,ceilings_json) SELECT ?,?,? WHERE {created} AND {no_receipt} ON CONFLICT(household_id,subject) DO NOTHING"
                ),
                vec![
                    r.household_id.clone(),
                    subject.clone(),
                    amounts.clone().counts_only().json(),
                    r.household_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                ],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO household_allocations(household_id,subject,amounts_json) SELECT ?,?,? WHERE {created} AND {no_receipt} ON CONFLICT(household_id,subject) DO NOTHING"
                ),
                vec![
                    r.household_id.clone(),
                    subject.clone(),
                    amounts.json(),
                    r.household_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                ],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO household_activity(household_id,actor_sub,action) SELECT ?,?,'Created household' WHERE {created} AND {no_receipt}"
                ),
                vec![
                    r.household_id.clone(),
                    subject.clone(),
                    r.household_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                ],
            ),
            Statement::new(
                &format!(
                    "INSERT INTO household_operations(actor_sub,operation_id,fingerprint,household_id) SELECT ?,?,?,? WHERE {created} ON CONFLICT(actor_sub,operation_id) DO NOTHING"
                ),
                vec![
                    subject.clone(),
                    r.operation_id.clone(),
                    fingerprint.clone(),
                    r.household_id.clone(),
                    r.household_id.clone(),
                    subject.clone(),
                    r.operation_id.clone(),
                ],
            ),
            capacity::account_guard(subject),
            Statement::new(
                "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=? AND operation_id=? AND fingerprint=?)",
                vec![subject.clone(), r.operation_id.clone(), fingerprint.clone()],
            ),
        ];
        writes.push(Statement::new("DELETE FROM invariant_guards", vec![]));
        self.0.db.batch(&writes).await.map_err(|error| {
            if error.code == connectrpc::ErrorCode::Unavailable {
                error
            } else {
                changed()
            }
        })?;
        Ok(HouseholdMutationResult {
            household_id: r.household_id,
            ..Default::default()
        })
    }
}
#[allow(refining_impl_trait)]
impl HouseholdService for Households {
    async fn get_overview(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<AccountOverview> {
        let session = self.0.authorize_rpc(&ctx).await?;
        let a = capacity::account(&self.0.db, &session.user_sub).await?;
        Response::ok(self.overview(&a).await?)
    }
    async fn get_household(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdKey>,
    ) -> ServiceResult<HouseholdDetails> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Response::ok(self.details(r.id, &session.user_sub).await?)
    }
    async fn change_household(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdChange>,
    ) -> ServiceResult<HouseholdMutationResult> {
        let session = self.0.authorize_rpc(&ctx).await?;
        let a = capacity::account(&self.0.db, &session.user_sub).await?;
        Response::ok(self.change(&a, r.to_owned_message()).await?)
    }
    async fn preview_allocation(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, AllocationRequest>,
    ) -> ServiceResult<AllocationPreview> {
        let session = self.0.authorize_rpc(&ctx).await?;
        let account = capacity::account(&self.0.db, &session.user_sub).await?;
        Response::ok(
            self.allocation_preview(
                &account,
                r.household_id,
                Amounts::from(&*r.to_owned_message().amounts),
            )
            .await?,
        )
    }
    async fn get_invitation(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, InvitationKey>,
    ) -> ServiceResult<InvitationPreview> {
        let session = self.0.authorize_rpc(&ctx).await?;
        Response::ok(self.invitation_preview(r.token, &session.user_sub).await?)
    }
    async fn preview_copy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, CopyRequest>,
    ) -> ServiceResult<CopyPreview> {
        let session = self.0.authorize_rpc(&ctx).await?;
        let h = self.require_head(r.household_id, &session.user_sub).await?;
        let lists = crate::lists::Lists(
            self.0.clone(),
            crate::lists::Scope {
                owner: h.scope_sub,
                actor: session.user_sub,
            },
        );
        Response::ok(lists.preview_personal_copy(&r.to_owned_message()).await?)
    }
    async fn copy_collection(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, CopyRequest>,
    ) -> ServiceResult<ChangeResult> {
        let session = self.0.authorize_rpc(&ctx).await?;
        let h = self.require_head(r.household_id, &session.user_sub).await?;
        let lists = crate::lists::Lists(
            self.0.clone(),
            crate::lists::Scope {
                owner: h.scope_sub,
                actor: session.user_sub,
            },
        );
        Response::ok(lists.copy_personal(&r.to_owned_message()).await?)
    }
    async fn list_household_activity(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, HouseholdActivityQuery>,
    ) -> ServiceResult<HouseholdActivityPage> {
        let session = self.0.authorize_rpc(&ctx).await?;
        self.require_head(r.household_id, &session.user_sub).await?;
        if r.before_sequence > i64::MAX as u64 {
            return Err(ConnectError::invalid_argument("Invalid History cursor."));
        }
        #[derive(Deserialize)]
        struct Entry {
            sequence: u64,
            public_id: String,
            display_name: String,
            action: String,
            occurred_at: i64,
            details_json: String,
        }
        let rows = self.0.db.query::<Entry>(
            "SELECT e.sequence,coalesce(a.public_id,'') AS public_id,CASE WHEN e.actor_sub='system:operator' THEN 'Operator' ELSE coalesce(a.display_name,'Former head') END AS display_name,e.action,e.occurred_at,e.details_json FROM household_activity e LEFT JOIN pilot_accounts a ON a.subject=e.actor_sub WHERE e.household_id=? AND (CAST(? AS INTEGER)=0 OR e.sequence<CAST(? AS INTEGER)) ORDER BY e.sequence DESC LIMIT 51",
            &[r.household_id.into(), r.before_sequence.to_string(), r.before_sequence.to_string()],
        ).await?;
        // Recheck after the read so a revoked head cannot keep paging History.
        self.require_head(r.household_id, &session.user_sub).await?;
        let more = rows.len() > 50;
        let entries: Vec<_> = rows
            .into_iter()
            .take(50)
            .map(|e| HouseholdActivityEntry {
                sequence: e.sequence,
                actor: identity(e.public_id, e.display_name).into(),
                action: e.action,
                occurred_at: e.occurred_at,
                details_json: e.details_json,
                ..Default::default()
            })
            .collect();
        let next_before_sequence = if more {
            entries.last().map_or(0, |e| e.sequence)
        } else {
            0
        };
        Response::ok(HouseholdActivityPage {
            entries,
            next_before_sequence,
            ..Default::default()
        })
    }
}
