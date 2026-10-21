import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "../../web/src/gen/life/v1/tasks_pb.js";
// @ts-expect-error JavaScript process helpers are used only by local/CI tests.
import { start, stop, ready, localEnv } from "../../scripts/processes.mjs";
import type { ChildProcess } from "node:child_process";

const baseUrl = process.env.TEST_API_URL ?? "http://127.0.0.1:8788";
const client = createClient(TaskService, createConnectTransport({ baseUrl }));
const origin = "http://127.0.0.1:4322";
let server: ChildProcess;
before(async () => {
  server = start("target/debug/intrepion-server", [], { env: localEnv });
  await ready(`${baseUrl}/health/live`);
});
after(async () => {
  await stop(server);
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
  await client.deleteTask({ id: task.id }, owner);
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
  await client.deleteTask({ id: created.id }, owner);
  await client.deleteTask({ id: created.id }, owner);
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
  await client.deleteTask({ id: first.id }, owner);
  await client.deleteTask({ id: second.id }, owner);
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
