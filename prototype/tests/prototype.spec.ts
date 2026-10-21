import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeEnabled();
}

async function chooseFault(page: Page, fault: string): Promise<void> {
  const details = page.locator(".review-tools > details");
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  await page.getByRole("combobox", { name: "Next task action", exact: true }).selectOption(fault);
}

test("create, edit, complete, reopen, cancel deletion, then permanently delete", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser workflow task");
  await page.getByLabel("Notes", { exact: false }).fill("Synthetic browser test");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  const row = page.locator("article.task").filter({ hasText: "Browser workflow task" });
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await row.getByRole("button", { name: "Edit task:" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Edited browser task");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const edited = page.locator("article.task").filter({ hasText: "Edited browser task" });
  await edited.getByRole("button", { name: "Delete task:" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(edited.getByRole("button", { name: "Delete task:" })).toBeFocused();
  await edited.getByRole("button", { name: "Delete task:" }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(edited).toHaveCount(0);
});

test("validation, failed save, and retry after a lost response retain one draft identity", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText("Enter a title.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Retry without a duplicate");
  await chooseFault(page, "failure");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText("We couldn’t confirm your save.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Retry without a duplicate");
  await chooseFault(page, "lost-response");
  await page.getByRole("button", { name: "Try saving again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try saving again", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Try saving again", exact: true }).click();
  await expect(page.locator("article.task").filter({ hasText: "Retry without a duplicate" })).toHaveCount(1);
});

test("discard confirmation protects a draft and restores focus", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Do not discard me");
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Do not discard me");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.locator("article.task").filter({ hasText: "Do not discard me" })).toHaveCount(0);
});

test("failed completion retains the last confirmed state and retry does not toggle twice", async ({ page }) => {
  await signIn(page);
  await chooseFault(page, "lost-response");
  const row = page.locator("article.task").filter({ hasText: "Water the plants" });
  await row.getByRole("checkbox").click();
  await expect(row.getByText("Couldn’t update this task.", { exact: true })).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await row.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(row.getByRole("checkbox")).toBeChecked();
});

test("simulated sign-out hides tasks; reload resets the synthetic demo", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Retained until reload");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.locator("article.task").filter({ hasText: "Retained until reload" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("#app article.task")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.locator("article.task").filter({ hasText: "Retained until reload" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.locator("article.task").filter({ hasText: "Retained until reload" })).toHaveCount(0);
});

test("session expiry preserves a dirty draft across simulated sign-in", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Keep through sign-in");
  await page.locator(".review-tools > details > summary").click();
  await page.getByRole("combobox", { name: "Screen", exact: true }).selectOption("expired");
  await page.getByRole("button", { name: "Show scenario", exact: true }).click();
  await expect(page.getByText("Your session expired. Sign in again to continue.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Keep through sign-in");
});

test("all review scenarios work without backend or external requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => {
    if (!request.url().startsWith("http://127.0.0.1:4321/") && !request.url().startsWith("data:")) external.push(request.url());
  });
  await page.goto("/");
  await page.locator(".review-tools > details > summary").click();
  await page.getByRole("combobox", { name: "Screen", exact: true }).selectOption("denied");
  await page.getByRole("button", { name: "Show scenario", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This account doesn’t have access." })).toBeVisible();
  await expect(page.locator("#app")).not.toContainText("owner@example.invalid");
  await page.getByRole("combobox", { name: "Screen", exact: true }).selectOption("loading");
  await page.getByRole("button", { name: "Show scenario", exact: true }).click();
  await expect(page.getByText("Opening your list…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish loading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Screen", exact: true }).selectOption("load-error");
  await page.getByRole("button", { name: "Show scenario", exact: true }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "Screen", exact: true }).selectOption("empty");
  await page.getByRole("button", { name: "Show scenario", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Next task action", exact: true })).toHaveValue("success");
  expect(external).toEqual([]);
});

test("mobile layout and untrusted task text do not create markup or overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill('<img src="https://not-requested.invalid/tracker">');
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText('<img src="https://not-requested.invalid/tracker">', { exact: true })).toBeVisible();
  await expect(page.locator("#app img[src^='https:']")).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("checkbox", { name: "Complete task: Water the plants" })).toBeVisible();
});
