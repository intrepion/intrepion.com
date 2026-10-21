import assert from "node:assert/strict";

// Run only while the native API is up and its local D1 bridge is stopped.
const response = await fetch("http://127.0.0.1:8790/experiment.v1.TaskService/ListTasks", {
  method: "POST",
  headers: {
    authorization: "Bearer local-owner",
    "content-type": "application/json",
    "connect-protocol-version": "1",
  },
  body: "{}",
});
assert.equal(response.status, 503);
const body = await response.json();
assert.equal(body.code, "unavailable");
assert.equal(body.message, "database temporarily unavailable");
assert.equal(JSON.stringify(body).includes("local-d1-token"), false);
console.log("Unavailable upstream returns a sanitized Connect error: passed");
