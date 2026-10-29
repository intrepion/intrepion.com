import { createSign, createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EmailOperationsService } from "../../web/src/gen/life/v1/accounts_pb.js";
import {
  EmailInvitationService,
  EmailInvitationAction,
} from "../../web/src/gen/life/v1/accounts_pb.js";
import { AccountAdminService } from "../../web/src/gen/life/v1/accounts_pb.js";
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

async function createConsentedInvitation(
  householdId: string,
  owner: RpcSession,
  email: string,
  subject = `request:${email}`,
  endpoint = baseUrl,
) {
  // Each scenario starts with a fresh in-memory login limiter; the persisted
  // database and sessions remain unchanged, and rate limiting is tested separately.
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl: endpoint }),
  );
  const link = await invitations.createRequestLink(
    { operationId: crypto.randomUUID(), householdId },
    owner,
  );
  const challenge = await fetch(`${endpoint}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  assert.equal(challenge.status, 200);
  const { nonce } = (await challenge.json()) as { nonce: string };
  const response = await fetch(`${endpoint}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: challenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce,
      credential: subject,
      request_token: link.token,
      development_email: email,
      development_name: "Requester",
    }),
  });
  assert.equal(response.status, 200);
  const session = (await response.json()) as { csrf: string };
  const requester = {
    headers: {
      origin,
      "x-csrf-token": session.csrf,
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const request = await invitations.submitInvitationRequest(
    { operationId: crypto.randomUUID(), confirmed: true },
    requester,
  );
  return invitations.approveInvitationRequest(
    {
      operationId: crypto.randomUUID(),
      householdId,
      requestId: request.id,
      confirmed: true,
    },
    owner,
  );
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

test("maintenance freezes customer writes and retention while operator bootstrap and saved reads remain available", async () => {
  const owner = await login();
  const saved = await client.createTask(
    { id: crypto.randomUUID(), title: "Saved before the maintenance window" },
    owner,
  );
  const pending = { id: crypto.randomUUID(), title: "Retry after maintenance" };
  const frozenBase = "http://127.0.0.1:8794";
  const transport = createConnectTransport({ baseUrl: frozenBase });
  const frozenTasks = createClient(TaskService, transport);
  const frozenLists = createClient(ListService, transport);
  const frozenHouseholds = createClient(HouseholdService, transport);
  const frozenMaintenance = createClient(
    HouseholdMaintenanceService,
    transport,
  );
  const frozenOperator = createClient(PilotOperatorService, transport);
  const admin = { headers: { authorization: `Bearer ${"cd".repeat(32)}` } };
  const unavailable = (error: unknown) =>
    error instanceof ConnectError && error.code === Code.Unavailable;
  let instance = start("target/debug/intrepion-server", [], {
    env: { ...localEnv, PORT: "8794", CUSTOMER_WRITES_FROZEN: "true" },
  });
  try {
    await ready(`${frozenBase}/health/live`);
    await assert.rejects(frozenTasks.createTask(pending, owner), unavailable);
    const config = await (await fetch(`${frozenBase}/auth/config`)).json();
    assert.equal(config.customer_writes_frozen, true);
    assert.equal(
      (await fetch(`${frozenBase}/auth/session`, { headers: owner.headers }))
        .status,
      200,
    );
    await assert.rejects(
      frozenTasks.updateTask(
        { ...saved, title: "Blocked maintenance edit" },
        owner,
      ),
      unavailable,
    );
    await assert.rejects(
      frozenTasks.deleteTask({ id: saved.id, revision: saved.revision }, owner),
      unavailable,
    );
    await assert.rejects(
      frozenLists.applyChange(
        {
          operationId: crypto.randomUUID(),
          collectionId: crypto.randomUUID(),
          action: ChangeAction.CREATE_COLLECTION,
          details: {
            kind: CollectionKind.SHOPPING,
            title: "Blocked maintenance list",
          },
        },
        owner,
      ),
      unavailable,
    );
    await assert.rejects(
      frozenHouseholds.changeHousehold(
        {
          operationId: crypto.randomUUID(),
          householdId: crypto.randomUUID(),
          action: HouseholdAction.CREATE,
          name: "Blocked maintenance household",
          amounts: { bytes: 4096n },
        },
        owner,
      ),
      unavailable,
    );
    await assert.rejects(
      frozenHouseholds.copyCollection({}, owner),
      unavailable,
    );
    await assert.rejects(
      frozenMaintenance.eraseDueHouseholds(
        {},
        { headers: { authorization: `Bearer ${"ab".repeat(32)}` } },
      ),
      unavailable,
    );
    for (const path of ["challenge", "development", "google", "logout"]) {
      const response = await fetch(`${frozenBase}/auth/${path}`, {
        method: "POST",
        headers: { ...owner.headers, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
    }
    assert.equal(
      (
        await fetch(`${frozenBase}/life.v1.HouseholdService/FutureMutation`, {
          method: "POST",
          headers: owner.headers,
          body: "{}",
        })
      ).status,
      503,
    );
    const confirmed = (await frozenTasks.listTasks({}, owner)).tasks;
    assert.equal(
      confirmed.find((task) => task.id === saved.id)!.title,
      saved.title,
    );
    assert.equal(
      confirmed.some((task) => task.id === pending.id),
      false,
    );
    assert.equal(
      (await frozenLists.getCollection({ id: saved.id }, owner)).title,
      saved.title,
    );
    await frozenHouseholds.getOverview({}, owner);
    await assert.rejects(
      frozenOperator.getStructuralPolicy({}, owner),
      (error: unknown) =>
        error instanceof ConnectError && error.code === Code.Unauthenticated,
    );
    const policy = await frozenOperator.getStructuralPolicy({}, admin);
    const changed = await frozenOperator.setStructuralPolicy(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: policy.revision,
        maxItemsPerCollection: policy.maxItemsPerCollection,
        maxSectionsPerCollection: policy.maxSectionsPerCollection,
        confirmed: true,
      },
      admin,
    );
    assert.equal(changed.revision, policy.revision + 1n);
    assert.equal(
      (await operator.getStructuralPolicy({}, admin)).revision,
      changed.revision,
    );
    await stop(instance);
    instance = start("target/debug/intrepion-server", [], {
      env: { ...localEnv, PORT: "8794", CUSTOMER_WRITES_FROZEN: "false" },
    });
    await ready(`${frozenBase}/health/live`);
    await frozenTasks.createTask(pending, owner);
    await frozenTasks.createTask(pending, owner);
    assert.equal(
      (await frozenTasks.listTasks({}, owner)).tasks.filter(
        (task) => task.id === pending.id,
      ).length,
      1,
    );
    assert.equal(
      (await (await fetch(`${frozenBase}/auth/config`)).json())
        .customer_writes_frozen,
      false,
    );
  } finally {
    await stop(instance);
  }
});

test("site owner can review account and household usage metadata without private content; other accounts cannot", async () => {
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const owner = await login();
  const other = await login("development-second");
  await client.createTask(
    {
      id: crypto.randomUUID(),
      title: "Admin cannot read my private title",
      notes: "Private metadata boundary sentinel",
    },
    other,
  );
  const overview = await admin.getOverview({}, owner);
  assert.ok(overview.accounts.length >= 2);
  assert.ok(
    overview.accounts.every((account) => account.id && account.personalUsage),
  );
  assert.equal(overview.providerUsageStatus, "unavailable");
  const firstPage = await admin.getOverview({ pageSize: 1 }, owner);
  assert.equal(firstPage.accounts.length, 1);
  assert.equal(firstPage.nextAccount, firstPage.accounts[0].id);
  assert.equal(firstPage.accountCount, BigInt(overview.accounts.length));
  assert.equal(firstPage.logicalBytes, overview.logicalBytes);
  const secondPage = await admin.getOverview(
    { pageSize: 1, afterAccount: firstPage.nextAccount },
    owner,
  );
  assert.equal(secondPage.accounts.length, 1);
  assert.notEqual(secondPage.accounts[0].id, firstPage.accounts[0].id);
  await assert.rejects(admin.getOverview({ pageSize: 101 }, owner));
  assert.equal(
    JSON.stringify(overview, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ).includes("Admin cannot read my private title"),
    false,
  );
  await assert.rejects(
    admin.getOverview({}, other),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.PermissionDenied,
  );
  await assert.rejects(
    admin.getOverview({}),
    (error: unknown) =>
      error instanceof ConnectError && error.code === Code.Unauthenticated,
  );
});

test("reviewed site safety policy replaces reserved contributions and head ceilings without deleting retained content", async () => {
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const owner = await login();
  const other = await login("development-second");
  const before = await admin.getPolicy({}, owner);
  // Generous disposable migration-fixture budgets cover retained legacy test
  // data. Specific exhaustion regressions lower only their tested boundary.
  const hard = {
    items: 1000000n,
    shopping: 10000n,
    templates: 10000n,
    runs: 10000n,
    bytes: 1073741824n,
    households: 1000n,
  };
  const soft = {
    items: 800000n,
    shopping: 8000n,
    templates: 8000n,
    runs: 8000n,
    bytes: 800000000n,
    households: 800n,
  };
  const policy = {
    enabled: true,
    personalHard: hard,
    personalSoft: soft,
    householdHard: hard,
    householdSoft: soft,
    maxItemsPerCollection: 30n,
    maxSectionsPerCollection: 10n,
  };
  const change = {
    operationId: crypto.randomUUID(),
    expectedRevision: before.revision,
    policy,
    confirmed: true,
  };
  const review = await admin.previewPolicy(change, owner);
  assert.ok(review.effect.includes("preserved"));
  await assert.rejects(
    admin.applyPolicy(change, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  await assert.rejects(
    admin.applyPolicy({ ...change, previewToken: review.previewToken }, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  const applied = await admin.applyPolicy(
    { ...change, previewToken: review.previewToken },
    owner,
  );
  assert.equal(applied.enabled, true);
  assert.equal(applied.revision, before.revision + 1n);
  const currentAccounts = (await admin.getOverview({}, owner)).accounts;
  const initialJournal = (await (
    await fetch("http://127.0.0.1:8792/records", {
      headers: { authorization: "Bearer local-erasure-only" },
    })
  ).json()) as {
    records: {
      scope: string;
      security?: { public_id: string; active: boolean };
    }[];
  };
  assert.ok(
    currentAccounts.every((account) =>
      initialJournal.records.some(
        (r) =>
          r.scope === "account_access" &&
          r.security?.public_id === account.id &&
          r.security.active === !account.suspended,
      ),
    ),
  );
  assert.equal(
    (
      await admin.applyPolicy(
        { ...change, previewToken: review.previewToken },
        owner,
      )
    ).revision,
    applied.revision,
  );
  const id = crypto.randomUUID();
  const created = await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Name-only household",
    },
    owner,
  );
  assert.equal(created.householdId, id);
  const detail = await households.getHousehold({ id }, owner);
  assert.equal(detail.household?.name, "Name-only household");
  const task = await client.createTask(
    { id: crypto.randomUUID(), title: "Shared after safety migration" },
    { headers: { ...owner.headers, "x-space-id": id } },
  );
  assert.equal(task.title, "Shared after safety migration");
  assert.ok(
    (await households.listHouseholdActivity({ householdId: id }, owner)).entries
      .length,
  );
  const overview = await households.getOverview({}, owner);
  assert.equal(overview.normalAccounts, true);
  assert.equal(overview.personalCapacity, undefined);
  assert.equal(detail.contributions.length, 0);
  assert.equal(detail.heads[0]?.ceilings, undefined);
});

test("normal-account safety rejection is generic and concurrent increases preserve the winning saved task", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const policy = await admin.getPolicy({}, owner);
  const change = {
    operationId: crypto.randomUUID(),
    expectedRevision: policy.revision,
    policy: {
      ...policy,
      householdHard: { ...policy.householdHard!, items: 1n },
      householdSoft: { ...policy.householdSoft!, items: 1n },
    },
    confirmed: true,
  };
  const review = await admin.previewPolicy(change, owner);
  await admin.applyPolicy(
    { ...change, previewToken: review.previewToken },
    owner,
  );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Concurrent safety",
    },
    owner,
  );
  const shared = { headers: { ...owner.headers, "x-space-id": id } };
  const results = await Promise.allSettled([
    client.createTask(
      { id: crypto.randomUUID(), title: "First contender" },
      shared,
    ),
    client.createTask(
      { id: crypto.randomUUID(), title: "Second contender" },
      shared,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failed = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal((failed.reason as ConnectError).code, Code.ResourceExhausted);
  assert.equal(
    (failed.reason as ConnectError).rawMessage,
    "Your change was not saved. Please try again later or contact support.",
  );
  const saved = (await client.listTasks({}, shared)).tasks;
  assert.equal(saved.length, 1);
  const winning = results.find(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<(typeof saved)[number]>;
  assert.equal(saved[0]!.id, winning.value.id);
  const diagnostics = (await admin.listAudit({}, owner)).entries.filter((e) =>
    e.action.includes("Blocked resource write"),
  );
  assert.ok(
    diagnostics.some(
      (e) =>
        e.action.includes("space_items_allowance") && e.action.includes(id),
    ),
  );
  assert.equal(
    JSON.stringify(diagnostics, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes("First contender"),
    false,
  );
  const current = await admin.getPolicy({}, owner);
  const structural = {
    operationId: crypto.randomUUID(),
    expectedRevision: current.revision,
    policy: { ...current, maxItemsPerCollection: 1n },
    confirmed: true,
  };
  const structuralReview = await admin.previewPolicy(structural, owner);
  await admin.applyPolicy(
    { ...structural, previewToken: structuralReview.previewToken },
    owner,
  );
  let collection = await shopping(owner);
  collection = (
    await lists.applyChange(
      changeRequest(collection, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Private structural canary" },
      }),
      owner,
    )
  ).collection!;
  await assert.rejects(
    lists.applyChange(
      changeRequest(collection, ChangeAction.CREATE_ITEM, {
        item: { id: crypto.randomUUID(), title: "Private rejected canary" },
      }),
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError &&
      e.code === Code.ResourceExhausted &&
      e.rawMessage ===
        "Your change was not saved. Please try again later or contact support.",
  );
  const latest = (await admin.listAudit({}, owner)).entries.filter((e) =>
    e.action.includes("Blocked resource write"),
  );
  const ownerId = (await households.getOverview({}, owner)).identity!.id;
  assert.equal(latest.filter((e) => e.actorId === ownerId).length, 1);
  assert.ok(
    latest.some(
      (e) =>
        e.actorId === ownerId &&
        e.action.includes("collection_items_allowance") &&
        e.action.includes("personal"),
    ),
  );
  assert.equal(
    JSON.stringify(latest, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes("canary"),
    false,
  );
  await assert.rejects(admin.listAudit({}, await login("development-second")));
  const restore = {
    operationId: crypto.randomUUID(),
    expectedRevision: (await admin.getPolicy({}, owner)).revision,
    policy: current,
    confirmed: true,
  };
  const restoration = await admin.previewPolicy(restore, owner);
  await admin.applyPolicy(
    { ...restore, previewToken: restoration.previewToken },
    owner,
  );
});

test("emailed invitations expose delivery metadata without secrets and pause prevents invitation growth", async () => {
  const owner = await login();
  const other = await login("development-second");
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const initial = await admin.getGrowth({}, owner);
  assert.equal(initial.paused, true);
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Email invitation household",
    },
    owner,
  );
  const change = {
    operationId: crypto.randomUUID(),
    householdId: id,
    recipientEmail: "morgan@example.invalid",
    action: EmailInvitationAction.CREATE,
    confirmed: true,
  };
  await assert.rejects(
    invitations.changeInvitation(change, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  await admin.changeGrowth(
    {
      operationId: crypto.randomUUID(),
      expectedRevision: initial.revision,
      paused: false,
      confirmed: true,
    },
    owner,
  );
  await assert.rejects(
    invitations.changeInvitation(
      { ...change, operationId: crypto.randomUUID() },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const linkAction = { operationId: crypto.randomUUID(), householdId: id };
  const defaultNotifications = await invitations.getRequestNotifications(
    { id },
    owner,
  );
  assert.equal(defaultNotifications.enabled, false);
  await assert.rejects(
    invitations.setRequestNotifications(
      { householdId: id, enabled: true, confirmed: true },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const headChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const headNonce = ((await headChallenge.json()) as { nonce: string }).nonce;
  const headLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: headChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: headNonce,
      credential: "development-owner",
      development_email: "head@example.invalid",
    }),
  });
  assert.equal(headLogin.status, 200);
  const headIdentity = (await headLogin.json()) as { csrf: string };
  const headSession = {
    headers: {
      origin,
      "x-csrf-token": headIdentity.csrf,
      cookie: headLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const optedIn = await invitations.setRequestNotifications(
    { householdId: id, enabled: true, confirmed: true },
    headSession,
  );
  assert.equal(optedIn.enabled, true);
  assert.equal(optedIn.email, "head@example.invalid");
  const changedChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const changedNonce = ((await changedChallenge.json()) as { nonce: string })
    .nonce;
  const changedLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: changedChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: changedNonce,
      credential: "development-owner",
      development_email: "new-head@example.invalid",
    }),
  });
  assert.equal(changedLogin.status, 200);
  const changedIdentity = (await changedLogin.json()) as { csrf: string };
  const changedSession = {
    headers: {
      origin,
      "x-csrf-token": changedIdentity.csrf,
      cookie: changedLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const pausedSettings = await invitations.getRequestNotifications(
    { id },
    changedSession,
  );
  assert.equal(pausedSettings.confirmationRequired, true);
  assert.equal(pausedSettings.email, "new-head@example.invalid");
  const reconfirmed = await invitations.setRequestNotifications(
    { householdId: id, enabled: true, confirmed: true },
    changedSession,
  );
  assert.equal(reconfirmed.confirmationRequired, false);
  const bytesBeforeLink = (await admin.getOverview({}, owner)).households.find(
    (h) => h.id === id,
  )!.usage!.bytes;
  const requestLink = await invitations.createRequestLink(linkAction, owner);
  const limitedBase = "http://127.0.0.1:8789";
  const limitedServer = start("target/debug/intrepion-server", [], {
    env: { ...localEnv, PORT: "8789", MAX_REQUEST_LINKS_PER_HOUSEHOLD: "1" },
  });
  try {
    await ready(`${limitedBase}/health/live`);
    const limitedInvites = createClient(
      EmailInvitationService,
      createConnectTransport({ baseUrl: limitedBase }),
    );
    await assert.rejects(
      limitedInvites.createRequestLink(
        { householdId: id, operationId: crypto.randomUUID() },
        owner,
      ),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.FailedPrecondition,
    );
  } finally {
    await stop(limitedServer);
  }
  const managedLinks = await invitations.listRequestLinks({ id }, owner);
  assert.equal(managedLinks.links.length, 1);
  assert.equal(managedLinks.links[0]?.id, requestLink.id);
  assert.equal(
    JSON.stringify(managedLinks, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes(requestLink.token),
    false,
  );
  await assert.rejects(
    invitations.listRequestLinks({ id }, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  assert.ok(
    (await admin.getOverview({}, owner)).households.find((h) => h.id === id)!
      .usage!.bytes > bytesBeforeLink,
  );
  const bytesAfterLink = (await admin.getOverview({}, owner)).households.find(
    (h) => h.id === id,
  )!.usage!.bytes;
  assert.match(requestLink.token, /^[a-f0-9]{64}$/);
  assert.equal(
    (await invitations.createRequestLink(linkAction, owner)).id,
    requestLink.id,
  );
  assert.equal(
    (await invitations.createRequestLink(linkAction, owner)).token,
    requestLink.token,
  );
  await assert.rejects(
    invitations.getRequestPreview({}),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const challenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const { nonce } = (await challenge.json()) as { nonce: string };
  const requestLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: challenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce,
      credential: "new-requester",
      request_token: requestLink.token,
      development_email: "jordan@example.invalid",
      development_name: "Jordan",
    }),
  });
  assert.equal(requestLogin.status, 200);
  const requestIdentity = (await requestLogin.json()) as { csrf: string };
  const requester = {
    headers: {
      origin,
      "x-csrf-token": requestIdentity.csrf,
      cookie: requestLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const preview = await invitations.getRequestPreview({}, requester);
  assert.equal(preview.householdName, "Email invitation household");
  assert.equal(preview.email, "jordan@example.invalid");
  assert.equal(preview.displayName, "Jordan");
  const submission = { operationId: crypto.randomUUID(), confirmed: true };
  await assert.rejects(
    invitations.submitInvitationRequest(
      { ...submission, confirmed: false },
      requester,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const requested = await invitations.submitInvitationRequest(
    submission,
    requester,
  );
  assert.equal(requested.status, "pending");
  const requestHistory = (
    await households.listHouseholdActivity({ householdId: id }, owner)
  ).entries;
  assert.ok(
    requestHistory.some((entry) => entry.action === "Invitation requested"),
  );
  assert.equal(
    JSON.stringify(requestHistory, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ).includes("jordan@example.invalid"),
    false,
  );
  const notifyOps = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  await notifyOps.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  assert.ok(
    (await admin.getOverview({}, owner)).households.find((h) => h.id === id)!
      .usage!.bytes > bytesAfterLink,
  );
  const lookupChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const lookupNonce = ((await lookupChallenge.json()) as { nonce: string })
    .nonce;
  const lookupLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: lookupChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: lookupNonce,
      credential: "new-requester",
      request_lookup: true,
      development_email: "jordan@example.invalid",
      development_name: "Jordan",
    }),
  });
  assert.equal(lookupLogin.status, 200);
  const lookupIdentity = (await lookupLogin.json()) as { csrf: string };
  const lookupSession = {
    headers: {
      origin,
      "x-csrf-token": lookupIdentity.csrf,
      cookie: lookupLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const mine = await invitations.listMyInvitationRequests({}, lookupSession);
  assert.equal(mine.requests.length, 1);
  assert.equal(mine.requests[0]?.householdName, "Email invitation household");
  assert.equal(mine.requests[0]?.id, requested.id);
  const withdrawChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const withdrawNonce = ((await withdrawChallenge.json()) as { nonce: string })
    .nonce;
  const withdrawLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: withdrawChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: withdrawNonce,
      credential: "withdraw-requester",
      request_token: requestLink.token,
      development_email: "withdraw@example.invalid",
      development_name: "Withdraw",
    }),
  });
  assert.equal(withdrawLogin.status, 200);
  const withdrawAuth = (await withdrawLogin.json()) as { csrf: string };
  const withdrawRequestSession = {
    headers: {
      origin,
      "x-csrf-token": withdrawAuth.csrf,
      cookie: withdrawLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const withdrawTarget = await invitations.submitInvitationRequest(
    { operationId: crypto.randomUUID(), confirmed: true },
    withdrawRequestSession,
  );
  await invitations.setRequestNotifications(
    { householdId: id, enabled: false, confirmed: true },
    changedSession,
  );
  await notifyOps.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const afterOptOut = (await (
    await fetch("http://127.0.0.1:8793/messages", {
      headers: { authorization: "Bearer local-email-only" },
    })
  ).json()) as { messages: { recipient: string }[] };
  assert.equal(
    afterOptOut.messages.filter(
      (m) => m.recipient === "new-head@example.invalid",
    ).length,
    1,
  );
  await invitations.setRequestNotifications(
    { householdId: id, enabled: true, confirmed: true },
    changedSession,
  );
  const freshChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const freshNonce = ((await freshChallenge.json()) as { nonce: string }).nonce;
  const freshLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: freshChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: freshNonce,
      credential: "withdraw-requester",
      request_lookup: true,
      development_email: "withdraw@example.invalid",
    }),
  });
  assert.equal(freshLogin.status, 200);
  const freshIdentity = (await freshLogin.json()) as { csrf: string };
  const freshSession = {
    headers: {
      origin,
      "x-csrf-token": freshIdentity.csrf,
      cookie: freshLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const withdrawal = {
    operationId: crypto.randomUUID(),
    requestId: withdrawTarget.id,
    confirmed: true,
  };
  const withdrawnInvitation = await invitations.approveInvitationRequest(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      requestId: withdrawTarget.id,
      confirmed: true,
    },
    owner,
  );
  await assert.rejects(
    invitations.withdrawInvitationRequest(withdrawal, lookupSession),
  );
  await invitations.withdrawInvitationRequest(withdrawal, freshSession);
  await invitations.withdrawInvitationRequest(withdrawal, freshSession);
  assert.equal(
    (await invitations.listInvitations({ id }, owner)).invitations.find(
      (i) => i.id === withdrawnInvitation.id,
    )?.status,
    "revoked",
  );
  assert.equal(
    (await invitations.listMyInvitationRequests({}, freshSession)).requests[0]
      ?.status,
    "withdrawn",
  );
  assert.equal(
    (await invitations.submitInvitationRequest(submission, requester)).id,
    requested.id,
  );
  assert.equal(
    (
      await invitations.submitInvitationRequest(
        { ...submission, operationId: crypto.randomUUID() },
        requester,
      )
    ).id,
    requested.id,
  );
  assert.equal(
    (await invitations.listInvitationRequests({ id }, owner)).requests.length,
    1,
  );
  await notifyOps.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const notificationInbox = (await (
    await fetch("http://127.0.0.1:8793/messages", {
      headers: { authorization: "Bearer local-email-only" },
    })
  ).json()) as {
    messages: {
      id: string;
      recipient: string;
      text: string;
      tags: { Name: string; Value: string }[];
    }[];
  };
  const notices = notificationInbox.messages.filter(
    (m) => m.recipient === "new-head@example.invalid",
  );
  assert.equal(notices.length, 1);
  assert.ok(notices[0]!.text.includes("Email invitation household"));
  assert.equal(notices[0]!.text.includes("Jordan"), false);
  assert.equal(notices[0]!.text.includes("jordan@example.invalid"), false);
  const noticeEvent = {
    eventType: "Delivery",
    mail: {
      messageId: notices[0]!.id,
      destination: [notices[0]!.recipient],
      tags: Object.fromEntries(
        notices[0]!.tags.map((tag) => [tag.Name, [tag.Value]]),
      ),
    },
  };
  const noticeEnvelope = await signedFeedback(noticeEvent);
  const postNoticeFeedback = (body: unknown) =>
    fetch(`${baseUrl}/email/feedback`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=UTF-8" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await postNoticeFeedback({ ...noticeEnvelope, Signature: "AA==" })).status,
    403,
  );
  assert.equal((await postNoticeFeedback(noticeEnvelope)).status, 204);
  assert.equal((await postNoticeFeedback(noticeEnvelope)).status, 204);
  assert.ok(
    (await admin.getEmailOperations({}, owner)).deliveries.some(
      (d) =>
        d.recipientEmail === "new-head@example.invalid" &&
        d.outcome === "delivered",
    ),
  );
  const decision = {
    operationId: crypto.randomUUID(),
    householdId: id,
    requestId: requested.id,
    confirmed: true,
  };
  await assert.rejects(
    invitations.declineInvitationRequest(decision, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await invitations.declineInvitationRequest(decision, owner);
  await invitations.declineInvitationRequest(decision, owner);
  await assert.rejects(
    invitations.submitInvitationRequest(
      { operationId: crypto.randomUUID(), confirmed: true },
      requester,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const nextChallenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const nextNonce = ((await nextChallenge.json()) as { nonce: string }).nonce;
  const nextLogin = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: nextChallenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce: nextNonce,
      credential: "another-requester",
      request_token: requestLink.token,
      development_email: "alex@example.invalid",
      development_name: "Alex",
    }),
  });
  assert.equal(nextLogin.status, 200);
  const nextIdentity = (await nextLogin.json()) as { csrf: string };
  const nextRequester = {
    headers: {
      origin,
      "x-csrf-token": nextIdentity.csrf,
      cookie: nextLogin.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  const approvedSubmission = {
    operationId: crypto.randomUUID(),
    confirmed: true,
  };
  const approvedRequest = await invitations.submitInvitationRequest(
    approvedSubmission,
    nextRequester,
  );
  assert.equal(
    (await invitations.listInvitationRequests({ id }, owner)).requests.length,
    1,
  );
  const approval = {
    operationId: crypto.randomUUID(),
    householdId: id,
    requestId: approvedRequest.id,
    confirmed: true,
  };
  await assert.rejects(
    invitations.approveInvitationRequest(approval, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  const issued = await invitations.approveInvitationRequest(approval, owner);
  assert.equal(issued.recipientEmail, "alex@example.invalid");
  assert.equal(
    (await invitations.approveInvitationRequest(approval, owner)).id,
    issued.id,
  );
  await assert.rejects(
    invitations.declineInvitationRequest(
      { ...approval, operationId: crypto.randomUUID() },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  const emailOps = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  await emailOps.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const messages = (await (
    await fetch("http://127.0.0.1:8793/messages", {
      headers: { authorization: "Bearer local-email-only" },
    })
  ).json()) as { messages: { recipient: string; text: string }[] };
  const receivedRequestMail = messages.messages.find(
    (m) => m.recipient === "alex@example.invalid",
  );
  assert.ok(receivedRequestMail);
  const approvedToken = receivedRequestMail.text.match(
    /#invite=([a-f0-9]{64})/,
  )?.[1];
  assert.ok(approvedToken);
  assert.equal(
    (
      await invitationLogin(
        approvedToken,
        "wrong-google-subject",
        "alex@example.invalid",
      )
    ).status,
    403,
  );
  const correctLogin = await invitationLogin(
    approvedToken,
    "another-requester",
    "alex@example.invalid",
  );
  assert.equal(correctLogin.status, 200);
  const onboarding = (await correctLogin.json()) as { csrf: string };
  const onboardHeaders = {
    origin,
    "x-csrf-token": onboarding.csrf,
    cookie: correctLogin.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
  let joinedCookies = "";
  const joined = await invitations.acceptInvitation(
    { operationId: crypto.randomUUID(), displayName: "Alex", confirmed: true },
    {
      headers: onboardHeaders,
      onHeader: (headers) => {
        joinedCookies = (headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      },
    },
  );
  assert.equal(joined.householdId, id);
  const joinedSession = {
    headers: { origin, "x-csrf-token": joined.csrf, cookie: joinedCookies },
  };
  const joinedNotifications = await invitations.setRequestNotifications(
    { householdId: id, enabled: true, confirmed: true },
    joinedSession,
  );
  assert.equal(joinedNotifications.email, "alex@example.invalid");
  await invitations.setRequestNotifications(
    { householdId: id, enabled: false, confirmed: true },
    joinedSession,
  );
  assert.equal(
    (
      await invitations.submitInvitationRequest(
        approvedSubmission,
        nextRequester,
      )
    ).status,
    "accepted",
  );
  await assert.rejects(
    invitations.listInvitationRequests({ id }, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await assert.rejects(
    invitations.createRequestLink(
      { ...linkAction, operationId: crypto.randomUUID() },
      other,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await assert.rejects(
    invitations.revokeRequestLink(
      { householdId: id, linkId: requestLink.id },
      other,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await invitations.revokeRequestLink(
    { householdId: id, linkId: requestLink.id },
    owner,
  );
  assert.equal(
    (await invitations.listInvitationRequests({ id }, owner)).requests.length,
    0,
  );
  await assert.rejects(
    invitations.getRequestPreview({}, requester),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  await assert.rejects(
    invitations.createRequestLink(linkAction, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  await invitations.setRequestNotifications(
    { householdId: id, enabled: false, confirmed: true },
    changedSession,
  );
  const sent = await createConsentedInvitation(
    id,
    owner,
    "morgan@example.invalid",
  );
  assert.equal(sent.recipientEmail, "morgan@example.invalid");
  assert.equal(sent.deliveryStatus, "queued");
  assert.equal(
    (await invitations.listInvitations({ id }, owner)).invitations.length,
    3,
  );
  await assert.rejects(
    invitations.listInvitations({ id }, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  assert.equal(
    Object.keys(sent).some((k) => /token|secret|link/i.test(k)),
    false,
  );
  const replacement = await invitations.changeInvitation(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      invitationId: sent.id,
      expectedRevision: sent.revision,
      action: EmailInvitationAction.REPLACE,
      confirmed: true,
    },
    owner,
  );
  assert.equal(replacement.revision, sent.revision + 1n);
  const revoked = await invitations.changeInvitation(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      invitationId: sent.id,
      expectedRevision: replacement.revision,
      action: EmailInvitationAction.REVOKE,
      confirmed: true,
    },
    owner,
  );
  assert.equal(revoked.status, "revoked");
  // The scenario exercises several sign-ins; isolate the in-memory login limiter
  // so unrelated tests do not depend on how many checks this scenario makes.
  await stop(server);
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
});

test("private email operations deliver the recipient link and count attempts without exposing it to heads", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Dinner <script>alert(1)</script>",
    },
    owner,
  );
  const invitation = await createConsentedInvitation(
    id,
    owner,
    "delivery@example.invalid",
  );
  await assert.rejects(
    mail.processQueue({}, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  const result = await mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  assert.ok(result.attempted >= 1n);
  assert.ok(result.monthlyAttempts >= 1n);
  const inboxResponse = await fetch("http://127.0.0.1:8793/messages", {
    headers: { authorization: "Bearer local-email-only" },
  });
  assert.equal(inboxResponse.status, 200);
  const inbox = (await inboxResponse.json()) as {
    messages: { recipient: string; text: string; html?: string }[];
  };
  const received = inbox.messages.find(
    (m) => m.recipient === "delivery@example.invalid",
  );
  assert.ok(received);
  assert.equal(typeof received.html, "string");
  assert.match(
    received.html ?? "",
    /Dinner &lt;script&gt;alert\(1\)&lt;\/script&gt;/,
  );
  assert.equal((received.html ?? "").includes("<script>"), false);
  assert.match(received.html ?? "", /Review invitation/);
  const token = received.text.match(/#invite=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal(
    JSON.stringify(
      await invitations.listInvitations({ id }, owner),
      (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    ).includes(token),
    false,
  );
  const current = (
    await invitations.listInvitations({ id }, owner)
  ).invitations.find((i) => i.id === invitation.id)!;
  assert.equal(current.deliveryStatus, "submitted");
});

async function invitationLogin(token: string, subject: string, email: string) {
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
        .map((v) => v.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce,
      credential: subject,
      invitation_token: token,
      development_email: email,
      development_name: "Prefilled Google name",
    }),
  });
  return response;
}

test("Google invitation onboarding creates an isolated normal account only on explicit once-only acceptance", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Family onboarding household",
    },
    owner,
  );
  await client.createTask(
    { id: crypto.randomUUID(), title: "Retained shared task" },
    { headers: { ...owner.headers, "x-space-id": id } },
  );
  await createConsentedInvitation(
    id,
    owner,
    "family@example.invalid",
    "development-family",
  );
  await mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const response = await fetch("http://127.0.0.1:8793/messages", {
    headers: { authorization: "Bearer local-email-only" },
  });
  const inbox = (await response.json()) as {
    messages: { recipient: string; text: string }[];
  };
  const token = inbox.messages
    .find((m) => m.recipient === "family@example.invalid")
    ?.text.match(/#invite=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  const before = (await admin.getOverview({}, owner)).accounts.length;
  await assert.rejects(
    invitations.getOnboarding({}),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const wrong = await invitationLogin(
    token,
    "development-wrong-family",
    "wrong@example.invalid",
  );
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.text()).includes("family@example.invalid"), false);
  const unavailableLink = await invitationLogin(
    "ab".repeat(32),
    "development-family",
    "family@example.invalid",
  );
  assert.equal(unavailableLink.status, 410);
  assert.equal(
    (await unavailableLink.text()).includes("Family onboarding household"),
    false,
  );
  const verified = await invitationLogin(
    token,
    "development-family",
    "family@example.invalid",
  );
  assert.equal(verified.status, 200);
  const context = (await verified.json()) as {
    csrf: string;
    onboarding: boolean;
  };
  assert.equal(context.onboarding, true);
  const onboarding = {
    headers: {
      origin,
      "x-csrf-token": context.csrf,
      cookie: verified.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    },
  };
  const preview = await invitations.getOnboarding({}, onboarding);
  assert.equal(preview.householdName, "Family onboarding household");
  assert.equal(preview.existingAccount, false);
  assert.equal(preview.displayName, "Prefilled Google name");
  assert.equal((await admin.getOverview({}, owner)).accounts.length, before);
  await assert.rejects(
    client.listTasks({}, onboarding),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const request = {
    operationId: crypto.randomUUID(),
    displayName: "Family head",
    confirmed: true,
  };
  const beforeMembership = (await households.getHousehold({ id }, owner))
    .household!.revision;
  let cookies = "";
  const accepted = await invitations.acceptInvitation(request, {
    ...onboarding,
    onHeader: (headers) => {
      cookies = headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
    },
  });
  assert.equal(accepted.displayName, "Family head");
  assert.equal(accepted.householdId, id);
  const family = {
    headers: { origin, "x-csrf-token": accepted.csrf, cookie: cookies },
  };
  assert.equal((await client.listTasks({}, family)).tasks.length, 0);
  assert.equal(
    (
      await client.listTasks(
        {},
        { headers: { ...family.headers, "x-space-id": id } },
      )
    ).tasks.length,
    1,
  );
  const repeated = await invitations.acceptInvitation(request, onboarding);
  assert.equal(repeated.householdId, id);
  // Simulate losing the accepted response and its normal-session cookie, then
  // reloading with only the previously verified onboarding cookie.
  let recoveredCookie = "";
  const recovered = await invitations.getOnboarding(
    {},
    {
      ...onboarding,
      onHeader: (headers) => {
        recoveredCookie = headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
      },
    },
  );
  assert.equal(recovered.status, "accepted");
  assert.match(recoveredCookie, /local_session=/);
  const recoveredSession = await fetch(`${baseUrl}/auth/session`, {
    headers: { cookie: recoveredCookie },
  });
  assert.equal(recoveredSession.status, 200);
  assert.equal(
    ((await recoveredSession.json()) as { onboarding?: boolean }).onboarding,
    undefined,
  );
  assert.equal(
    (await households.getHousehold({ id }, owner)).household!.revision,
    beforeMembership + 1n,
  );
  assert.equal(
    (await admin.getOverview({}, owner)).accounts.length,
    before + 1,
  );
  assert.equal(
    (await households.getHousehold({ id }, family)).heads.filter(
      (h) => h.identity?.name === "Family head",
    ).length,
    1,
  );
  await assert.rejects(
    admin.getOverview({}, family),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
});

test("onboarding respects growth pause and replacement, and sign-out invalidates its private session", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  let growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    growth = await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Invitation session recovery",
    },
    owner,
  );
  const pending = await createConsentedInvitation(
    id,
    owner,
    "session@example.invalid",
    "development-invitation-session",
  );
  const ops = { headers: { authorization: `Bearer ${"ef".repeat(32)}` } };
  await mail.processQueue({}, ops);
  const readToken = async () => {
    const response = await fetch("http://127.0.0.1:8793/messages", {
      headers: { authorization: "Bearer local-email-only" },
    });
    const inbox = (await response.json()) as {
      messages: { recipient: string; text: string }[];
    };
    const token = inbox.messages
      .filter((m) => m.recipient === "session@example.invalid")
      .at(-1)
      ?.text.match(/#invite=([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    return token;
  };
  const token = await readToken();
  const response = await invitationLogin(
    token,
    "development-invitation-session",
    "session@example.invalid",
  );
  assert.equal(response.status, 200);
  const context = (await response.json()) as { csrf: string };
  const onboarding = {
    headers: {
      origin,
      "x-csrf-token": context.csrf,
      cookie: response.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    },
  };
  growth = await admin.changeGrowth(
    {
      operationId: crypto.randomUUID(),
      expectedRevision: growth.revision,
      paused: true,
      confirmed: true,
    },
    owner,
  );
  assert.equal(
    (await invitations.getOnboarding({}, onboarding)).growthPaused,
    true,
  );
  const acceptance = {
    operationId: crypto.randomUUID(),
    displayName: "Session head",
    confirmed: true,
  };
  await assert.rejects(
    invitations.acceptInvitation(acceptance, onboarding),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.FailedPrecondition,
  );
  await admin.changeGrowth(
    {
      operationId: crypto.randomUUID(),
      expectedRevision: growth.revision,
      paused: false,
      confirmed: true,
    },
    owner,
  );
  await invitations.changeInvitation(
    {
      action: EmailInvitationAction.REPLACE,
      operationId: crypto.randomUUID(),
      householdId: id,
      invitationId: pending.id,
      expectedRevision: pending.revision,
      confirmed: true,
    },
    owner,
  );
  await assert.rejects(
    invitations.getOnboarding({}, onboarding),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const oldLogin = await invitationLogin(
    token,
    "development-invitation-session",
    "session@example.invalid",
  );
  assert.equal(oldLogin.status, 410);
  await mail.processQueue({}, ops);
  const replacement = await readToken();
  assert.notEqual(replacement, token);
  const fresh = await invitationLogin(
    replacement,
    "development-invitation-session",
    "session@example.invalid",
  );
  assert.equal(fresh.status, 200);
  const freshContext = (await fresh.json()) as { csrf: string };
  const freshHeaders = {
    origin,
    "x-csrf-token": freshContext.csrf,
    cookie: fresh.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
  const signedOut = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: freshHeaders,
  });
  assert.equal(signedOut.status, 204);
  await assert.rejects(
    invitations.acceptInvitation(acceptance, { headers: freshHeaders }),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
});

test("site account suspension and restoration preserve data, end old sessions and publish independent pseudonymous protection", async () => {
  const owner = await login();
  const other = await login("development-second");
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const otherId = (await households.getOverview({}, other)).identity!.id;
  const ownerId = (await households.getOverview({}, owner)).identity!.id;
  const otherHousehold = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: otherHousehold,
      operationId: crypto.randomUUID(),
      name: "Account access usage projection",
    },
    other,
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const growthForSuspension = await admin.getGrowth({}, owner);
  if (growthForSuspension.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growthForSuspension.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const otherLink = await invitations.createRequestLink(
    { operationId: crypto.randomUUID(), householdId: otherHousehold },
    other,
  );
  const challenge = await fetch(`${baseUrl}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  const { nonce } = (await challenge.json()) as { nonce: string };
  const prospective = await fetch(`${baseUrl}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: challenge.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      nonce,
      credential: "suspension-requester",
      request_token: otherLink.token,
      development_email: "suspension@example.invalid",
      development_name: "Requester",
    }),
  });
  assert.equal(prospective.status, 200);
  const requestIdentity = (await prospective.json()) as { csrf: string };
  const requestSession = {
    headers: {
      origin,
      "x-csrf-token": requestIdentity.csrf,
      cookie: prospective.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    },
  };
  await invitations.submitInvitationRequest(
    { operationId: crypto.randomUUID(), confirmed: true },
    requestSession,
  );
  const before = (await client.listTasks({}, other)).tasks
    .map((t) => t.id)
    .sort();
  const metadata = (await admin.getOverview({}, owner)).accounts.find(
    (a) => a.id === otherId,
  )!;
  const priorJournal = (await (
    await fetch("http://127.0.0.1:8792/records", {
      headers: { authorization: "Bearer local-erasure-only" },
    })
  ).json()) as {
    records: {
      operation_id: string;
      scope: string;
      security?: { public_id: string };
    }[];
  };
  const priorChanges = new Set(
    priorJournal.records
      .filter(
        (r) =>
          r.scope === "account_access" && r.security?.public_id === otherId,
      )
      .map((r) => r.operation_id),
  );
  const change = {
    operationId: crypto.randomUUID(),
    accountId: otherId,
    expectedRevision: metadata.accessRevision,
    suspended: true,
    confirmed: true,
  };
  await assert.rejects(
    admin.setAccountAccess(change, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await assert.rejects(
    admin.setAccountAccess(
      { ...change, operationId: crypto.randomUUID(), accountId: ownerId },
      owner,
    ),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  const suspended = await admin.setAccountAccess(change, owner);
  await assert.rejects(
    invitations.getRequestPreview({}, requestSession),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  assert.equal(suspended.suspended, true);
  assert.equal(suspended.accessRevision, metadata.accessRevision + 1n);
  assert.equal(suspended.protectionPending, false);
  assert.deepEqual(suspended.personalUsage, metadata.personalUsage);
  assert.equal(
    (await admin.setAccountAccess(change, owner)).accessRevision,
    suspended.accessRevision,
  );
  await assert.rejects(
    client.listTasks({}, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const restored = await admin.setAccountAccess(
    {
      operationId: crypto.randomUUID(),
      accountId: otherId,
      expectedRevision: suspended.accessRevision,
      suspended: false,
      confirmed: true,
    },
    owner,
  );
  assert.equal(restored.suspended, false);
  const audit = await admin.listAudit({}, owner);
  assert.equal(
    audit.entries.filter((entry) => entry.operationId === change.operationId)
      .length,
    1,
  );
  const event = audit.entries.find(
    (entry) => entry.operationId === change.operationId,
  )!;
  assert.equal(event.actorId, ownerId);
  assert.ok(event.actorName);
  assert.ok(event.action.includes("Suspended account"));
  assert.equal(
    JSON.stringify(audit, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes("development-owner"),
    false,
  );
  await assert.rejects(
    admin.listAudit({}, await login("development-second")),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.PermissionDenied,
  );
  await assert.rejects(
    client.listTasks({}, other),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.Unauthenticated,
  );
  const fresh = await login("development-second");
  assert.deepEqual(
    (await client.listTasks({}, fresh)).tasks.map((t) => t.id).sort(),
    before,
  );
  const ledgerResponse = await fetch("http://127.0.0.1:8792/records", {
    headers: { authorization: "Bearer local-erasure-only" },
  });
  assert.equal(ledgerResponse.status, 200);
  const ledger = (await ledgerResponse.json()) as {
    records: {
      operation_id: string;
      version: number;
      scope: string;
      security?: { public_id: string; subject_hash: string; active: boolean };
    }[];
  };
  const changes = ledger.records.filter(
    (r) =>
      r.version === 4 &&
      r.scope === "account_access" &&
      r.security?.public_id === otherId,
  );
  assert.equal(changes.length, priorChanges.size + 2);
  const newChanges = changes.filter((r) => !priorChanges.has(r.operation_id));
  assert.ok(newChanges.some((r) => r.security?.active === false));
  assert.ok(newChanges.some((r) => r.security?.active === true));
  assert.ok(
    changes.every((r) => /^[a-f0-9]{64}$/.test(r.security!.subject_hash)),
  );
  assert.equal(JSON.stringify(changes).includes("development-second"), false);
});

async function signedFeedback(
  message: unknown,
  overrides: Record<string, string> = {},
) {
  const envelope: Record<string, string> = {
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: "arn:aws:sns:us-west-2:000000000000:local-email-feedback",
    Message: JSON.stringify(message),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "2",
    SigningCertURL: "http://127.0.0.1:8793/SimpleNotificationService-local.pem",
    Subject: "SES delivery feedback",
    ...overrides,
  };
  const names =
    envelope.Type === "Notification"
      ? [
          "Message",
          "MessageId",
          ...(envelope.Subject ? ["Subject"] : []),
          "Timestamp",
          "TopicArn",
          "Type",
        ]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  const canonical = names
    .map((name) => `${name}\n${envelope[name]}\n`)
    .join("");
  const key = createPrivateKey({
    key: await readFile("server/tests/fixtures/signing-key.der"),
    format: "der",
    type: "pkcs1",
  });
  envelope.Signature = createSign("RSA-SHA256")
    .update(canonical)
    .sign(key, "base64");
  return envelope;
}

test("signed SES feedback rejects forgeries and applies hard-bounce suppression once through the real HTTP boundary", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      action: HouseholdAction.CREATE,
      householdId: id,
      operationId: crypto.randomUUID(),
      name: "Feedback household",
    },
    owner,
  );
  const invitation = await createConsentedInvitation(
    id,
    owner,
    "bounce@example.invalid",
  );
  const ops = { headers: { authorization: `Bearer ${"ef".repeat(32)}` } };
  await mail.processQueue({}, ops);
  const inboxResponse = await fetch("http://127.0.0.1:8793/messages", {
    headers: { authorization: "Bearer local-email-only" },
  });
  const inbox = (await inboxResponse.json()) as {
    messages: {
      id: string;
      recipient: string;
      tags: { Name: string; Value: string }[];
    }[];
  };
  const received = inbox.messages.find(
    (m) => m.recipient === "bounce@example.invalid",
  )!;
  assert.ok(received);
  const event = {
    eventType: "Bounce",
    mail: {
      messageId: received.id,
      destination: [received.recipient],
      tags: Object.fromEntries(received.tags.map((t) => [t.Name, [t.Value]])),
    },
    bounce: {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: received.recipient }],
    },
  };
  const envelope = await signedFeedback(event);
  const post = (body: unknown) =>
    fetch(`${baseUrl}/email/feedback`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=UTF-8" },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ ...envelope, Signature: "AA==" })).status, 403);
  assert.equal(
    (
      await post(
        await signedFeedback(event, {
          TopicArn: "arn:aws:sns:us-west-2:000000000000:wrong-topic",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        await signedFeedback(event, {
          SigningCertURL: "http://169.254.169.254/latest/meta-data/",
        }),
      )
    ).status,
    403,
  );
  assert.equal((await post(envelope)).status, 204);
  assert.equal((await post(envelope)).status, 204);
  const status = await admin.getEmailOperations({}, owner);
  const block = status.suppressions.find(
    (s) => s.recipientEmail === received.recipient,
  )!;
  assert.equal(block.reason, "hard_bounce");
  assert.equal(block.revision, 1n);
  const visible = (
    await invitations.listInvitations({ id }, owner)
  ).invitations.find((i) => i.id === invitation.id)!;
  assert.equal(visible.deliveryStatus, "failed");
  assert.equal(
    JSON.stringify(visible, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes("hard_bounce"),
    false,
  );
  await invitations.changeInvitation(
    {
      action: EmailInvitationAction.REPLACE,
      operationId: crypto.randomUUID(),
      householdId: id,
      invitationId: invitation.id,
      expectedRevision: visible.revision,
      confirmed: true,
    },
    owner,
  );
  assert.equal((await mail.processQueue({}, ops)).attempted, 0n);
  const clear = {
    operationId: crypto.randomUUID(),
    recipientEmail: received.recipient,
    expectedRevision: block.revision,
    confirmed: true,
  };
  await assert.rejects(
    admin.clearEmailSuppression(clear, await login("development-second")),
  );
  await assert.rejects(
    admin.clearEmailSuppression({ ...clear, confirmed: false }, owner),
  );
  await assert.rejects(
    admin.clearEmailSuppression({ ...clear, expectedRevision: 0n }, owner),
  );
  await admin.clearEmailSuppression(clear, owner);
  await admin.clearEmailSuppression(clear, owner);
  assert.equal(
    (await admin.getEmailOperations({}, owner)).suppressions.some(
      (s) => s.recipientEmail === received.recipient,
    ),
    false,
  );
  // The provider can retry a report after receipt/log retention. A new SNS ID
  // with the same signed event timestamp must not undo the reviewed clear.
  assert.equal(
    (await post(await signedFeedback(event, { Timestamp: envelope.Timestamp })))
      .status,
    204,
  );
  assert.equal(
    (await admin.getEmailOperations({}, owner)).suppressions.some(
      (s) => s.recipientEmail === received.recipient,
    ),
    false,
  );
  assert.equal((await mail.processQueue({}, ops)).attempted, 1n);
});

test("normal household copies use independent space budgets without exposing retired head ceilings", async () => {
  const owner = await login();
  const householdId = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId,
      action: HouseholdAction.CREATE,
      name: "Normal independent copies",
    },
    owner,
  );
  const source = (
    await lists.applyChange(
      {
        operationId: crypto.randomUUID(),
        collectionId: crypto.randomUUID(),
        action: ChangeAction.CREATE_COLLECTION,
        details: {
          kind: CollectionKind.SHOPPING,
          title: "Personal groceries to copy",
        },
      },
      owner,
    )
  ).collection!;
  const request = {
    operationId: crypto.randomUUID(),
    sourceCollectionId: source.id,
    expectedSourceRevision: source.revision,
    householdId,
    destinationCollectionId: crypto.randomUUID(),
  };
  const preview = await households.previewCopy(request, owner);
  assert.equal(preview.allowed, true);
  assert.equal(preview.required, undefined);
  assert.equal(preview.destinationUsage, undefined);
  assert.equal(preview.destinationCapacity, undefined);
  const copied = (await households.copyCollection(request, owner)).collection!;
  assert.equal(copied.title, source.title);
  assert.equal(
    (await households.copyCollection(request, owner)).collection!.id,
    copied.id,
  );
  assert.equal(
    (await lists.getCollection({ id: source.id }, owner)).title,
    source.title,
  );
  await lists.applyChange(
    changeRequest(source, ChangeAction.UPDATE_METADATA, {
      details: { title: "Changed personal groceries" },
    }),
    owner,
  );
  assert.equal(
    (
      await lists.getCollection(
        { id: copied.id },
        { headers: { ...owner.headers, "x-space-id": householdId } },
      )
    ).title,
    "Personal groceries to copy",
  );
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const policy = await admin.getPolicy({}, owner);
  const change = {
    operationId: crypto.randomUUID(),
    expectedRevision: policy.revision,
    policy: {
      ...policy,
      householdHard: { ...policy.householdHard!, shopping: 1n },
      householdSoft: { ...policy.householdSoft!, shopping: 1n },
    },
    confirmed: true,
  };
  const review = await admin.previewPolicy(change, owner);
  await admin.applyPolicy(
    { ...change, previewToken: review.previewToken },
    owner,
  );
  const blocked = {
    ...request,
    operationId: crypto.randomUUID(),
    destinationCollectionId: crypto.randomUUID(),
    expectedSourceRevision: (
      await lists.getCollection({ id: source.id }, owner)
    ).revision,
  };
  assert.equal(
    (await households.previewCopy(blocked, owner)).reason,
    "Your copy was not saved. Please try again later or contact support.",
  );
  await assert.rejects(
    households.copyCollection(blocked, owner),
    (e: unknown) =>
      e instanceof ConnectError && e.code === Code.ResourceExhausted,
  );
  const record = (await admin.listAudit({}, owner)).entries.find((e) =>
    e.action.includes("Blocked resource write"),
  )!;
  assert.ok(record.action.includes("space_shopping_allowance"));
  assert.ok(record.action.includes("selected request context personal"));
  assert.equal(record.action.includes("scope personal"), false);
  const restore = {
    operationId: crypto.randomUUID(),
    expectedRevision: (await admin.getPolicy({}, owner)).revision,
    policy,
    confirmed: true,
  };
  const restoration = await admin.previewPolicy(restore, owner);
  await admin.applyPolicy(
    { ...restore, previewToken: restoration.previewToken },
    owner,
  );
});

test("normal household closure remains visible and retains its household safety slot until erasure", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Retained normal closure",
    },
    owner,
  );
  const ownerId = (await households.getOverview({}, owner)).identity!.id;
  const beforeUsed = (await admin.getOverview({}, owner)).accounts.find(
    (a) => a.id === ownerId,
  )!.personalUsage!.households;
  const detail = await households.getHousehold({ id }, owner);
  const leave = {
    operationId: crypto.randomUUID(),
    householdId: id,
    expectedRevision: detail.household!.revision,
    action: HouseholdAction.LEAVE,
    confirmClose: true,
    expectedEraseDueAt: detail.closureEraseDueAt,
  };
  await households.changeHousehold(leave, owner);
  await households.changeHousehold(leave, owner);
  const closed = (await households.getOverview({}, owner)).households.find(
    (h) => h.id === id,
  );
  assert.equal(closed?.status, "closed");
  assert.equal(closed?.isHead, false);
  assert.equal(closed?.ownContribution, undefined);
  assert.equal(closed?.eraseDueAt, detail.closureEraseDueAt);
  assert.ok(beforeUsed > 0n);
  assert.equal(
    (await admin.getOverview({}, owner)).accounts.find((a) => a.id === ownerId)!
      .personalUsage!.households,
    beforeUsed,
  );
  await assert.rejects(households.getHousehold({ id }, owner));
  const original = await admin.getPolicy({}, owner);
  const apply = async (policy: typeof original) => {
    const latest = await admin.getPolicy({}, owner);
    const change = {
      operationId: crypto.randomUUID(),
      expectedRevision: latest.revision,
      policy,
      confirmed: true,
    };
    const review = await admin.previewPolicy(change, owner);
    await admin.applyPolicy(
      { ...change, previewToken: review.previewToken },
      owner,
    );
  };
  try {
    await apply({
      ...original,
      personalHard: { ...original.personalHard!, households: beforeUsed },
      personalSoft: { ...original.personalSoft!, households: 1n },
    });
    await assert.rejects(
      households.changeHousehold(
        {
          operationId: crypto.randomUUID(),
          householdId: crypto.randomUUID(),
          action: HouseholdAction.CREATE,
          name: "Cannot cycle a retained slot",
        },
        owner,
      ),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.ResourceExhausted,
    );
  } finally {
    await apply(original);
  }
});

test("an expired invitation can be sent again within the request's consent window", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Resend consent window",
    },
    owner,
  );
  const oldBase = "http://127.0.0.1:8789";
  const oldServer = start("target/debug/intrepion-server", [], {
    env: {
      ...localEnv,
      PORT: "8789",
      APP_TEST_NOW: String(Math.floor(Date.now() / 1000) - 8 * 86400),
    },
  });
  let invitation;
  try {
    await ready(`${oldBase}/health/live`);
    invitation = await createConsentedInvitation(
      id,
      owner,
      "resend@example.invalid",
      "resend-requester",
      oldBase,
    );
  } finally {
    await stop(oldServer);
  }
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  await mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const expired = (
    await invitations.listInvitations({ id }, owner)
  ).invitations.find((i) => i.id === invitation.id)!;
  assert.equal(expired.status, "expired");
  const replacement = await invitations.changeInvitation(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      invitationId: expired.id,
      expectedRevision: expired.revision,
      action: EmailInvitationAction.REPLACE,
      confirmed: true,
    },
    owner,
  );
  assert.equal(replacement.status, "pending");
});

test("normal household invitation growth shares retained metadata storage guards while revocation remains possible when full", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invites = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Invitation metadata storage",
    },
    owner,
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const original = await admin.getPolicy({}, owner);
  const usage = async () =>
    (await admin.getOverview({}, owner)).households.find((h) => h.id === id)!
      .usage!.bytes;
  const setBytes = async (bytes: bigint) => {
    const latest = await admin.getPolicy({}, owner);
    const change = {
      operationId: crypto.randomUUID(),
      expectedRevision: latest.revision,
      policy: {
        ...original,
        householdHard: { ...original.householdHard!, bytes },
        householdSoft: { ...original.householdSoft!, bytes },
      },
      confirmed: true,
    };
    const review = await admin.previewPolicy(change, owner);
    await admin.applyPolicy(
      { ...change, previewToken: review.previewToken },
      owner,
    );
  };
  const create = {
    operationId: crypto.randomUUID(),
    householdId: id,
  };
  try {
    const before = await usage();
    const historyBefore = (
      await households.listHouseholdActivity({ householdId: id }, owner)
    ).entries.length;
    await setBytes(before);
    await assert.rejects(
      invites.createRequestLink(create, owner),
      (e: unknown) =>
        e instanceof ConnectError &&
        e.code === Code.ResourceExhausted &&
        e.rawMessage.includes("not saved"),
    );
    assert.equal(
      (await invites.listInvitations({ id }, owner)).invitations.length,
      0,
    );
    assert.equal(await usage(), before);
    assert.equal(
      (await households.listHouseholdActivity({ householdId: id }, owner))
        .entries.length,
      historyBefore,
    );
    await setBytes(original.householdHard!.bytes);
    const invitation = await createConsentedInvitation(
      id,
      owner,
      "metadata-storage@example.invalid",
    );
    await setBytes(await usage());
    const revoked = await invites.changeInvitation(
      {
        operationId: crypto.randomUUID(),
        householdId: id,
        invitationId: invitation.id,
        expectedRevision: invitation.revision,
        action: EmailInvitationAction.REVOKE,
        confirmed: true,
      },
      owner,
    );
    assert.equal(revoked.status, "revoked");
  } finally {
    await setBytes(original.householdHard!.bytes);
  }
});

test("owner growth measurements stay unknown without a comparable history window and become measurable after a day", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  assert.equal(
    (await admin.getOverview({}, owner)).growthStatus,
    "insufficient_history",
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  await mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  await client.createTask(
    { id: crypto.randomUUID(), title: "A new day of private growth" },
    owner,
  );
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: crypto.randomUUID(),
      action: HouseholdAction.CREATE,
      name: "Growth after daily sample",
    },
    owner,
  );
  const futureBase = "http://127.0.0.1:8789";
  const instance = start("target/debug/intrepion-server", [], {
    env: {
      ...localEnv,
      PORT: "8789",
      APP_TEST_NOW: String(Math.floor(Date.now() / 1000) + 25 * 3600),
    },
  });
  try {
    await ready(`${futureBase}/health/live`);
    const futureAdmin = createClient(
      AccountAdminService,
      createConnectTransport({ baseUrl: futureBase }),
    );
    const measured = await futureAdmin.getOverview({}, owner);
    assert.equal(measured.growthStatus, "measured");
    assert.ok(measured.growthSince > 0n);
    assert.ok(measured.logicalByteChange > 0n);
    assert.ok(measured.householdChange >= 1n);
    await assert.rejects(
      futureAdmin.getOverview({}, await login("development-second")),
      (e: unknown) =>
        e instanceof ConnectError && e.code === Code.PermissionDenied,
    );
  } finally {
    await stop(instance);
  }
});

test("post-backup identities keep their independent public identity when a missing account is readmitted or privately recovered", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invites = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Recovered identity household",
    },
    owner,
  );
  await createConsentedInvitation(
    id,
    owner,
    "recovered-member@example.invalid",
    "development-recovered-member",
  );
  await mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  const inbox = (await (
    await fetch("http://127.0.0.1:8793/messages", {
      headers: { authorization: "Bearer local-email-only" },
    })
  ).json()) as { messages: { recipient: string; text: string }[] };
  const token = inbox.messages
    .find((m) => m.recipient === "recovered-member@example.invalid")!
    .text.match(/#invite=([a-f0-9]{64})/)![1];
  const verified = await invitationLogin(
    token,
    "development-recovered-member",
    "recovered-member@example.invalid",
  );
  assert.equal(verified.status, 200);
  const context = (await verified.json()) as { csrf: string };
  const onboarding = {
    headers: {
      origin,
      "x-csrf-token": context.csrf,
      cookie: verified.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    },
  };
  let cookie = "";
  const accepted = await invites.acceptInvitation(
    {
      operationId: crypto.randomUUID(),
      displayName: "Recovered member",
      confirmed: true,
    },
    {
      ...onboarding,
      onHeader: (h) => {
        cookie = h
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
      },
    },
  );
  const account = await households.getOverview(
    {},
    { headers: { origin, "x-csrf-token": accepted.csrf, cookie } },
  );
  assert.equal(account.identity!.id, "44".repeat(16));
  const operator = createClient(
    PilotOperatorService,
    createConnectTransport({ baseUrl }),
  );
  const privateOperator = {
    headers: { authorization: `Bearer ${"cd".repeat(32)}` },
  };
  const restore = {
    operationId: crypto.randomUUID(),
    subject: "development-recovered-blocked",
    displayName: "Recovered suspended account",
    createAccount: true,
    approved: true,
    plan: {},
  };
  assert.equal(
    (await operator.previewAccountPolicy(restore, privateOperator)).allowed,
    false,
  );
  const disabled = { ...restore, approved: false };
  const preview = await operator.previewAccountPolicy(
    disabled,
    privateOperator,
  );
  assert.equal(preview.allowed, true);
  const result = await operator.applyAccountPolicy(
    { ...disabled, previewToken: preview.previewToken },
    privateOperator,
  );
  assert.equal(result.publicId, "55".repeat(16));
  const profile = (await admin.getOverview({}, owner)).accounts.find(
    (a) => a.id === result.publicId,
  )!;
  assert.equal(profile.suspended, true);
  await admin.setAccountAccess(
    {
      operationId: crypto.randomUUID(),
      accountId: profile.id,
      expectedRevision: profile.accessRevision,
      suspended: false,
      confirmed: true,
    },
    owner,
  );
  assert.ok((await login("development-recovered-blocked")).headers.cookie);
});

test("signed subscription confirmation validates its destination and acknowledges a retry once", async () => {
  const topic = "arn:aws:sns:us-west-2:000000000000:local-email-feedback";
  const token = "local-confirmation-token";
  const url = new URL("http://127.0.0.1:8793/confirm");
  url.search = new URLSearchParams({
    Action: "ConfirmSubscription",
    TopicArn: topic,
    Token: token,
  }).toString();
  const post = (body: unknown) =>
    fetch(`${baseUrl}/email/feedback`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
    });
  const overrides = {
    Type: "SubscriptionConfirmation",
    Token: token,
    SubscribeURL: url.href,
  };
  const readCount = async () =>
    (
      (await (
        await fetch("http://127.0.0.1:8793/confirmations", {
          headers: { authorization: "Bearer local-email-only" },
        })
      ).json()) as { confirmations: number }
    ).confirmations;
  const prior = await readCount();
  assert.equal(
    (
      await post(
        await signedFeedback("Confirm local subscription", {
          ...overrides,
          SubscribeURL: "http://169.254.169.254/?Action=ConfirmSubscription",
        }),
      )
    ).status,
    403,
  );
  const mismatch = new URL(url);
  mismatch.searchParams.set("Token", "wrong-token");
  assert.equal(
    (
      await post(
        await signedFeedback("Confirm local subscription", {
          ...overrides,
          SubscribeURL: mismatch.href,
        }),
      )
    ).status,
    403,
  );
  assert.equal(await readCount(), prior);
  const envelope = await signedFeedback(
    "Confirm local subscription",
    overrides,
  );
  assert.equal((await post(envelope)).status, 204);
  assert.equal((await post(envelope)).status, 204);
  assert.equal(await readCount(), prior + 1);
});

test("uncertain delivery retries reuse the link and early signed feedback survives send acknowledgment", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const invites = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const ops = { headers: { authorization: `Bearer ${"ef".repeat(32)}` } };
  const provider = async (path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:8793/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer local-email-only",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 200);
    return r.json() as Promise<{
      messages: { recipient: string; text: string }[];
    }>;
  };
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Uncertain delivery",
    },
    owner,
  );
  // Drain unrelated pending work before targeting the next provider handoff.
  await mail.processQueue({}, ops);
  const invite = await createConsentedInvitation(
    id,
    owner,
    "uncertain@example.invalid",
  );
  await provider("fault", { fail_next: "after" });
  const before = await admin.getEmailOperations({}, owner);
  await mail.processQueue({}, ops);
  const status = async () =>
    (await invites.listInvitations({ id }, owner)).invitations.find(
      (i) => i.id === invite.id,
    )!;
  assert.equal((await status()).deliveryStatus, "uncertain");
  assert.equal(
    (await admin.getEmailOperations({}, owner)).monthlyAttempts,
    before.monthlyAttempts + 1n,
  );
  assert.equal((await mail.processQueue({}, ops)).attempted, 0n);
  const futureBase = "http://127.0.0.1:8789";
  const instance = start("target/debug/intrepion-server", [], {
    env: {
      ...localEnv,
      PORT: "8789",
      APP_TEST_NOW: String(Math.floor(Date.now() / 1000) + 65),
    },
  });
  try {
    await ready(`${futureBase}/health/live`);
    const futureMail = createClient(
      EmailOperationsService,
      createConnectTransport({ baseUrl: futureBase }),
    );
    assert.equal((await futureMail.processQueue({}, ops)).attempted, 1n);
    const messages = (await provider("messages")).messages.filter(
      (m) => m.recipient === "uncertain@example.invalid",
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.text, messages[1]!.text);
    assert.equal((await status()).deliveryStatus, "submitted");
  } finally {
    await stop(instance);
  }
  const early = await createConsentedInvitation(
    id,
    owner,
    "early-feedback@example.invalid",
  );
  await provider("fault", { fail_next: "feedback" });
  assert.equal((await mail.processQueue({}, ops)).attempted, 1n);
  const visible = (
    await invites.listInvitations({ id }, owner)
  ).invitations.find((i) => i.id === early.id)!;
  assert.equal(visible.deliveryStatus, "failed");
  assert.ok(
    (await admin.getEmailOperations({}, owner)).suppressions.some(
      (s) => s.recipientEmail === "early-feedback@example.invalid",
    ),
  );
});

test("revocation waits for an already-started provider handoff", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Handoff coordination",
    },
    owner,
  );
  const invite = await createConsentedInvitation(
    id,
    owner,
    "handoff@example.invalid",
  );
  const invitations = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  await fetch("http://127.0.0.1:8793/fault", {
    method: "POST",
    headers: {
      authorization: "Bearer local-email-only",
      "content-type": "application/json",
    },
    body: JSON.stringify({ fail_next: "hold" }),
  });
  const sending = mail.processQueue(
    {},
    { headers: { authorization: `Bearer ${"ef".repeat(32)}` } },
  );
  let handedOff = false;
  for (let i = 0; i < 100 && !handedOff; i++) {
    const inbox = (await (
      await fetch("http://127.0.0.1:8793/messages", {
        headers: { authorization: "Bearer local-email-only" },
      })
    ).json()) as { messages: { recipient: string }[] };
    handedOff = inbox.messages.some(
      (m) => m.recipient === "handoff@example.invalid",
    );
    if (!handedOff) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(handedOff, true);
  const revoke = {
    operationId: crypto.randomUUID(),
    householdId: id,
    invitationId: invite.id,
    expectedRevision: invite.revision,
    action: EmailInvitationAction.REVOKE,
    confirmed: true,
  };
  try {
    await assert.rejects(
      invitations.changeInvitation(revoke, owner),
      (e: unknown) => e instanceof ConnectError && e.code === Code.Unavailable,
    );
  } finally {
    await sending;
  }
  assert.equal(
    (await invitations.changeInvitation(revoke, owner)).status,
    "revoked",
  );
});

test("an interrupted final email attempt becomes terminal after its claim expires without another send", async () => {
  const owner = await login();
  const admin = createClient(
    AccountAdminService,
    createConnectTransport({ baseUrl }),
  );
  const growth = await admin.getGrowth({}, owner);
  if (growth.paused)
    await admin.changeGrowth(
      {
        operationId: crypto.randomUUID(),
        expectedRevision: growth.revision,
        paused: false,
        confirmed: true,
      },
      owner,
    );
  const invites = createClient(
    EmailInvitationService,
    createConnectTransport({ baseUrl }),
  );
  const ops = { headers: { authorization: `Bearer ${"ef".repeat(32)}` } };
  const mail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl }),
  );
  const provider = async (path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:8793/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer local-email-only",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 200);
    return r.json() as Promise<{ messages: { recipient: string }[] }>;
  };
  await mail.processQueue({}, ops);
  const id = crypto.randomUUID();
  await households.changeHousehold(
    {
      operationId: crypto.randomUUID(),
      householdId: id,
      action: HouseholdAction.CREATE,
      name: "Interrupted final attempt",
    },
    owner,
  );
  const invite = await createConsentedInvitation(
    id,
    owner,
    "interrupted@example.invalid",
  );
  await provider("fault", { fail_next: "after" });
  await mail.processQueue({}, ops);
  const epoch = Math.floor(Date.now() / 1000);
  const futureBase = "http://127.0.0.1:8789";
  const futureMail = createClient(
    EmailOperationsService,
    createConnectTransport({ baseUrl: futureBase }),
  );
  const status = async () =>
    (await invites.listInvitations({ id }, owner)).invitations.find(
      (i) => i.id === invite.id,
    )!;
  let instance: ChildProcess | undefined;
  try {
    for (const seconds of [65, 370, 410]) {
      instance = start("target/debug/intrepion-server", [], {
        env: {
          ...localEnv,
          PORT: "8789",
          APP_TEST_NOW: String(epoch + seconds),
        },
      });
      await ready(`${futureBase}/health/live`);
      if (seconds === 65) {
        await provider("fault", { fail_next: "after" });
        assert.equal((await futureMail.processQueue({}, ops)).attempted, 1n);
      } else if (seconds === 370) {
        await provider("fault", { fail_next: "hold" });
        const sending = futureMail.processQueue({}, ops).catch(() => undefined);
        const deadline = Date.now() + 5000;
        while (
          (await provider("messages")).messages.filter(
            (m) => m.recipient === "interrupted@example.invalid",
          ).length < 3
        ) {
          if (Date.now() > deadline)
            throw new Error(
              "Third attempt was not handed to the local provider",
            );
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal((await status()).deliveryStatus, "sending");
        await stop(instance);
        await sending;
      } else {
        assert.equal((await futureMail.processQueue({}, ops)).attempted, 0n);
        assert.equal((await status()).deliveryStatus, "uncertain");
        assert.equal(
          (await provider("messages")).messages.filter(
            (m) => m.recipient === "interrupted@example.invalid",
          ).length,
          3,
        );
      }
      await stop(instance);
      instance = undefined;
    }
  } finally {
    await stop(instance);
  }
});
