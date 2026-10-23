import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(`Pilot operator CLI (no web dashboard)
  show SUBJECT [--local]
  preview POLICY.json [--out REVIEW.json] [--local]
  show-structure [--local]
  preview-structure LIMITS.json [--out REVIEW.json] [--local]
  apply REVIEW.json [--local]

Preview writes a private review file without changing policy. Apply uses that
exact preview and stable action identity. Reuse the same review file for retries.
Requires PILOT_OPERATOR_TOKEN. Local mode targets only 127.0.0.1:8788.`);
  process.exit(0);
}
const [command, input] = args;
const origin = new URL(
  args.includes("--local")
    ? "http://127.0.0.1:8788"
    : (process.env.PILOT_API_ORIGIN ?? "https://api.intrepion.com"),
);
if (
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/" ||
  (origin.protocol !== "https:" &&
    !(args.includes("--local") && origin.origin === "http://127.0.0.1:8788"))
)
  throw new Error("Use an exact HTTPS API origin, or explicit --local mode.");
const token = process.env.PILOT_OPERATOR_TOKEN;
if (!token || !/^[0-9a-f]{64}$/i.test(token))
  throw new Error(
    "Configure the separate PILOT_OPERATOR_TOKEN environment variable.",
  );
async function rpc(method, body) {
  let response;
  try {
    response = await fetch(
      new URL(`/life.v1.PilotOperatorService/${method}`, origin),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      },
    );
  } catch {
    throw new Error(
      "The policy action could not be confirmed. Retry using the same review file.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Operator API rejected the request (HTTP ${response.status}). For a stale policy, create a new preview; for an uncertain response, retry the same reviewed action.`,
    );
  return response.json();
}
async function jsonFile(path) {
  if (!path || path.startsWith("--"))
    throw new Error("Supply a JSON file path.");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Could not read a valid JSON policy file.");
  }
}
function amount(value) {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" &&
      /^[0-9]+$/.test(value) &&
      BigInt(value) <= 9007199254740991n)
  );
}
async function saveReview(review) {
  const index = args.indexOf("--out");
  const output =
    index < 0
      ? join(
          tmpdir(),
          `pilot-${review.request.operationId}.pilot-policy-review.json`,
        )
      : args[index + 1];
  if (!output || output.startsWith("--"))
    throw new Error("--out requires a file path.");
  await writeFile(
    output,
    JSON.stringify(
      {
        ...review,
        origin: origin.origin,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(`Review saved to ${output}`);
  if (review.preview?.allowed === false) {
    console.log(review.preview.reason);
    process.exitCode = 2;
  } else
    console.log(
      "Inspect the request and affected spaces, then apply this review file. No policy has changed.",
    );
}
if (command === "show")
  console.log(
    JSON.stringify(await rpc("GetAccountPolicy", { subject: input }), null, 2),
  );
else if (command === "show-structure")
  console.log(JSON.stringify(await rpc("GetStructuralPolicy", {}), null, 2));
else if (command === "preview") {
  const request = await jsonFile(input);
  if (
    !request.subject ||
    !request.displayName ||
    typeof request.approved !== "boolean" ||
    !request.plan ||
    !["items", "shopping", "templates", "runs", "bytes", "households"].every(
      (key) => amount(request.plan[key]),
    )
  )
    throw new Error(
      "Specify subject, displayName, approved, and every finite plan resource explicitly.",
    );
  request.operationId ??= randomUUID();
  request.expectedRevision ??= request.createAccount
    ? "0"
    : ((await rpc("GetAccountPolicy", { subject: request.subject })).revision ??
      "0");
  delete request.previewToken;
  const preview = await rpc("PreviewAccountPolicy", request);
  request.previewToken = preview.previewToken;
  await saveReview({ kind: "account", request, preview });
} else if (command === "preview-structure") {
  const inputPolicy = await jsonFile(input);
  if (
    !amount(inputPolicy.maxItemsPerCollection) ||
    !amount(inputPolicy.maxSectionsPerCollection)
  )
    throw new Error("Specify both finite structural limits explicitly.");
  const current = await rpc("GetStructuralPolicy", {});
  const request = {
    operationId: randomUUID(),
    expectedRevision: current.revision ?? "0",
    maxItemsPerCollection: inputPolicy.maxItemsPerCollection,
    maxSectionsPerCollection: inputPolicy.maxSectionsPerCollection,
    confirmed: true,
  };
  await saveReview({ kind: "structural", request, current });
} else if (command === "apply") {
  const review = await jsonFile(input);
  if (review.origin !== origin.origin)
    throw new Error(
      "This review belongs to a different API origin. Generate a preview for this environment.",
    );
  if (
    review.kind === "account" &&
    review.preview?.allowed === true &&
    review.request?.previewToken
  )
    console.log(
      JSON.stringify(await rpc("ApplyAccountPolicy", review.request), null, 2),
    );
  else if (review.kind === "structural" && review.request?.confirmed === true)
    console.log(
      JSON.stringify(await rpc("SetStructuralPolicy", review.request), null, 2),
    );
  else throw new Error("This is not an applicable approved policy preview.");
} else throw new Error("Unknown operator command. Use --help.");
