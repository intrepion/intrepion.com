import { fileURLToPath } from "node:url";
import { run, localEnv } from "./processes.mjs";
export async function seedLocalPilot(state) {
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
      ...(state ? ["--persist-to", state] : []),
      "--file",
      fileURLToPath(new URL("local-pilot.sql", import.meta.url)),
    ],
    { env: localEnv },
  );
}
