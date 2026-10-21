// This script runs only after the workflow has checked the exact revision's CI.
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const service = required("RENDER_SERVICE_ID");
if (!/^srv-[a-z0-9]+$/.test(service)) throw new Error("Invalid service ID.");
const sha = required("DEPLOY_SHA");
if (!/^[0-9a-f]{40}$/.test(sha))
  throw new Error("An exact commit SHA is required.");
const response = await fetch(
  `https://api.render.com/v1/services/${service}/deploys`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${required("RENDER_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ commitId: sha }),
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok)
  throw new Error(`Render refused deployment (${response.status}).`);
const { id } = await response.json();
if (typeof id !== "string" || !/^dep-[a-z0-9]+$/.test(id))
  throw new Error("Unexpected Render deployment response.");
for (let attempt = 0; attempt < 120; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const status = await fetch(
    `https://api.render.com/v1/services/${service}/deploys/${id}`,
    {
      headers: { authorization: `Bearer ${required("RENDER_API_KEY")}` },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!status.ok)
    throw new Error(
      "Could not confirm the Render deployment. Inspect the provider dashboard before retrying.",
    );
  const deploy = await status.json();
  if (deploy.status === "live") {
    if (deploy.commit?.id !== sha)
      throw new Error("Render deployed a different revision.");
    console.log("The requested API revision is live.");
    process.exit(0);
  }
  if (
    ["build_failed", "update_failed", "canceled", "deactivated"].includes(
      deploy.status,
    )
  )
    throw new Error("Render deployment did not succeed.");
}
throw new Error(
  "Timed out waiting for Render. Inspect its dashboard before retrying.",
);
