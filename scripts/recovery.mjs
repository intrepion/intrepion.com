import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { B2, verifySql } from "./backups.mjs";

const MAX_BYTES = 20 * 1024 * 1024;
const householdEmailErasure = (
  await readFile(
    new URL("../server/household-email-erasure.sql", import.meta.url),
    "utf8",
  )
)
  .split(";")
  .filter((sql) => sql.trim());
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
      !(
        (record.version === 1 &&
          ["collection", "item"].includes(record.scope) &&
          Object.keys(record).sort().join(",") ===
            "collection_id,database_id,operation_id,scope,target_id,version") ||
        (record.version === 2 &&
          ["household_closed", "household"].includes(record.scope) &&
          Number.isSafeInteger(record.erase_due_at) &&
          record.erase_due_at > 0 &&
          record.erase_due_at <= 253402300799 &&
          Object.keys(record).sort().join(",") ===
            "collection_id,database_id,erase_due_at,operation_id,scope,target_id,version") ||
        (record.version === 3 &&
          record.scope === "household_content" &&
          Array.isArray(record.collection_ids) &&
          record.collection_ids.length > 0 &&
          record.collection_ids.length <= 100 &&
          new Set(record.collection_ids).size ===
            record.collection_ids.length &&
          record.collection_ids.every(uuid) &&
          Object.keys(record).sort().join(",") ===
            "collection_id,collection_ids,database_id,operation_id,scope,target_id,version") ||
        (record.version === 4 &&
          ["account_access", "head_membership"].includes(record.scope) &&
          record.security &&
          Object.keys(record.security).sort().join(",") ===
            "active,public_id,revision,subject_hash" &&
          typeof record.security.active === "boolean" &&
          typeof record.security.subject_hash === "string" &&
          /^[0-9a-f]{64}$/.test(record.security.subject_hash) &&
          typeof record.security.public_id === "string" &&
          /^[0-9a-f]{32}$/.test(record.security.public_id) &&
          Number.isSafeInteger(record.security.revision) &&
          record.security.revision > 0 &&
          (record.scope !== "account_access" ||
            record.collection_id === "00000000-0000-0000-0000-000000000000") &&
          Object.keys(record).sort().join(",") ===
            "collection_id,database_id,operation_id,scope,security,target_id,version")
      ) ||
      record.database_id !== ledger.databaseId ||
      !uuid(record.operation_id) ||
      !uuid(record.collection_id) ||
      (record.scope === "item"
        ? !uuid(record.target_id)
        : record.target_id !== "")
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
      record.version,
      record.erase_due_at ?? null,
      record.collection_ids ?? null,
      record.security ?? null,
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
    type === "column"
      ? db
          .prepare("PRAGMA table_info(erasure_intents)")
          .all()
          .some((c) => c.name === name)
      : !!db
          .prepare("SELECT 1 FROM sqlite_master WHERE type=? AND name=?")
          .get(type, name);
  for (const [type, anchor, file] of [
    ["table", "retired_task_ids", "0002_retired_task_ids"],
    ["table", "collections", "0003_everyday_collections"],
    ["table", "list_items", "0004_list_items_and_sections"],
    ["trigger", "tasks_replaced_insert", "0005_migrate_personal_tasks"],
    ["table", "erasure_intents", "0006_erasure_protocol"],
    ["table", "pilot_accounts", "0007_pilot_accounts"],
    ["table", "households", "0008_household_foundation"],
    ["table", "operator_settings", "0009_transactional_limits"],
    ["column", "confirmed_active_erasure", "0010_active_erasure_confirmation"],
    ["table", "household_lifecycle", "0011_household_lifecycle"],
    ["trigger", "budget_collections_insert", "0012_budget_aware_writers"],
    ["table", "household_content_erasures", "0013_household_content_erasure"],
    ["table", "pilot_operator_operations", "0014_operator_policy"],
    ["table", "site_safety_policy", "0015_independent_safety_policy"],
    ["table", "email_invitations", "0016_email_invitations"],
    ["table", "email_send_attempts", "0017_email_delivery"],
    ["table", "onboarding_sessions", "0018_invitation_onboarding"],
    ["table", "site_security_outbox", "0019_protected_account_access"],
    ["table", "email_feedback_receipts", "0020_signed_email_feedback"],
    ["index", "email_accounting_review", "0021_mail_recovery_accounting"],
    ["view", "content_space_usage", "0022_household_metadata_storage"],
    ["table", "site_usage_samples", "0023_aggregate_usage_history"],
    ["trigger", "record_account_admission", "0024_protected_account_admission"],
    ["table", "household_request_links", "0025_request_links"],
    ["table", "household_request_decisions", "0026_request_decisions"],
    ["table", "email_attempt_reservations", "0027_request_approval"],
    [
      "trigger",
      "finalize_request_on_invitation_change",
      "0028_request_final_state",
    ],
    ["trigger", "revoke_links_departed_head", "0029_request_link_lifecycle"],
    ["table", "request_lookup_sessions", "0030_request_lookup"],
    ["table", "household_request_withdrawals", "0031_request_withdrawals"],
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
    "0007_pilot_accounts.sql",
    "0008_household_foundation.sql",
    "0009_transactional_limits.sql",
    "0010_active_erasure_confirmation.sql",
    "0011_household_lifecycle.sql",
    "0012_budget_aware_writers.sql",
    "0013_household_content_erasure.sql",
    "0014_operator_policy.sql",
    "0015_independent_safety_policy.sql",
    "0016_email_invitations.sql",
    "0017_email_delivery.sql",
    "0018_invitation_onboarding.sql",
    "0019_protected_account_access.sql",
    "0020_signed_email_feedback.sql",
    "0021_mail_recovery_accounting.sql",
    "0022_household_metadata_storage.sql",
    "0023_aggregate_usage_history.sql",
    "0024_protected_account_admission.sql",
    "0025_request_links.sql",
    "0026_request_decisions.sql",
    "0027_request_approval.sql",
    "0028_request_final_state.sql",
    "0029_request_link_lifecycle.sql",
    "0030_request_lookup.sql",
    "0031_request_withdrawals.sql",
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
function replay(
  db,
  records,
  nested = false,
  retainedPublicIdentities = new Set(),
) {
  const retire = db.prepare(
    "INSERT OR IGNORE INTO retired_list_ids(kind,id) VALUES(?,?)",
  );
  db.exec("UPDATE security_replay_control SET replaying=1 WHERE id=1;");
  for (const record of [...records]
    .filter((r) => r.version !== 4)
    .sort(
      (a, b) =>
        Number(a.scope === "household") - Number(b.scope === "household"),
    )) {
    if (record.scope === "household_content") {
      for (const id of record.collection_ids) {
        const parent = db
          .prepare("SELECT owner_sub FROM collections WHERE id=?")
          .get(id);
        if (parent && parent.owner_sub !== `household:${record.collection_id}`)
          throw new Error(
            "Recovery rejected an erasure target outside its household.",
          );
      }
      replay(
        db,
        record.collection_ids.map((id) => ({
          ...record,
          scope: "collection",
          collection_id: id,
          target_id: "",
        })),
        true,
      );
      continue;
    }
    if (["household_closed", "household"].includes(record.scope)) {
      const previous = db
        .prepare("SELECT erase_due_at FROM closed_household_ids WHERE id=?")
        .get(record.collection_id);
      if (previous && previous.erase_due_at !== record.erase_due_at)
        throw new Error(
          "Recovery rejected conflicting household closure deadlines.",
        );
      db.prepare(
        "INSERT OR IGNORE INTO closed_household_ids(id,erase_due_at) VALUES(?,?)",
      ).run(record.collection_id, record.erase_due_at);
      const household = db
        .prepare("SELECT status FROM households WHERE id=?")
        .get(record.collection_id);
      if (household && household.status !== "erased") {
        db.prepare(
          "UPDATE households SET status='closed',erase_due_at=?,revision=revision+1 WHERE id=?",
        ).run(record.erase_due_at, record.collection_id);
        db.prepare(
          "UPDATE household_heads SET active=0 WHERE household_id=?",
        ).run(record.collection_id);
        db.prepare(
          "UPDATE household_invitations SET status='revoked' WHERE household_id=? AND status='pending'",
        ).run(record.collection_id);
        db.prepare(
          "INSERT INTO household_lifecycle(household_id,actor_sub,operation_id,erase_due_at,closure_published) VALUES(?,'',?,?,1) ON CONFLICT(household_id) DO UPDATE SET erase_due_at=excluded.erase_due_at,closure_published=1",
        ).run(record.collection_id, record.operation_id, record.erase_due_at);
      }
      if (record.scope === "household") {
        db.prepare("UPDATE closed_household_ids SET erased=1 WHERE id=?").run(
          record.collection_id,
        );
        if (household) {
          const space = db
            .prepare("SELECT scope_sub FROM households WHERE id=?")
            .get(record.collection_id).scope_sub;
          db.prepare(
            "INSERT INTO household_releases(household_id,subject,released_at) SELECT household_id,subject,? FROM household_allocations WHERE household_id=? ON CONFLICT(household_id,subject) DO NOTHING",
          ).run(record.erase_due_at, record.collection_id);
          for (const [table, kind] of [
            ["collections", "collection"],
            ["list_items", "item"],
            ["list_sections", "section"],
          ])
            db.prepare(
              `INSERT INTO retired_list_ids(kind,id) SELECT ?,id FROM ${table} WHERE owner_sub=? ON CONFLICT(kind,id) DO NOTHING`,
            ).run(kind, space);
          db.prepare(
            "INSERT INTO retired_task_ids(owner_sub,id) SELECT owner_sub,id FROM collections WHERE owner_sub=? AND kind=1 ON CONFLICT(owner_sub,id) DO NOTHING",
          ).run(space);
          for (const table of [
            "erasure_intents",
            "collection_operations",
            "collection_history",
            "list_items",
            "list_sections",
            "collections",
          ])
            db.prepare(`DELETE FROM ${table} WHERE owner_sub=?`).run(space);
          for (const sql of householdEmailErasure)
            db.prepare(sql).run(record.collection_id);
          for (const table of [
            "household_invitations",
            "household_content_erasures",
            "household_activity",
            "household_heads",
            "household_operations",
            "household_lifecycle",
            "household_allocations",
          ])
            db.prepare(`DELETE FROM ${table} WHERE household_id=?`).run(
              record.collection_id,
            );
          db.prepare(
            "UPDATE households SET name='Erased household',status='erased',erasure_delayed=0,revision=revision+1,last_operation='erased' WHERE id=?",
          ).run(record.collection_id);
        }
      }
      continue;
    }
    const parent = db
      .prepare("SELECT owner_sub,kind,revision FROM collections WHERE id=?")
      .get(record.collection_id);
    if (parent)
      db.prepare(
        "INSERT INTO write_budgets(id,owner_sub,actor_sub,collection_id,usage_json,own_json,structure_json) VALUES(1,?,'',?,'{}','{}','{}')",
      ).run(parent.owner_sub, record.collection_id);
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
    db.exec("DELETE FROM write_budgets;");
  }
  if (nested) return;
  replaySecurity(
    db,
    records.filter((r) => r.version === 4),
    retainedPublicIdentities,
  );
  db.exec(
    "DELETE FROM sessions; DELETE FROM login_challenges; DELETE FROM onboarding_sessions; DELETE FROM request_sessions; DELETE FROM request_lookup_sessions; UPDATE household_request_links SET revoked=1; UPDATE household_invitation_requests SET status='canceled',closed_at=unixepoch() WHERE status='pending'; UPDATE email_invitations SET status='revoked',delivery_status='canceled',claim_id='',claim_until=0,revision=revision+1 WHERE status='pending'; UPDATE household_invitations SET status='revoked' WHERE status='pending'; UPDATE invitation_growth SET paused=1,revision=revision+1 WHERE id=1; UPDATE security_replay_control SET replaying=0 WHERE id=1;",
  );
}
function replaySecurity(db, records, retainedPublicIdentities) {
  const sequences = new Map();
  const publishedIds = new Set(records.map((r) => r.operation_id));
  // A snapshot can be ahead of the independent journal. Merge its durable
  // outbox before ordering changes, preserving unpublished restrictions.
  records = [
    ...records,
    ...db
      .prepare("SELECT * FROM site_security_outbox")
      .all()
      .map((row) => ({
        version: 4,
        operation_id: row.event_id,
        scope: row.scope,
        collection_id: row.household_id,
        security: {
          subject_hash:
            row.subject_hash ||
            createHash("sha256").update(row.subject).digest("hex"),
          public_id: row.public_id,
          revision: row.sequence,
          active: !!row.active,
        },
      })),
  ];
  const profiles = new Map(
    db
      .prepare("SELECT subject,public_id FROM pilot_accounts")
      .all()
      .map((p) => [createHash("sha256").update(p.subject).digest("hex"), p]),
  );
  const identities = new Map(),
    publicOwners = new Map();
  const bindIdentity = (hash, publicId) => {
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !/^[a-f0-9]{32}$/.test(publicId) ||
      (identities.has(hash) && identities.get(hash) !== publicId) ||
      (publicOwners.has(publicId) && publicOwners.get(publicId) !== hash)
    )
      throw new Error(
        "Recovery rejected conflicting protected identity records.",
      );
    identities.set(hash, publicId);
    publicOwners.set(publicId, hash);
  };
  for (const [hash, profile] of profiles)
    if (retainedPublicIdentities.has(profile.subject))
      bindIdentity(hash, profile.public_id);
  for (const row of db
    .prepare(
      "SELECT subject_hash,public_id FROM protected_account_access UNION SELECT subject_hash,public_id FROM protected_membership_state",
    )
    .all())
    bindIdentity(row.subject_hash, row.public_id);
  for (const record of [...records].sort(
    (a, b) => a.security.revision - b.security.revision,
  )) {
    const event = record.security;
    bindIdentity(event.subject_hash, event.public_id);
    const canonical = JSON.stringify([
      record.scope,
      record.collection_id,
      record.operation_id,
      event.subject_hash,
      event.public_id,
      event.revision,
      event.active,
    ]);
    const previous = sequences.get(event.revision);
    if (previous && previous !== canonical)
      throw new Error("Recovery rejected conflicting security revisions.");
    sequences.set(event.revision, canonical);
    const profile = profiles.get(event.subject_hash);
    if (profile && profile.public_id !== event.public_id) {
      if (retainedPublicIdentities.has(profile.subject))
        throw new Error(
          "Recovery rejected a mismatched protected account identity.",
        );
      db.prepare("UPDATE pilot_accounts SET public_id=? WHERE subject=?").run(
        event.public_id,
        profile.subject,
      );
      profile.public_id = event.public_id;
    }
    if (record.scope === "account_access") {
      db.prepare(
        "INSERT INTO protected_account_access(subject_hash,public_id,active,security_revision) VALUES(?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET public_id=excluded.public_id,active=excluded.active,security_revision=excluded.security_revision WHERE excluded.security_revision>protected_account_access.security_revision",
      ).run(
        event.subject_hash,
        event.public_id,
        Number(event.active),
        event.revision,
      );
    } else {
      db.prepare(
        "INSERT INTO protected_membership_state(household_id,subject_hash,public_id,active,security_revision) VALUES(?,?,?,?,?) ON CONFLICT(household_id,subject_hash) DO UPDATE SET public_id=excluded.public_id,active=excluded.active,security_revision=excluded.security_revision WHERE excluded.security_revision>protected_membership_state.security_revision",
      ).run(
        record.collection_id,
        event.subject_hash,
        event.public_id,
        Number(event.active),
        event.revision,
      );
      // A replay never grants a new membership. A later admitted state only
      // supersedes an earlier revocation, leaving snapshot membership as-is.
    }
    const existing = db
      .prepare("SELECT * FROM site_security_outbox WHERE sequence=?")
      .get(event.revision);
    if (!existing)
      db.prepare(
        "INSERT INTO site_security_outbox(sequence,event_id,scope,subject_hash,public_id,household_id,active,published) VALUES(?,?,?,?,?,?,?,1)",
      ).run(
        event.revision,
        record.operation_id,
        record.scope,
        event.subject_hash,
        event.public_id,
        record.collection_id,
        Number(event.active),
      );
    else if (publishedIds.has(record.operation_id))
      db.prepare(
        "UPDATE site_security_outbox SET published=1,subject='',subject_hash=? WHERE sequence=?",
      ).run(event.subject_hash, event.revision);
  }
  for (const row of db
    .prepare("SELECT * FROM protected_account_access")
    .all()) {
    const profile = profiles.get(row.subject_hash);
    if (profile) {
      if (profile.public_id !== row.public_id)
        throw new Error(
          "Recovery rejected a mismatched protected account identity.",
        );
      db.prepare("UPDATE pilot_accounts SET approved=? WHERE subject=?").run(
        row.active,
        profile.subject,
      );
    }
  }
  for (const row of db
    .prepare("SELECT * FROM protected_membership_state WHERE active=0")
    .all()) {
    const profile = profiles.get(row.subject_hash);
    if (profile)
      db.prepare(
        "UPDATE household_heads SET active=0 WHERE household_id=? AND subject=?",
      ).run(row.household_id, profile.subject);
  }
}
function dump(db, enforceBudget = true) {
  const schema = db
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
    )
    .all();
  // D1 manages the import transaction itself and rejects explicit BEGIN/COMMIT.
  // Recovery is imported only into a new isolated database, verified before use.
  const output = ["PRAGMA foreign_keys=OFF;"];
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
  output.push("PRAGMA foreign_keys=ON;");
  const bytes = Buffer.from(output.join("\n"));
  if (enforceBudget && bytes.length > MAX_BYTES)
    throw new Error("Recovery output exceeds the MVP size budget.");
  return bytes;
}

function holdRecoveryMailBudget(db) {
  // The snapshot can undercount attempts handed off after it was captured.
  // Hold the current UTC month's budget instead of pretending that gap is zero.
  db.exec(
    "INSERT INTO email_monthly_attempts(month,attempted,accounting_state) VALUES(strftime('%Y-%m','now'),10000,'recovery_hold') ON CONFLICT(month) DO UPDATE SET attempted=max(email_monthly_attempts.attempted,excluded.attempted),accounting_state='recovery_hold';",
  );
}

/** Measure current-schema SQL before independent ledger replay; never a restore guarantee. */
export async function estimateRecoverySqlBytes(sql) {
  verifySql(sql);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql.toString());
    await upgrade(db);
    holdRecoveryMailBudget(db);
    const serialized = dump(db, false);
    const size = serialized.length;
    serialized.fill(0);
    return size;
  } finally {
    db.close();
  }
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
    const hadAccounts = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pilot_accounts'",
      )
      .get();
    const hadPublicIds =
      hadAccounts &&
      db
        .prepare("PRAGMA table_info(pilot_accounts)")
        .all()
        .some((c) => c.name === "public_id");
    const retainedPublicIdentities = new Set(
      hadPublicIds
        ? db
            .prepare("SELECT subject FROM pilot_accounts WHERE public_id<>''")
            .all()
            .map((r) => r.subject)
        : [],
    );
    await upgrade(db);
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    replay(db, records, false, retainedPublicIdentities);
    holdRecoveryMailBudget(db);
    db.exec("DELETE FROM site_usage_samples;");
    db.exec(
      await readFile(
        new URL("../server/operational-retention.sql", import.meta.url),
        "utf8",
      ),
    );
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
