import { strict as assert } from "node:assert";
import test from "node:test";
import { B2, createBackup, checkBackup, verifySql } from "./backups.mjs";
import { readFile } from "node:fs/promises";
const sql = Buffer.concat([
  await readFile("server/migrations/0001_initial.sql"),
  await readFile("server/migrations/0002_retired_task_ids.sql"),
]);
test("restoring a schema with retired IDs requires its deletion trigger", () => {
  assert.doesNotThrow(() => verifySql(sql));
  const missingTrigger = Buffer.from(sql.toString().split("CREATE TRIGGER")[0]);
  assert.throws(() => verifySql(missingTrigger), /retirement protection/);
});
test("B2 accepts its documented upload host and blocks redirects and unrelated destinations", async () => {
  const uploadUrl =
    "https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file";
  const requests = [];
  const store = new B2(
    {
      apiInfo: { storageApi: { apiUrl: "https://api001.backblazeb2.com" } },
      authorizationToken: "test-account-token",
    },
    "test-bucket",
    async (url, options) => {
      requests.push({ url, options });
      return Response.json(
        requests.length === 1
          ? { uploadUrl, authorizationToken: "test-upload-token" }
          : { fileId: "uploaded" },
      );
    },
  );
  assert.equal(
    (await store.upload("daily/test", Buffer.from("synthetic"))).fileId,
    "uploaded",
  );
  assert.equal(requests[1].url, uploadUrl);
  assert.equal(requests[1].options.headers.authorization, "test-upload-token");
  assert.ok(requests.every(({ options }) => options.redirect === "error"));
  for (const url of [
    "http://pod-000-1005-03.backblaze.com/upload",
    "https://backblaze.com.attacker.test/upload",
    "https://attackerbackblazeb2.com/upload",
    "https://unrelated.test/upload",
  ]) {
    await assert.rejects(store.fetch(url), /Unexpected backup provider URL/);
  }
  assert.equal(requests.length, 2);
});
class Storage {
  files = [];
  data = new Map();
  async upload(fileName, bytes) {
    const file = {
      fileId: String(this.files.length + 1),
      fileName,
      action: "upload",
      uploadTimestamp: Date.now(),
      contentLength: bytes.length,
    };
    this.files.push(file);
    this.data.set(file.fileId, bytes);
    return file;
  }
  async download(id) {
    return this.data.get(id);
  }
  async list() {
    return this.files;
  }
  async remove(file) {
    this.files = this.files.filter((f) => f.fileId !== file.fileId);
  }
  async infoFor(id) {
    const file = this.files.find((file) => file.fileId === id);
    return {
      ...file,
      contentSha1: (await import("node:crypto"))
        .createHash("sha1")
        .update(this.data.get(id))
        .digest("hex"),
    };
  }
}
test("verified backups survive readback, watchdog checks the archive, and only expired daily files are pruned", async () => {
  const store = new Storage();
  await store.upload("daily/2026-10-01/database.sql.age", Buffer.from("older"));
  await store.upload("unrelated/private", Buffer.from("keep"));
  await createBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date("2026-10-20T04:00:00Z"),
  );
  assert.equal(
    store.files.some((f) => f.fileName.includes("2026-10-01")),
    false,
  );
  assert.equal(
    store.files.some((f) => f.fileName === "unrelated/private"),
    true,
  );
  assert.equal(
    (await checkBackup(store, new Date("2026-10-20T05:00:00Z")))
      .backup_age_minutes,
    60,
  );
  await assert.rejects(
    checkBackup(store, new Date("2026-10-21T04:00:01Z")),
    /older than 24 hours/,
  );
});
test("a corrupt upload cannot publish a verified marker or prune older backups", async () => {
  const store = new Storage();
  await store.upload("daily/2026-10-01/database.sql.age", Buffer.from("older"));
  store.download = async () => Buffer.from("corrupt transport");
  await assert.rejects(
    createBackup(store, sql, () => Buffer.from("encrypted fixture")),
    /checksum differs/,
  );
  assert.equal(
    store.files.some((f) => f.fileName.endsWith("verified.json")),
    false,
  );
  assert.equal(
    store.files.some((f) => f.fileName.includes("2026-10-01")),
    true,
  );
});

test("MVP 2 backups require erasure guards and valid collection relationships", async () => {
  const current = Buffer.concat([
    sql,
    ...(await Promise.all(
      [
        "0003_everyday_collections",
        "0004_list_items_and_sections",
        "0005_migrate_personal_tasks",
        "0006_erasure_protocol",
      ].map((name) => readFile(`server/migrations/${name}.sql`)),
    )),
  ]);
  assert.doesNotThrow(() => verifySql(current));
  assert.throws(() =>
    verifySql(
      Buffer.concat([current, Buffer.from("\nDROP TRIGGER no_retired_item;")]),
    ),
  );
  assert.throws(() =>
    verifySql(
      Buffer.concat([
        current,
        Buffer.from(
          "\nPRAGMA foreign_keys=OFF; INSERT INTO list_items(owner_sub,collection_id,id,title,position) VALUES('owner','missing-parent','orphan','Bad restore',0);",
        ),
      ]),
    ),
  );
});

test("verified markers report measured plaintext size and preserve unknown sizes for older archives", async () => {
  const store = new Storage();
  const marker = await createBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date("2026-10-24T04:00:00Z"),
  );
  assert.equal(marker.sql_bytes, sql.length);
  const health = await checkBackup(store, new Date("2026-10-24T05:00:00Z"));
  assert.equal(health.sql_bytes, sql.length);
  assert.equal(health.budget_bytes, 20_971_520);
  const markerFile = store.files.find((f) =>
    f.fileName.endsWith("verified.json"),
  );
  const legacy = JSON.parse(store.data.get(markerFile.fileId).toString());
  delete legacy.sql_bytes;
  store.data.set(markerFile.fileId, Buffer.from(JSON.stringify(legacy)));
  assert.equal(
    (await checkBackup(store, new Date("2026-10-24T05:00:00Z"))).sql_bytes,
    null,
  );
});

test("watchdog rejects malformed plaintext measurements rather than reporting false headroom", async () => {
  const store = new Storage();
  await createBackup(store, sql, () => Buffer.from("encrypted fixture"));
  const file = store.files.find((f) => f.fileName.endsWith("verified.json"));
  const original = JSON.parse(store.data.get(file.fileId).toString());
  for (const value of [null, "1088", 0, -1, 20_971_521, 1.5]) {
    store.data.set(
      file.fileId,
      Buffer.from(JSON.stringify({ ...original, sql_bytes: value })),
    );
    await assert.rejects(checkBackup(store), /Invalid backup measurement/);
  }
});

test("verified markers carry a separately measured recovery estimate and reject invalid estimates", async () => {
  const store = new Storage();
  const marker = await createBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date(),
    { recoverySqlBytes: 25_165_824 },
  );
  assert.equal(marker.recovery_sql_bytes, 25_165_824);
  assert.equal((await checkBackup(store)).recovery_sql_bytes, 25_165_824);
  const file = store.files.find((f) => f.fileName.endsWith("verified.json"));
  const original = JSON.parse(store.data.get(file.fileId).toString());
  for (const value of [null, "12", 0, -1, 1.5]) {
    store.data.set(
      file.fileId,
      Buffer.from(JSON.stringify({ ...original, recovery_sql_bytes: value })),
    );
    await assert.rejects(checkBackup(store), /Invalid backup measurement/);
  }
});

test("monitored backup creation records both measurements after verified encrypted storage", async () => {
  const { createMonitoredBackup } = await import("./backup-operations.mjs");
  const store = new Storage();
  const report = await createMonitoredBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date("2026-10-24T04:00:00Z"),
  );
  assert.equal(report.failed, false);
  assert.equal(report.health.sql_bytes, 1088);
  assert.ok(report.health.recovery_sql_bytes > report.health.sql_bytes);
  assert.equal(report.health.budget_bytes, 20_971_520);
  assert.ok(
    store.files.some((file) => file.fileName.endsWith("verified.json")),
  );
});

test("either SQL measurement triggers the approved review, pause and urgent thresholds", async () => {
  const { checkMonitoredBackup } = await import("./backup-operations.mjs");
  const store = new Storage();
  await createBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date("2026-10-24T04:00:00Z"),
    { recoverySqlBytes: 32768 },
  );
  const file = store.files.find((f) => f.fileName.endsWith("verified.json"));
  const marker = JSON.parse(store.data.get(file.fileId).toString());
  for (const field of ["sql_bytes", "recovery_sql_bytes"])
    for (const [size, level, failed] of [
      [5_242_879, "normal", false],
      [5_242_880, "review", false],
      [10_485_759, "review", false],
      [10_485_760, "pause", true],
      [15_728_639, "pause", true],
      [15_728_640, "urgent", true],
    ]) {
      store.data.set(
        file.fileId,
        Buffer.from(JSON.stringify({ ...marker, [field]: size })),
      );
      const report = await checkMonitoredBackup(
        store,
        new Date("2026-10-24T05:00:00Z"),
      );
      assert.equal(report.size_level, level);
      assert.equal(report.failed, failed);
      assert.ok(
        report.alerts.every(
          (alert) => alert.level === (failed ? "error" : "warning"),
        ),
      );
    }
});

test("monitored checks alert at 22 hours while preserving the 24-hour hard expiry", async () => {
  const { checkMonitoredBackup } = await import("./backup-operations.mjs");
  const store = new Storage();
  await createBackup(
    store,
    sql,
    () => Buffer.from("encrypted fixture"),
    new Date("2026-10-24T04:00:00Z"),
    { recoverySqlBytes: 32768 },
  );
  assert.equal(
    (await checkMonitoredBackup(store, new Date("2026-10-25T01:59:59Z")))
      .failed,
    false,
  );
  const late = await checkMonitoredBackup(
    store,
    new Date("2026-10-25T02:00:00Z"),
  );
  assert.equal(late.failed, true);
  assert.ok(
    late.alerts.some(
      (a) => a.level === "error" && a.message.includes("22 hours"),
    ),
  );
  await assert.rejects(
    checkMonitoredBackup(store, new Date("2026-10-25T04:00:01Z")),
    /older than 24 hours/,
  );
});

test("legacy markers report unknown sizes while incomplete new measurements fail monitoring", async () => {
  const { checkMonitoredBackup } = await import("./backup-operations.mjs");
  const store = new Storage();
  await createBackup(store, sql, () => Buffer.from("encrypted fixture"));
  assert.equal((await checkMonitoredBackup(store)).failed, true);
  const file = store.files.find((f) => f.fileName.endsWith("verified.json"));
  const legacy = JSON.parse(store.data.get(file.fileId).toString());
  delete legacy.sql_bytes;
  store.data.set(file.fileId, Buffer.from(JSON.stringify(legacy)));
  const report = await checkMonitoredBackup(store);
  assert.equal(report.failed, false);
  assert.equal(report.health.sql_bytes, null);
  assert.equal(report.health.recovery_sql_bytes, null);
  assert.equal(report.size_level, "unknown");
  assert.ok(
    report.alerts.some(
      (a) => a.level === "warning" && a.message.includes("unknown"),
    ),
  );
});

test("an unavailable recovery estimate still saves the verified backup before raising an alert", async () => {
  const { createMonitoredBackup } = await import("./backup-operations.mjs");
  const store = new Storage();
  const future = Buffer.concat([
    sql,
    Buffer.from(
      "\nCREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE); INSERT INTO d1_migrations(name) VALUES('9999_private_future_migration.sql');",
    ),
  ]);
  const report = await createMonitoredBackup(store, future, () =>
    Buffer.from("encrypted fixture"),
  );
  assert.equal(report.failed, true);
  assert.ok(
    store.files.some((file) => file.fileName.endsWith("verified.json")),
  );
  assert.equal(report.health.sql_bytes, future.length);
  assert.equal(report.health.recovery_sql_bytes, null);
  assert.equal(JSON.stringify(report).includes("private_future"), false);
});
