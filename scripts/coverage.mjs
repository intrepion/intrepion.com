import { run } from "./processes.mjs";
if (process.env.CI)
  throw new Error("Coverage runs locally only, by owner policy.");
await run("node", [
  "node_modules/c8/bin/c8.js",
  "--include=src/lib/model.ts",
  "node",
  "--import",
  "tsx",
  "tests/model.test.ts",
]);
