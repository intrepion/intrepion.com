import { PilotOperatorService } from "../../web/src/gen/life/v1/operator_pb.js";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import {
  HouseholdService,
  HouseholdMaintenanceService,
  HouseholdAction,
} from "../../web/src/gen/life/v1/households_pb.js";
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
const households = createClient(
  HouseholdService,
  createConnectTransport({ baseUrl }),
);
const maintenance = createClient(
  HouseholdMaintenanceService,
  createConnectTransport({ baseUrl }),
);
const operator = createClient(
  PilotOperatorService,
  createConnectTransport({ baseUrl }),
);
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

type RpcSession = {
  headers: { origin: string; "x-csrf-token": string; cookie: string };
};
const sessionFixtures = new Map<string, RpcSession>();
async function login(credential = "") {
  const identity = credential || "development-owner";
  const existing = sessionFixtures.get(identity);
  if (existing) {
    const current = await fetch(`${baseUrl}/auth/session`, {
      headers: existing.headers,
    });
    if (current.ok) return { headers: { ...existing.headers } };
    sessionFixtures.delete(identity);
  }
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
    body: JSON.stringify({ nonce, credential }),
  });
  assert.equal(response.status, 200);
  const { csrf } = (await response.json()) as { csrf: string };
  const session = {
    headers: {
      origin,
      "x-csrf-token": csrf,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
  };
  sessionFixtures.set(identity, session);
  return { headers: { ...session.headers } };
}

test("approved pilot users have separate personal tasks and cannot read each other's collections", async () => {
  const owner = await login();
  const other = await login("development-second");
  const ownerTask = await client.createTask(
    { id: crypto.randomUUID(), title: "Private owner task" },
    owner,
  );
  const otherTask = await client.createTask(
    { id: crypto.randomUUID(), title: "Private second task" },
    other,
  );
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some(
      (t) => t.id === otherTask.id,
    ),
    false,
  );
  assert.equal(
    (await client.listTasks({}, other)).tasks.some(
      (t) => t.id === ownerTask.id,
    ),
    false,
  );
  await assert.rejects(
    lists.getCollection({ id: ownerTask.id }, other),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.NotFound,
  );
  await assert.rejects(
    lists.getCollection({ id: otherTask.id }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.NotFound,
  );
});

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
  const original = (await client.listTasks({}, owner)).tasks;
  const originalOpen = original
    .filter((task) => !task.completed)
    .map((task) => task.id);
  const originalCompleted = original
    .filter((task) => task.completed)
    .map((task) => task.id);
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
    [second.id, first.id, ...originalOpen, ...originalCompleted],
  );
  await client.updateTask({ ...second, completed: true }, owner);
  assert.deepEqual(
    (await client.listTasks({}, owner)).tasks.map((t) => t.id),
    [first.id, ...originalOpen, second.id, ...originalCompleted],
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
  ).json()) as {
    records: {
      operation_id: string;
      collection_id: string;
      target_id: string;
      scope: string;
    }[];
  };
  assert.equal(
    records.records.filter(
      (r) =>
        r.collection_id === c.id &&
        r.target_id === item.id &&
        r.scope === "item",
    ).length,
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
    ).json()) as {
      records: { operation_id: string; collection_id: string; scope: string }[];
    };
    assert.equal(
      before.records.some(
        (record) =>
          record.collection_id === c.id && record.scope === "collection",
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
    ).json()) as {
      records: {
        operation_id: string;
        database_id: string;
        collection_id: string;
        scope: string;
      }[];
    };
    assert.equal(
      after.records.find(
        (record) =>
          record.collection_id === c.id && record.scope === "collection",
      )?.database_id,
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

test("a head creates a household using reserved capacity without sharing personal content", async () => {
  const owner = await login();
  const before = await households.getOverview({}, owner);
  const operation = {
    operationId: crypto.randomUUID(),
    householdId: crypto.randomUUID(),
    action: HouseholdAction.CREATE,
    name: "Household foundation",
    amounts: {
      items: 20n,
      shopping: 4n,
      templates: 2n,
      runs: 2n,
      bytes: 64000n,
    },
  };
  const created = await households.changeHousehold(operation, owner);
  assert.equal(created.householdId, operation.householdId);
  const after = await households.getOverview({}, owner);
  assert.equal(
    after.personalCapacity!.items,
    before.personalCapacity!.items - 20n,
  );
  const shared = await households.getHousehold(
    { id: created.householdId },
    owner,
  );
  assert.equal(shared.household!.name, "Household foundation");
  assert.equal(shared.household!.isHead, true);
  assert.equal(shared.heads[0].ceilings!.bytes, 0n);
  assert.equal(shared.heads[0].ceilings!.households, 0n);
  assert.equal(shared.usage!.items, 0n);
  assert.equal(shared.heads.length, 1);
  assert.equal(
    (await households.changeHousehold(operation, owner)).householdId,
    created.householdId,
  );
  assert.equal(
    (await households.getOverview({}, owner)).personalCapacity!.items,
    after.personalCapacity!.items,
  );
});

test("recipient-bound head invitations grant shared access and removal revokes the same active session", async () => {
  const owner = await login();
  const other = await login("development-second");
  const otherIdentity = (await households.getOverview({}, other)).identity!;
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Invitation household",
      amounts: {
        items: 30n,
        shopping: 4n,
        templates: 2n,
        runs: 2n,
        bytes: 128000n,
      },
    },
    owner,
  );
  const scopedOwner = {
    headers: { ...owner.headers, "x-space-id": householdId },
  };
  const scopedOther = {
    headers: { ...other.headers, "x-space-id": householdId },
  };
  const shared = await client.createTask(
    { id: crypto.randomUUID(), title: "Shared household task" },
    scopedOwner,
  );
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some((t) => t.id === shared.id),
    false,
  );
  await assert.rejects(
    client.listTasks({}, scopedOther),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  const invitationToken = "a7".repeat(32);
  const beforeInvite = await households.getHousehold(
    { id: householdId },
    owner,
  );
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: beforeInvite.household!.revision,
      action: HouseholdAction.INVITE,
      targetId: otherIdentity.id,
      invitationToken,
    },
    owner,
  );
  await assert.rejects(
    households.getInvitation({ token: invitationToken }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  const preview = await households.getInvitation(
    { token: invitationToken },
    other,
  );
  assert.equal(preview.householdId, householdId);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.ACCEPT_INVITATION,
      invitationToken,
    },
    other,
  );
  assert.equal(
    (await client.listTasks({}, scopedOther)).tasks.some(
      (t) => t.id === shared.id,
    ),
    true,
  );
  const authored = await client.createTask(
    { id: crypto.randomUUID(), title: "Written by second head" },
    scopedOther,
  );
  assert.equal(
    (await lists.listHistory({ collectionId: authored.id }, scopedOwner))
      .entries[0]!.actor,
    "Second pilot user",
  );
  const current = await households.getHousehold({ id: householdId }, owner);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: current.household!.revision,
      action: HouseholdAction.REMOVE_HEAD,
      targetId: otherIdentity.id,
    },
    owner,
  );
  await assert.rejects(
    client.listTasks({}, scopedOther),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  assert.equal(
    (await client.listTasks({}, scopedOwner)).tasks.some(
      (t) => t.id === authored.id,
    ),
    true,
  );
  assert.ok(await client.listTasks({}, other));
});

test("own ceilings and retained household capacity cannot be bypassed by concurrent writes or Trash", async () => {
  const owner = await login();
  const other = await login("development-second");
  const otherIdentity = (await households.getOverview({}, other)).identity!;
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "One retained task",
      amounts: {
        items: 1n,
        shopping: 2n,
        templates: 2n,
        runs: 2n,
        bytes: 128000n,
      },
    },
    owner,
  );
  let detail = await households.getHousehold({ id: householdId }, owner);
  const ceiling = {
    operationId: crypto.randomUUID(),
    householdId,
    expectedRevision: detail.household!.revision,
    action: HouseholdAction.SET_OWN_CEILINGS,
    amounts: { items: 1n, shopping: 2n, templates: 2n, runs: 2n },
  };
  await households.changeHousehold(ceiling, owner);
  detail = await households.getHousehold({ id: householdId }, owner);
  await assert.rejects(
    households.changeHousehold(
      {
        ...ceiling,
        operationId: crypto.randomUUID(),
        expectedRevision: detail.household!.revision,
        targetId: otherIdentity.id,
      },
      owner,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  const requests = [0, 1].map((n) => ({
    id: crypto.randomUUID(),
    title: `Concurrent task ${n}`,
  }));
  const results = await Promise.allSettled(
    requests.map((request) => client.createTask(request, scoped)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.ok(
    rejected &&
      rejected.status === "rejected" &&
      rejected.reason instanceof ConnectError &&
      rejected.reason.code === Code.ResourceExhausted,
  );
  const saved = (await client.listTasks({}, scoped)).tasks[0]!;
  await client.deleteTask({ id: saved.id, revision: saved.revision }, scoped);
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.items,
    1n,
  );
  await assert.rejects(
    client.createTask(
      { id: crypto.randomUUID(), title: "Trash is still retained" },
      scoped,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.ResourceExhausted,
  );
  const trash = await lists.getCollection({ id: saved.id }, scoped);
  assert.equal(trash.trashed, true);
  await lists.applyChange(
    changeRequest(trash, ChangeAction.ERASE_COLLECTION),
    scoped,
  );
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.items,
    0n,
  );
  const afterErasure = await client.createTask(
    { id: crypto.randomUUID(), title: "Freed after protected erasure" },
    scoped,
  );
  assert.equal(afterErasure.title, "Freed after protected erasure");
});

test("a departed contributor manages only their allocation and cannot withdraw capacity still backing shared content", async () => {
  const owner = await login();
  const other = await login("development-second");
  const target = (await households.getOverview({}, other)).identity!;
  const householdId = crypto.randomUUID();
  const original = {
    items: 3n,
    shopping: 2n,
    templates: 2n,
    runs: 2n,
    bytes: 128000n,
  };
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Retained contribution",
      amounts: original,
    },
    owner,
  );
  let detail = await households.getHousehold({ id: householdId }, owner);
  const token = "b8".repeat(32);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.INVITE,
      targetId: target.id,
      invitationToken: token,
    },
    owner,
  );
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.ACCEPT_INVITATION,
      invitationToken: token,
    },
    other,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  await client.createTask(
    { id: crypto.randomUUID(), title: "Retained shared task" },
    scoped,
  );
  detail = await households.getHousehold({ id: householdId }, owner);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.LEAVE,
    },
    owner,
  );
  await assert.rejects(
    households.getHousehold({ id: householdId }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  const blocked = await households.previewAllocation(
    { householdId, amounts: { ...original, items: 0n } },
    owner,
  );
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.householdUsage, undefined);
  const afterLeave = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === householdId,
  )!;
  assert.equal(afterLeave.isHead, false);
  assert.equal(afterLeave.ownContribution!.items, 3n);
  detail = await households.getHousehold({ id: householdId }, other);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.ALLOCATE,
      amounts: { items: 3n },
    },
    other,
  );
  const valid = await households.previewAllocation(
    { householdId, amounts: { ...original, items: 0n } },
    owner,
  );
  assert.equal(valid.allowed, true);
  assert.equal(valid.householdUsage, undefined);
  const current = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === householdId,
  )!;
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: current.revision,
      action: HouseholdAction.ALLOCATE,
      amounts: { ...original, items: 0n },
    },
    owner,
  );
  assert.equal(
    (await households.getOverview({}, owner)).households.find(
      (h) => h.id === householdId,
    )!.ownContribution!.items,
    0n,
  );
});

test("personal sharing copies a complete snapshot with fresh History and rejects insufficient destination capacity atomically", async () => {
  const owner = await login();
  let source = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: {
          kind: CollectionKind.TEMPLATE,
          title: "Private earlier title",
          notes: "Private earlier notes",
        },
      },
      owner,
    )
  ).collection!;
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.UPDATE_METADATA, {
        details: {
          title: "Packing to share",
          notes: "Current shared instructions",
        },
      }),
      owner,
    )
  ).collection!;
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Pack chargers" },
      }),
      owner,
    )
  ).collection!;
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Check documents" },
      }),
      owner,
    )
  ).collection!;
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Independent sharing",
      amounts: { items: 4n, templates: 2n, runs: 2n, bytes: 128000n },
    },
    owner,
  );
  const copy = {
    operationId: crypto.randomUUID(),
    sourceCollectionId: source.id,
    expectedSourceRevision: source.revision,
    householdId,
    destinationCollectionId: crypto.randomUUID(),
  };
  const preview = await households.previewCopy(copy, owner);
  assert.equal(preview.allowed, true);
  assert.equal(preview.required!.items, 2n);
  assert.equal(preview.required!.templates, 1n);
  const copied = (await households.copyCollection(copy, owner)).collection!;
  assert.equal(copied.title, "Packing to share");
  assert.deepEqual(
    copied.items.map((i) => i.title),
    ["Pack chargers", "Check documents"],
  );
  assert.ok(
    copied.items.every(
      (item) => !source.items.some((original) => original.id === item.id),
    ),
  );
  const shared = { headers: { ...owner.headers, "x-space-id": householdId } };
  const freshHistory = await lists.listHistory(
    { collectionId: copied.id },
    shared,
  );
  assert.equal(
    freshHistory.entries.some((entry) =>
      [entry.targetTitle, entry.beforeJson, entry.afterJson].some((value) =>
        value.includes("Private earlier"),
      ),
    ),
    false,
  );
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.bytes,
    preview.destinationUsage!.bytes + preview.required!.bytes,
  );
  assert.equal(
    (await households.copyCollection(copy, owner)).collection!.id,
    copied.id,
  );
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.items,
    2n,
  );
  source = (
    await lists.applyChange(
      changeRequest(source, ChangeAction.UPDATE_METADATA, {
        details: { title: "Changed private original" },
      }),
      owner,
    )
  ).collection!;
  assert.equal(
    (await lists.getCollection({ id: copied.id }, shared)).title,
    "Packing to share",
  );
  const second = {
    ...copy,
    operationId: crypto.randomUUID(),
    expectedSourceRevision: source.revision,
    destinationCollectionId: crypto.randomUUID(),
  };
  const before = await households.getHousehold({ id: householdId }, owner);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: before.household!.revision,
      action: HouseholdAction.SET_OWN_CEILINGS,
      amounts: { items: 2n, templates: 2n, runs: 2n },
    },
    owner,
  );
  assert.equal((await households.previewCopy(second, owner)).allowed, false);
  await assert.rejects(
    households.copyCollection(second, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.ResourceExhausted,
  );
  await assert.rejects(
    lists.getCollection({ id: second.destinationCollectionId }, shared),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.NotFound,
  );
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.items,
    2n,
  );
});

test("full storage recovery requires explicit active-erasure confirmation and retains content until protected erasure is acknowledged", async () => {
  const owner = await login();
  const householdId = crypto.randomUUID();
  const amounts = {
    items: 3n,
    shopping: 2n,
    templates: 2n,
    runs: 2n,
    bytes: 128000n,
  };
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Storage recovery",
      amounts,
    },
    owner,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  const task = await client.createTask(
    {
      id: crypto.randomUUID(),
      title: "Storage recovery target",
      notes: "Retained notes that stay until explicit protected erasure.",
    },
    scoped,
  );
  const detail = await households.getHousehold({ id: householdId }, owner);
  const full = { ...amounts, bytes: detail.usage!.bytes };
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.ALLOCATE,
      amounts: full,
    },
    owner,
  );
  await assert.rejects(
    client.updateTask({ ...task, notes: "Shorter" }, scoped),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.ResourceExhausted,
  );
  await assert.rejects(
    client.deleteTask({ id: task.id, revision: task.revision }, scoped),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.ResourceExhausted,
  );
  const active = await lists.getCollection({ id: task.id }, scoped);
  assert.equal(active.trashed, false);
  assert.equal(active.notes, task.notes);
  await assert.rejects(
    lists.applyChange(
      changeRequest(active, ChangeAction.ERASE_COLLECTION),
      scoped,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  const erase = changeRequest(active, ChangeAction.ERASE_COLLECTION, {
    confirmedActiveErasure: true,
  });
  await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: {
      authorization: "Bearer local-erasure-only",
      "content-type": "application/json",
    },
    body: JSON.stringify({ fail_next: "after" }),
  });
  await assert.rejects(
    lists.applyChange(erase, scoped),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.Unavailable,
  );
  const pending = await lists.getCollection({ id: task.id }, scoped);
  assert.equal(pending.notes, task.notes);
  assert.equal(pending.pendingErasure!.confirmedActiveErasure, true);
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.bytes,
    full.bytes,
  );
  const recoveredRequest = changeRequest(
    pending,
    ChangeAction.ERASE_COLLECTION,
    {
      operationId: pending.pendingErasure!.operationId,
      expectedRevision: pending.pendingErasure!.expectedRevision,
      confirmedActiveErasure: pending.pendingErasure!.confirmedActiveErasure,
    },
  );
  assert.equal(
    (await lists.applyChange(recoveredRequest, scoped)).erased,
    true,
  );
  assert.equal((await lists.applyChange(erase, scoped)).erased, true);
  assert.equal(
    (await households.getHousehold({ id: householdId }, owner)).usage!.bytes,
    16n,
  );
  await assert.rejects(
    lists.getCollection({ id: task.id }, scoped),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.NotFound,
  );
});

test("the last head can leave and permanently close a household while retained capacity waits for month-end erasure", async () => {
  const owner = await login();
  const other = await login("development-second");
  const target = (await households.getOverview({}, other)).identity!;
  const householdId = crypto.randomUUID();
  const amounts = { items: 3n, templates: 2n, runs: 2n, bytes: 128000n };
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Final closure",
      amounts,
    },
    owner,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  await client.createTask(
    { id: crypto.randomUUID(), title: "Retained until month-end" },
    scoped,
  );
  let detail = await households.getHousehold({ id: householdId }, owner);
  const token = "c9".repeat(32);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.INVITE,
      targetId: target.id,
      invitationToken: token,
    },
    owner,
  );
  detail = await households.getHousehold({ id: householdId }, owner);
  const due = detail.closureEraseDueAt;
  const deadline = new Date(Number(due) * 1000);
  assert.ok(Number(due) > Date.now() / 1000);
  assert.equal(deadline.getUTCDate(), 1);
  assert.equal(deadline.getUTCHours(), 0);
  assert.equal(deadline.getUTCMinutes(), 0);
  const leave = {
    operationId: crypto.randomUUID(),
    householdId,
    expectedRevision: detail.household!.revision,
    action: HouseholdAction.LEAVE,
  };
  await assert.rejects(
    households.changeHousehold(leave, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  await assert.rejects(
    households.changeHousehold(
      { ...leave, confirmClose: true, expectedEraseDueAt: due + 1n },
      owner,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  const confirmed = { ...leave, confirmClose: true, expectedEraseDueAt: due };
  assert.equal(
    (await households.changeHousehold(confirmed, owner)).householdId,
    householdId,
  );
  assert.equal(
    (await households.changeHousehold(confirmed, owner)).householdId,
    householdId,
  );
  await assert.rejects(
    client.listTasks({}, scoped),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  const closed = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === householdId,
  )!;
  assert.equal(closed.status, "closed");
  assert.equal(closed.isHead, false);
  assert.equal(closed.eraseDueAt, due);
  assert.equal(closed.ownContribution!.bytes, amounts.bytes);
  assert.equal(
    (await households.getInvitation({ token }, other)).status,
    "closed",
  );
  await assert.rejects(
    households.changeHousehold(
      {
        operationId: crypto.randomUUID(),
        householdId,
        action: HouseholdAction.ACCEPT_INVITATION,
        invitationToken: token,
      },
      other,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  assert.equal(
    (await households.previewAllocation({ householdId, amounts: {} }, owner))
      .allowed,
    false,
  );
});

test("separate approved accounts cannot poison each other's erasure ledger by reusing an action UUID", async () => {
  const owner = await login();
  const other = await login("development-second");
  const first = await client.createTask(
    { id: crypto.randomUUID(), title: "First private erasure" },
    owner,
  );
  const second = await client.createTask(
    { id: crypto.randomUUID(), title: "Second private erasure" },
    other,
  );
  await client.deleteTask({ id: first.id, revision: first.revision }, owner);
  await client.deleteTask({ id: second.id, revision: second.revision }, other);
  const firstTrash = await lists.getCollection({ id: first.id }, owner);
  const secondTrash = await lists.getCollection({ id: second.id }, other);
  const operationId = crypto.randomUUID();
  const eraseFirst = changeRequest(firstTrash, ChangeAction.ERASE_COLLECTION, {
    operationId,
  });
  const eraseSecond = changeRequest(
    secondTrash,
    ChangeAction.ERASE_COLLECTION,
    { operationId },
  );
  assert.equal((await lists.applyChange(eraseFirst, owner)).erased, true);
  assert.equal((await lists.applyChange(eraseSecond, other)).erased, true);
  assert.equal((await lists.applyChange(eraseFirst, owner)).erased, true);
  assert.equal((await lists.applyChange(eraseSecond, other)).erased, true);
  const { records } = (await (
    await fetch("http://127.0.0.1:8792/records", {
      headers: { authorization: "Bearer local-erasure-only" },
    })
  ).json()) as { records: { operation_id: string; collection_id: string }[] };
  const published = records.filter((record) =>
    [first.id, second.id].includes(record.collection_id),
  );
  assert.equal(published.length, 2);
  assert.equal(new Set(published.map((record) => record.operation_id)).size, 2);
});

test("household names consume UTF-8 storage and a rejected creation reserves nothing", async () => {
  const owner = await login();
  const before = await households.getOverview({}, owner);
  const request = {
    operationId: crypto.randomUUID(),
    householdId: crypto.randomUUID(),
    action: HouseholdAction.CREATE,
    name: "家🏡",
    amounts: { bytes: 0n },
  };
  await assert.rejects(
    households.changeHousehold(request, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.ResourceExhausted,
  );
  const rejected = await households.getOverview({}, owner);
  assert.equal(
    rejected.households.some((h) => h.id === request.householdId),
    false,
  );
  assert.equal(
    rejected.personalCapacity!.bytes,
    before.personalCapacity!.bytes,
  );
  await households.changeHousehold(
    { ...request, amounts: { bytes: 7n } },
    owner,
  );
  const shared = await households.getHousehold(
    { id: request.householdId },
    owner,
  );
  assert.equal(shared.usage!.bytes, 7n);
  const after = await households.getOverview({}, owner);
  assert.equal(
    after.personalCapacity!.bytes,
    before.personalCapacity!.bytes - 7n,
  );
  assert.equal(
    after.personalUsage!.households,
    before.personalUsage!.households + 1n,
  );
});

test("heads can identify and revoke an invitation from administrative History without exposing the link token", async () => {
  const owner = await login();
  const other = await login("development-second");
  const recipient = (await households.getOverview({}, other)).identity!;
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Invitation management",
      amounts: { bytes: 4096n },
    },
    owner,
  );
  const invitationToken =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const request = {
    operationId: crypto.randomUUID(),
    householdId,
    expectedRevision: (
      await households.getHousehold({ id: householdId }, owner)
    ).household!.revision,
    action: HouseholdAction.INVITE,
    targetId: recipient.id,
    invitationToken,
  };
  const results = await Promise.allSettled([
    households.changeHousehold(request, owner),
    households.changeHousehold(request, owner),
  ]);
  const retry = await households.changeHousehold(request, owner);
  for (const result of results) {
    if (result.status === "fulfilled")
      assert.equal(result.value.invitationId, retry.invitationId);
  }
  let detail = await households.getHousehold({ id: householdId }, owner);
  assert.equal(detail.invitations.length, 1);
  assert.equal(detail.invitations[0].id, retry.invitationId);
  assert.equal(detail.invitations[0].recipient!.id, recipient.id);
  assert.equal(detail.invitations[0].status, "pending");
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.REVOKE_INVITATION,
      targetId: retry.invitationId,
    },
    owner,
  );
  detail = await households.getHousehold({ id: householdId }, owner);
  assert.equal(detail.invitations[0].status, "revoked");
  assert.equal(
    (await households.getInvitation({ token: invitationToken }, other)).status,
    "revoked",
  );
  await assert.rejects(
    households.changeHousehold(
      {
        operationId: crypto.randomUUID(),
        householdId,
        expectedRevision: detail.household!.revision,
        action: HouseholdAction.ACCEPT_INVITATION,
        invitationToken,
      },
      other,
    ),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.FailedPrecondition,
  );
  const activity = await households.listHouseholdActivity(
    { householdId },
    owner,
  );
  assert.deepEqual(
    activity.entries.map((e) => e.action),
    [
      "Revoked invitation",
      "Invited an approved person as a head",
      "Created household",
    ],
  );
  assert.equal(
    activity.entries.every((e) => e.actor!.id === detail.heads[0].identity!.id),
    true,
  );
  assert.equal(
    activity.entries.some((e) => e.detailsJson.includes(invitationToken)),
    false,
  );
  assert.equal(
    activity.entries[0].detailsJson.includes(retry.invitationId),
    true,
  );
  const older = await households.listHouseholdActivity(
    { householdId, beforeSequence: activity.entries[0].sequence },
    owner,
  );
  assert.equal(older.entries.length, 2);
  await assert.rejects(
    households.listHouseholdActivity({ householdId }, other),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
});

test("final closure ends access immediately but its acknowledgment waits for independent recovery protection", async () => {
  const owner = await login();
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Protected final closure",
      amounts: { bytes: 4096n },
    },
    owner,
  );
  const detail = await households.getHousehold({ id: householdId }, owner);
  const request = {
    operationId: crypto.randomUUID(),
    householdId,
    expectedRevision: detail.household!.revision,
    action: HouseholdAction.LEAVE,
    confirmClose: true,
    expectedEraseDueAt: detail.closureEraseDueAt,
  };
  const fault = await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: { authorization: "Bearer local-erasure-only" },
    body: JSON.stringify({ fail_next: "after" }),
  });
  assert.equal(fault.ok, true);
  await assert.rejects(
    households.changeHousehold(request, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.Unavailable,
  );
  await assert.rejects(
    households.getHousehold({ id: householdId }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  let summary = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === householdId,
  )!;
  assert.equal(summary.status, "closed");
  assert.equal(summary.ownContribution!.bytes, 4096n);
  // The record exists even though the provider response was lost.
  const ledger = await fetch("http://127.0.0.1:8792/records", {
    headers: { authorization: "Bearer local-erasure-only" },
  }).then((r) => r.json());
  const protectedClosure = ledger.records.filter(
    (r: { collection_id: string }) => r.collection_id === householdId,
  );
  assert.equal(protectedClosure.length, 1);
  assert.equal(protectedClosure[0].scope, "household_closed");
  assert.equal(
    protectedClosure[0].erase_due_at,
    Number(detail.closureEraseDueAt),
  );
  assert.equal(
    JSON.stringify(protectedClosure).includes("Protected final closure"),
    false,
  );
  assert.equal(
    (await households.changeHousehold(request, owner)).householdId,
    householdId,
  );
  summary = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === householdId,
  )!;
  assert.equal(summary.ownContribution!.bytes, 4096n);
});

test("scheduled household erasure requires operator authentication and releases capacity only after protected deletion succeeds", async () => {
  const owner = await login();
  const other = await login("development-second");
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Scheduled erasure",
      amounts: { items: 10n, bytes: 8192n },
    },
    owner,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  const content = await client.createTask(
    { id: crypto.randomUUID(), title: "Must disappear at the deadline" },
    scoped,
  );
  const detail = await households.getHousehold({ id: householdId }, owner);
  const ownBefore = await households.getOverview({}, owner);
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      expectedRevision: detail.household!.revision,
      action: HouseholdAction.LEAVE,
      confirmClose: true,
      expectedEraseDueAt: detail.closureEraseDueAt,
    },
    owner,
  );
  await assert.rejects(
    maintenance.eraseDueHouseholds({ householdId }, owner),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.Unauthenticated,
  );
  const operator = { headers: { authorization: `Bearer ${"ab".repeat(32)}` } };
  assert.equal(
    (await maintenance.eraseDueHouseholds({ householdId }, operator))
      .erasedHouseholds,
    0,
  );
  const futureEnv = {
    ...localEnv,
    HOUSEHOLD_TEST_NOW: String(detail.closureEraseDueAt),
  };
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: futureEnv });
  await ready(`${baseUrl}/health/live`);
  try {
    await fetch("http://127.0.0.1:8792/fault", {
      method: "POST",
      headers: { authorization: "Bearer local-erasure-only" },
      body: JSON.stringify({ fail_next: "after" }),
    });
    await assert.rejects(
      maintenance.eraseDueHouseholds({ householdId }, operator),
      (error: unknown) =>
        error instanceof ConnectError && error.code === Code.Unavailable,
    );
    let closed = (await households.getOverview({}, owner)).households.find(
      (h) => h.id === householdId,
    )!;
    assert.equal(closed.ownContribution!.bytes, 8192n);
    assert.equal(closed.erasureDelayed, true);
    await maintenance.eraseDueHouseholds({ householdId }, operator);
    const after = await households.getOverview({}, owner);
    closed = after.households.find((h) => h.id === householdId)!;
    assert.equal(closed.status, "erased");
    assert.equal(closed.name, "Erased household");
    assert.equal(closed.ownContribution, undefined);
    assert.equal(
      after.personalCapacity!.bytes,
      ownBefore.personalCapacity!.bytes + 8192n,
    );
    assert.equal(
      (await households.getOverview({}, other)).households.some(
        (h) => h.id === householdId,
      ),
      false,
    );
    await assert.rejects(
      client.listTasks({}, scoped),
      (error: unknown) =>
        error instanceof ConnectError && error.code === Code.PermissionDenied,
    );
    await assert.rejects(
      client.createTask(
        { id: content.id, title: "Cannot resurrect globally retired content" },
        owner,
      ),
      (error: unknown) =>
        error instanceof ConnectError && error.code === Code.NotFound,
    );
    await assert.rejects(
      households.changeHousehold(
        {
          operationId: crypto.randomUUID(),
          householdId,
          action: HouseholdAction.CREATE,
          name: "Cannot reopen",
          amounts: { bytes: 100n },
        },
        owner,
      ),
    );
    assert.equal(
      (await maintenance.eraseDueHouseholds({ householdId }, operator))
        .erasedHouseholds,
      0,
    );
  } finally {
    await stop(server);
    server = start("target/debug/intrepion-server", [], { env: localEnv });
    await ready(`${baseUrl}/health/live`);
  }
});

test("whole-household content erasure freezes its snapshot until protected completion and never expands on retry", async () => {
  const owner = await login();
  const other = await login("development-second");
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Bulk recovery",
      amounts: { items: 10n, bytes: 128000n },
    },
    owner,
  );
  const scoped = { headers: { ...owner.headers, "x-space-id": householdId } };
  const privateTask = await client.createTask(
    { id: crypto.randomUUID(), title: "Independent private task" },
    owner,
  );
  const first = await client.createTask(
    { id: crypto.randomUUID(), title: "Shared snapshot one" },
    scoped,
  );
  await client.createTask(
    { id: crypto.randomUUID(), title: "Shared snapshot two" },
    scoped,
  );
  const detail = await households.getHousehold({ id: householdId }, owner);
  const erase = {
    operationId: crypto.randomUUID(),
    householdId,
    expectedRevision: detail.household!.revision,
    action: HouseholdAction.ERASE_CONTENT,
  };
  await assert.rejects(
    households.changeHousehold(erase, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const confirmed = { ...erase, confirmContentErasure: true };
  await assert.rejects(
    households.changeHousehold(confirmed, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await fetch("http://127.0.0.1:8792/fault", {
    method: "POST",
    headers: { authorization: "Bearer local-erasure-only" },
    body: JSON.stringify({ fail_next: "after" }),
  });
  await assert.rejects(
    households.changeHousehold(confirmed, owner),
    (e: unknown) => e instanceof ConnectError && e.code === Code.Unavailable,
  );
  const pending = await households.getHousehold({ id: householdId }, owner);
  assert.equal(pending.pendingContentErasure!.operationId, erase.operationId);
  assert.equal(pending.pendingContentErasure!.collections, 2n);
  assert.equal(pending.usage!.items, 2n);
  await assert.rejects(
    client.createTask(
      { id: crypto.randomUUID(), title: "Must wait for erasure" },
      scoped,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  assert.equal((await client.listTasks({}, scoped)).tasks.length, 2);
  await households.changeHousehold(confirmed, owner);
  assert.equal((await client.listTasks({}, scoped)).tasks.length, 0);
  await assert.rejects(
    lists.getCollection({ id: first.id }, scoped),
    (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound,
  );
  const after = await households.getHousehold({ id: householdId }, owner);
  assert.equal(after.pendingContentErasure, undefined);
  assert.equal(after.household!.isHead, true);
  assert.equal(after.capacity!.bytes, 128000n);
  assert.equal(
    (await client.listTasks({}, owner)).tasks.some(
      (t) => t.id === privateTask.id,
    ),
    true,
  );
  const later = await client.createTask(
    { id: crypto.randomUUID(), title: "Created after protected erasure" },
    scoped,
  );
  await households.changeHousehold(confirmed, owner);
  assert.deepEqual(
    (await client.listTasks({}, scoped)).tasks.map((t) => t.id),
    [later.id],
  );
});

test("operator-only policy previews admit a pilot, preserve over-quota content, and revoke an existing session", async () => {
  const owner = await login();
  const subject = `development-policy-${crypto.randomUUID()}`;
  const request = {
    operationId: crypto.randomUUID(),
    subject,
    displayName: "Policy tester",
    approved: true,
    createAccount: true,
    plan: {
      items: 20n,
      shopping: 2n,
      templates: 2n,
      runs: 2n,
      bytes: 128000n,
      households: 3n,
    },
  };
  await assert.rejects(
    operator.previewAccountPolicy(request, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  await assert.rejects(
    operator.previewAccountPolicy(request, {
      headers: { authorization: `Bearer ${"ab".repeat(32)}` },
    }),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const admin = { headers: { authorization: `Bearer ${"cd".repeat(32)}` } };
  const preview = await operator.previewAccountPolicy(request, admin);
  assert.equal(preview.allowed, true);
  assert.equal(preview.accountExists, false);
  await assert.rejects(
    operator.applyAccountPolicy(request, admin),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const admitted = await operator.applyAccountPolicy(
    { ...request, previewToken: preview.previewToken },
    admin,
  );
  assert.equal(admitted.revision, 1n);
  assert.equal(
    (
      await operator.applyAccountPolicy(
        { ...request, previewToken: preview.previewToken },
        admin,
      )
    ).publicId,
    admitted.publicId,
  );
  const policy = await operator.getAccountPolicy({ subject }, admin);
  assert.equal(policy.displayName, "Policy tester");
  const person = await login(subject);
  const task = await client.createTask(
    { id: crypto.randomUUID(), title: "Preserve this saved task" },
    person,
  );
  const reduction = {
    ...request,
    operationId: crypto.randomUUID(),
    createAccount: false,
    expectedRevision: 1n,
    plan: { ...request.plan, items: 0n },
  };
  const smaller = await operator.previewAccountPolicy(reduction, admin);
  assert.equal(smaller.allowed, true);
  assert.equal(
    smaller.spaces.find((s) => s.id === "personal")!.exceedsAfter,
    true,
  );
  await operator.applyAccountPolicy(
    { ...reduction, previewToken: smaller.previewToken },
    admin,
  );
  assert.equal((await client.listTasks({}, person)).tasks[0].id, task.id);
  await assert.rejects(
    client.createTask(
      { id: crypto.randomUUID(), title: "Cannot grow over quota" },
      person,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.ResourceExhausted,
  );
  const revoked = {
    ...reduction,
    operationId: crypto.randomUUID(),
    expectedRevision: 2n,
    approved: false,
  };
  const revocation = await operator.previewAccountPolicy(revoked, admin);
  await operator.applyAccountPolicy(
    { ...revoked, previewToken: revocation.previewToken },
    admin,
  );
  await assert.rejects(
    client.listTasks({}, person),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const restored = {
    ...revoked,
    operationId: crypto.randomUUID(),
    expectedRevision: 3n,
    approved: true,
  };
  const restoration = await operator.previewAccountPolicy(restored, admin);
  await operator.applyAccountPolicy(
    { ...restored, previewToken: restoration.previewToken },
    admin,
  );
  await assert.rejects(
    client.listTasks({}, person),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const fresh = await login(subject);
  assert.equal((await client.listTasks({}, fresh)).tasks[0].id, task.id);
  await assert.rejects(
    operator.previewAccountPolicy(
      { ...request, subject: `household:${crypto.randomUUID()}` },
      admin,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.InvalidArgument,
  );
});

test("operator plan reductions require explicit allocation replacements and reject a stale retained-usage preview", async () => {
  const admin = { headers: { authorization: `Bearer ${"cd".repeat(32)}` } };
  const subject = `development-replacement-${crypto.randomUUID()}`;
  const initial = {
    operationId: crypto.randomUUID(),
    subject,
    displayName: "Replacement tester",
    approved: true,
    createAccount: true,
    plan: {
      items: 20n,
      shopping: 2n,
      templates: 2n,
      runs: 2n,
      bytes: 128000n,
      households: 3n,
    },
  };
  const admission = await operator.previewAccountPolicy(initial, admin);
  await operator.applyAccountPolicy(
    { ...initial, previewToken: admission.previewToken },
    admin,
  );
  const person = await login(subject);
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Explicit replacement",
      amounts: { items: 5n, bytes: 32000n },
    },
    person,
  );
  const scoped = { headers: { ...person.headers, "x-space-id": householdId } };
  await client.createTask(
    {
      id: crypto.randomUUID(),
      title: "Preserve shared content despite plan loss",
    },
    scoped,
  );
  const detail = await households.getHousehold({ id: householdId }, person);
  const reduction = {
    ...initial,
    operationId: crypto.randomUUID(),
    createAccount: false,
    expectedRevision: 1n,
    plan: { ...initial.plan, items: 1n },
  };
  assert.equal(
    (await operator.previewAccountPolicy(reduction, admin)).allowed,
    false,
  );
  const explicit = {
    ...reduction,
    replacements: [
      {
        householdId,
        expectedRevision: detail.household!.revision,
        amounts: { items: 0n, bytes: 32000n },
      },
    ],
  };
  // Only genuinely reduced plan dimensions may leave retained content unfunded.
  for (const plan of [
    initial.plan,
    { ...initial.plan, bytes: initial.plan.bytes - 1n },
    { ...initial.plan, items: initial.plan.items + 1n },
  ]) {
    const voluntary = {
      ...explicit,
      operationId: crypto.randomUUID(),
      plan,
    };
    const blocked = await operator.previewAccountPolicy(voluntary, admin);
    assert.equal(blocked.allowed, false);
    await assert.rejects(
      operator.applyAccountPolicy(
        { ...voluntary, previewToken: blocked.previewToken },
        admin,
      ),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.FailedPrecondition,
    );
  }
  const preview = await operator.previewAccountPolicy(explicit, admin);
  assert.equal(preview.allowed, true);
  assert.equal(
    preview.spaces.find((s) => s.id === householdId)!.exceedsAfter,
    true,
  );
  const cut = preview.spaces.find((space) => space.id === householdId)!;
  assert.equal(cut.ownAllocationBefore!.items, 5n);
  assert.equal(cut.ownAllocationAfter!.items, 0n);
  await client.createTask(
    { id: crypto.randomUUID(), title: "Changed after preview" },
    scoped,
  );
  await assert.rejects(
    operator.applyAccountPolicy(
      { ...explicit, previewToken: preview.previewToken },
      admin,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const updated = await operator.previewAccountPolicy(explicit, admin);
  await operator.applyAccountPolicy(
    { ...explicit, previewToken: updated.previewToken },
    admin,
  );
  assert.equal(
    (await households.getHousehold({ id: householdId }, person)).capacity!
      .items,
    0n,
  );
  assert.equal((await client.listTasks({}, scoped)).tasks.length, 2);
  await assert.rejects(
    client.createTask(
      { id: crypto.randomUUID(), title: "No growth in unfunded space" },
      scoped,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.ResourceExhausted,
  );
  const privateTask = await client.createTask(
    { id: crypto.randomUUID(), title: "Remaining personal item slot" },
    person,
  );
  assert.equal(
    (
      await operator.applyAccountPolicy(
        { ...explicit, previewToken: updated.previewToken },
        admin,
      )
    ).revision,
    2n,
  );
  assert.equal(
    (await client.listTasks({}, person)).tasks[0].id,
    privateTask.id,
  );
});

test("operator structural caps preserve oversized collections and reject further growth", async () => {
  const owner = await login();
  const admin = { headers: { authorization: `Bearer ${"cd".repeat(32)}` } };
  await assert.rejects(
    operator.getStructuralPolicy({}, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const initial = await operator.getStructuralPolicy({}, admin);
  let collection = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: {
          kind: CollectionKind.SHOPPING,
          title: "Retained structural overage",
        },
      },
      owner,
    )
  ).collection!;
  for (const title of ["Existing first item", "Existing second item"])
    collection = (
      await lists.applyChange(
        changeRequest(collection, ChangeAction.CREATE_ITEM, {
          item: { id: crypto.randomUUID(), title },
          position: collection.items.length,
        }),
        owner,
      )
    ).collection!;
  const change = {
    operationId: crypto.randomUUID(),
    expectedRevision: initial.revision,
    maxItemsPerCollection: 1n,
    maxSectionsPerCollection: 0n,
  };
  await assert.rejects(
    operator.setStructuralPolicy(change, admin),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  try {
    const saved = await operator.setStructuralPolicy(
      { ...change, confirmed: true },
      admin,
    );
    assert.equal(saved.maxItemsPerCollection, 1n);
    assert.equal(
      (
        await operator.setStructuralPolicy(
          { ...change, confirmed: true },
          admin,
        )
      ).revision,
      saved.revision,
    );
    assert.equal(
      (await lists.getCollection({ id: collection.id }, owner)).items.length,
      2,
    );
    await assert.rejects(
      lists.applyChange(
        changeRequest(collection, ChangeAction.CREATE_ITEM, {
          item: {
            id: crypto.randomUUID(),
            title: "Cannot exceed the structural cap",
          },
          position: 2,
        }),
        owner,
      ),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.ResourceExhausted,
    );
    assert.equal(
      (await lists.getCollection({ id: collection.id }, owner)).items.length,
      2,
    );
  } finally {
    const current = await operator.getStructuralPolicy({}, admin);
    await operator.setStructuralPolicy(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: current.revision,
        maxItemsPerCollection: initial.maxItemsPerCollection,
        maxSectionsPerCollection: initial.maxSectionsPerCollection,
        confirmed: true,
      },
      admin,
    );
  }
});
