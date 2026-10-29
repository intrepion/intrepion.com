import { seedLocalPilot } from "./local-pilot.mjs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  start,
  stop,
  run,
  ready,
  localEnv,
  bridgeReady,
} from "./processes.mjs";
if (process.env.CI) throw new Error("E2E is local-only by owner policy.");
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const state = await mkdtemp(join(tmpdir(), "intrepion-e2e-"));
const children = [];
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all(children.map(stop));
  await rm(state, { recursive: true, force: true });
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
try {
  await run("cargo", ["build", "--locked", "--features", "dev-auth"]);
  await run("npm", ["--prefix", "web", "run", "build"]);
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
  await seedLocalPilot(state);
  children.push(
    start(
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
    ),
  );
  children.push(
    start("node", ["scripts/local-erasure-ledger.mjs"], {
      env: {
        ...localEnv,
        LEDGER_TEST_CONTROLS: "1",
        LOCAL_ERASURE_LEDGER_DIR: `${state}/erasure-ledger`,
      },
    }),
  );
  if (process.env.NORMAL_ACCOUNTS_TEST) {
    children.push(
      start("node", ["scripts/local-email.mjs"], { env: localEnv }),
    );
    await ready("http://127.0.0.1:8793/health");
  }
  await ready("http://127.0.0.1:8792/health");
  await bridgeReady();
  children.push(
    start("target/debug/intrepion-server", [], {
      env: {
        ...localEnv,
        LOCAL_EMAIL_AUTOMATIC: process.env.NORMAL_ACCOUNTS_TEST ? "1" : "0",
      },
    }),
  );
  await ready("http://127.0.0.1:8788/health/live");
  if (process.env.NORMAL_ACCOUNTS_TEST && !process.env.BOOTSTRAP_POLICY_TEST)
    await (
      await import("./local-normal-accounts.mjs")
    ).seedLocalNormalAccounts();
  children.push(
    start(
      "node",
      [
        "node_modules/astro/bin/astro.mjs",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4322",
        "--ignore-lock",
      ],
      { cwd: "web", env: { ...localEnv, ASTRO_TELEMETRY_DISABLED: "1" } },
    ),
  );
  await Promise.race(
    children.map(
      (child) => new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
} finally {
  await close();
}
