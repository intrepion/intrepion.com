import assert from "node:assert/strict";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "./generated/experiment/v1/task_pb.js";

const client = createClient(TaskService, createConnectTransport({ baseUrl: process.env.EXPERIMENT_API_URL ?? "http://127.0.0.1:8787" }));
const owner = { headers: { authorization: "Bearer local-owner" } };
const id = "experiment-persistence-sentinel";
const mode = process.argv[2];
if (mode === "seed") {
  const existing = (await client.listTasks({}, owner)).tasks.find(t => t.id === id);
  if (!existing) await client.createTask({ id, title: "Synthetic persistence sentinel", notes: "No real data" }, owner);
} else if (mode === "check") {
  const task = (await client.listTasks({}, owner)).tasks.find(t => t.id === id);
  assert.equal(task?.title, "Synthetic persistence sentinel");
  assert.equal(task?.notes, "No real data");
} else if (mode === "cleanup") {
  await client.deleteTask({ id }, owner);
} else {
  throw new Error("Expected seed, check, or cleanup");
}
console.log(`Persistence ${mode}: passed`);
