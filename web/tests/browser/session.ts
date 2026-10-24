import { expect, type BrowserContext, type Page } from "@playwright/test";

type Identity = "owner" | "Morgan";
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions = new Map<Identity, Cookies>();

// Feature workflows reuse genuine sessions; dedicated expiry/logout steps still
// exchange fresh challenges. Keep the production login rate limit unchanged.
export async function signInPilot(page: Page, identity: Identity = "owner") {
  const cached = sessions.get(identity);
  let valid = false;
  if (cached) {
    await page.context().addCookies(cached);
    const session = await page.request.get(
      "http://127.0.0.1:8788/auth/session",
    );
    valid = session.ok();
    if (!valid) await page.context().clearCookies();
  }
  await page.goto("/");
  if (!valid) {
    await page
      .getByRole("button", {
        name: `Sign in as development ${identity}`,
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "My capacity", exact: true }),
  ).toBeEnabled({ timeout: 15_000 });
  sessions.set(identity, await page.context().cookies());
}
