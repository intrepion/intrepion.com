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
