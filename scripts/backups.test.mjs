import { strict as assert } from "node:assert";
import test from "node:test";
import { createBackup, checkBackup } from "./backups.mjs";
import { readFile } from "node:fs/promises";
const sql = await readFile("server/migrations/0001_initial.sql");
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
