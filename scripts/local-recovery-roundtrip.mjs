// Actual local D1 export -> age encryption -> independent journal -> recovery.
// Called only by the disposable integration fixture; never a production export.
import { readFile, unlink, mkdir, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { run, localEnv } from "./processes.mjs";
import { encrypt, verifySql } from "./backups.mjs";
import { recoverArchive } from "./recovery.mjs";
const state = resolve(process.argv[2] ?? "");
if (
  dirname(state) !== resolve(tmpdir()) ||
  !basename(state).startsWith("intrepion-integration-")
)
  throw new Error(
    "Recovery integration requires its disposable local fixture.",
  );
const snapshot = join(state, "roundtrip.sql"),
  identity = join(state, "roundtrip.agekey");
// Export lacks --persist-to. Give a temporary config its isolated default state.
const exportRoot = join(state, "export"),
  exportConfig = join(exportRoot, "wrangler.toml");
await mkdir(join(exportRoot, ".wrangler"), { recursive: true });
await symlink(state, join(exportRoot, ".wrangler/state"), "dir");
const config = (await readFile("server/local/wrangler.toml", "utf8"))
  .replace(
    'main = "bridge.mjs"',
    `main = ${JSON.stringify(resolve("server/local/bridge.mjs"))}`,
  )
  .replace(
    'migrations_dir = "../migrations"',
    `migrations_dir = ${JSON.stringify(resolve("server/migrations"))}`,
  );
await writeFile(exportConfig, config);
await run(
  "node",
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "export",
    "DB",
    "--local",
    "--config",
    exportConfig,
    "--output",
    snapshot,
  ],
  { env: localEnv },
);
const source = await readFile(snapshot);
await unlink(snapshot);
const keygen = process.env.AGE_KEYGEN_BIN ?? "age-keygen";
if (spawnSync(keygen, ["-o", identity], { encoding: "utf8" }).status !== 0)
  throw new Error("Install age-keygen for encrypted recovery integration.");
const key = spawnSync(keygen, ["-y", identity], { encoding: "utf8" });
if (key.status !== 0) throw new Error("Local recovery test identity failed.");
const response = await fetch("http://127.0.0.1:8792/records", {
  headers: { authorization: "Bearer local-erasure-only" },
  signal: AbortSignal.timeout(10000),
});
if (!response.ok) throw new Error("Local independent journal is unavailable.");
const ledger = await response.json();
const recovered = await recoverArchive(
  encrypt(source, key.stdout.trim()),
  identity,
  {
    databaseId: "00000000-0000-0000-0000-000000000001",
    complete: true,
    records: ledger.records,
  },
);
verifySql(recovered);
const before = new DatabaseSync(":memory:"),
  after = new DatabaseSync(":memory:");
try {
  before.exec(source.toString());
  after.exec(recovered.toString());
  const canaryQuery =
    "SELECT title,notes,completed,revision,trashed FROM collections WHERE id='00000000-0000-4000-a000-000000000042'";
  const canary = after.prepare(canaryQuery).get();
  if (
    !canary ||
    canary.title !== "Migrated personal task" ||
    canary.notes !== "Keep the original notes" ||
    canary.completed !== 1 ||
    JSON.stringify(canary) !== JSON.stringify(before.prepare(canaryQuery).get())
  )
    throw new Error(
      "Encrypted local recovery lost the retained MVP 1 task canary.",
    );
  for (const query of [
    "SELECT subject,public_id,approved FROM pilot_accounts ORDER BY subject",
    "SELECT household_id,subject,active FROM household_heads ORDER BY household_id,subject",
  ])
    if (
      JSON.stringify(before.prepare(query).all()) !==
      JSON.stringify(after.prepare(query).all())
    )
      throw new Error(
        "Local encrypted recovery changed current account identity or household access.",
      );
  if (
    after.prepare("SELECT count(*) n FROM sessions").get().n ||
    after.prepare("SELECT count(*) n FROM onboarding_sessions").get().n ||
    after.prepare("SELECT paused FROM invitation_growth WHERE id=1").get()
      .paused !== 1
  )
    throw new Error("Local recovery did not clear sign-ins and pause growth.");
  console.log(
    JSON.stringify({
      event: "local_d1_encrypted_recovery",
      recovered_bytes: recovered.length,
      journal_records: ledger.records.length,
    }),
  );
} finally {
  before.close();
  after.close();
  source.fill(0);
  recovered.fill(0);
}
