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
    // Legacy snapshots can be restored before applying migration 0002. Once
    // receipts exist, restoring without their trigger would silently weaken deletion.
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='retired_task_ids'",
        )
        .get()
    ) {
      db.prepare("SELECT owner_sub,id FROM retired_task_ids LIMIT 1").all();
      if (
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='remember_deleted_task' AND tbl_name='tasks'",
          )
          .get()
      ) {
        throw new Error(
          "Backup is missing deleted-task retirement protection.",
        );
      }
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='collections'",
        )
        .get()
    ) {
      for (const query of [
        "SELECT owner_sub,id,kind,title,notes,completed,archived,trashed,finished,revision,sequence,source_id,source_title,last_operation FROM collections LIMIT 1",
        "SELECT owner_sub,collection_id,id,title,notes,quantity,section_id,completed,trashed,position FROM list_items LIMIT 1",
        "SELECT owner_sub,collection_id,id,title,position FROM list_sections LIMIT 1",
        "SELECT owner_sub,collection_id,operation_id,target_id,target_title,action,occurred_at,before_json,after_json FROM collection_history LIMIT 1",
        "SELECT owner_sub,operation_id,collection_id,fingerprint,erased_scope FROM collection_operations LIMIT 1",
        "SELECT kind,id FROM retired_list_ids LIMIT 1",
        "SELECT owner_sub,collection_id,operation_id,fingerprint,expected_revision,target_id,scope FROM erasure_intents LIMIT 1",
      ])
        db.prepare(query).all();
      for (const name of [
        "no_retired_collection",
        "no_retired_item",
        "no_retired_section",
        "intent_requires_unused_operation",
        "receipt_requires_matching_intent",
        "tasks_replaced_insert",
        "tasks_replaced_update",
        "tasks_replaced_delete",
        "distinct_collection_identity",
        "distinct_item_identity",
        "distinct_section_identity",
      ]) {
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
            )
            .get(name)
        )
          throw new Error(
            "Backup is missing MVP 2 erasure or migration protection.",
          );
      }
      if (
        db.prepare("PRAGMA foreign_key_check").all().length ||
        db.prepare("SELECT 1 FROM tasks LIMIT 1").get() ||
        db
          .prepare(
            "SELECT 1 FROM list_items i WHERE trashed=0 AND section_id<>'' AND NOT EXISTS(SELECT 1 FROM list_sections s WHERE s.owner_sub=i.owner_sub AND s.collection_id=i.collection_id AND s.id=i.section_id) LIMIT 1",
          )
          .get() ||
        db
          .prepare(
            "SELECT 1 FROM retired_list_ids r WHERE (kind='collection' AND EXISTS(SELECT 1 FROM collections WHERE id=r.id)) OR (kind='item' AND EXISTS(SELECT 1 FROM list_items WHERE id=r.id)) OR (kind='section' AND EXISTS(SELECT 1 FROM list_sections WHERE id=r.id)) LIMIT 1",
          )
          .get()
      )
        throw new Error(
          "Backup contains invalid MVP 2 relationships or resurrected content.",
        );
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='households'",
        )
        .get()
    ) {
      for (const query of [
        "SELECT subject,public_id,display_name,approved,plan_json,plan_revision FROM pilot_accounts LIMIT 1",
        "SELECT id,scope_sub,name,status,revision,created_by,last_operation,erase_due_at,erasure_delayed FROM households LIMIT 1",
        "SELECT household_id,subject,active,ceilings_json FROM household_heads LIMIT 1",
        "SELECT household_id,subject,amounts_json FROM household_allocations LIMIT 1",
        "SELECT id,household_id,recipient_sub,token_hash,status,expires_at,created_by FROM household_invitations LIMIT 1",
        "SELECT actor_sub,operation_id,fingerprint,household_id,result_id FROM household_operations LIMIT 1",
        "SELECT household_id,actor_sub,operation_id,erase_due_at,closure_published FROM household_lifecycle LIMIT 1",
        "SELECT household_id,subject,released_at FROM household_releases LIMIT 1",
        "SELECT id,erase_due_at,erased FROM closed_household_ids LIMIT 1",
        "SELECT owner_sub,items,shopping,templates,runs,bytes,households FROM space_usage LIMIT 1",
        "SELECT * FROM space_capacity LIMIT 1",
        "SELECT confirmed_active_erasure FROM erasure_intents LIMIT 1",
      ])
        db.prepare(query).all();
      for (const name of [
        "no_closed_household_insert",
        "no_household_reopening",
      ])
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
            )
            .get(name)
        )
          throw new Error("Backup is missing household protection.");
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='household_content_erasures'",
          )
          .get()
      ) {
        db.prepare(
          "SELECT household_id,operation_id,actor_sub,fingerprint,expected_revision,target_json,published_batches,completed FROM household_content_erasures LIMIT 1",
        ).all();
        for (const name of [
          "one_pending_household_erasure",
          "content_erasure_requires_unused_operation",
          "household_receipt_requires_matching_erasure",
        ])
          if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name))
            throw new Error(
              "Backup is missing shared-content erasure protection.",
            );
        if (
          db
            .prepare(
              "SELECT 1 FROM household_content_erasures e JOIN households h ON h.id=e.household_id WHERE h.status='erased' LIMIT 1",
            )
            .get()
        )
          throw new Error(
            "Backup retains an erased household's content-erasure manifest.",
          );
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pilot_operator_operations'",
          )
          .get()
      ) {
        db.prepare(
          "SELECT last_policy_operation FROM pilot_accounts LIMIT 1",
        ).all();
        db.prepare(
          "SELECT revision,last_operation FROM operator_settings LIMIT 1",
        ).all();
        db.prepare(
          "SELECT operation_id,fingerprint,subject,public_id,revision,max_items,max_sections FROM pilot_operator_operations LIMIT 1",
        ).all();
      }
      for (const table of ["invariant_guards", "limit_guards", "write_budgets"])
        if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
          throw new Error(
            "Backup contains an unfinished household write guard.",
          );
      if (
        db.prepare("PRAGMA foreign_key_check").all().length ||
        db
          .prepare(
            "SELECT 1 FROM households h WHERE scope_sub<>'household:'||id OR (status<>'active' AND EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=h.id AND m.active=1)) OR (status IN('closed','erasing','erased') AND NOT EXISTS(SELECT 1 FROM closed_household_ids x WHERE x.id=h.id AND x.erase_due_at=h.erase_due_at)) LIMIT 1",
          )
          .get() ||
        db
          .prepare(
            "SELECT 1 FROM closed_household_ids x JOIN households h ON h.id=x.id WHERE h.status='active' OR (x.erased=1 AND h.status<>'erased') LIMIT 1",
          )
          .get() ||
        db
          .prepare(
            "SELECT 1 FROM households h WHERE status='erased' AND (name<>'Erased household' OR EXISTS(SELECT 1 FROM collections c WHERE c.owner_sub=h.scope_sub) OR EXISTS(SELECT 1 FROM household_allocations a WHERE a.household_id=h.id) OR EXISTS(SELECT 1 FROM household_heads a WHERE a.household_id=h.id) OR EXISTS(SELECT 1 FROM household_lifecycle a WHERE a.household_id=h.id) OR EXISTS(SELECT 1 FROM household_invitations a WHERE a.household_id=h.id) OR EXISTS(SELECT 1 FROM household_operations a WHERE a.household_id=h.id) OR EXISTS(SELECT 1 FROM household_activity a WHERE a.household_id=h.id)) LIMIT 1",
          )
          .get()
      )
        throw new Error(
          "Backup contains invalid household relationships or reopened/erased data.",
        );
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_safety_policy'",
        )
        .get()
    ) {
      for (const query of [
        "SELECT revision,enabled,personal_soft_json,personal_hard_json,household_soft_json,household_hard_json,max_items_per_collection,max_sections_per_collection,last_operation FROM site_safety_policy LIMIT 1",
        "SELECT operation_id,fingerprint,revision FROM site_admin_operations LIMIT 1",
        "SELECT operation_id,actor_sub,action,occurred_at FROM site_audit LIMIT 1",
        "SELECT revision,paused,last_operation FROM invitation_growth LIMIT 1",
        "SELECT id,household_id,recipient_email,token_hash,generation,status,delivery_status,expires_at,created_by,accepted_by,claim_id,claim_until,attempts,next_attempt_at,delivery_event_at FROM email_invitations LIMIT 1",
        "SELECT actor_sub,operation_id,fingerprint,invitation_id FROM email_invitation_operations LIMIT 1",
        "SELECT month,attempted,accounting_state FROM email_monthly_attempts LIMIT 1",
        "SELECT id,invitation_id,generation,recipient_email,outcome,provider_message_id,attempted_at,feedback_at FROM email_send_attempts LIMIT 1",
        "SELECT recipient_email,reason,revision,last_event_at FROM email_suppressions LIMIT 1",
        "SELECT recipient_hash,cleared_at,revision FROM email_suppression_reviews LIMIT 1",
        "SELECT id,digest,claim_id,invitation_id,received_at FROM email_feedback_receipts LIMIT 1",
        "SELECT token_hash,csrf,user_sub,email,display_name,invitation_id,generation,expires_at FROM onboarding_sessions LIMIT 1",
        "SELECT user_sub,operation_id,fingerprint,invitation_id,household_id FROM invitation_acceptance_receipts LIMIT 1",
        "SELECT access_revision,last_access_operation FROM pilot_accounts LIMIT 1",
        "SELECT sequence,event_id,scope,subject,subject_hash,public_id,household_id,active,published FROM site_security_outbox LIMIT 1",
        "SELECT subject_hash,public_id,active,security_revision FROM protected_account_access LIMIT 1",
        "SELECT household_id,subject_hash,public_id,active,security_revision FROM protected_membership_state LIMIT 1",
        "SELECT * FROM legacy_space_capacity LIMIT 1",
        "SELECT * FROM content_space_usage LIMIT 1",
        "SELECT day,sampled_at,normal_enabled,account_count,household_count,logical_bytes FROM site_usage_samples LIMIT 1",
      ])
        db.prepare(query).all();
      for (const [name, table] of [
        ["revoke_departed_issuer_email", "household_heads"],
        ["revoke_suspended_issuer_email", "pilot_accounts"],
        ["retire_legacy_invitation_writes", "household_invitations"],
        ["retire_legacy_allocation_inserts", "household_allocations"],
        ["retire_legacy_allocation_updates", "household_allocations"],
        ["retire_legacy_ceiling_updates", "household_heads"],
        ["record_account_access_change", "pilot_accounts"],
        ["record_account_admission", "pilot_accounts"],
        ["record_head_admission", "household_heads"],
        ["record_head_access_change", "household_heads"],
      ])
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?",
            )
            .get(name, table)
        )
          throw new Error(
            "Backup is missing normal-account security protection.",
          );
      if (
        !db
          .prepare(
            "SELECT 1 FROM security_replay_control WHERE id=1 AND replaying=0",
          )
          .get() ||
        !db.prepare("SELECT 1 FROM site_safety_policy WHERE id=1").get() ||
        !db.prepare("SELECT 1 FROM invitation_growth WHERE id=1").get() ||
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='one_pending_email_invitation'",
          )
          .get() ||
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='email_accounting_review'",
          )
          .get() ||
        db
          .prepare(
            "SELECT 1 FROM email_invitations i JOIN households h ON h.id=i.household_id WHERE h.status='erased' LIMIT 1",
          )
          .get()
      )
        throw new Error(
          "Backup contains incomplete normal-account protection or erased household mail.",
        );
    }
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

export async function createBackup(
  store,
  sql,
  seal,
  at = new Date(),
  { recoverySqlBytes } = {},
) {
  verifySql(sql);
  if (
    recoverySqlBytes !== undefined &&
    (!Number.isSafeInteger(recoverySqlBytes) || recoverySqlBytes <= 0)
  )
    throw new Error("Invalid backup measurement.");
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
    sql_bytes: sql.length,
    ...(recoverySqlBytes === undefined
      ? {}
      : { recovery_sql_bytes: recoverySqlBytes }),
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
  for (const field of ["sql_bytes", "recovery_sql_bytes"])
    if (
      Object.hasOwn(marker, field) &&
      (!Number.isSafeInteger(marker[field]) ||
        marker[field] <= 0 ||
        (field === "sql_bytes" && marker[field] > MAX_BYTES))
    )
      throw new Error("Invalid backup measurement.");
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
    sql_bytes: marker.sql_bytes ?? null,
    recovery_sql_bytes: marker.recovery_sql_bytes ?? null,
    budget_bytes: MAX_BYTES,
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
