import {
  start,
  stop,
  run,
  ready,
  localEnv,
  bridgeReady,
} from "./processes.mjs";
const children = [];
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
  await run("npm", ["run", "db:migrate"], { env: localEnv });
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
      ],
      { env: localEnv },
    ),
  );
  children.push(
    start("node", ["scripts/local-erasure-ledger.mjs"], {
      env: {
        ...localEnv,
        LOCAL_ERASURE_LEDGER_DIR: ".wrangler/erasure-ledger",
      },
    }),
  );
  await ready("http://127.0.0.1:8792/health");
  await bridgeReady();
  children.push(start("target/debug/intrepion-server", [], { env: localEnv }));
  await ready("http://127.0.0.1:8788/health/live");
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
      { cwd: "web", env: { ...localEnv, ASTRO_TELEMETRY_DISABLED: "1" } },
    ),
  );
  console.log(
    "Open http://127.0.0.1:4322 — development login; local D1 survives restarts.",
  );
  await Promise.race(
    children.map(
      (child) => new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
} finally {
  await close();
}
