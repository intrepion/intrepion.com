// Development/test provider emulator. Never included in the production API.
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const directory =
  process.env.LOCAL_ERASURE_LEDGER_DIR ?? ".wrangler/erasure-ledger";
await mkdir(directory, { recursive: true, mode: 0o700 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let failNext = "";
let badB2Scope = false;
const server = createServer(async (req, res) => {
  const respond = (status, body = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health")
    return respond(200, { ready: true });
  const authorization =
    req.url === "/b2api/v4/b2_authorize_account"
      ? `Basic ${Buffer.from("emulator-key:emulator-secret").toString("base64")}`
      : req.url === "/b2api/v4/b2_get_upload_url"
        ? "emulator-auth-token"
        : req.url === "/b2-upload"
          ? "emulator-upload-token"
          : "Bearer local-erasure-only";
  if (req.headers.authorization !== authorization) return respond(404);
  try {
    if (req.method === "GET" && req.url === "/b2api/v4/b2_authorize_account")
      return respond(200, {
        authorizationToken: "emulator-auth-token",
        apiInfo: {
          storageApi: {
            apiUrl: "http://127.0.0.1:8792",
            allowed: {
              buckets: [{ id: "emulator-bucket", name: "Local ledger" }],
              capabilities: badB2Scope
                ? ["writeFiles", "deleteFiles"]
                : ["writeFiles"],
              namePrefix: badB2Scope
                ? ""
                : "erasures/00000000-0000-0000-0000-000000000001/",
            },
          },
        },
      });
    if (req.method === "GET" && req.url === "/records") {
      const records = [];
      for (const name of await readdir(directory))
        if (name.endsWith(".json"))
          records.push(
            JSON.parse(await readFile(join(directory, name), "utf8")),
          );
      return respond(200, { records });
    }
    let bytes = "";
    for await (const chunk of req) {
      bytes += chunk;
      if (Buffer.byteLength(bytes) > 8192) return respond(413);
    }
    const body = JSON.parse(bytes);
    if (
      req.method === "POST" &&
      req.url === "/fault" &&
      process.env.LEDGER_TEST_CONTROLS === "1"
    ) {
      if (!["before", "after", ""].includes(body.fail_next))
        return respond(400);
      failNext = body.fail_next;
      if (typeof body.b2_bad_scope === "boolean")
        badB2Scope = body.b2_bad_scope;
      return respond(200);
    }
    if (req.method === "POST" && req.url === "/b2api/v4/b2_get_upload_url")
      return body.bucketId === "emulator-bucket"
        ? respond(200, {
            uploadUrl: "http://127.0.0.1:8792/b2-upload",
            authorizationToken: "emulator-upload-token",
            bucketId: "emulator-bucket",
          })
        : respond(400);
    if (req.method !== "POST" || !["/records", "/b2-upload"].includes(req.url))
      return respond(404);
    if (
      !(
        (body.version === 1 &&
          ["collection", "item"].includes(body.scope) &&
          Object.keys(body).sort().join(",") ===
            "collection_id,database_id,operation_id,scope,target_id,version") ||
        (body.version === 2 &&
          ["household_closed", "household"].includes(body.scope) &&
          Number.isSafeInteger(body.erase_due_at) &&
          body.erase_due_at > 0 &&
          Object.keys(body).sort().join(",") ===
            "collection_id,database_id,erase_due_at,operation_id,scope,target_id,version") ||
        (body.version === 3 &&
          body.scope === "household_content" &&
          Array.isArray(body.collection_ids) &&
          body.collection_ids.length > 0 &&
          body.collection_ids.length <= 100 &&
          new Set(body.collection_ids).size === body.collection_ids.length &&
          body.collection_ids.every(
            (id) => typeof id === "string" && uuid.test(id),
          ) &&
          Object.keys(body).sort().join(",") ===
            "collection_id,collection_ids,database_id,operation_id,scope,target_id,version") ||
        (body.version === 4 &&
          ["account_access", "head_membership"].includes(body.scope) &&
          body.security &&
          Object.keys(body.security).sort().join(",") ===
            "active,public_id,revision,subject_hash" &&
          typeof body.security.active === "boolean" &&
          /^[a-f0-9]{64}$/.test(body.security.subject_hash) &&
          /^[a-f0-9]{32}$/.test(body.security.public_id) &&
          Number.isSafeInteger(body.security.revision) &&
          body.security.revision > 0 &&
          Object.keys(body).sort().join(",") ===
            "collection_id,database_id,operation_id,scope,security,target_id,version")
      ) ||
      ![body.collection_id, body.database_id, body.operation_id].every(
        (value) => typeof value === "string" && uuid.test(value),
      ) ||
      (body.scope === "item"
        ? !uuid.test(body.target_id)
        : body.target_id !== "")
    )
      return respond(400);
    const failure = failNext;
    failNext = "";
    if (failure === "before") return respond(503);
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    const filename = `erasures/${body.database_id}/${body.operation_id}.json`;
    if (
      req.url === "/b2-upload" &&
      (req.headers["x-bz-content-sha1"] !== sha1 ||
        decodeURIComponent(req.headers["x-bz-file-name"] ?? "") !== filename)
    )
      return respond(400);
    const path = join(directory, `${body.operation_id}.json`);
    const content = JSON.stringify(body);
    try {
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if ((await readFile(path, "utf8")) !== content) return respond(409);
    }
    if (failure === "after") return respond(503);
    if (req.url === "/b2-upload")
      return respond(200, {
        action: "upload",
        bucketId: "emulator-bucket",
        fileName: filename,
        contentLength: Buffer.byteLength(bytes),
        contentSha1: sha1,
        fileId: body.operation_id,
      });
    return respond(201, { recorded: true, operation_id: body.operation_id });
  } catch {
    respond(500);
  }
});
server.listen(8792, "127.0.0.1", () =>
  console.log("Local erasure ledger ready on 127.0.0.1:8792."),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
