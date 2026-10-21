const origin = new URL(process.argv[2]);
if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
  throw new Error("Provide the HTTPS API origin.");
const start = performance.now();
try {
  const response = await fetch(new URL("/health/live", origin), {
    signal: AbortSignal.timeout(90000),
    redirect: "error",
  });
  console.log(
    JSON.stringify({
      event: "availability_sample",
      ok: response.ok,
      first_response_ms: Math.round(performance.now() - start),
      measured_at: new Date().toISOString(),
    }),
  );
  if (!response.ok) process.exitCode = 1;
} catch {
  console.log(
    JSON.stringify({
      event: "availability_sample",
      ok: false,
      first_response_ms: Math.round(performance.now() - start),
      measured_at: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
}
