import assert from "node:assert/strict";
import test from "node:test";
import { probe } from "./probe.mjs";

test("HTTP 200 loading pages cannot count as application readiness", async () => {
  const result = await probe("https://api.example.test", {
    request: async () => new Response("Starting your service"),
    timeoutMs: 20,
    retryDelayMs: 1,
  });
  assert.equal(result.ok, false);
});

test("readiness waits for the application body after loading and error responses", async () => {
  const responses = [
    new Response("Loading"),
    new Response("ok", { status: 503 }),
    new Response("ok\n"),
  ];
  const result = await probe("https://api.example.test", {
    request: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return responses.shift();
    },
    timeoutMs: 1000,
    retryDelayMs: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(responses.length, 0);
});
