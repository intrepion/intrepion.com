import { copyFile, mkdir } from "node:fs/promises";
import { build, context } from "esbuild";

await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/main.js",
  sourcemap: true,
};
if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "dist", host: "127.0.0.1", port: 5173 });
  console.log("Web spike: http://127.0.0.1:5173");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => { await ctx.dispose(); process.exit(0); });
  }
} else {
  await build(options);
}
