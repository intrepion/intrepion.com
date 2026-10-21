import assert from "node:assert/strict";
import test from "node:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "./generated/experiment/v1/task_pb.js";

const baseUrl = process.env.EXPERIMENT_API_URL ?? "http://127.0.0.1:8787";
const owner = { headers: { authorization: "Bearer local-owner" } };
const client = createClient(TaskService, createConnectTransport({ baseUrl }));

for (const useBinaryFormat of [false, true]) {
  test(`generated client round trip (${useBinaryFormat ? "protobuf" : "JSON"})`, async () => {
    const client = createClient(
      TaskService,
      createConnectTransport({ baseUrl, useBinaryFormat }),
    );
    const response = await client.echo({ title: "Synthetic task — café 🦀" }, { headers: { authorization: "Bearer local-owner" } });
    assert.equal(response.title, "Synthetic task — café 🦀");
  });
}

test("missing and non-owner identities return structured errors", async () => {
  await assert.rejects(client.listTasks({}), (error: unknown) => error instanceof ConnectError && error.code === Code.Unauthenticated);
  await assert.rejects(client.listTasks({}, { headers: { authorization: "Bearer other-user" } }), (error: unknown) => error instanceof ConnectError && error.code === Code.PermissionDenied);
});

test("D1 create, list, edit, complete, reopen, and delete through generated RPCs", async () => {
  const id = crypto.randomUUID();
  const task = { id, title: "Synthetic task", notes: "Local D1 only", completed: false };
  const created = await client.createTask(task, owner);
  assert.equal(created.id, id);
  try {
    assert.equal((await client.listTasks({}, owner)).tasks.find(t => t.id === id)?.title, task.title);
    await assert.rejects(client.createTask(task, owner), (e: unknown) => e instanceof ConnectError && e.code === Code.AlreadyExists);
    const updated = await client.updateTask({ ...task, title: "Edited 🦀", completed: true }, owner);
    assert.equal(updated.title, "Edited 🦀");
    assert.equal(updated.completed, true);
    const reopened = await client.updateTask({ ...task, completed: false }, owner);
    assert.equal(reopened.completed, false);
  } finally {
    await client.deleteTask({ id }, owner);
  }
  assert.equal((await client.listTasks({}, owner)).tasks.some(t => t.id === id), false);
  await assert.rejects(client.deleteTask({ id }, owner), (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound);
});

test("invalid task fields return a structured validation error", async () => {
  await assert.rejects(client.createTask({ id: crypto.randomUUID(), title: "   " }, owner), (error: unknown) => error instanceof ConnectError && error.code === Code.InvalidArgument);
});

test("browser origin preflight allows the local web client only", async () => {
  const url = `${baseUrl}/experiment.v1.TaskService/Echo`;
  const allowed = await fetch(url, { method: "OPTIONS", headers: { origin: "http://localhost:4321", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, connect-protocol-version" } });
  assert.ok([200, 204].includes(allowed.status));
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:4321");
  const denied = await fetch(url, { method: "OPTIONS", headers: { origin: "https://other.example" } });
  // Browser access depends on the allow-origin header, not a specific status.
  assert.ok([200, 204, 403].includes(denied.status));
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const browserClient = createClient(TaskService, createConnectTransport({ baseUrl, interceptors: [next => async request => { request.header.set("origin", "http://localhost:4321"); return next(request); }] }));
  const result = await browserClient.echo({ title: "Origin test" }, owner);
  assert.equal(result.title, "Origin test");
});
