import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, stop, run, localEnv, bridgeReady } from "./processes.mjs";
const state = await mkdtemp(join(tmpdir(), "intrepion-integration-"));
let bridge;
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
      "--persist-to",
      state,
    ],
    { env: localEnv },
  );
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
  await run("node", ["--import", "tsx", "--test", "server/tests/rpc.test.ts"], {
    env: localEnv,
  });
} finally {
  await stop(bridge);
  await rm(state, { recursive: true, force: true });
}
