import assert from "node:assert/strict";
import { test } from "node:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { compatibilityClient } from "./client.ts";

for (const useBinaryFormat of [true, false]) {
  const format = useBinaryFormat ? "binary" : "JSON";
  const client = compatibilityClient(useBinaryFormat);
  test(`${format}: generated web client decodes Ping response`, async () => {
    const result = await client.ping({ clientName: "Web" });
    assert.equal(result.message, "Hello, Web!");
    assert.equal(result.server, "connect-rust/axum");
  });
  test(`${format}: service trims client name`, async () => {
    const result = await client.ping({ clientName: "  Web  " });
    assert.equal(result.message, "Hello, Web!");
  });
  test(`${format}: blank client name returns typed invalid_argument`, async () => {
    for (const clientName of ["", "   "]) {
      await assert.rejects(client.ping({ clientName }), (error: unknown) => {
        assert.ok(error instanceof ConnectError);
        assert.equal(error.code, Code.InvalidArgument);
        return true;
      });
    }
  });
}

// Node does not enforce CORS, so test the browser's preflight explicitly.
for (const origin of ["http://127.0.0.1:5173", "http://localhost:5173"]) {
  test(`CORS: allows the local web origin ${origin}`, async () => {
    const response = await fetch(
      "http://127.0.0.1:4100/spike.v1.CompatibilityService/Ping",
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,connect-protocol-version,connect-timeout-ms",
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    assert.ok(response.ok);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/i);
    const allowedHeaders = response.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    for (const header of ["content-type", "connect-protocol-version", "connect-timeout-ms"]) {
      assert.ok(allowedHeaders.includes(header), `missing CORS header ${header}`);
    }
  });
}
