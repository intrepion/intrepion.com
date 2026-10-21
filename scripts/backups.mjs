import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const digest = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const MAX_BYTES = 20 * 1024 * 1024;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
export function verifySql(sql) {
  if (sql.length > MAX_BYTES)
    throw new Error(
      "Backup exceeds the MVP size budget. Review storage usage before increasing it.",
    );
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql.toString());
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("Restore integrity check failed.");
    db.prepare(
      "SELECT id,owner_sub,title,notes,completed,revision,sequence FROM tasks LIMIT 1",
    ).all();
    db.prepare(
      "SELECT token_hash,owner_sub,csrf,expires_at FROM sessions LIMIT 1",
    ).all();
  } finally {
    db.close();
  }
}
export function encrypt(sql, recipient) {
  const result = spawnSync(process.env.AGE_BIN ?? "age", ["-r", recipient], {
    input: sql,
    maxBuffer: MAX_BYTES + 1024 * 1024,
    timeout: 30000,
  });
  if (result.status !== 0 || !result.stdout?.length)
    throw new Error("Backup encryption failed.");
  return result.stdout;
}

export class B2 {
  constructor(info, bucket, request = fetch) {
    this.info = info;
    this.bucket = bucket;
    this.request = request;
  }
  static async authorize() {
    const response = await fetch(
      "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
      {
        headers: {
          authorization: `Basic ${Buffer.from(`${required("B2_KEY_ID")}:${required("B2_APPLICATION_KEY")}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`Backup authorization failed (${response.status}).`);
    return new B2(await response.json(), required("B2_BUCKET_ID"));
  }
  async fetch(url, options = {}) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      (!parsed.hostname.endsWith(".backblazeb2.com") &&
        !parsed.hostname.endsWith(".backblaze.com"))
    )
      throw new Error("Unexpected backup provider URL.");
    const response = await this.request(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Backup provider request failed (${response.status}).`);
    return response;
  }
  async call(method, body) {
    return (
      await this.fetch(
        `${this.info.apiInfo.storageApi.apiUrl}/b2api/v4/${method}`,
        {
          method: "POST",
          headers: {
            authorization: this.info.authorizationToken,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      )
    ).json();
  }
  async list() {
    const response = await this.call("b2_list_file_versions", {
      bucketId: this.bucket,
      prefix: "daily/",
      maxFileCount: 1000,
    });
    if (response.nextFileId || response.nextFileName)
      throw new Error(
        "Too many backup versions; inspect retention before continuing.",
      );
    return response.files;
  }
  async upload(name, bytes) {
    const upload = await this.call("b2_get_upload_url", {
      bucketId: this.bucket,
    });
    return (
      await this.fetch(upload.uploadUrl, {
        method: "POST",
        headers: {
          authorization: upload.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(name),
          "X-Bz-Content-Sha1": digest(bytes, "sha1"),
          "content-type": "application/octet-stream",
        },
        body: bytes,
      })
    ).json();
  }
  async download(id) {
    return Buffer.from(
      await (
        await this.fetch(
          `${this.info.apiInfo.storageApi.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${encodeURIComponent(id)}`,
          { headers: { authorization: this.info.authorizationToken } },
        )
      ).arrayBuffer(),
    );
  }
  async infoFor(id) {
    return this.call("b2_get_file_info", { fileId: id });
  }
  async remove(file) {
    await this.call("b2_delete_file_version", {
      fileName: file.fileName,
      fileId: file.fileId,
    });
  }
}

export async function createBackup(store, sql, seal, at = new Date()) {
  verifySql(sql);
  const bytes = seal(sql);
  if (bytes.length > MAX_BYTES + 1024 * 1024)
    throw new Error("Encrypted backup exceeds the size budget.");
  const prefix = `daily/${at.toISOString().slice(0, 10)}/`;
  const archive = await store.upload(prefix + "database.sql.age", bytes);
  if (digest(await store.download(archive.fileId)) !== digest(bytes))
    throw new Error(
      "Uploaded backup checksum differs; no verified marker was written.",
    );
  const marker = {
    version: 1,
    created_at: at.toISOString(),
    file_id: archive.fileId,
    file_name: prefix + "database.sql.age",
    sha256: digest(bytes),
    sha1: digest(bytes, "sha1"),
    bytes: bytes.length,
  };
  const markerBytes = Buffer.from(JSON.stringify(marker));
  const written = await store.upload(prefix + "verified.json", markerBytes);
  if (digest(await store.download(written.fileId)) !== digest(markerBytes))
    throw new Error("Backup verification marker could not be confirmed.");
  // Only prune our prefix after a new archive and marker have been read back.
  // Retain the current UTC day and six previous days, including all versions.
  const cutoff = new Date(at);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  for (const file of await store.list()) {
    const match =
      /^daily\/(\d{4}-\d{2}-\d{2})\/(database\.sql\.age|verified\.json)$/.exec(
        file.fileName,
      );
    if (match && match[1] < cutoff.toISOString().slice(0, 10))
      await store.remove(file);
  }
  return marker;
}
export async function checkBackup(store, at = new Date()) {
  const markers = (await store.list())
    .filter(
      (file) =>
        /^daily\/\d{4}-\d{2}-\d{2}\/verified\.json$/.test(file.fileName) &&
        file.action === "upload",
    )
    .sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
  if (!markers.length) throw new Error("No verified backup exists.");
  const bytes = await store.download(markers[0].fileId);
  if (bytes.length > 4096) throw new Error("Invalid backup marker.");
  const marker = JSON.parse(bytes.toString());
  const age = at.getTime() - Date.parse(marker.created_at);
  if (!Number.isFinite(age) || age < 0 || age > 86400000)
    throw new Error(
      "The latest verified backup is invalid or older than 24 hours.",
    );
  const file = await store.infoFor(marker.file_id);
  if (
    marker.version !== 1 ||
    file.fileName !== marker.file_name ||
    file.contentLength !== marker.bytes ||
    file.contentSha1 !== marker.sha1
  )
    throw new Error("The verified archive is missing or its metadata differs.");
  return {
    backup_age_minutes: Math.floor(age / 60000),
    archive_bytes: marker.bytes,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const command = process.argv[2];
    if (command === "verify-sql") {
      verifySql(await readFile(process.argv[3]));
      console.log(
        "SQL restored successfully into an isolated in-memory SQLite database.",
      );
    } else if (command === "create") {
      const store = await B2.authorize();
      await createBackup(store, await readFile(process.argv[3]), (sql) =>
        encrypt(sql, required("AGE_RECIPIENT")),
      );
      console.log(
        "Encrypted backup uploaded, read back, restore-checked, and retained.",
      );
    } else if (command === "check") {
      console.log(JSON.stringify(await checkBackup(await B2.authorize())));
    } else
      throw new Error(
        "Use create <export.sql>, check, or verify-sql <export.sql>.",
      );
  } catch (error) {
    // Provider bodies, credentials, SQL and filesystem errors stay out of public CI logs.
    console.error(
      error instanceof Error &&
        /^(Missing |Backup |Uploaded |Encrypted |Too many |Unexpected backup|No verified |The latest |The verified |Invalid backup)/.test(
          error.message,
        )
        ? error.message
        : "Backup operation failed; inspect credentials and private operator diagnostics.",
    );
    process.exitCode = 1;
  }
}
