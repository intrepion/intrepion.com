import { defineConfig } from "astro/config";
import { rename } from "node:fs/promises";
export default defineConfig({
  output: "static",
  devToolbar: { enabled: false },
  integrations: [
    {
      name: "pages-security-headers",
      hooks: {
        // Astro ignores underscore-prefixed routes. Generate a normal endpoint,
        // then give its output the special filename consumed by Cloudflare Pages.
        "astro:build:done": async ({ dir }) => {
          await rename(
            new URL("security-headers.txt", dir),
            new URL("_headers", dir),
          );
        },
      },
    },
  ],
});
