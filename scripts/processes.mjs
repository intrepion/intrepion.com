import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
export function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  child.on("error", (error) => console.error(error.message));
  return child;
}
export async function run(command, args, options = {}) {
  const child = start(command, args, options);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}
export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    setTimeout(5000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}
export async function ready(url, options = {}) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* Not listening yet. */
    }
    await setTimeout(200);
  }
  throw new Error(`Local service did not become ready: ${url}`);
}
export const localEnv = {
  ...process.env,
  APP_ENV: "development",
  WEB_ORIGIN: "http://127.0.0.1:4322",
  PORT: "8788",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: "/tmp/intrepion-production-wrangler.log",
};
export const bridgeReady = () =>
  ready("http://127.0.0.1:8791/query", {
    method: "POST",
    headers: {
      authorization: "Bearer local-d1-only",
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql: "SELECT 1", params: [] }),
  });
