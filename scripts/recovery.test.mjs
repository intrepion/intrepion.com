import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync, constants } from "node:sqlite";
import { B2, encrypt, verifySql } from "./backups.mjs";
import { recoverArchive, readErasureLedger } from "./recovery.mjs";
const databaseId = "00000000-0000-0000-0000-000000000001";
const id = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const migrations = (
  await Promise.all(
    [
      "0001_initial",
      "0002_retired_task_ids",
      "0003_everyday_collections",
      "0004_list_items_and_sections",
      "0005_migrate_personal_tasks",
      "0006_erasure_protocol",
    ].map((name) => readFile(`server/migrations/${name}.sql`, "utf8")),
  )
).join("\n");

test("encrypted recovery reapplies later collection and item erasures before producing usable SQL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intrepion-recovery-"));
  try {
    const identity = join(directory, "identity.agekey");
    const keygen = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-o", identity],
      { encoding: "utf8" },
    );
    assert.equal(
      keygen.status,
      0,
      "age-keygen must be installed for recovery verification",
    );
    const recipient = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-y", identity],
      { encoding: "utf8" },
    ).stdout.trim();
    const sql = Buffer.from(
      migrations +
        `\n
      INSERT INTO collections(owner_sub,id,kind,title,notes,last_operation) VALUES
        ('previous-owner','${id(1)}',3,'Erased private recipe','Erased source note','${id(101)}'),
        ('previous-owner','${id(2)}',4,'Independent cooking run','Retained copied note','${id(102)}'),
        ('previous-owner','${id(3)}',2,'Retained groceries','','${id(103)}'),
        ('previous-owner','${id(4)}',1,'Erased personal task','','${id(104)}');
      INSERT INTO list_items(owner_sub,collection_id,id,title,notes,trashed,position) VALUES
        ('previous-owner','${id(1)}','${id(11)}','Erased source step','',0,0),
        ('previous-owner','${id(1)}','${id(12)}','Erased trashed step','',1,1),
        ('previous-owner','${id(2)}','${id(21)}','Independent copied step','',0,0),
        ('previous-owner','${id(3)}','${id(31)}','Erased private shopping item','Erased shopping note',1,0);
      INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json) VALUES
        ('previous-owner','${id(1)}','${id(101)}','${id(1)}','Erased private recipe','Created','null','{}'),
        ('previous-owner','${id(3)}','${id(103)}','${id(31)}','Erased private shopping item','Created','null','{"notes":"Erased shopping note"}');
      INSERT INTO sessions VALUES('old-session','previous-owner','old-csrf',9999999999);
      INSERT INTO login_challenges VALUES('old-login',9999999999);
    `,
    );
    const archive = encrypt(sql, recipient);
    assert.equal(archive.includes("Erased private"), false);
    const records = [
      {
        version: 1,
        database_id: databaseId,
        operation_id: id(201),
        collection_id: id(1),
        scope: "collection",
        target_id: "",
      },
      {
        version: 1,
        database_id: databaseId,
        operation_id: id(202),
        collection_id: id(3),
        scope: "item",
        target_id: id(31),
      },
      {
        version: 1,
        database_id: databaseId,
        operation_id: id(203),
        collection_id: id(4),
        scope: "collection",
        target_id: "",
      },
    ];
    const output = await recoverArchive(archive, identity, {
      databaseId,
      records: [...records, records[0]],
      complete: true,
    });
    verifySql(output);
    const restored = new DatabaseSync(":memory:");
    // Hosted D1 rejects explicit transactions. Enforce that documented import
    // restriction at SQLite's statement boundary; string contents stay data.
    restored.setAuthorizer((action) =>
      [constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT].includes(
        action,
      )
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK,
    );
    try {
      restored.exec(output.toString());
      assert.deepEqual(
        restored
          .prepare("SELECT title FROM collections ORDER BY id")
          .all()
          .map((row) => row.title),
        ["Independent cooking run", "Retained groceries"],
      );
      assert.deepEqual(
        restored
          .prepare("SELECT title FROM list_items")
          .all()
          .map((row) => row.title),
        ["Independent copied step"],
      );
      assert.equal(
        restored.prepare("SELECT count(*) n FROM collection_history").get().n,
        0,
      );
      assert.equal(
        restored.prepare("SELECT count(*) n FROM sessions").get().n,
        0,
      );
      assert.equal(
        restored.prepare("SELECT count(*) n FROM login_challenges").get().n,
        0,
      );
      assert.throws(() =>
        restored
          .prepare(
            "INSERT INTO list_items(owner_sub,collection_id,id,title,position) VALUES(?,?,?,?,0)",
          )
          .run("previous-owner", id(3), id(31), "Must not resurrect"),
      );
      assert.throws(() =>
        restored
          .prepare(
            "INSERT INTO collections(owner_sub,id,kind,title,last_operation) VALUES(?,?,2,?,?)",
          )
          .run("new-owner", id(1), "Must not resurrect", id(999)),
      );
    } finally {
      restored.close();
    }
    assert.equal(output.includes("Erased private"), false);
    assert.equal(output.includes("Erased shopping note"), false);
    await assert.rejects(
      recoverArchive(archive, identity, {
        databaseId,
        records,
        complete: false,
      }),
    );
    await assert.rejects(
      recoverArchive(archive, identity, {
        databaseId: id(999),
        records,
        complete: true,
      }),
    );
    await assert.rejects(
      recoverArchive(archive, identity, {
        databaseId,
        records: [{ ...records[0], title: "Forbidden content" }],
        complete: true,
      }),
    );
    await writeFile(join(directory, "recovered.sql"), output, { mode: 0o600 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery reads every immutable ledger version and rejects broad provider credentials", async () => {
  const record = {
    version: 1,
    database_id: databaseId,
    operation_id: id(501),
    collection_id: id(1),
    scope: "collection",
    target_id: "",
  };
  const bytes = Buffer.from(JSON.stringify(record));
  const checksum = (await import("node:crypto"))
    .createHash("sha1")
    .update(bytes)
    .digest("hex");
  const name = `erasures/${databaseId}/${record.operation_id}.json`;
  const requests = [];
  const info = {
    authorizationToken: "synthetic-read-token",
    apiInfo: {
      storageApi: {
        apiUrl: "https://api001.backblazeb2.com",
        downloadUrl: "https://f001.backblazeb2.com",
        allowed: {
          buckets: [{ id: "ledger-bucket" }],
          namePrefix: `erasures/${databaseId}/`,
          capabilities: ["listFiles", "readFiles"],
        },
      },
    },
  };
  const store = new B2(info, "ledger-bucket", async (url, options) => {
    requests.push({
      url,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    if (url.includes("b2_download_file_by_id")) return new Response(bytes);
    const second = JSON.parse(options.body).startFileId === "version-two";
    return Response.json({
      files: [
        {
          fileName: name,
          fileId: second ? "version-two" : "version-one",
          action: "upload",
          contentLength: bytes.length,
          contentSha1: checksum,
        },
      ],
      ...(second ? {} : { nextFileName: name, nextFileId: "version-two" }),
    });
  });
  const ledger = await readErasureLedger(store, databaseId);
  assert.equal(ledger.complete, true);
  assert.equal(ledger.records.length, 2);
  assert.equal(
    requests.filter((r) => r.url.includes("b2_list_file_versions")).length,
    2,
  );
  const broad = structuredClone(info);
  broad.apiInfo.storageApi.allowed.capabilities.push("deleteFiles");
  await assert.rejects(
    readErasureLedger(
      new B2(broad, "ledger-bucket", async () => {
        throw new Error("Must reject before provider read");
      }),
      databaseId,
    ),
  );
});

test("recovering an MVP 1 archive upgrades retained tasks and the migration ledger before replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intrepion-legacy-recovery-"));
  try {
    const identity = join(directory, "identity.agekey");
    const keygen = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-o", identity],
      { encoding: "utf8" },
    );
    assert.equal(keygen.status, 0);
    const recipient = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-y", identity],
      { encoding: "utf8" },
    ).stdout.trim();
    const legacy = Buffer.from(
      (
        await Promise.all(
          ["0001_initial", "0002_retired_task_ids"].map((name) =>
            readFile(`server/migrations/${name}.sql`, "utf8"),
          ),
        )
      ).join("\n") +
        `\nCREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);INSERT INTO d1_migrations(name) VALUES('0001_initial.sql'),('0002_retired_task_ids.sql');INSERT INTO tasks(owner_sub,id,title,notes,completed,revision) VALUES('old-owner','${id(601)}','Retained legacy task','Original notes',1,7),('old-owner','${id(602)}','Permanently erased later','Private notes',0,1);`,
    );
    const { estimateRecoverySqlBytes } = await import("./recovery.mjs");
    const withoutErasures = await recoverArchive(
      encrypt(legacy, recipient),
      identity,
      {
        databaseId,
        records: [],
        complete: true,
      },
    );
    assert.equal(
      await estimateRecoverySqlBytes(legacy),
      withoutErasures.length,
    );
    const record = {
      version: 1,
      database_id: databaseId,
      operation_id: id(603),
      collection_id: id(602),
      scope: "collection",
      target_id: "",
    };
    const output = await recoverArchive(encrypt(legacy, recipient), identity, {
      databaseId,
      records: [record],
      complete: true,
    });
    const restored = new DatabaseSync(":memory:");
    try {
      restored.exec(output.toString());
      assert.deepEqual(
        restored
          .prepare("SELECT title,notes,completed,revision FROM collections")
          .get(),
        Object.assign(Object.create(null), {
          title: "Retained legacy task",
          notes: "Original notes",
          completed: 1,
          revision: 7,
        }),
      );
      assert.equal(
        restored.prepare("SELECT action FROM collection_history").get().action,
        "Existing task at MVP 2 migration",
      );
      assert.equal(
        restored.prepare("SELECT count(*) n FROM d1_migrations").get().n,
        35,
      );
      assert.equal(restored.prepare("SELECT count(*) n FROM tasks").get().n, 0);
    } finally {
      restored.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted recovery cannot reopen a household closed after the snapshot or reuse a pre-snapshot closure identity", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "intrepion-household-recovery-"),
  );
  try {
    const identity = join(directory, "identity.agekey");
    const keygen = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-o", identity],
      { encoding: "utf8" },
    );
    assert.equal(keygen.status, 0);
    const recipient = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-y", identity],
      { encoding: "utf8" },
    ).stdout.trim();
    const householdMigrations = (
      await Promise.all(
        [
          "0007_pilot_accounts",
          "0008_household_foundation",
          "0009_transactional_limits",
          "0010_active_erasure_confirmation",
          "0011_household_lifecycle",
        ].map((name) => readFile(`server/migrations/${name}.sql`, "utf8")),
      )
    ).join("\n");
    const completeSchema = (
      await Promise.all(
        [
          "0012_budget_aware_writers",
          "0013_household_content_erasure",
          "0014_operator_policy",
        ].map((name) => readFile(`server/migrations/${name}.sql`, "utf8")),
      )
    ).join("\n");
    const sql = Buffer.from(
      migrations +
        householdMigrations +
        `
      INSERT INTO pilot_accounts(subject,display_name,public_id) VALUES('head-one','Alex','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      INSERT INTO households(id,scope_sub,name,created_by,last_operation) VALUES('${id(701)}','household:${id(701)}','Retained closed name','head-one','${id(702)}');
      INSERT INTO household_heads(household_id,subject,ceilings_json) VALUES('${id(701)}','head-one','{}');
      INSERT INTO household_allocations(household_id,subject,amounts_json) VALUES('${id(701)}','head-one','{"items":10,"bytes":4096}');
      INSERT INTO collections(owner_sub,id,kind,title,last_operation,creator_sub) VALUES('household:${id(701)}','${id(703)}',2,'Retained until erasure','${id(704)}','head-one');
      INSERT INTO list_items(owner_sub,collection_id,id,title,position,creator_sub) VALUES('household:${id(701)}','${id(703)}','${id(706)}','Erased shared child',0,'head-one');
      INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json,actor_sub) VALUES('household:${id(701)}','${id(703)}','${id(704)}','${id(703)}','Erased shared History','Created','null','{}','head-one');
      INSERT INTO collections(owner_sub,id,kind,title,last_operation,creator_sub) VALUES('head-one','${id(707)}',4,'Independent personal copy','${id(708)}','head-one');
      INSERT INTO collections(owner_sub,id,kind,title,last_operation,creator_sub) VALUES('household:${id(701)}','${id(716)}',2,'Later shared content','${id(717)}','head-one');
      INSERT INTO household_invitations(id,household_id,recipient_sub,token_hash,expires_at,created_by) VALUES('${id(705)}','${id(701)}','head-one','hash-only',9999999999,'head-one');
    ` +
        completeSchema +
        "\nCREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP); INSERT INTO d1_migrations(name) VALUES('0014_operator_policy.sql');",
    );
    await assert.rejects(
      recoverArchive(
        encrypt(
          Buffer.concat([
            sql,
            Buffer.from("\nDROP TRIGGER no_household_reopening;"),
          ]),
          recipient,
        ),
        identity,
        { databaseId, complete: true, records: [] },
      ),
      /household protection/,
    );
    const bulk = {
      version: 3,
      database_id: databaseId,
      operation_id: id(718),
      collection_id: id(701),
      scope: "household_content",
      target_id: "",
      collection_ids: [id(703)],
    };
    const bulkOutput = await recoverArchive(encrypt(sql, recipient), identity, {
      databaseId,
      complete: true,
      records: [bulk],
    });
    const afterBulk = new DatabaseSync(":memory:");
    try {
      afterBulk.exec(bulkOutput.toString());
      assert.equal(
        afterBulk
          .prepare("SELECT status FROM households WHERE id=?")
          .get(id(701)).status,
        "active",
      );
      assert.equal(
        afterBulk.prepare("SELECT count(*) n FROM household_allocations").get()
          .n,
        1,
      );
      assert.deepEqual(
        afterBulk
          .prepare("SELECT title FROM collections ORDER BY id")
          .all()
          .map((r) => r.title),
        ["Independent personal copy", "Later shared content"],
      );
      assert.equal(
        afterBulk.prepare("SELECT count(*) n FROM collection_history").get().n,
        0,
      );
    } finally {
      afterBulk.close();
    }
    await assert.rejects(
      recoverArchive(encrypt(sql, recipient), identity, {
        databaseId,
        complete: true,
        records: [{ ...bulk, collection_ids: [id(707)] }],
      }),
      /outside.*household/,
    );
    const record = {
      version: 2,
      database_id: databaseId,
      operation_id: id(710),
      collection_id: id(701),
      scope: "household_closed",
      target_id: "",
      erase_due_at: 1761955200,
    };
    const output = await recoverArchive(encrypt(sql, recipient), identity, {
      databaseId,
      complete: true,
      records: [
        record,
        { ...record, operation_id: id(711), collection_id: id(799) },
      ],
    });
    verifySql(output);
    const restored = new DatabaseSync(":memory:");
    try {
      restored.exec(output.toString());
      assert.throws(
        () =>
          restored
            .prepare(
              "UPDATE collections SET title='Old writer bypass' WHERE id=?",
            )
            .run(id(707)),
        /budget-aware writer/,
      );

      assert.equal(
        restored
          .prepare("SELECT status FROM households WHERE id=?")
          .get(id(701)).status,
        "closed",
      );
      assert.equal(
        restored
          .prepare("SELECT erase_due_at FROM households WHERE id=?")
          .get(id(701)).erase_due_at,
        1761955200,
      );
      assert.equal(
        restored
          .prepare("SELECT active FROM household_heads WHERE household_id=?")
          .get(id(701)).active,
        0,
      );
      assert.equal(
        restored
          .prepare("SELECT status FROM household_invitations WHERE id=?")
          .get(id(705)).status,
        "revoked",
      );
      assert.equal(
        restored
          .prepare("SELECT title FROM collections WHERE id=?")
          .get(id(703)).title,
        "Retained until erasure",
      );
      assert.equal(
        restored
          .prepare(
            "SELECT json_extract(amounts_json,'$.bytes') n FROM household_allocations WHERE household_id=?",
          )
          .get(id(701)).n,
        4096,
      );
      assert.throws(() =>
        restored
          .prepare("UPDATE households SET status='active' WHERE id=?")
          .run(id(701)),
      );
      assert.throws(() =>
        restored
          .prepare(
            "INSERT INTO households(id,scope_sub,name,created_by,last_operation) VALUES(?,?,?,?,?)",
          )
          .run(
            id(799),
            `household:${id(799)}`,
            "Must remain closed",
            "head-one",
            id(712),
          ),
      );
    } finally {
      restored.close();
    }
    const erased = await recoverArchive(encrypt(sql, recipient), identity, {
      databaseId,
      complete: true,
      // Provider listing order must not let the older closure marker undo erasure.
      records: [
        { ...record, scope: "household", operation_id: id(713) },
        record,
        {
          ...record,
          scope: "household",
          collection_id: id(799),
          operation_id: id(714),
        },
      ],
    });
    const afterErasure = new DatabaseSync(":memory:");
    try {
      afterErasure.exec(erased.toString());
      assert.equal(
        afterErasure
          .prepare("SELECT status FROM households WHERE id=?")
          .get(id(701)).status,
        "erased",
      );
      assert.deepEqual(
        afterErasure
          .prepare("SELECT title FROM collections")
          .all()
          .map((r) => r.title),
        ["Independent personal copy"],
      );
      for (const table of [
        "list_items",
        "collection_history",
        "household_heads",
        "household_invitations",
        "household_allocations",
        "household_lifecycle",
      ])
        assert.equal(
          afterErasure.prepare(`SELECT count(*) n FROM ${table}`).get().n,
          0,
        );
      assert.equal(
        afterErasure
          .prepare(
            "SELECT subject FROM household_releases WHERE household_id=?",
          )
          .get(id(701)).subject,
        "head-one",
      );
      assert.throws(() =>
        afterErasure
          .prepare(
            "INSERT INTO households(id,scope_sub,name,created_by,last_operation) VALUES(?,?,?,?,?)",
          )
          .run(
            id(799),
            `household:${id(799)}`,
            "Never reopen",
            "head-one",
            id(715),
          ),
      );
      assert.throws(() =>
        afterErasure
          .prepare(
            "INSERT INTO list_items(owner_sub,collection_id,id,title,position) VALUES(?,?,?,?,0)",
          )
          .run("head-one", id(707), id(706), "Never resurrect"),
      );
    } finally {
      afterErasure.close();
    }
    assert.equal(erased.includes("Retained closed name"), false);
    assert.equal(erased.includes("Erased shared History"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized recovery estimates stay measurable while encrypted restores keep the 20 MiB ceiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intrepion-size-recovery-"));
  try {
    const identity = join(directory, "identity.agekey");
    assert.equal(
      spawnSync(process.env.AGE_KEYGEN_BIN ?? "age-keygen", ["-o", identity])
        .status,
      0,
    );
    const recipient = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-y", identity],
      { encoding: "utf8" },
    ).stdout.trim();
    const rows = Array.from(
      { length: 2270 },
      (_, n) =>
        `('owner','${id(10000 + n)}',1,'Synthetic size fixture','${"x".repeat(9000)}','${id(20000 + n)}')`,
    );
    const input = Buffer.from(
      migrations +
        "\nINSERT INTO collections(owner_sub,id,kind,title,notes,last_operation) VALUES" +
        rows.join(",") +
        ";",
    );
    assert.ok(input.length < 20_971_520);
    const { estimateRecoverySqlBytes } = await import("./recovery.mjs");
    assert.ok((await estimateRecoverySqlBytes(input)) > 20_971_520);
    await assert.rejects(
      recoverArchive(encrypt(input, recipient), identity, {
        databaseId,
        records: [],
        complete: true,
      }),
      /Recovery output exceeds the MVP size budget/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted recovery preserves later account suspensions and head removals and pauses invitation growth", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "intrepion-security-recovery-"),
  );
  try {
    const identity = join(directory, "identity.agekey");
    const keygen = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-o", identity],
      { encoding: "utf8" },
    );
    assert.equal(keygen.status, 0);
    const recipient = spawnSync(
      process.env.AGE_KEYGEN_BIN ?? "age-keygen",
      ["-y", identity],
      { encoding: "utf8" },
    ).stdout.trim();
    const files = [
      "0001_initial",
      "0002_retired_task_ids",
      "0003_everyday_collections",
      "0004_list_items_and_sections",
      "0005_migrate_personal_tasks",
      "0006_erasure_protocol",
      "0007_pilot_accounts",
      "0008_household_foundation",
      "0009_transactional_limits",
      "0010_active_erasure_confirmation",
      "0011_household_lifecycle",
      "0012_budget_aware_writers",
      "0013_household_content_erasure",
      "0014_operator_policy",
    ];
    const schema = (
      await Promise.all(
        files.map((name) => readFile(`server/migrations/${name}.sql`, "utf8")),
      )
    ).join("\n");
    const publicId = (n) => String(n).padStart(32, "0");
    const sql = Buffer.from(
      schema +
        `\n
   INSERT INTO pilot_accounts(subject,display_name,public_id) VALUES('restore-owner','Owner','${publicId(1)}'),('later-suspended','Suspended head','${publicId(2)}'),('later-removed','Removed head','${publicId(3)}');
   INSERT INTO households(id,scope_sub,name,created_by,last_operation) VALUES('${id(901)}','household:${id(901)}','Recovery household','restore-owner','${id(902)}');
   INSERT INTO household_heads(household_id,subject,ceilings_json) VALUES('${id(901)}','restore-owner','{}'),('${id(901)}','later-suspended','{}'),('${id(901)}','later-removed','{}');
   INSERT INTO household_invitations(id,household_id,recipient_sub,token_hash,expires_at,created_by) VALUES('${id(903)}','${id(901)}','later-suspended','old-invitation-hash',9999999999,'restore-owner');
   INSERT INTO sessions VALUES('old-session','later-suspended','old-csrf',9999999999);
   INSERT INTO login_challenges VALUES('old-login',9999999999);
  `,
    );
    const marker = (n, scope, subject, public_id, revision) => ({
      version: 4,
      database_id: databaseId,
      operation_id: id(n),
      collection_id:
        scope === "head_membership"
          ? id(901)
          : "00000000-0000-0000-0000-000000000000",
      scope,
      target_id: "",
      security: {
        subject_hash: createHash("sha256").update(subject).digest("hex"),
        public_id,
        revision,
        active: false,
      },
    });
    const suspension = marker(
      910,
      "account_access",
      "later-suspended",
      publicId(2),
      10,
    );
    const removal = marker(
      911,
      "head_membership",
      "later-removed",
      publicId(3),
      11,
    );
    const output = await recoverArchive(encrypt(sql, recipient), identity, {
      databaseId,
      complete: true,
      records: [removal, suspension, suspension],
    });
    await assert.rejects(
      recoverArchive(
        encrypt(
          Buffer.concat([
            output,
            Buffer.from("\nDROP TRIGGER record_account_access_change;"),
          ]),
          recipient,
        ),
        identity,
        { databaseId, complete: true, records: [removal, suspension] },
      ),
      /normal.account.*protection/i,
    );
    const unknownIdentity = marker(
      930,
      "account_access",
      "not-in-snapshot",
      publicId(8),
      12,
    );
    const conflictingIdentity = marker(
      931,
      "head_membership",
      "not-in-snapshot",
      publicId(9),
      13,
    );
    await assert.rejects(
      recoverArchive(encrypt(output, recipient), identity, {
        databaseId,
        complete: true,
        records: [suspension, removal, unknownIdentity, conflictingIdentity],
      }),
      /conflicting.*identity/i,
    );
    // A backup can contain a newer restriction that had not yet reached the
    // independent ledger. An older published restoration must not undo it.
    const pendingRestriction = Buffer.concat([
      output,
      Buffer.from(`
      UPDATE security_replay_control SET replaying=1 WHERE id=1;
      UPDATE pilot_accounts SET approved=0 WHERE subject='later-removed';
      INSERT INTO site_security_outbox(sequence,event_id,scope,subject,public_id,household_id,active,published) VALUES(12,'${id(912)}','account_access','later-removed','${publicId(3)}','00000000-0000-0000-0000-000000000000',0,0);
      UPDATE security_replay_control SET replaying=0 WHERE id=1;
      INSERT INTO email_send_attempts(id,invitation_id,generation,recipient_email,attempted_at) VALUES('${id(914)}','${id(903)}',1,'expired-log@example.invalid',unixepoch()-31*86400);
      INSERT INTO email_feedback_receipts(id,digest,claim_id,received_at) VALUES('${id(915)}','test-digest','test-claim',unixepoch()-31*86400);
      INSERT INTO site_audit(operation_id,actor_sub,action,occurred_at) VALUES('${id(916)}','restore-owner','Expired audit',unixepoch('now','-2 years'));
      INSERT INTO email_suppressions(recipient_email,reason) VALUES('retained-block@example.invalid','complaint');
      INSERT INTO household_request_links(id,household_id,created_by,token_hash,expires_at) VALUES('${id(926)}','${id(901)}','restore-owner','request-link-hash',unixepoch()+86400);
      INSERT INTO household_invitation_requests(id,household_id,link_id,user_sub,email,display_name,status,consent_version,requested_at,expires_at,closed_at) VALUES('${id(927)}','${id(901)}','${id(926)}','old-requester','old@example.invalid','Old requester','declined','v1',unixepoch()-40*86400,unixepoch()-33*86400,unixepoch()-31*86400);
      INSERT INTO household_request_operations(user_sub,operation_id,link_id,request_id) VALUES('old-requester','${id(928)}','${id(926)}','${id(927)}');
      INSERT INTO household_request_decisions(actor_sub,operation_id,request_id,household_id,action) VALUES('restore-owner','${id(929)}','${id(927)}','${id(901)}','decline');
      INSERT INTO household_invitation_requests(id,household_id,link_id,user_sub,email,display_name,status,consent_version,requested_at,expires_at) VALUES('${id(945)}','${id(901)}','${id(926)}','waiting-requester','waiting@example.invalid','Waiting','pending','v1',unixepoch(),unixepoch()+86400);
      INSERT INTO household_request_notification_settings(household_id,head_sub,enabled,confirmed_email) VALUES('${id(901)}','restore-owner',1,'head@example.invalid');
      INSERT INTO household_request_notifications(id,request_id,household_id,head_sub,recipient_email) VALUES('${id(946)}','${id(945)}','${id(901)}','restore-owner','head@example.invalid');
      INSERT OR REPLACE INTO email_monthly_attempts(month,attempted) VALUES(strftime('%Y-%m','now'),9999);
    `),
    ]);
    const olderRestoration = marker(
      913,
      "account_access",
      "later-removed",
      publicId(3),
      9,
    );
    olderRestoration.security.active = true;
    const recoveredPending = await recoverArchive(
      encrypt(pendingRestriction, recipient),
      identity,
      {
        databaseId,
        complete: true,
        records: [olderRestoration, removal, suspension],
      },
    );
    const pendingDb = new DatabaseSync(":memory:");
    try {
      pendingDb.exec(recoveredPending.toString());
      assert.equal(
        pendingDb
          .prepare(
            "SELECT enabled FROM household_request_notification_settings WHERE household_id=? AND head_sub='restore-owner'",
          )
          .get(id(901)).enabled,
        0,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT status FROM household_request_notifications WHERE id=?",
          )
          .get(id(946)).status,
        "canceled",
      );
      assert.equal(
        pendingDb
          .prepare("SELECT revoked FROM household_request_links WHERE id=?")
          .get(id(926)).revoked,
        1,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT count(*) n FROM household_invitation_requests WHERE id=?",
          )
          .get(id(927)).n,
        0,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT count(*) n FROM household_request_operations WHERE request_id=?",
          )
          .get(id(927)).n,
        0,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT count(*) n FROM household_request_decisions WHERE request_id=?",
          )
          .get(id(927)).n,
        0,
      );
      assert.equal(
        pendingDb.prepare("SELECT count(*) n FROM email_send_attempts").get().n,
        0,
      );
      assert.equal(
        pendingDb
          .prepare("SELECT count(*) n FROM email_feedback_receipts")
          .get().n,
        0,
      );
      assert.equal(
        pendingDb.prepare("SELECT count(*) n FROM site_audit").get().n,
        0,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT reason FROM email_suppressions WHERE recipient_email='retained-block@example.invalid'",
          )
          .get().reason,
        "complaint",
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT attempted FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now')",
          )
          .get().attempted,
        10000,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT accounting_state FROM email_monthly_attempts WHERE month=strftime('%Y-%m','now')",
          )
          .get().accounting_state,
        "recovery_hold",
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT approved FROM pilot_accounts WHERE subject='later-removed'",
          )
          .get().approved,
        0,
      );
      assert.equal(
        pendingDb
          .prepare(
            "SELECT published FROM site_security_outbox WHERE sequence=12",
          )
          .get().published,
        0,
      );
    } finally {
      pendingDb.close();
    }
    const withHouseholdMail = Buffer.concat([
      pendingRestriction,
      Buffer.from(`
      INSERT INTO email_invitations(id,household_id,recipient_email,token_hash,expires_at,created_by,last_operation) VALUES('${id(919)}','${id(901)}','household-recipient@example.invalid','unique-erasure-test-hash',unixepoch()+86400,'restore-owner','${id(920)}');
      INSERT INTO email_send_attempts(id,invitation_id,generation,recipient_email,attempted_at) VALUES('${id(921)}','${id(919)}',1,'household-recipient@example.invalid',unixepoch());
      INSERT INTO email_feedback_receipts(id,digest,claim_id,invitation_id) VALUES('${id(922)}','test-digest','test-claim','${id(919)}');
      INSERT INTO email_invitation_operations(actor_sub,operation_id,fingerprint,invitation_id) VALUES('restore-owner','${id(923)}','test-fingerprint','${id(919)}');
      INSERT INTO invitation_acceptance_receipts(user_sub,operation_id,fingerprint,invitation_id,household_id) VALUES('later-removed','${id(924)}','test-fingerprint','${id(919)}','${id(901)}');
      INSERT INTO household_invitation_requests(id,household_id,link_id,user_sub,email,display_name,status,consent_version,requested_at,expires_at) VALUES('${id(940)}','${id(901)}','${id(926)}','live-requester','live@example.invalid','Live requester','pending','v1',unixepoch(),unixepoch()+86400);
      INSERT INTO household_request_operations(user_sub,operation_id,link_id,request_id) VALUES('live-requester','${id(941)}','${id(926)}','${id(940)}');
    `),
    ]);
    const erased = await recoverArchive(
      encrypt(withHouseholdMail, recipient),
      identity,
      {
        databaseId,
        complete: true,
        records: [
          suspension,
          removal,
          {
            version: 2,
            database_id: databaseId,
            operation_id: id(925),
            collection_id: id(901),
            scope: "household",
            target_id: "",
            erase_due_at: 1,
          },
        ],
      },
    );
    const erasedDb = new DatabaseSync(":memory:");
    try {
      erasedDb.exec(erased.toString());
      for (const table of [
        "household_request_links",
        "household_invitation_requests",
        "household_request_operations",
        "household_request_decisions",
        "household_request_notifications",
        "household_request_notification_settings",
        "email_invitations",
        "email_send_attempts",
        "email_feedback_receipts",
        "email_invitation_operations",
        "invitation_acceptance_receipts",
      ])
        assert.equal(
          erasedDb.prepare(`SELECT count(*) n FROM ${table}`).get().n,
          0,
          `${table} must not retain erased household invitation data`,
        );
      assert.equal(
        erasedDb
          .prepare(
            "SELECT reason FROM email_suppressions WHERE recipient_email='retained-block@example.invalid'",
          )
          .get().reason,
        "complaint",
      );
    } finally {
      erasedDb.close();
    }
    verifySql(output);
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(output.toString());
      assert.equal(
        db
          .prepare(
            "SELECT approved FROM pilot_accounts WHERE subject='later-suspended'",
          )
          .get().approved,
        0,
      );
      assert.equal(
        db
          .prepare(
            "SELECT active FROM household_heads WHERE subject='later-removed'",
          )
          .get().active,
        0,
      );
      assert.equal(
        db
          .prepare(
            "SELECT active FROM household_heads WHERE subject='restore-owner'",
          )
          .get().active,
        1,
      );
      assert.equal(
        db
          .prepare("SELECT status FROM household_invitations WHERE id=?")
          .get(id(903)).status,
        "revoked",
      );
      assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
      assert.equal(
        db.prepare("SELECT count(*) n FROM onboarding_sessions").get().n,
        0,
      );
      assert.equal(
        db.prepare("SELECT paused FROM invitation_growth WHERE id=1").get()
          .paused,
        1,
      );
      assert.equal(
        db
          .prepare(
            "SELECT active FROM protected_account_access WHERE subject_hash=?",
          )
          .get(suspension.security.subject_hash).active,
        0,
      );
      assert.ok(
        db
          .prepare(
            "SELECT seq FROM sqlite_sequence WHERE name='site_security_outbox'",
          )
          .get().seq >= 11,
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
