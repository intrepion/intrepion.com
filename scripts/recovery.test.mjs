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
        6,
      );
      assert.equal(restored.prepare("SELECT count(*) n FROM tasks").get().n, 0);
    } finally {
      restored.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
