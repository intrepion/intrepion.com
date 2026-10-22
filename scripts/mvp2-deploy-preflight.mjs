// Read-only fence: the first MVP 2 upgrade needs the stopped-service procedure.
// Ordinary later deployments can continue to apply compatible additive migrations.
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
try {
  const account = required("CLOUDFLARE_ACCOUNT_ID"),
    database = required("D1_DATABASE_ID");
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9-]{36}$/.test(database))
    throw new Error("Invalid database identifiers.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${required("CLOUDFLARE_API_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN('tasks_replaced_insert','no_retired_collection','no_retired_item','no_retired_section','distinct_collection_identity','distinct_item_identity','distinct_section_identity')",
        params: [],
      }),
    },
  );
  if (!response.ok) throw new Error("Database preflight failed.");
  const body = await response.json();
  if (
    !body.success ||
    !body.result?.[0]?.success ||
    body.result[0].results?.length !== 7
  )
    throw new Error(
      "MVP 2 requires its maintenance upgrade before normal deployment. Follow docs/mvp-2-release.md; do not migrate underneath the old API.",
    );
  console.log(
    "MVP 2 schema fence verified; compatible deployment may continue.",
  );
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith("MVP 2 requires")
      ? error.message
      : "MVP 2 deployment preflight failed. Keep the current service unchanged and inspect private operator diagnostics.",
  );
  process.exitCode = 1;
}
