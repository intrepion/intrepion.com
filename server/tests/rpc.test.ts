import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "../../web/src/gen/life/v1/tasks_pb.js";
import {
  ListService,
  CollectionKind,
  ChangeAction,
} from "../../web/src/gen/life/v1/lists_pb.js";
import type { Collection } from "../../web/src/gen/life/v1/lists_pb.js";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ChangeRequestSchema } from "../../web/src/gen/life/v1/lists_pb.js";
// @ts-expect-error JavaScript process helpers are used only by local/CI tests.
import { start, stop, ready, localEnv } from "../../scripts/processes.mjs";
import type { ChildProcess } from "node:child_process";

const baseUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:8788";
const client = createClient(TaskService, createConnectTransport({ baseUrl }));
const lists = createClient(ListService, createConnectTransport({ baseUrl }));
const origin = "http://127.0.0.1:4322";
let server: ChildProcess;
before(async () => {
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
});
after(async () => {
  await stop(server);
});
test("MVP 1 tasks survive migration with a truthful history baseline and compatible task RPCs", async () => {
  const owner = await login();
  const migrated = await lists.getCollection(
    { id: "00000000-0000-4000-a000-000000000042" },
    owner,
  );
  assert.equal(migrated.title, "Migrated personal task");
  assert.equal(migrated.notes, "Keep the original notes");
  assert.equal(migrated.completed, true);
  assert.equal(migrated.revision, 7);
  const baseline = (
    await lists.listHistory({ collectionId: migrated.id }, owner)
  ).entries;
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0]!.action, "Existing task at MVP 2 migration");
  assert.equal(baseline[0]!.beforeJson, "null");
  assert.equal(
    (await client.listTasks({}, owner)).tasks.find((t) => t.id === migrated.id)
      ?.notes,
    "Keep the original notes",
  );
  const trashed = (
    await lists.applyChange(
      changeRequest(migrated, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  assert.equal(trashed.completed, true);
  assert.equal(trashed.trashed, true);
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some((t) => t.id === migrated.id),
    false,
  );
});
test("anonymous callers cannot list private tasks", async () => {
  await assert.rejects(
    client.listTasks({}),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
});

async function login() {
  const challenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  assert.equal(challenge.status, 200);
  const { nonce } = (await challenge.json()) as { nonce: string };
  const response = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: challenge.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({ nonce, credential: "" }),
  });
  assert.equal(response.status, 200);
  const { csrf } = (await response.json()) as { csrf: string };
  return {
    headers: {
      origin,
      "x-csrf-token": csrf,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
  };
}

test("owner writes survive an API restart and a session re-login", async () => {
  const owner = await login();
  const task = await client.createTask(
    { id: crypto.randomUUID(), title: "Persistent 🦀", notes: "Local D1" },
    owner,
  );
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
  assert.equal(
    (await client.listTasks({}, owner)).tasks.find((t) => t.id === task.id)
      ?.title,
    "Persistent 🦀",
  );
  assert.equal(
    (await client.listTasks({}, await login())).tasks.find(
      (t) => t.id === task.id,
    )?.notes,
    "Local D1",
  );
  await client.deleteTask({ id: task.id, revision: task.revision }, owner);
});

test("create, update and delete retries are idempotent and stale edits do not overwrite data", async () => {
  const owner = await login();
  const request = {
    id: crypto.randomUUID(),
    title: "Retry once",
    notes: "Original",
  };
  const created = await client.createTask(request, owner);
  assert.equal((await client.createTask(request, owner)).id, created.id);
  assert.equal(
    (await client.listTasks({}, owner)).tasks.filter((t) => t.id === created.id)
      .length,
    1,
  );
  const desired = { ...created, completed: true };
  const updated = await client.updateTask(desired, owner);
  assert.equal(updated.completed, true);
  assert.equal(
    (await client.updateTask(desired, owner)).revision,
    updated.revision,
  );
  await assert.rejects(
    client.updateTask({ ...created, title: "Stale window" }, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  assert.equal(
    (await client.updateTask({ ...updated, completed: false }, owner))
      .completed,
    false,
  );
  await client.deleteTask(
    { id: created.id, revision: updated.revision + 1 },
    owner,
  );
  await client.deleteTask(
    { id: created.id, revision: updated.revision + 1 },
    owner,
  );
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some((t) => t.id === created.id),
    false,
  );
});

test("server enforces Unicode limits, plaintext and incomplete-first creation ordering", async () => {
  const owner = await login();
  for (const task of [
    { title: "   " },
    { title: "🦀".repeat(201) },
    { title: "Valid", notes: "x".repeat(10001) },
    { title: "null\0byte" },
  ]) {
    await assert.rejects(
      client.createTask({ id: crypto.randomUUID(), ...task }, owner),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.InvalidArgument,
    );
  }
  const first = await client.createTask(
    { id: crypto.randomUUID(), title: "🦀".repeat(200) },
    owner,
  );
  const second = await client.createTask(
    {
      id: crypto.randomUUID(),
      title: "<script>literal</script>",
      notes: "x".repeat(10000),
    },
    owner,
  );
  assert.deepEqual(
    (await client.listTasks({}, owner)).tasks.map((t) => t.id),
    [second.id, first.id],
  );
  await client.updateTask({ ...second, completed: true }, owner);
  assert.deepEqual(
    (await client.listTasks({}, owner)).tasks.map((t) => t.id),
    [first.id, second.id],
  );
  await client.deleteTask({ id: first.id, revision: first.revision }, owner);
  await client.deleteTask(
    { id: second.id, revision: second.revision + 1 },
    owner,
  );
});

test("sessions require origin and CSRF, logout revokes the cookie, and arbitrary Google credentials fail", async () => {
  const owner = await login();
  for (const headers of [
    { cookie: owner.headers.cookie, origin },
    { ...owner.headers, origin: "https://stranger.example" },
    { ...owner.headers, "x-csrf-token": "wrong" },
  ]) {
    await assert.rejects(
      client.listTasks({}, { headers }),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.PermissionDenied,
    );
  }
  const badLogin = await fetch(`${baseUrl}/auth/google`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ credential: "forged", nonce: "x".repeat(64) }),
  });
  assert.equal(badLogin.status, 401);
  assert.equal(
    (
      await fetch(`${baseUrl}/auth/logout`, {
        method: "POST",
        headers: owner.headers,
      })
    ).status,
    204,
  );
  await assert.rejects(
    client.listTasks({}, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
});

test("cross-origin responses expose only the configured origin and never cache private data", async () => {
  for (const candidate of [origin, "https://stranger.example"]) {
    const response = await fetch(`${baseUrl}/life.v1.TaskService/ListTasks`, {
      method: "OPTIONS",
      headers: {
        origin: candidate,
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-csrf-token,content-type",
      },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (candidate === origin)
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        "true",
      );
  }
});

test("retrying a committed create after deletion never resurrects the task", async () => {
  const owner = await login();
  const request = {
    id: crypto.randomUUID(),
    title: "Deleted during lost response",
  };
  const created = await client.createTask(request, owner);
  await client.deleteTask(
    { id: created.id, revision: created.revision },
    owner,
  );
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
  await assert.rejects(
    client.createTask(request, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.NotFound,
  );
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some(
      (task) => task.id === created.id,
    ),
    false,
  );
});

test("stale deletion preserves a newer edit and a confirmed delete can be retried", async () => {
  const owner = await login();
  const created = await client.createTask(
    { id: crypto.randomUUID(), title: "Before concurrent edit" },
    owner,
  );
  const updated = await client.updateTask(
    { ...created, title: "Newer edit" },
    owner,
  );
  await assert.rejects(
    client.deleteTask({ id: created.id }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  await assert.rejects(
    client.deleteTask({ id: created.id, revision: created.revision }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  assert.equal(
    (await client.listTasks({}, owner)).tasks.find(
      (task) => task.id === created.id,
    )?.title,
    updated.title,
  );
  await client.deleteTask(
    { id: updated.id, revision: updated.revision },
    owner,
  );
  await client.deleteTask(
    { id: updated.id, revision: updated.revision },
    owner,
  );
});

test("owner creates a durable shopping list with one history entry and safe create retries", async () => {
  const owner = await login();
  await assert.rejects(
    lists.listCollections({ kind: CollectionKind.SHOPPING }),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.Unauthenticated,
  );
  const request = {
    operationId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    action: ChangeAction.CREATE_COLLECTION,
    details: {
      kind: CollectionKind.SHOPPING,
      title: "Weekly groceries",
      notes: "For the weekend",
    },
  };
  const result = await lists.applyChange(request, owner);
  assert.equal(result.collection?.title, "Weekly groceries");
  assert.equal(result.collection?.revision, 1);
  await lists.applyChange(request, owner);
  assert.equal(
    (
      await lists.listCollections({ kind: CollectionKind.SHOPPING }, owner)
    ).collections.filter((c) => c.id === request.collectionId).length,
    1,
  );
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
  assert.equal(
    (await lists.getCollection({ id: request.collectionId }, await login()))
      .notes,
    "For the weekend",
  );
  const history = await lists.listHistory(
    { collectionId: request.collectionId },
    owner,
  );
  assert.equal(history.entries.length, 1);
  assert.equal(
    JSON.parse(history.entries[0]!.afterJson).title,
    "Weekly groceries",
  );
});

function changeRequest(
  collection: Collection,
  action: ChangeAction,
  fields: Omit<
    MessageInitShape<typeof ChangeRequestSchema>,
    "$typeName" | "$unknown"
  > = {},
) {
  return {
    operationId: crypto.randomUUID(),
    collectionId: collection.id,
    expectedRevision: collection.revision,
    action,
    ...fields,
  };
}
async function shopping(owner: Awaited<ReturnType<typeof login>>) {
  return (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: { kind: CollectionKind.SHOPPING, title: "Shopping behavior" },
      },
      owner,
    )
  ).collection!;
}
test("shopping items retain manual positions and stale or replayed changes cannot overwrite newer progress", async () => {
  const owner = await login();
  let collection = await shopping(owner);
  const milkId = crypto.randomUUID(),
    breadId = crypto.randomUUID();
  collection = (
    await lists.applyChange(
      changeRequest(collection, ChangeAction.CREATE_ITEM, {
        item: {
          id: milkId,
          title: "Milk",
          quantity: "2 cartons",
          notes: "Oat milk",
        },
      }),
      owner,
    )
  ).collection!;
  collection = (
    await lists.applyChange(
      changeRequest(collection, ChangeAction.CREATE_ITEM, {
        item: { id: breadId, title: "Bread" },
      }),
      owner,
    )
  ).collection!;
  const original = collection.items.find((i) => i.id === milkId)!;
  const update = changeRequest(collection, ChangeAction.UPDATE_ITEM, {
    item: { ...original, completed: true },
  });
  collection = (await lists.applyChange(update, owner)).collection!;
  await assert.rejects(
    lists.applyChange(
      changeRequest(
        { ...collection, revision: collection.revision - 1 },
        ChangeAction.UPDATE_ITEM,
        { item: { ...original, title: "Stale name" } },
      ),
      owner,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  collection = (
    await lists.applyChange(
      changeRequest(collection, ChangeAction.RESET_PURCHASES),
      owner,
    )
  ).collection!;
  const retried = (await lists.applyChange(update, owner)).collection!;
  assert.equal(retried.items.find((i) => i.id === milkId)!.completed, false);
  assert.equal(
    retried.items.find((i) => i.id === milkId)!.position,
    original.position,
  );
  assert.equal(
    retried.items.find((i) => i.id === milkId)!.quantity,
    "2 cartons",
  );
  assert.equal(retried.itemCount, 2);
  assert.equal(
    (
      await lists.listHistory({ collectionId: collection.id }, owner)
    ).entries.filter(
      (entry) => entry.targetId === milkId && entry.action === "Item edited",
    ).length,
    1,
  );
});

test("concurrent reuse of an action ID cannot create rejected collections or change an acknowledged item", async () => {
  const owner = await login();
  const operationId = crypto.randomUUID();
  const prefix = `Concurrent ${crypto.randomUUID()}`;
  const attempts = Array.from({ length: 4 }, (_, n) => ({
    operationId,
    collectionId: crypto.randomUUID(),
    action: ChangeAction.CREATE_COLLECTION,
    details: { kind: CollectionKind.SHOPPING, title: `${prefix} ${n}` },
  }));
  const results = await Promise.allSettled(
    attempts.map((request) => lists.applyChange(request, owner)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await lists.listCollections({ kind: CollectionKind.SHOPPING }, owner)
    ).collections.filter((c) => c.title.startsWith(prefix)).length,
    1,
    "rejected actions must not leave collections behind",
  );
  let collection = (
    results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof lists.applyChange>>
    >
  ).value.collection!;
  collection = (
    await lists.applyChange(
      changeRequest(collection, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Original" },
      }),
      owner,
    )
  ).collection!;
  const shared = crypto.randomUUID();
  const edits = await Promise.allSettled(
    ["First", "Second"].map((title) =>
      lists.applyChange(
        changeRequest(collection, ChangeAction.UPDATE_ITEM, {
          operationId: shared,
          item: { ...collection.items[0]!, title },
        }),
        owner,
      ),
    ),
  );
  assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
  const winner = (
    edits.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof lists.applyChange>>
    >
  ).value.collection!.items[0]!.title;
  assert.equal(
    (await lists.getCollection({ id: collection.id }, owner)).items[0]!.title,
    winner,
  );
});

test("a checklist template creates independent runs with fresh item identities and unchecked progress", async () => {
  const owner = await login();
  let template = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: {
          kind: CollectionKind.TEMPLATE,
          title: "Packing",
          notes: "Check the weather",
        },
      },
      owner,
    )
  ).collection!;
  await assert.rejects(
    lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        sourceId: template.id,
        expectedRevision: template.revision,
        action: ChangeAction.START_RUN,
        details: { title: "Empty trip" },
      },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const sectionId = crypto.randomUUID();
  template = (
    await lists.applyChange(
      changeRequest(template, ChangeAction.CREATE_SECTION, {
        section: { id: sectionId, title: "Clothing" },
      }),
      owner,
    )
  ).collection!;
  template = (
    await lists.applyChange(
      changeRequest(template, ChangeAction.CREATE_ITEM, {
        item: {
          id: crypto.randomUUID(),
          title: "Jacket",
          notes: "Waterproof",
          sectionId,
        },
      }),
      owner,
    )
  ).collection!;
  const request = {
    operationId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    sourceId: template.id,
    expectedRevision: template.revision,
    action: ChangeAction.START_RUN,
    details: { title: "Trip A" },
  };
  const a = (await lists.applyChange(request, owner)).collection!;
  const b = (
    await lists.applyChange(
      {
        ...request,
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        details: { title: "Trip B" },
      },
      owner,
    )
  ).collection!;
  assert.equal(a.notes, "Check the weather");
  assert.equal(a.items[0]!.notes, "Waterproof");
  assert.equal(a.items[0]!.completed, false);
  assert.notEqual(a.items[0]!.id, template.items[0]!.id);
  assert.notEqual(a.items[0]!.id, b.items[0]!.id);
  assert.notEqual(a.sections[0]!.id, sectionId);
  assert.equal(a.items[0]!.sectionId, a.sections[0]!.id);
  await lists.applyChange(request, owner);
  assert.equal(
    (await lists.listHistory({ collectionId: a.id }, owner)).entries.filter(
      (e) => e.targetId === a.id,
    ).length,
    1,
  );
  template = (
    await lists.applyChange(
      changeRequest(template, ChangeAction.UPDATE_ITEM, {
        item: { ...template.items[0]!, title: "New jacket" },
      }),
      owner,
    )
  ).collection!;
  await lists.applyChange(
    changeRequest(a, ChangeAction.UPDATE_ITEM, {
      item: { ...a.items[0]!, completed: true, title: "Trip-only jacket" },
    }),
    owner,
  );
  assert.equal(
    (await lists.getCollection({ id: b.id }, owner)).items[0]!.title,
    "Jacket",
  );
  assert.equal(template.items[0]!.title, "New jacket");
});

test("finished archived and trashed states preserve progress and enforce explicit reopening", async () => {
  const owner = await login();
  let template = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: { kind: CollectionKind.TEMPLATE, title: "State template" },
      },
      owner,
    )
  ).collection!;
  template = (
    await lists.applyChange(
      changeRequest(template, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Step" },
      }),
      owner,
    )
  ).collection!;
  let run = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        sourceId: template.id,
        expectedRevision: template.revision,
        action: ChangeAction.START_RUN,
        details: { title: "State run" },
      },
      owner,
    )
  ).collection!;
  run = (
    await lists.applyChange(changeRequest(run, ChangeAction.FINISH_RUN), owner)
  ).collection!;
  assert.equal(run.finished, true);
  assert.equal(run.items[0]!.completed, false);
  await assert.rejects(
    lists.applyChange(
      changeRequest(run, ChangeAction.UPDATE_ITEM, {
        item: { ...run.items[0]!, completed: true },
      }),
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  run = (
    await lists.applyChange(changeRequest(run, ChangeAction.ARCHIVE), owner)
  ).collection!;
  await assert.rejects(
    lists.applyChange(changeRequest(run, ChangeAction.REOPEN_RUN), owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  run = (
    await lists.applyChange(
      changeRequest(run, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  assert.ok(
    (await lists.listCollections({ trashed: true }, owner)).collections.some(
      (c) => c.id === run.id,
    ),
    "Trash must include previously archived collections",
  );
  run = (
    await lists.applyChange(
      changeRequest(run, ChangeAction.RESTORE_COLLECTION),
      owner,
    )
  ).collection!;
  assert.equal(run.archived, true);
  assert.equal(run.finished, true);
  run = (
    await lists.applyChange(changeRequest(run, ChangeAction.UNARCHIVE), owner)
  ).collection!;
  assert.equal(run.finished, true);
  run = (
    await lists.applyChange(changeRequest(run, ChangeAction.REOPEN_RUN), owner)
  ).collection!;
  assert.equal(run.finished, false);
  run = (
    await lists.applyChange(
      changeRequest(run, ChangeAction.UPDATE_METADATA, {
        details: { title: "Renamed run", notes: "Independent notes" },
      }),
      owner,
    )
  ).collection!;
  assert.equal(run.title, "Renamed run");
  assert.equal(run.notes, "Independent notes");
  template = (
    await lists.applyChange(
      changeRequest(template, ChangeAction.ARCHIVE),
      owner,
    )
  ).collection!;
  await assert.rejects(
    lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        sourceId: template.id,
        expectedRevision: template.revision,
        action: ChangeAction.START_RUN,
        details: { title: "Not allowed" },
      },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
});

test("sections and items can be reordered and removed without losing trashed items or historical names", async () => {
  const owner = await login();
  let c = await shopping(owner);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  for (const section of [
    { id: a, title: "Produce" },
    { id: b, title: "Dairy" },
  ])
    c = (
      await lists.applyChange(
        changeRequest(c, ChangeAction.CREATE_SECTION, { section }),
        owner,
      )
    ).collection!;
  for (const item of [
    { id: crypto.randomUUID(), title: "Apples", sectionId: a },
    { id: crypto.randomUUID(), title: "Carrots", sectionId: a },
    {
      id: crypto.randomUUID(),
      title: "Milk",
      notes: "Oat milk",
      quantity: "2 cartons",
      completed: true,
      sectionId: b,
    },
  ])
    c = (
      await lists.applyChange(
        changeRequest(c, ChangeAction.CREATE_ITEM, { item }),
        owner,
      )
    ).collection!;
  const apples = c.items.find((i) => i.title === "Apples")!,
    carrots = c.items.find((i) => i.title === "Carrots")!,
    milk = c.items.find((i) => i.title === "Milk")!;
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.MOVE_SECTION, { targetId: b, position: 0 }),
      owner,
    )
  ).collection!;
  assert.deepEqual(
    c.sections.map((s) => s.id),
    [b, a],
  );
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.MOVE_ITEM, {
        targetId: carrots.id,
        position: 0,
      }),
      owner,
    )
  ).collection!;
  assert.deepEqual(
    c.items.filter((i) => i.sectionId === a).map((i) => i.title),
    ["Carrots", "Apples"],
  );
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.RENAME_SECTION, {
        section: { id: a, title: "Fruit and vegetables" },
      }),
      owner,
    )
  ).collection!;
  const oldHistory = (
    await lists.listHistory({ collectionId: c.id }, owner)
  ).entries.find((e) => e.targetId === apples.id && e.action === "Item added")!;
  assert.equal(JSON.parse(oldHistory.afterJson).section, "Produce");
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.TRASH_ITEM, { targetId: milk.id }),
      owner,
    )
  ).collection!;
  assert.equal(c.itemCount, 2);
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.REMOVE_SECTION, { targetId: b }),
      owner,
    )
  ).collection!;
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  const trashed = (await lists.listTrashedItems({}, owner)).items.find(
    (i) => i.item?.id === milk.id,
  )!;
  assert.equal(trashed.parent?.trashed, true);
  await assert.rejects(
    lists.applyChange(
      changeRequest(c, ChangeAction.RESTORE_ITEM, { targetId: milk.id }),
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.RESTORE_COLLECTION),
      owner,
    )
  ).collection!;
  assert.equal(c.items.find((i) => i.id === milk.id)!.trashed, true);
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.RESTORE_ITEM, { targetId: milk.id }),
      owner,
    )
  ).collection!;
  const restored = c.items.find((i) => i.id === milk.id)!;
  assert.equal(restored.sectionId, "");
  assert.equal(restored.completed, true);
  assert.equal(restored.notes, "Oat milk");
  assert.equal(restored.quantity, "2 cartons");
});

test("a child identity collision rolls back the rejected change and its history", async () => {
  const owner = await login();
  let first = await shopping(owner);
  const second = await shopping(owner);
  const id = crypto.randomUUID();
  first = (
    await lists.applyChange(
      changeRequest(first, ChangeAction.CREATE_ITEM, {
        item: { id, title: "Original owner of ID" },
      }),
      owner,
    )
  ).collection!;
  await assert.rejects(
    lists.applyChange(
      changeRequest(second, ChangeAction.CREATE_ITEM, {
        item: { id, title: "Must not be acknowledged" },
      }),
      owner,
    ),
  );
  const after = await lists.getCollection({ id: second.id }, owner);
  assert.equal(after.revision, second.revision);
  assert.equal(after.items.length, 0);
  assert.equal(
    (await lists.listHistory({ collectionId: second.id }, owner)).entries
      .length,
    1,
  );
  assert.equal(
    (await lists.getCollection({ id: first.id }, owner)).items[0]!.title,
    "Original owner of ID",
  );
});

test("permanent item erasure waits for an independent ledger and survives uncertain publication and restart", async () => {
  const owner = await login();
  let c = await shopping(owner);
  const create = changeRequest(c, ChangeAction.CREATE_ITEM, {
    item: {
      id: crypto.randomUUID(),
      title: "Private erased item",
      notes: "Erase these notes",
      quantity: "3 packs",
    },
  });
  c = (await lists.applyChange(create, owner)).collection!;
  const item = c.items[0]!;
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.TRASH_ITEM, { targetId: item.id }),
      owner,
    )
  ).collection!;
  const erase = changeRequest(c, ChangeAction.ERASE_ITEM, {
    targetId: item.id,
  });
  const ledgerHeaders = {
    authorization: "Bearer local-erasure-only",
    "content-type": "application/json",
  };
  await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: ledgerHeaders,
    body: JSON.stringify({ fail_next: "after" }),
  });
  await assert.rejects(
    lists.applyChange(erase, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.Unavailable,
  );
  c = await lists.getCollection({ id: c.id }, owner);
  assert.equal(c.erasurePending, true);
  assert.equal(c.items[0]!.notes, "Erase these notes");
  await assert.rejects(
    lists.applyChange(
      changeRequest(c, ChangeAction.RESTORE_ITEM, { targetId: item.id }),
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
  c = (await lists.applyChange(erase, owner)).collection!;
  assert.equal(c.erasurePending, false);
  assert.equal(c.items.length, 0);
  assert.equal((await lists.applyChange(erase, owner)).erased, true);
  assert.equal(
    (await lists.listHistory({ collectionId: c.id }, owner)).entries
      .map((e) => `${e.targetTitle}\n${e.beforeJson}\n${e.afterJson}`)
      .join("\n")
      .includes("Private erased item"),
    false,
  );
  assert.equal(
    (await lists.listHistory({ collectionId: c.id }, owner)).entries
      .map((e) => `${e.targetTitle}\n${e.beforeJson}\n${e.afterJson}`)
      .join("\n")
      .includes("Erase these notes"),
    false,
  );
  await assert.rejects(lists.applyChange(create, owner));
  await assert.rejects(
    lists.applyChange(
      changeRequest(c, ChangeAction.CREATE_ITEM, {
        item: { id: item.id, title: "Must stay erased" },
      }),
      owner,
    ),
  );
  const records = (await (
    await fetch("http://127.0.0.1:8792/records", { headers: ledgerHeaders })
  ).json()) as { records: { operation_id: string }[] };
  assert.equal(
    records.records.filter((r) => r.operation_id === erase.operationId).length,
    1,
  );
  assert.equal(JSON.stringify(records).includes("Private erased item"), false);
  assert.equal(JSON.stringify(records).includes("Erase these notes"), false);
});

test("permanent collection erasure preserves independent runs and blocks legacy task resurrection", async () => {
  const owner = await login();
  const request = {
    operationId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    action: ChangeAction.CREATE_COLLECTION,
    details: {
      kind: CollectionKind.TEMPLATE,
      title: "Erased source",
      notes: "Copied note",
    },
  };
  let source = (await lists.applyChange(request, owner)).collection!;
  const removedId = crypto.randomUUID();
  for (const item of [
    { id: crypto.randomUUID(), title: "Independent copied item" },
    { id: removedId, title: "Trashed source-only secret" },
  ])
    source = (
      await lists.applyChange(
        changeRequest(source, ChangeAction.CREATE_ITEM, { item }),
        owner,
      )
    ).collection!;
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.TRASH_ITEM, { targetId: removedId }),
      owner,
    )
  ).collection!;
  const run = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        sourceId: source.id,
        expectedRevision: source.revision,
        action: ChangeAction.START_RUN,
        details: { title: "Retained run" },
      },
      owner,
    )
  ).collection!;
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  const erase = changeRequest(source, ChangeAction.ERASE_COLLECTION);
  assert.equal((await lists.applyChange(erase, owner)).erased, true);
  assert.equal((await lists.applyChange(erase, owner)).erased, true);
  await assert.rejects(
    lists.getCollection({ id: source.id }, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound,
  );
  await assert.rejects(
    lists.listHistory({ collectionId: source.id }, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound,
  );
  await assert.rejects(lists.applyChange(request, owner));
  const retained = await lists.getCollection({ id: run.id }, owner);
  assert.equal(retained.notes, "Copied note");
  assert.equal(retained.items.length, 1);
  assert.equal(retained.items[0]!.title, "Independent copied item");
  const newList = await shopping(owner);
  await assert.rejects(
    lists.applyChange(
      changeRequest(newList, ChangeAction.CREATE_ITEM, {
        item: { id: removedId, title: "No reuse" },
      }),
      owner,
    ),
  );
  const oldRequest = {
    id: crypto.randomUUID(),
    title: "Task erased through current API",
  };
  const legacy = await client.createTask(oldRequest, owner);
  await client.deleteTask({ id: legacy.id, revision: legacy.revision }, owner);
  const task = await lists.getCollection({ id: legacy.id }, owner);
  await lists.applyChange(
    changeRequest(task, ChangeAction.ERASE_COLLECTION),
    owner,
  );
  await assert.rejects(
    client.createTask(oldRequest, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound,
  );
});

test("a pending erasure reserves its action ID against unrelated writes", async () => {
  const owner = await login();
  let c = await shopping(owner);
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  const erase = changeRequest(c, ChangeAction.ERASE_COLLECTION);
  await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: {
      authorization: "Bearer local-erasure-only",
      "content-type": "application/json",
    },
    body: JSON.stringify({ fail_next: "before" }),
  });
  await assert.rejects(
    lists.applyChange(erase, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.Unavailable,
  );
  const collision = {
    operationId: erase.operationId,
    collectionId: crypto.randomUUID(),
    action: ChangeAction.CREATE_COLLECTION,
    details: {
      kind: CollectionKind.SHOPPING,
      title: "Must not steal pending erasure identity",
    },
  };
  await assert.rejects(lists.applyChange(collision, owner));
  await assert.rejects(
    lists.getCollection({ id: collision.collectionId }, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound,
  );
  assert.equal((await lists.applyChange(erase, owner)).erased, true);
});

test("Backblaze publication rejects broad keys and verifies the independently stored record", async () => {
  await stop(server);
  server = start("target/debug/intrepion-server", [], {
    env: { ...localEnv, ERASURE_LEDGER_B2_EMULATOR: "1" },
  });
  await ready(`${baseUrl}/health/live`);
  const headers = {
    authorization: "Bearer local-erasure-only",
    "content-type": "application/json",
  };
  try {
    const owner = await login();
    let c = await shopping(owner);
    c = (
      await lists.applyChange(
        changeRequest(c, ChangeAction.TRASH_COLLECTION),
        owner,
      )
    ).collection!;
    const erase = changeRequest(c, ChangeAction.ERASE_COLLECTION);
    await fetch("http://127.0.0.1:8792/fault", {
      method: "POST",
      headers,
      body: JSON.stringify({ fail_next: "", b2_bad_scope: true }),
    });
    await assert.rejects(
      lists.applyChange(erase, owner),
      (e: unknown) => e instanceof ConnectError && e.code === Code.Unavailable,
    );
    const before = (await (
      await fetch("http://127.0.0.1:8792/records", { headers })
    ).json()) as { records: { operation_id: string }[] };
    assert.equal(
      before.records.some(
        (record) => record.operation_id === erase.operationId,
      ),
      false,
    );
    await fetch("http://127.0.0.1:8792/fault", {
      method: "POST",
      headers,
      body: JSON.stringify({ fail_next: "", b2_bad_scope: false }),
    });
    assert.equal((await lists.applyChange(erase, owner)).erased, true);
    const after = (await (
      await fetch("http://127.0.0.1:8792/records", { headers })
    ).json()) as { records: { operation_id: string; database_id: string }[] };
    assert.equal(
      after.records.find((record) => record.operation_id === erase.operationId)
        ?.database_id,
      "00000000-0000-0000-0000-000000000001",
    );
  } finally {
    await fetch("http://127.0.0.1:8792/fault", {
      method: "POST",
      headers,
      body: JSON.stringify({ fail_next: "", b2_bad_scope: false }),
    });
    await stop(server);
    server = start("target/debug/intrepion-server", [], { env: localEnv });
    await ready(`${baseUrl}/health/live`);
  }
});

test("list pages keep shopping alphabetical, runs newest first and tasks incomplete first", async () => {
  const owner = await login();
  const create = async (kind: CollectionKind, title: string) =>
    (
      await lists.applyChange(
        {
          operationId: crypto.randomUUID(),
          collectionId: crypto.randomUUID(),
          action: ChangeAction.CREATE_COLLECTION,
          details: { kind, title },
        },
        owner,
      )
    ).collection!;
  const z = await create(CollectionKind.SHOPPING, "ZZ ordering");
  const a = await create(CollectionKind.SHOPPING, "AA ordering");
  const shoppingPage = await lists.listCollections(
    { kind: CollectionKind.SHOPPING },
    owner,
  );
  assert.ok(
    shoppingPage.collections.findIndex((c) => c.id === a.id) <
      shoppingPage.collections.findIndex((c) => c.id === z.id),
  );
  let source = await create(CollectionKind.TEMPLATE, "Ordering source");
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Step" },
      }),
      owner,
    )
  ).collection!;
  const run = async (title: string) =>
    (
      await lists.applyChange(
        {
          operationId: crypto.randomUUID(),
          collectionId: crypto.randomUUID(),
          sourceId: source.id,
          expectedRevision: source.revision,
          action: ChangeAction.START_RUN,
          details: { title },
        },
        owner,
      )
    ).collection!;
  const old = await run("AA older run");
  const newest = await run("ZZ newer run");
  const runs = await lists.listCollections({ kind: CollectionKind.RUN }, owner);
  assert.equal(runs.collections[0]!.id, newest.id);
  assert.equal(runs.collections[1]!.id, old.id);
  let done = await create(CollectionKind.TASK, "AA done task");
  done = (
    await lists.applyChange(
      changeRequest(done, ChangeAction.UPDATE_METADATA, {
        details: { title: done.title, completed: true },
      }),
      owner,
    )
  ).collection!;
  const active = await create(CollectionKind.TASK, "ZZ active task");
  const tasks = await lists.listCollections(
    { kind: CollectionKind.TASK },
    owner,
  );
  assert.equal(tasks.collections[0]!.id, active.id);
  assert.ok(
    tasks.collections.findIndex((c) => c.id === active.id) <
      tasks.collections.findIndex((c) => c.id === done.id),
  );
});

test("a large shopping reset is atomic and records every changed item across history pages", async () => {
  const owner = await login();
  let c = await shopping(owner);
  for (let i = 0; i < 55; i++)
    c = (
      await lists.applyChange(
        changeRequest(c, ChangeAction.CREATE_ITEM, {
          item: {
            id: crypto.randomUUID(),
            title: `Purchased ${i}`,
            completed: true,
          },
        }),
        owner,
      )
    ).collection!;
  const reset = changeRequest(c, ChangeAction.RESET_PURCHASES);
  c = (await lists.applyChange(reset, owner)).collection!;
  assert.equal(c.items.length, 55);
  assert.equal(c.items.filter((i) => i.completed).length, 0);
  const seen: string[] = [];
  let beforeSequence = 0n;
  do {
    const page = await lists.listHistory(
      { collectionId: c.id, beforeSequence },
      owner,
    );
    seen.push(
      ...page.entries
        .filter((e) => e.action === "Marked needed")
        .map((e) => e.targetId),
    );
    beforeSequence = page.nextBeforeSequence;
  } while (beforeSequence !== 0n);
  assert.equal(new Set(seen).size, 55);
  const revision = c.revision;
  assert.equal(
    (await lists.applyChange(reset, owner)).collection!.revision,
    revision,
  );
});

test("a pending erasure can be rediscovered after the client loses its in-memory request", async () => {
  const owner = await login();
  let c = await shopping(owner);
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.TRASH_COLLECTION),
      owner,
    )
  ).collection!;
  const request = changeRequest(c, ChangeAction.ERASE_COLLECTION);
  await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: {
      authorization: "Bearer local-erasure-only",
      "content-type": "application/json",
    },
    body: JSON.stringify({ fail_next: "before" }),
  });
  await assert.rejects(lists.applyChange(request, owner));
  const loaded = await lists.getCollection({ id: c.id }, owner);
  const pending = (
    loaded as unknown as {
      pendingErasure?: {
        operationId: string;
        expectedRevision: number;
        targetId: string;
        wholeCollection: boolean;
      };
    }
  ).pendingErasure;
  assert.ok(pending, "A reloaded client needs the content-free retry identity");
  assert.equal(pending.operationId, request.operationId);
  assert.equal(pending.expectedRevision, c.revision);
  assert.equal(pending.targetId, "");
  assert.equal(pending.wholeCollection, true);
  assert.equal(
    (
      await lists.applyChange(
        {
          operationId: pending.operationId,
          collectionId: c.id,
          expectedRevision: pending.expectedRevision,
          action: pending.wholeCollection
            ? ChangeAction.ERASE_COLLECTION
            : ChangeAction.ERASE_ITEM,
          targetId: pending.targetId,
        },
        owner,
      )
    ).erased,
    true,
  );
});

test("section and item identities cannot alias and hide a successful history change", async () => {
  const owner = await login();
  let c = await shopping(owner);
  const sectionId = crypto.randomUUID();
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.CREATE_SECTION, {
        section: { id: sectionId, title: "Section identity" },
      }),
      owner,
    )
  ).collection!;
  const history = (await lists.listHistory({ collectionId: c.id }, owner))
    .entries.length;
  await assert.rejects(
    lists.applyChange(
      changeRequest(c, ChangeAction.CREATE_ITEM, {
        item: { id: sectionId, title: "Must not alias section" },
      }),
      owner,
    ),
  );
  const after = await lists.getCollection({ id: c.id }, owner);
  assert.equal(after.items.length, 0);
  assert.equal(after.revision, c.revision);
  assert.equal(
    (await lists.listHistory({ collectionId: c.id }, owner)).entries.length,
    history,
  );
});

test("reorder history reports human positions for every item whose relative order changed", async () => {
  const owner = await login();
  let c = await shopping(owner);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  for (const item of [
    { id: a, title: "First" },
    { id: b, title: "Second" },
  ])
    c = (
      await lists.applyChange(
        changeRequest(c, ChangeAction.CREATE_ITEM, { item }),
        owner,
      )
    ).collection!;
  c = (
    await lists.applyChange(
      changeRequest(c, ChangeAction.MOVE_ITEM, { targetId: b, position: 0 }),
      owner,
    )
  ).collection!;
  const entries = (
    await lists.listHistory({ collectionId: c.id }, owner)
  ).entries.filter((e) => e.action === "Item order changed");
  assert.equal(entries.length, 2);
  assert.deepEqual(
    JSON.parse(entries.find((e) => e.targetId === b)!.beforeJson),
    { position: 2 },
  );
  assert.deepEqual(
    JSON.parse(entries.find((e) => e.targetId === b)!.afterJson),
    { position: 1 },
  );
  assert.deepEqual(
    JSON.parse(entries.find((e) => e.targetId === a)!.beforeJson),
    { position: 1 },
  );
  assert.deepEqual(
    JSON.parse(entries.find((e) => e.targetId === a)!.afterJson),
    { position: 2 },
  );
});

test("racing one action ID across collections leaves the rejected collection revision unchanged", async () => {
  const owner = await login();
  const first = await shopping(owner),
    second = await shopping(owner);
  const operationId = crypto.randomUUID();
  const requests = [
    changeRequest(first, ChangeAction.UPDATE_METADATA, {
      operationId,
      details: { title: "Winner candidate one" },
    }),
    changeRequest(second, ChangeAction.UPDATE_METADATA, {
      operationId,
      details: { title: "Winner candidate two" },
    }),
  ];
  const outcomes = await Promise.allSettled(
    requests.map((request) => lists.applyChange(request, owner)),
  );
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.findIndex((result) => result.status === "rejected");
  const original = [first, second][rejected]!;
  const unchanged = await lists.getCollection({ id: original.id }, owner);
  assert.equal(unchanged.revision, original.revision);
  assert.equal(unchanged.title, original.title);
  assert.equal(
    (await lists.listHistory({ collectionId: original.id }, owner)).entries
      .length,
    1,
  );
});

test("a run can copy many maximum-length Unicode notes without a bound-value overflow", async () => {
  const owner = await login();
  let source = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: {
          kind: CollectionKind.TEMPLATE,
          title: "Large Unicode recipe",
        },
      },
      owner,
    )
  ).collection!;
  const notes = "🍎".repeat(10000);
  for (let index = 0; index < 55; index++)
    source = (
      await lists.applyChange(
        changeRequest(source, ChangeAction.CREATE_ITEM, {
          item: { id: crypto.randomUUID(), title: `Step ${index}`, notes },
        }),
        owner,
      )
    ).collection!;
  const run = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        sourceId: source.id,
        expectedRevision: source.revision,
        action: ChangeAction.START_RUN,
        details: { title: "Large independent run" },
      },
      owner,
    )
  ).collection!;
  assert.equal(run.items.length, 55);
  assert.equal(run.items[54]!.notes, notes);
  assert.equal(
    run.items.every((item) => !item.completed),
    true,
  );
});
