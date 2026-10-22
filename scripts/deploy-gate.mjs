const sha = process.env.DEPLOY_SHA;
if (!sha || !/^[0-9a-f]{40}$/.test(sha))
  throw new Error("Provide a full lowercase commit SHA.");
const repo = process.env.GITHUB_REPOSITORY;
const response = await fetch(
  `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
  {
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw new Error("Could not inspect CI.");
const { workflow_runs: runs } = await response.json();
const matching = runs
  .filter(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      ["push", "workflow_dispatch"].includes(run.event),
  )
  .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
if (matching[0]?.conclusion !== "success")
  throw new Error(
    "The latest push or manually triggered CI run for this main revision must have succeeded.",
  );
console.log("Exact revision passed CI.");
