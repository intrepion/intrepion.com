import {
  mkdtemp,
  rm,
  mkdir,
  copyFile,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, stop, run, localEnv, bridgeReady } from "./processes.mjs";
const state = await mkdtemp(join(tmpdir(), "intrepion-integration-"));
let bridge;
let ledger;
try {
  await run("cargo", ["build", "--locked", "--features", "dev-auth"]);
  // Exercise an actual upgrade from MVP 1, not just a new empty database.
  const legacyMigrations = join(state, "legacy-migrations");
  await mkdir(legacyMigrations);
  for (const name of ["0001_initial.sql", "0002_retired_task_ids.sql"])
    await copyFile(
      new URL(`../server/migrations/${name}`, import.meta.url),
      join(legacyMigrations, name),
    );
  const legacyConfig = join(state, "legacy.toml");
  const config = (await readFile("server/local/wrangler.toml", "utf8"))
    .replace(
      'main = "bridge.mjs"',
      `main = ${JSON.stringify(join(process.cwd(), "server/local/bridge.mjs"))}`,
    )
    .replace(
      'migrations_dir = "../migrations"',
      `migrations_dir = ${JSON.stringify(legacyMigrations)}`,
    );
  await writeFile(legacyConfig, config);
  await run(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--config",
      legacyConfig,
      "--persist-to",
      state,
    ],
    { env: localEnv },
  );
  const legacyFixture = join(state, "legacy-fixture.sql");
  await writeFile(
    legacyFixture,
    "INSERT INTO tasks(owner_sub,id,title,notes,completed,revision) VALUES('development-owner','00000000-0000-4000-a000-000000000042','Migrated personal task','Keep the original notes',1,7);",
  );
  await run(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      legacyConfig,
      "--persist-to",
      state,
      "--file",
      legacyFixture,
    ],
    { env: localEnv },
  );
  await run(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--config",
      "server/local/wrangler.toml",
      "--persist-to",
      state,
    ],
    { env: localEnv },
  );
  const pilotFixture = join(state, "pilot-fixture.sql");
  await writeFile(
    pilotFixture,
    'INSERT INTO pilot_accounts(subject,display_name) VALUES(\'development-second\',\'Second pilot user\'); UPDATE pilot_accounts SET plan_revision=1,plan_json=\'{"items":1000000,"shopping":10000,"templates":10000,"runs":10000,"bytes":1073741824,"households":100}\';',
  );
  await run(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "server/local/wrangler.toml",
      "--persist-to",
      state,
      "--file",
      pilotFixture,
    ],
    { env: localEnv },
  );
  const structureFixture = join(state, "structure-fixture.sql");
  await writeFile(
    structureFixture,
    "UPDATE operator_settings SET max_items_per_collection=10000,max_sections_per_collection=1000 WHERE id=1;",
  );
  await run(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "server/local/wrangler.toml",
      "--persist-to",
      state,
      "--file",
      structureFixture,
    ],
    { env: localEnv },
  );
  ledger = start("node", ["scripts/local-erasure-ledger.mjs"], {
    env: {
      ...localEnv,
      LOCAL_ERASURE_LEDGER_DIR: join(state, "ledger"),
      LEDGER_TEST_CONTROLS: "1",
    },
  });
  await readyLedger();
  bridge = start(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--local",
      "--config",
      "server/local/wrangler.toml",
      "--ip",
      "127.0.0.1",
      "--port",
      "8791",
      "--persist-to",
      state,
    ],
    { env: localEnv },
  );
  await bridgeReady();
  await run(
    "node",
    [
      "--import",
      "tsx",
      "--test",
      ...process.argv.slice(2),
      "server/tests/rpc.test.ts",
    ],
    {
      env: {
        ...localEnv,
        HOUSEHOLD_MAINTENANCE_TOKEN: "ab".repeat(32),
        PILOT_OPERATOR_TOKEN: "cd".repeat(32),
      },
    },
  );
} finally {
  await stop(bridge);
  await stop(ledger);
  await rm(state, { recursive: true, force: true });
}
async function readyLedger() {
  const { ready } = await import("./processes.mjs");
  await ready("http://127.0.0.1:8792/health");
}
