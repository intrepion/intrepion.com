import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { B2, createBackup, checkBackup, encrypt } from "./backups.mjs";
import { estimateRecoverySqlBytes } from "./recovery.mjs";
import policy from "../docs/mvp-3-monitoring-policy.json" with { type: "json" };
const BYTES_PER_MIB = 1_048_576;

function reportHealth(health) {
  const size = Math.max(health.sql_bytes ?? 0, health.recovery_sql_bytes ?? 0);
  const sizeLevel =
    size >= policy.urgent_bytes
      ? "urgent"
      : size >= policy.pause_bytes
        ? "pause"
        : size >= policy.review_bytes
          ? "review"
          : health.sql_bytes === null || health.recovery_sql_bytes === null
            ? "unknown"
            : "normal";
  const alerts = [];
  if (health.sql_bytes === null && health.recovery_sql_bytes === null)
    alerts.push({
      level: "warning",
      message:
        "Older backup marker has unknown SQL sizes. Run a fresh monitored backup to establish headroom.",
    });
  else if (health.sql_bytes === null || health.recovery_sql_bytes === null)
    alerts.push({
      level: "error",
      message:
        "Backup size measurements are incomplete. The archive is verified, but recovery headroom needs investigation.",
    });
  if (sizeLevel === "urgent")
    alerts.push({
      level: "error",
      message: `SQL size reached ${policy.urgent_bytes / BYTES_PER_MIB} MiB. Urgent recovery-capacity review required; pause pilot expansion.`,
    });
  else if (sizeLevel === "pause")
    alerts.push({
      level: "error",
      message: `SQL size reached ${policy.pause_bytes / BYTES_PER_MIB} MiB. Pause new admissions and allowance increases until capacity is reviewed.`,
    });
  else if (sizeLevel === "review")
    alerts.push({
      level: "warning",
      message: `SQL size reached ${policy.review_bytes / BYTES_PER_MIB} MiB. Review growth, History and recovery headroom.`,
    });
  if (health.backup_age_minutes >= policy.backup_age_alert_minutes)
    alerts.push({
      level: "error",
      message: `Verified backup reached ${policy.backup_age_alert_minutes / 60} hours old. Investigate delayed or failing backups before the recovery target is missed.`,
    });
  return {
    health,
    size_level: sizeLevel,
    failed: alerts.some((a) => a.level === "error"),
    alerts,
  };
}

export async function checkMonitoredBackup(store, at = new Date()) {
  return reportHealth(await checkBackup(store, at));
}

export async function createMonitoredBackup(store, sql, seal, at = new Date()) {
  let recoverySqlBytes;
  try {
    recoverySqlBytes = await estimateRecoverySqlBytes(sql);
  } catch {
    // Preserve a valid source archive even if the current recovery format cannot
    // be measured. Its missing measurement raises an alert after readback.
  }
  await createBackup(store, sql, seal, at, { recoverySqlBytes });
  return checkMonitoredBackup(store, at);
}

function summary(report) {
  const { health } = report;
  const size = (bytes) =>
    bytes === null
      ? "unknown"
      : `${bytes.toLocaleString("en-US")} (${(bytes / BYTES_PER_MIB).toFixed(2)} MiB)`;
  const headroom = (bytes) =>
    bytes === null ? "unknown" : size(Math.max(0, health.budget_bytes - bytes));
  return [
    "## Backup recovery headroom",
    "",
    `Verified backup age: ${health.backup_age_minutes} minutes. Size status: **${report.size_level}**.`,
    "",
    `| Measurement | Bytes (MiB) | Remaining under ${health.budget_bytes / BYTES_PER_MIB} MiB |`,
    "| --- | ---: | ---: |",
    `| Plaintext export | ${size(health.sql_bytes)} | ${headroom(health.sql_bytes)} |`,
    `| Recovery SQL estimate before ledger replay | ${size(health.recovery_sql_bytes)} | ${headroom(health.recovery_sql_bytes)} |`,
    `| Encrypted archive | ${size(health.archive_bytes)} | n/a |`,
    "",
    "Sizes describe this snapshot. Recovery SQL is measured at backup time, before independent erasure-ledger replay; it is not a restore-size guarantee or a logical storage allowance. Protected recovery drills remain required.",
    "",
    ...report.alerts.map((alert) => `- ${alert.message}`),
    "",
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let sql;
  try {
    const command = process.argv[2];
    if (!["create", "check"].includes(command))
      throw new Error("Invalid command");
    const store = await B2.authorize();
    let report;
    if (command === "create") {
      sql = await readFile(process.argv[3]);
      report = await createMonitoredBackup(store, sql, (value) =>
        encrypt(value, process.env.AGE_RECIPIENT),
      );
    } else report = await checkMonitoredBackup(store);
    console.log(JSON.stringify({ event: "backup_monitoring", ...report }));
    for (const alert of report.alerts)
      console.log(`::${alert.level}::${alert.message}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(report));
    if (report.failed) process.exitCode = 1;
  } catch {
    // Never expose SQL parser errors, identities, credentials or provider bodies.
    console.error(
      "::error::Backup operation failed. Inspect private operator diagnostics; no SQL or credentials are included in this log.",
    );
    process.exitCode = 1;
  } finally {
    sql?.fill(0);
  }
}
