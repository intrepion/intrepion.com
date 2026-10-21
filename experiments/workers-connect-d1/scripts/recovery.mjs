import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only synthetic local D1 state. --local is mandatory in every command.
const temporary = mkdtempSync(join(tmpdir(), "intrepion-d1-restore-"));
const dump = join(temporary, "synthetic-backup.sql");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(temporary, "wrangler.log") };
function wrangler(args) {
  return execFileSync(process.execPath, [process.env.EXPERIMENT_WRANGLER_JS ?? "node_modules/wrangler/bin/wrangler.js", ...args], { env, encoding: "utf8" });
}
wrangler(["d1", "export", "DB", "--local", "--table", "tasks", "--output", dump]);
wrangler(["d1", "execute", "DB", "--local", "--persist-to", join(temporary, "restored"), "--file", dump]);
const output = wrangler(["d1", "execute", "DB", "--local", "--persist-to", join(temporary, "restored"), "--command", "SELECT COUNT(*) AS count FROM tasks WHERE id = 'experiment-persistence-sentinel' AND title = 'Synthetic persistence sentinel' AND notes = 'No real data'", "--json"]);
const result = JSON.parse(output);
assert.equal(result[0].results[0].count, 1);
console.log("Local D1 export and restore into separate storage: passed");
console.log(`Synthetic recovery files: ${temporary}`);
