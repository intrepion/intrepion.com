import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

export async function probe(
  origin,
  { request = fetch, timeoutMs = 90000, retryDelayMs = 2000 } = {},
) {
  const start = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let ok = false;
  let attempts = 0;
  while (!signal.aborted) {
    attempts++;
    try {
      const response = await request(new URL("/health/live", origin), {
        signal,
        redirect: "error",
      });
      if (response.status === 200 && (await response.text()).trim() === "ok") {
        ok = true;
        break;
      }
    } catch {
      // Provider loading pages and transient network failures are not ready.
    }
    try {
      await setTimeout(retryDelayMs, undefined, { signal });
    } catch {
      break;
    }
  }
  return {
    event: "availability_sample",
    ok,
    attempts,
    first_response_ms: Math.round(performance.now() - start),
    measured_at: new Date().toISOString(),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const origin = new URL(process.argv[2]);
  if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
    throw new Error("Provide the HTTPS API origin.");
  const result = await probe(origin);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
