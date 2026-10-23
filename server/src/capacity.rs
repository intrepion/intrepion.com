use crate::{
    db::{Database, Statement},
    proto::life::v1::ResourceAmounts,
};
use connectrpc::ConnectError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct Amounts {
    pub items: u64,
    pub shopping: u64,
    pub templates: u64,
    pub runs: u64,
    pub bytes: u64,
    pub households: u64,
}
pub(crate) const RESOURCES: [&str; 5] = ["items", "shopping", "templates", "runs", "bytes"];
impl From<Amounts> for ResourceAmounts {
    fn from(a: Amounts) -> Self {
        Self {
            items: a.items,
            shopping: a.shopping,
            templates: a.templates,
            runs: a.runs,
            bytes: a.bytes,
            households: a.households,
            ..Default::default()
        }
    }
}
impl From<&ResourceAmounts> for Amounts {
    fn from(a: &ResourceAmounts) -> Self {
        Self {
            items: a.items,
            shopping: a.shopping,
            templates: a.templates,
            runs: a.runs,
            bytes: a.bytes,
            households: a.households,
        }
    }
}
impl Amounts {
    pub fn counts_only(mut self) -> Self {
        self.bytes = 0;
        self.households = 0;
        self
    }
    pub fn json(&self) -> String {
        serde_json::to_string(self).expect("finite resource amounts")
    }
    pub fn validate(&self) -> Result<(), ConnectError> {
        if [
            self.items,
            self.shopping,
            self.templates,
            self.runs,
            self.bytes,
            self.households,
        ]
        .iter()
        .any(|v| *v > 9_007_199_254_740_991)
        {
            return Err(ConnectError::invalid_argument(
                "Resource amounts must be non-negative safe whole numbers.",
            ));
        }
        Ok(())
    }
    pub fn values(&self) -> [u64; 5] {
        [
            self.items,
            self.shopping,
            self.templates,
            self.runs,
            self.bytes,
        ]
    }
    pub fn subtract(&self, other: &Self) -> Result<Self, ConnectError> {
        let a = self.values();
        let b = other.values();
        let mut v = [0; 5];
        for i in 0..5 {
            v[i] = a[i].checked_sub(b[i]).ok_or_else(|| {
                ConnectError::failed_precondition(
                    "Allocations exceed this account's plan. Contact the operator.",
                )
            })?;
        }
        Ok(Self {
            items: v[0],
            shopping: v[1],
            templates: v[2],
            runs: v[3],
            bytes: v[4],
            households: self.households,
        })
    }
}
#[derive(Deserialize)]
pub(crate) struct Account {
    pub subject: String,
    pub public_id: String,
    pub display_name: String,
    pub plan_json: String,
    pub plan_revision: u64,
}
impl Account {
    pub fn plan(&self) -> Result<Amounts, ConnectError> {
        serde_json::from_str(&self.plan_json)
            .map_err(|_| ConnectError::internal("Invalid operator plan configuration."))
    }
}
pub(crate) async fn account(db: &Database, subject: &str) -> Result<Account, ConnectError> {
    db.query::<Account>("SELECT subject,public_id,display_name,plan_json,plan_revision FROM pilot_accounts WHERE subject=? AND approved=1", &[subject.into()]).await?.pop().ok_or_else(||ConnectError::permission_denied("This account no longer has pilot access."))
}
pub(crate) async fn usage(db: &Database, scope: &str) -> Result<Amounts, ConnectError> {
    Ok(db.query::<Amounts>("SELECT items,shopping,templates,runs,bytes,households FROM space_usage WHERE owner_sub=?", &[scope.into()]).await?.pop().unwrap_or_default())
}
pub(crate) async fn personal_capacity(
    db: &Database,
    account: &Account,
) -> Result<Amounts, ConnectError> {
    let expressions = RESOURCES
        .map(|key| format!("coalesce(sum(json_extract(x.amounts_json,'$.{key}')),0) AS {key}"));
    let reserved=db.query::<Amounts>(&format!("SELECT {},0 AS households FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=? AND h.status<>'erased'",expressions.join(",")),std::slice::from_ref(&account.subject)).await?.pop().unwrap_or_default();
    account.plan()?.subtract(&reserved)
}
// Correlated SQL is evaluated inside the same D1 transaction as the allocation.
// A Rust preflight alone would race with another household reserving this plan.
fn account_resource_checks() -> [String; 5] {
    RESOURCES.map(|key|format!("coalesce((SELECT {key} FROM space_usage WHERE owner_sub=a.subject),0)+coalesce((SELECT sum(json_extract(x.amounts_json,'$.{key}')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0)<=json_extract(a.plan_json,'$.{key}')"))
}
pub(crate) fn account_guard(subject: &str) -> Statement {
    let checks = account_resource_checks();
    Statement::new(
        &format!(
            "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=1 AND a.plan_revision>0 AND {} AND (SELECT count(*) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE m.subject=a.subject AND m.active=1 AND h.status='active')<=json_extract(a.plan_json,'$.households'))",
            checks.join(" AND ")
        ),
        vec![subject.into()],
    )
}
pub(crate) async fn household_capacity(db: &Database, id: &str) -> Result<Amounts, ConnectError> {
    let expressions = RESOURCES
        .map(|key| format!("coalesce(sum(json_extract(x.amounts_json,'$.{key}')),0) AS {key}"));
    Ok(db.query::<Amounts>(&format!("SELECT {},0 AS households FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE h.id=? AND h.status<>'erased'",expressions.join(",")), &[id.into()]).await?.pop().unwrap_or_default())
}

impl From<Amounts> for buffa::MessageField<ResourceAmounts, buffa::Inline<ResourceAmounts>> {
    fn from(amounts: Amounts) -> Self {
        ResourceAmounts::from(amounts).into()
    }
}

pub(crate) const LIMIT_ERRORS: [(&str, &str); 11] = [
    (
        "space_items_allowance",
        "The space's retained-item allowance is full. Trash still counts; add capacity or permanently erase retained content.",
    ),
    (
        "space_shopping_allowance",
        "The space's retained shopping-list allowance is full.",
    ),
    (
        "space_templates_allowance",
        "The space's retained template allowance is full.",
    ),
    (
        "space_runs_allowance",
        "The space's retained run allowance is full.",
    ),
    (
        "space_bytes_allowance",
        "The space's storage allowance cannot retain this content and its new History. Your change was not saved.",
    ),
    (
        "member_items_allowance",
        "Your individual retained-item ceiling is full. Change your own ceiling or reduce retained usage.",
    ),
    (
        "member_shopping_allowance",
        "Your individual shopping-list ceiling is full.",
    ),
    (
        "member_templates_allowance",
        "Your individual template ceiling is full.",
    ),
    (
        "member_runs_allowance",
        "Your individual run ceiling is full.",
    ),
    (
        "collection_items_allowance",
        "The per-collection retained-item cap is full. Pooled capacity does not raise this cap.",
    ),
    (
        "collection_sections_allowance",
        "The per-collection section cap is full. Pooled capacity does not raise this cap.",
    ),
];
pub(crate) fn snapshot(scope: &str, actor: &str, collection: &str) -> Statement {
    let usage = RESOURCES
        .iter()
        .map(|k| format!("'{k}',u.{k}"))
        .collect::<Vec<_>>()
        .join(",");
    let own = RESOURCES
        .iter()
        .filter(|k| **k != "bytes")
        .map(|k| format!("'{k}',coalesce(o.{k},0)"))
        .collect::<Vec<_>>()
        .join(",");
    Statement::new(
        &format!(
            "WITH target AS(SELECT ? AS owner_sub,? AS actor_sub,? AS collection_id) INSERT INTO write_budgets(id,owner_sub,actor_sub,collection_id,usage_json,own_json,structure_json) SELECT 1,t.owner_sub,t.actor_sub,t.collection_id,json_object({usage}),json_object({own}),json_object('items',(SELECT count(*) FROM list_items WHERE owner_sub=t.owner_sub AND collection_id=t.collection_id),'sections',(SELECT count(*) FROM list_sections WHERE owner_sub=t.owner_sub AND collection_id=t.collection_id)) FROM target t JOIN space_usage u ON u.owner_sub=t.owner_sub LEFT JOIN creator_usage o ON o.owner_sub=t.owner_sub AND o.creator_sub=t.actor_sub"
        ),
        vec![scope.into(), actor.into(), collection.into()],
    )
}
pub(crate) fn content_checks() -> Vec<Statement> {
    let space=RESOURCES.map(|k|format!("NOT EXISTS(SELECT 1 FROM write_budgets b JOIN space_usage u ON u.owner_sub=b.owner_sub JOIN space_capacity c ON c.owner_sub=b.owner_sub WHERE u.{k}>c.{k} AND u.{k}>json_extract(b.usage_json,'$.{k}'))"));
    let member=RESOURCES.iter().filter(|k|**k!="bytes").map(|k|format!("NOT EXISTS(SELECT 1 FROM write_budgets b JOIN creator_usage u ON u.owner_sub=b.owner_sub AND u.creator_sub=b.actor_sub JOIN households h ON h.scope_sub=b.owner_sub JOIN household_heads m ON m.household_id=h.id AND m.subject=b.actor_sub WHERE u.{k}>json_extract(m.ceilings_json,'$.{k}') AND u.{k}>json_extract(b.own_json,'$.{k}'))")).collect::<Vec<_>>();
    vec![
        Statement::new(
            "INSERT INTO invariant_guards(valid) SELECT count(*)=1 FROM write_budgets",
            vec![],
        ),
        Statement::new(
            &format!(
                "INSERT INTO limit_guards(space_items,space_shopping,space_templates,space_runs,space_bytes) SELECT {}",
                space.join(",")
            ),
            vec![],
        ),
        Statement::new(
            &format!(
                "INSERT INTO limit_guards(member_items,member_shopping,member_templates,member_runs) SELECT {}",
                member.join(",")
            ),
            vec![],
        ),
        Statement::new(
            "INSERT INTO limit_guards(collection_items,collection_sections) SELECT NOT EXISTS(SELECT 1 FROM write_budgets b JOIN operator_settings s ON s.id=1 WHERE (SELECT count(*) FROM list_items WHERE owner_sub=b.owner_sub AND collection_id=b.collection_id)>s.max_items_per_collection AND (SELECT count(*) FROM list_items WHERE owner_sub=b.owner_sub AND collection_id=b.collection_id)>json_extract(b.structure_json,'$.items')),NOT EXISTS(SELECT 1 FROM write_budgets b JOIN operator_settings s ON s.id=1 WHERE (SELECT count(*) FROM list_sections WHERE owner_sub=b.owner_sub AND collection_id=b.collection_id)>s.max_sections_per_collection AND (SELECT count(*) FROM list_sections WHERE owner_sub=b.owner_sub AND collection_id=b.collection_id)>json_extract(b.structure_json,'$.sections'))",
            vec![],
        ),
        Statement::new("DELETE FROM write_budgets", vec![]),
        Statement::new("DELETE FROM limit_guards", vec![]),
    ]
}

impl Amounts {
    pub fn add(&self, other: &Self) -> Result<Self, ConnectError> {
        let a = self.values();
        let b = other.values();
        let mut v = [0; 5];
        for i in 0..5 {
            v[i] = a[i].checked_add(b[i]).ok_or_else(|| {
                ConnectError::resource_exhausted(
                    "Combined capacity exceeds the supported integer range.",
                )
            })?;
        }
        Ok(Self {
            items: v[0],
            shopping: v[1],
            templates: v[2],
            runs: v[3],
            bytes: v[4],
            households: self.households,
        })
    }
}
pub(crate) fn allocation_account_guard(subject: &str) -> Statement {
    let checks = account_resource_checks();
    Statement::new(
        &format!(
            "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=1 AND a.plan_revision>0 AND {})",
            checks.join(" AND ")
        ),
        vec![subject.into()],
    )
}
pub(crate) fn household_source_guard(id: &str) -> Statement {
    let checks = RESOURCES.map(|key| format!("u.{key}<=c.{key}"));
    Statement::new(
        &format!(
            "INSERT INTO invariant_guards(valid) SELECT EXISTS(SELECT 1 FROM households h JOIN space_usage u ON u.owner_sub=h.scope_sub JOIN space_capacity c ON c.owner_sub=h.scope_sub WHERE h.id=? AND h.status='active' AND {})",
            checks.join(" AND ")
        ),
        vec![id.into()],
    )
}

#[derive(Deserialize)]
pub(crate) struct StructuralLimits {
    pub max_items_per_collection: u64,
    pub max_sections_per_collection: u64,
}
pub(crate) async fn structural_limits(db: &Database) -> Result<StructuralLimits, ConnectError> {
    db.query::<StructuralLimits>("SELECT max_items_per_collection,max_sections_per_collection FROM operator_settings WHERE id=1", &[]).await?.pop().ok_or_else(||ConnectError::failed_precondition("The operator must configure finite structural limits before launch."))
}
pub(crate) async fn creator_usage(
    db: &Database,
    scope: &str,
    actor: &str,
) -> Result<Amounts, ConnectError> {
    Ok(db.query::<Amounts>("SELECT items,shopping,templates,runs,bytes,households FROM creator_usage WHERE owner_sub=? AND creator_sub=?", &[scope.into(),actor.into()]).await?.pop().unwrap_or_default())
}
