// Read-only compatibility fence. The first MVP 3 upgrade uses the separately
// reviewed stopped-service procedure, never the ordinary migration step.
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const maintenanceRequired = () =>
  new Error(
    "MVP 3 requires its completed maintenance upgrade and policy bootstrap before normal deployment. Follow docs/mvp-3-release.md; do not migrate underneath the old API.",
  );
try {
  const account = required("CLOUDFLARE_ACCOUNT_ID");
  const database = required("D1_DATABASE_ID");
  if (
    !/^[a-f0-9]{32}$/.test(account) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(database)
  )
    throw new Error("Invalid database identifiers.");
  const token = required("CLOUDFLARE_API_TOKEN");
  async function query(sql, params = []) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!response.ok) throw new Error("Database preflight failed.");
    const body = await response.json();
    if (
      !body.success ||
      body.result?.length !== 1 ||
      !body.result[0].success ||
      !Array.isArray(body.result[0].results)
    )
      throw new Error("Database preflight failed.");
    return body.result[0].results;
  }
  const anchors = {
    table: [
      "tasks",
      "sessions",
      "login_challenges",
      "retired_task_ids",
      "collections",
      "list_items",
      "list_sections",
      "collection_history",
      "collection_operations",
      "retired_list_ids",
      "erasure_intents",
      "pilot_accounts",
      "households",
      "household_heads",
      "household_allocations",
      "household_invitations",
      "household_operations",
      "household_activity",
      "invariant_guards",
      "operator_settings",
      "write_budgets",
      "limit_guards",
      "household_lifecycle",
      "closed_household_ids",
      "household_releases",
      "household_content_erasures",
      "pilot_operator_operations",
      "d1_migrations",
    ],
    view: ["space_usage", "creator_usage", "space_capacity"],
    index: ["one_pending_household_erasure"],
    trigger: [
      "remember_deleted_task",
      "tasks_replaced_insert",
      "tasks_replaced_update",
      "tasks_replaced_delete",
      "no_retired_collection",
      "no_retired_item",
      "no_retired_section",
      "distinct_collection_identity",
      "distinct_item_identity",
      "distinct_section_identity",
      "intent_requires_unused_operation",
      "receipt_requires_matching_intent",
      "budget_collections_insert",
      "budget_collections_update",
      "budget_list_items_insert",
      "budget_list_items_update",
      "budget_list_sections_insert",
      "budget_list_sections_update",
      "budget_collection_history_insert",
      "budget_collection_history_update",
      "no_closed_household_insert",
      "no_household_reopening",
      "content_erasure_requires_unused_operation",
      "household_receipt_requires_matching_erasure",
    ],
  };
  const names = Object.values(anchors).flat();
  const schema = new Set(
    (
      await query(
        `SELECT type,name FROM sqlite_master WHERE name IN(${names.map(() => "?").join(",")})`,
        names,
      )
    ).map((row) => `${row.type}:${row.name}`),
  );
  if (
    Object.entries(anchors).some(([type, entries]) =>
      entries.some((name) => !schema.has(`${type}:${name}`)),
    )
  )
    throw maintenanceRequired();
  const migrations = new Set(
    (await query("SELECT name FROM d1_migrations")).map((row) => row.name),
  );
  for (const name of [
    "0001_initial.sql",
    "0002_retired_task_ids.sql",
    "0003_everyday_collections.sql",
    "0004_list_items_and_sections.sql",
    "0005_migrate_personal_tasks.sql",
    "0006_erasure_protocol.sql",
    "0007_pilot_accounts.sql",
    "0008_household_foundation.sql",
    "0009_transactional_limits.sql",
    "0010_active_erasure_confirmation.sql",
    "0011_household_lifecycle.sql",
    "0012_budget_aware_writers.sql",
    "0013_household_content_erasure.sql",
    "0014_operator_policy.sql",
  ])
    if (!migrations.has(name)) throw maintenanceRequired();
  const [policy] = await query(
    "SELECT (SELECT count(*) FROM operator_settings WHERE id=1 AND revision>0 AND max_items_per_collection>0 AND max_sections_per_collection>0) AS structural_ready,(SELECT count(*) FROM pilot_accounts WHERE approved=1) AS approved_accounts,(SELECT count(*) FROM pilot_accounts WHERE approved=1 AND plan_revision=0) AS unconfigured_accounts,(SELECT count(*) FROM tasks) AS legacy_tasks,(SELECT count(*) FROM write_budgets)+(SELECT count(*) FROM invariant_guards)+(SELECT count(*) FROM limit_guards) AS leftover_guards",
  );
  if (
    !policy ||
    Number(policy.structural_ready) !== 1 ||
    Number(policy.approved_accounts) < 1 ||
    Number(policy.unconfigured_accounts) !== 0 ||
    Number(policy.legacy_tasks) !== 0 ||
    Number(policy.leftover_guards) !== 0
  )
    throw maintenanceRequired();
  if ((await query("PRAGMA foreign_key_check")).length)
    throw maintenanceRequired();
  console.log(
    "MVP 3 schema, migration ledger, writer fences and policy bootstrap verified; compatible deployment may continue.",
  );
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("MVP 3 requires")
      ? error.message
      : "MVP 3 deployment preflight failed. Keep the current service unchanged and inspect private operator diagnostics.",
  );
  process.exitCode = 1;
}
