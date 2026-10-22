import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { B2, verifySql } from "./backups.mjs";

const MAX_BYTES = 20 * 1024 * 1024;
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (typeof value === "string")
    return value.includes("\0")
      ? `CAST(X'${Buffer.from(value).toString("hex")}' AS TEXT)`
      : `'${value.replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array)
    return `X'${Buffer.from(value).toString("hex")}'`;
  throw new Error("Recovery encountered an unsupported SQL value.");
}
function validateLedger(ledger) {
  if (
    !ledger?.complete ||
    !uuid(ledger.databaseId) ||
    !Array.isArray(ledger.records)
  )
    throw new Error(
      "Recovery requires a complete independently retrieved erasure ledger.",
    );
  const operations = new Map();
  for (const record of ledger.records) {
    if (
      !record ||
      Object.keys(record).sort().join(",") !==
        "collection_id,database_id,operation_id,scope,target_id,version" ||
      record.version !== 1 ||
      record.database_id !== ledger.databaseId ||
      !uuid(record.operation_id) ||
      !uuid(record.collection_id) ||
      !["collection", "item"].includes(record.scope) ||
      (record.scope === "collection"
        ? record.target_id !== ""
        : !uuid(record.target_id))
    )
      throw new Error(
        "Recovery rejected a malformed or wrong-database erasure record.",
      );
    const canonical = JSON.stringify([
      record.database_id,
      record.operation_id,
      record.collection_id,
      record.scope,
      record.target_id,
    ]);
    const previous = operations.get(record.operation_id);
    if (previous && previous.canonical !== canonical)
      throw new Error("Recovery rejected conflicting erasure identities.");
    operations.set(record.operation_id, { canonical, record });
  }
  return [...operations.values()].map((value) => value.record);
}
async function upgrade(db) {
  const exists = (type, name) =>
    !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type=? AND name=?")
      .get(type, name);
  for (const [type, anchor, file] of [
    ["table", "retired_task_ids", "0002_retired_task_ids"],
    ["table", "collections", "0003_everyday_collections"],
    ["table", "list_items", "0004_list_items_and_sections"],
    ["trigger", "tasks_replaced_insert", "0005_migrate_personal_tasks"],
    ["table", "erasure_intents", "0006_erasure_protocol"],
  ])
    if (!exists(type, anchor))
      db.exec(
        await readFile(
          new URL(`../server/migrations/${file}.sql`, import.meta.url),
          "utf8",
        ),
      );
  const names = [
    "0001_initial.sql",
    "0002_retired_task_ids.sql",
    "0003_everyday_collections.sql",
    "0004_list_items_and_sections.sql",
    "0005_migrate_personal_tasks.sql",
    "0006_erasure_protocol.sql",
  ];
  db.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
  );
  if (
    db
      .prepare("SELECT name FROM d1_migrations")
      .all()
      .some((row) => !names.includes(row.name))
  )
    throw new Error(
      "Recovery requires a version that understands all recorded migrations.",
    );
  for (const name of names)
    db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)").run(name);
}
function replay(db, records) {
  const retire = db.prepare(
    "INSERT OR IGNORE INTO retired_list_ids(kind,id) VALUES(?,?)",
  );
  for (const record of records) {
    const parent = db
      .prepare("SELECT owner_sub,kind,revision FROM collections WHERE id=?")
      .get(record.collection_id);
    if (record.scope === "collection") {
      for (const row of db
        .prepare("SELECT id FROM list_items WHERE collection_id=?")
        .all(record.collection_id))
        retire.run("item", row.id);
      for (const row of db
        .prepare("SELECT id FROM list_sections WHERE collection_id=?")
        .all(record.collection_id))
        retire.run("section", row.id);
      retire.run("collection", record.collection_id);
      if (parent?.kind === 1)
        db.prepare(
          "INSERT OR IGNORE INTO retired_task_ids(owner_sub,id) VALUES(?,?)",
        ).run(parent.owner_sub, record.collection_id);
      db.prepare("DELETE FROM collection_history WHERE collection_id=?").run(
        record.collection_id,
      );
      db.prepare("DELETE FROM list_items WHERE collection_id=?").run(
        record.collection_id,
      );
      db.prepare("DELETE FROM list_sections WHERE collection_id=?").run(
        record.collection_id,
      );
      db.prepare("DELETE FROM collections WHERE id=?").run(
        record.collection_id,
      );
    } else {
      const item = db
        .prepare("SELECT collection_id FROM list_items WHERE id=?")
        .get(record.target_id);
      if (item && item.collection_id !== record.collection_id)
        throw new Error(
          "Recovery found an erasure target in a different collection.",
        );
      retire.run("item", record.target_id);
      db.prepare(
        "DELETE FROM collection_history WHERE collection_id=? AND target_id=?",
      ).run(record.collection_id, record.target_id);
      db.prepare("DELETE FROM list_items WHERE collection_id=? AND id=?").run(
        record.collection_id,
        record.target_id,
      );
      if (parent) {
        if (parent.revision >= 4294967295)
          throw new Error(
            "Recovery requires review of an exhausted collection revision.",
          );
        db.prepare(
          "UPDATE collections SET revision=revision+1,last_operation=? WHERE id=?",
        ).run(record.operation_id, record.collection_id);
      }
    }
    // Content-derived fingerprints must not retain a verifier for erased text.
    db.prepare("DELETE FROM collection_operations WHERE collection_id=?").run(
      record.collection_id,
    );
    db.prepare("DELETE FROM erasure_intents WHERE collection_id=?").run(
      record.collection_id,
    );
  }
  db.exec("DELETE FROM sessions; DELETE FROM login_challenges;");
}
function dump(db) {
  const schema = db
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
    )
    .all();
  const output = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const entry of schema.filter((row) => row.type === "table"))
    output.push(`${entry.sql};`);
  for (const table of schema.filter((row) => row.type === "table")) {
    const columns = db
      .prepare(`PRAGMA table_info(${identifier(table.name)})`)
      .all()
      .map((column) => column.name);
    const query = db.prepare(`SELECT * FROM ${identifier(table.name)}`);
    query.setReadBigInts(true);
    const rows = query.all();
    for (const row of rows)
      output.push(
        `INSERT INTO ${identifier(table.name)}(${columns.map(identifier).join(",")}) VALUES(${columns.map((column) => literal(row[column])).join(",")});`,
      );
  }
  // Preserve AUTOINCREMENT high-water marks even when the newest row was erased.
  if (
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()
  ) {
    output.push("DELETE FROM sqlite_sequence;");
    const query = db.prepare("SELECT name,seq FROM sqlite_sequence");
    query.setReadBigInts(true);
    for (const row of query.all())
      output.push(
        `INSERT INTO sqlite_sequence(name,seq) VALUES(${literal(row.name)},${literal(row.seq)});`,
      );
  }
  for (const entry of schema.filter((row) => row.type !== "table"))
    output.push(`${entry.sql};`);
  output.push("COMMIT;", "PRAGMA foreign_keys=ON;");
  const bytes = Buffer.from(output.join("\n"));
  if (bytes.length > MAX_BYTES)
    throw new Error("Recovery output exceeds the MVP size budget.");
  return bytes;
}

/** Fetch all retained versions with a separate read-only, database-prefix-scoped operator key. */
export async function readErasureLedger(store, databaseId) {
  const prefix = `erasures/${databaseId}/`;
  const allowed = store.info?.apiInfo?.storageApi?.allowed;
  if (
    !uuid(databaseId) ||
    allowed?.namePrefix !== prefix ||
    allowed?.buckets?.length !== 1 ||
    allowed.buckets[0].id !== store.bucket ||
    JSON.stringify([...(allowed.capabilities ?? [])].sort()) !==
      JSON.stringify(["listFiles", "readFiles"])
  )
    throw new Error(
      "Recovery requires a narrowly scoped read-only ledger key.",
    );
  const records = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await store.call("b2_list_file_versions", {
      bucketId: store.bucket,
      prefix,
      maxFileCount: 1000,
      ...(cursor ?? {}),
    });
    if (
      !Array.isArray(page.files) ||
      Boolean(page.nextFileName) !== Boolean(page.nextFileId)
    )
      throw new Error("Recovery received an incomplete ledger listing.");
    for (const file of page.files) {
      if (
        file.action !== "upload" ||
        typeof file.fileName !== "string" ||
        !file.fileName.startsWith(prefix) ||
        !uuid(file.fileName.slice(prefix.length, -5)) ||
        !file.fileName.endsWith(".json") ||
        !file.fileId ||
        file.contentLength > 8192
      )
        throw new Error(
          "Recovery rejected a hidden or unexpected ledger object.",
        );
      const bytes = await store.download(file.fileId);
      if (
        bytes.length > 8192 ||
        bytes.length !== Number(file.contentLength) ||
        createHash("sha1").update(bytes).digest("hex") !== file.contentSha1
      )
        throw new Error("Recovery ledger checksum or length differs.");
      const record = JSON.parse(bytes.toString());
      if (file.fileName !== `${prefix}${record.operation_id}.json`)
        throw new Error("Recovery ledger filename does not match its record.");
      records.push(record);
      if (records.length > 100000)
        throw new Error(
          "Recovery ledger exceeds the reviewed MVP size budget.",
        );
    }
    if (page.nextFileName) {
      const key = JSON.stringify([page.nextFileName, page.nextFileId]);
      if (cursors.has(key))
        throw new Error("Recovery ledger pagination did not advance.");
      cursors.add(key);
      cursor = {
        startFileName: page.nextFileName,
        startFileId: page.nextFileId,
      };
    } else cursor = undefined;
  } while (cursor);
  const ledger = { databaseId, records, complete: true };
  validateLedger(ledger);
  return ledger;
}

/** Produce isolated, upgraded, session-cleared SQL only after all ledger records validate and replay. */
export async function recoverArchive(archive, identity, ledger) {
  const records = validateLedger(ledger);
  if (archive.length > MAX_BYTES + 1024 * 1024)
    throw new Error("Recovery archive exceeds the MVP size budget.");
  const decrypted = spawnSync(
    process.env.AGE_BIN ?? "age",
    ["-d", "-i", identity],
    { input: archive, maxBuffer: MAX_BYTES, timeout: 30000 },
  );
  if (decrypted.status !== 0 || !decrypted.stdout?.length)
    throw new Error("Recovery decryption failed.");
  verifySql(decrypted.stdout);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(decrypted.stdout.toString());
    await upgrade(db);
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    replay(db, records);
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Recovery foreign-key integrity check failed.");
    db.exec("COMMIT;");
    const sql = dump(db);
    verifySql(sql);
    return sql;
  } finally {
    db.close();
    decrypted.stdout.fill(0);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv[2] === "download-ledger") {
      const [databaseId, output] = process.argv.slice(3);
      if (!databaseId || !output)
        throw new Error("Missing ledger destination.");
      const ledger = await readErasureLedger(await B2.authorize(), databaseId);
      await writeFile(output, JSON.stringify(ledger), {
        mode: 0o600,
        flag: "wx",
      });
      console.log("Complete scoped erasure ledger downloaded and validated.");
    } else {
      const [archive, identity, ledgerFile, output] = process.argv.slice(2);
      if (!archive || !identity || !ledgerFile || !output)
        throw new Error(
          "Use recovery.mjs <database.sql.age> <identity.agekey> <complete-ledger.json> <new-private-output.sql>.",
        );
      const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
      const sql = await recoverArchive(
        await readFile(archive),
        identity,
        ledger,
      );
      await writeFile(output, sql, { mode: 0o600, flag: "wx" });
      sql.fill(0);
      console.log(
        "Recovery SQL prepared: erasures replayed, sessions cleared, integrity checked. Keep the service stopped until isolated restore verification finishes.",
      );
    }
  } catch {
    console.error(
      "Recovery failed closed. No usable recovery output was published. Inspect private inputs and ledger completeness; keep the application stopped.",
    );
    process.exitCode = 1;
  }
}
