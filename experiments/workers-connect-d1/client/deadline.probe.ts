import assert from "node:assert/strict";
import test from "node:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TaskService } from "./generated/experiment/v1/task_pb.js";

// This is a compatibility acceptance probe, intentionally failing on the
// unmodified Workers stack. Do not turn its HTTP 500 into an expected success.
test("generated client with an explicit deadline", async () => {
  const baseUrl = process.env.EXPERIMENT_API_URL ?? "http://127.0.0.1:8787";
  const client = createClient(TaskService, createConnectTransport({ baseUrl }));
  const response = await client.echo({ title: "deadline probe" }, {
    timeoutMs: 5_000,
    headers: { authorization: "Bearer local-owner" },
  });
  assert.equal(response.title, "deadline probe");
});

test("server returns a structured deadline error for a slow handler", async () => {
  const baseUrl = process.env.EXPERIMENT_API_URL ?? "http://127.0.0.1:8787";
  const client = createClient(TaskService, createConnectTransport({ baseUrl }));
  // Use a raw protocol timeout header, not timeoutMs, to avoid a client-side
  // timeout masking whether the server enforces the deadline correctly.
  await assert.rejects(client.echo({ title: "delay" }, {
    headers: { authorization: "Bearer local-owner", "connect-timeout-ms": "20" },
  }), (error: unknown) => error instanceof ConnectError && error.code === Code.DeadlineExceeded);
});
