// Feed private exported server JSON lines on stdin. Output contains aggregates only.
let source = "";
for await (const chunk of process.stdin) source += chunk;
const lines = source.split("\n");
const requests = lines.flatMap((line) => {
  try {
    const entry = JSON.parse(line);
    return entry.event === "request" &&
      ["list", "create", "update", "delete"].includes(entry.route)
      ? [entry]
      : [];
  } catch {
    return [];
  }
});
const durations = requests
  .map((entry) => Number(entry.duration_ms))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const errors = requests.filter((entry) => entry.status >= 500).length;
console.log(
  JSON.stringify(
    {
      requests: requests.length,
      server_errors: errors,
      error_rate: requests.length ? errors / requests.length : null,
      api_p95_ms: durations.length
        ? durations[Math.ceil(durations.length * 0.95) - 1]
        : null,
      interpretation:
        requests.length < 20
          ? "Small sample: collect more observations before treating percentiles or error rates as trends."
          : "Review p95 > 500 ms and errors > 1% with context.",
    },
    null,
    2,
  ),
);
