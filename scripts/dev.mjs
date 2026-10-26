import { seedLocalPilot } from "./local-pilot.mjs";
import { seedLocalNormalAccounts } from "./local-normal-accounts.mjs";
import { resolve } from "node:path";
import {
  start,
  stop,
  run,
  ready,
  localEnv,
  bridgeReady,
} from "./processes.mjs";
const children = [];
const normal = process.argv.includes("--normal-accounts");
const state = normal ? resolve(".wrangler/normal-development") : undefined;
const persist = state ? ["--persist-to", state] : [];
const environment = {
  ...localEnv,
  ...(normal ? { LOCAL_EMAIL_AUTOMATIC: "1" } : {}),
};
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all(children.map(stop));
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
try {
  await run("cargo", ["build", "--locked", "--features", "dev-auth"]);
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
      ...persist,
    ],
    { env: environment },
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
        ...persist,
      ],
      { env: environment },
    ),
  );
  children.push(
    start("node", ["scripts/local-erasure-ledger.mjs"], {
      env: {
        ...environment,
        LOCAL_ERASURE_LEDGER_DIR: state
          ? `${state}/erasure-ledger`
          : ".wrangler/erasure-ledger",
      },
    }),
  );
  await ready("http://127.0.0.1:8792/health");
  await bridgeReady();
  if (normal) {
    children.push(
      start("node", ["scripts/local-email.mjs"], { env: environment }),
    );
    await ready("http://127.0.0.1:8793/health");
  }
  children.push(
    start("target/debug/intrepion-server", [], { env: environment }),
  );
  await ready("http://127.0.0.1:8788/health/live");
  if (normal) await seedLocalNormalAccounts({ reuseExisting: true });
  children.push(
    start(
      "node",
      [
        "node_modules/astro/bin/astro.mjs",
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        "4322",
        "--ignore-lock",
      ],
      { cwd: "web", env: { ...environment, ASTRO_TELEMETRY_DISABLED: "1" } },
    ),
  );
  console.log(
    "Open http://127.0.0.1:4322 — development login; local D1 survives restarts.",
  );
  if (normal)
    console.log(
      "Normal-account development uses isolated persistent local state and illustrative safety values. Fake mail only: use @example.invalid recipients; open http://127.0.0.1:8793/mailbox. Existing local pauses/settings survive restart.",
    );
  await Promise.race(
    children.map(
      (child) => new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
} finally {
  await close();
}
