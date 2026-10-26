//! Site-wide metadata is separate from household authority and private content.
mod access;
mod audit;
pub(crate) use audit::record_resource_rejection;
mod email;
mod growth;
mod policy;
use crate::{auth::SharedAuth, capacity, proto::life::v1::*};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde::Deserialize;

pub(crate) struct Administration(pub SharedAuth);
#[derive(Deserialize)]
struct AccountRow {
    subject: String,
    public_id: String,
    display_name: String,
    approved: i32,
    active_households: u64,
    access_revision: u64,
    protection_pending: i32,
    usage_json: String,
}
const USAGE_JSON_SQL: &str = "json_object('items',coalesce(u.items,0),'shopping',coalesce(u.shopping,0),'templates',coalesce(u.templates,0),'runs',coalesce(u.runs,0),'bytes',coalesce(u.bytes,0),'households',coalesce(u.households,0)) AS usage_json";
fn account_projection() -> String {
    let usage = USAGE_JSON_SQL.replace("coalesce(u.households,0)", capacity::NORMAL_HOUSEHOLDS_SQL);
    format!(
        "SELECT a.subject,a.public_id,a.display_name,a.approved,a.access_revision,{usage},EXISTS(SELECT 1 FROM site_security_outbox x WHERE x.public_id=a.public_id AND x.scope='account_access' AND x.published=0) AS protection_pending,(SELECT count(*) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.subject=a.subject AND m.active=1 AND h.status='active') AS active_households FROM pilot_accounts a LEFT JOIN space_usage u ON u.owner_sub=a.subject"
    )
}
impl AccountRow {
    fn into_admin(self, owner: &str) -> Result<AdminAccount, ConnectError> {
        let usage = serde_json::from_str::<capacity::Amounts>(&self.usage_json)
            .map_err(|_| ConnectError::internal("Usage measurements are unavailable."))?;
        Ok(AdminAccount {
            id: self.public_id,
            display_name: self.display_name,
            suspended: self.approved == 0,
            personal_usage: usage.into(),
            active_households: self.active_households,
            access_revision: self.access_revision,
            protection_pending: self.protection_pending != 0,
            site_owner: self.subject == owner,
            ..Default::default()
        })
    }
}
#[derive(Deserialize)]
struct HouseholdRow {
    id: String,
    name: String,
    status: String,
    active_heads: u64,
    usage_json: String,
}
#[allow(refining_impl_trait)]
impl AccountAdminService for Administration {
    async fn list_audit(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, AdminAuditQuery>,
    ) -> ServiceResult<AdminAuditPage> {
        self.require_owner(&ctx).await?;
        Response::ok(self.audit(&r.to_owned_message()).await?)
    }
    async fn clear_email_suppression(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, EmailSuppressionClear>,
    ) -> ServiceResult<Empty> {
        let session = self.require_owner(&ctx).await?;
        self.clear_suppression(&session.user_sub, &r.to_owned_message())
            .await?;
        Response::ok(Empty::default())
    }
    async fn get_email_operations(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, EmailOperationsQuery>,
    ) -> ServiceResult<EmailOperationsOverview> {
        self.require_owner(&ctx).await?;
        Response::ok(self.email_operations(&r.to_owned_message()).await?)
    }
    async fn set_account_access(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, AccountAccessChange>,
    ) -> ServiceResult<AdminAccount> {
        let session = self.require_owner(&ctx).await?;
        Response::ok(
            self.change_access(&session.user_sub, &r.to_owned_message())
                .await?,
        )
    }
    async fn get_growth(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<GrowthState> {
        self.require_owner(&ctx).await?;
        Response::ok(self.growth().await?)
    }
    async fn change_growth(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, GrowthChange>,
    ) -> ServiceResult<GrowthState> {
        let session = self.require_owner(&ctx).await?;
        Response::ok(
            self.set_growth(&session.user_sub, &r.to_owned_message())
                .await?,
        )
    }
    async fn get_policy(
        &self,
        ctx: RequestContext,
        _r: ServiceRequest<'_, Empty>,
    ) -> ServiceResult<SiteSafetyPolicy> {
        self.require_owner(&ctx).await?;
        Response::ok(self.policy().await?)
    }
    async fn preview_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, SitePolicyChange>,
    ) -> ServiceResult<SitePolicyReview> {
        self.require_owner(&ctx).await?;
        Response::ok(self.review_policy(&r.to_owned_message()).await?)
    }
    async fn apply_policy(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, SitePolicyChange>,
    ) -> ServiceResult<SiteSafetyPolicy> {
        let session = self.require_owner(&ctx).await?;
        Response::ok(
            self.change_policy(&session.user_sub, &r.to_owned_message())
                .await?,
        )
    }
    async fn get_overview(
        &self,
        ctx: RequestContext,
        r: ServiceRequest<'_, AdminOverviewQuery>,
    ) -> ServiceResult<AdminOverview> {
        self.require_owner(&ctx).await?;
        let r = r.to_owned_message();
        if r.page_size > 100
            || (!r.after_account.is_empty()
                && (r.after_account.len() != 32
                    || !r.after_account.bytes().all(|b| b.is_ascii_hexdigit())))
            || (!r.after_household.is_empty() && !crate::lists::valid_id(&r.after_household))
        {
            return Err(ConnectError::invalid_argument("Invalid overview page."));
        }
        let size = if r.page_size == 0 {
            50
        } else {
            r.page_size as usize
        };
        let usage_json = USAGE_JSON_SQL;
        let mut rows = self
            .0
            .db
            .query::<AccountRow>(
                &format!(
                    "{} WHERE a.public_id>? ORDER BY a.public_id LIMIT ?",
                    account_projection()
                ),
                &[r.after_account, (size + 1).to_string()],
            )
            .await?;
        let more = rows.len() > size;
        rows.truncate(size);
        let next_account = if more {
            rows.last().map(|r| r.public_id.clone()).unwrap_or_default()
        } else {
            String::new()
        };
        let parse_usage = |json: &str| {
            serde_json::from_str::<capacity::Amounts>(json)
                .map_err(|_| ConnectError::internal("Usage measurements are unavailable."))
        };
        let accounts = rows
            .into_iter()
            .map(|row| row.into_admin(&self.0.config.owner_sub))
            .collect::<Result<Vec<_>, _>>()?;
        let mut rows = self.0.db.query::<HouseholdRow>(&format!("SELECT h.id,h.name,h.status,{usage_json},(SELECT count(*) FROM household_heads m WHERE m.household_id=h.id AND m.active=1) AS active_heads FROM households h LEFT JOIN space_usage u ON u.owner_sub=h.scope_sub WHERE h.status<>'erased' AND h.id>? ORDER BY h.id LIMIT ?"), &[r.after_household,(size+1).to_string()]).await?;
        let more = rows.len() > size;
        rows.truncate(size);
        let next_household = if more {
            rows.last().map(|r| r.id.clone()).unwrap_or_default()
        } else {
            String::new()
        };
        let mut households = Vec::new();
        for row in rows {
            households.push(AdminHousehold {
                id: row.id,
                name: row.name,
                status: row.status,
                usage: parse_usage(&row.usage_json)?.into(),
                active_heads: row.active_heads,
                ..Default::default()
            });
        }
        #[derive(Deserialize)]
        struct Totals {
            accounts: u64,
            suspended: u64,
            active: u64,
            closed: u64,
            bytes: u64,
            pending_security: u64,
            pending_closures: u64,
            pending_content: u64,
        }
        let total = self.0.db.query::<Totals>("SELECT (SELECT count(*) FROM pilot_accounts) AS accounts,(SELECT count(*) FROM pilot_accounts WHERE approved=0) AS suspended,(SELECT count(*) FROM households WHERE status='active') AS active,(SELECT count(*) FROM households WHERE status IN('closed','erasing')) AS closed,(SELECT coalesce(sum(bytes),0) FROM space_usage) AS bytes,(SELECT count(*) FROM site_security_outbox WHERE published=0) AS pending_security,(SELECT count(*) FROM household_lifecycle WHERE closure_published=0) AS pending_closures,(SELECT count(*) FROM household_content_erasures WHERE completed=0) AS pending_content", &[]).await?.pop().ok_or_else(||ConnectError::internal("Usage totals are unavailable."))?;
        #[derive(Deserialize)]
        struct Sample {
            sampled_at: i64,
            account_count: u64,
            household_count: u64,
            logical_bytes: u64,
        }
        let now = crate::auth::now();
        let sample = self.0.db.query::<Sample>("SELECT sampled_at,account_count,household_count,logical_bytes FROM site_usage_samples WHERE sampled_at<=CAST(? AS INTEGER) AND sampled_at>=CAST(? AS INTEGER) AND normal_enabled=(SELECT enabled FROM site_safety_policy WHERE id=1) ORDER BY sampled_at LIMIT 1",&[now.saturating_sub(86400).to_string(),now.saturating_sub(7*86400).to_string()]).await?.pop();
        let difference = |current: u64, previous: u64| {
            i64::try_from(i128::from(current) - i128::from(previous))
                .map_err(|_| ConnectError::internal("Growth measurements are unavailable."))
        };
        let (growth_status, growth_since, logical_byte_change, account_change, household_change) =
            if let Some(sample) = sample {
                (
                    "measured".to_string(),
                    sample.sampled_at,
                    difference(total.bytes, sample.logical_bytes)?,
                    difference(total.accounts, sample.account_count)?,
                    difference(total.active + total.closed, sample.household_count)?,
                )
            } else {
                ("insufficient_history".to_string(), 0, 0, 0, 0)
            };
        Response::ok(AdminOverview {
            accounts,
            households,
            logical_bytes: total.bytes,
            account_count: total.accounts,
            suspended_account_count: total.suspended,
            active_household_count: total.active,
            closed_household_count: total.closed,
            pending_security_changes: total.pending_security,
            pending_closures: total.pending_closures,
            pending_content_erasures: total.pending_content,
            next_account,
            next_household,
            growth_status,
            growth_since,
            logical_byte_change,
            account_change,
            household_change,
            provider_usage_status: "unavailable".into(),
            ..Default::default()
        })
    }
}
