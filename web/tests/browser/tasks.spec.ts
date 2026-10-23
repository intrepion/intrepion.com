import { test, expect, type Page } from "@playwright/test";
async function signIn(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner" })
    .click();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
}
async function draft(page: Page, title: string) {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
}
function taskRow(page: Page, title: string) {
  return page
    .locator("article.task")
    .filter({ has: page.locator(".task-title", { hasText: title }) });
}

test("real API task lifecycle persists across reload and logout", async ({
  page,
}) => {
  await signIn(page);
  await draft(page, "Browser persistent task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  let row = taskRow(page, "Browser persistent task");
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await row.getByRole("button", { name: "Edit task:" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser edited task");
  await page
    .getByLabel("Notes", { exact: false })
    .fill("Notes survive the server acknowledgment.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(taskRow(page, "Browser edited task")).toBeVisible();
  await page.reload();
  row = taskRow(page, "Browser edited task");
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(row).not.toBeVisible();
  await page
    .getByRole("button", { name: "Sign in as development owner" })
    .click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Move task to Trash:" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    row.getByRole("button", { name: "Move task to Trash:" }),
  ).toBeFocused();
  await row.getByRole("button", { name: "Move task to Trash:" }).click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(row).toHaveCount(0);
});

test("validation and discard protection retain a draft and safe focus", async ({
  page,
}) => {
  await signIn(page);
  await draft(page, "   ");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText("Enter a title.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Keep this draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
});

test("lost create response preserves the draft and retry creates exactly one task", async ({
  page,
}) => {
  await signIn(page);
  await draft(page, "Lost response browser task");
  await page.route(
    "**/life.v1.TaskService/CreateTask",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Try saving again", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Lost response browser task",
  );
  await page
    .getByRole("button", { name: "Try saving again", exact: true })
    .click();
  await expect(taskRow(page, "Lost response browser task")).toHaveCount(1);
  await page.reload();
  await expect(taskRow(page, "Lost response browser task")).toHaveCount(1);
});

test("lost completion response keeps the confirmed checkbox until a safe retry", async ({
  page,
}) => {
  await signIn(page);
  await draft(page, "Completion retry browser task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  const row = taskRow(page, "Completion retry browser task");
  await expect(row).toBeVisible();
  await page.route(
    "**/life.v1.TaskService/UpdateTask",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await row.getByRole("checkbox").click();
  await expect(
    page.getByRole("button", { name: "Retry action", exact: true }),
  ).toBeEnabled();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("button", { name: "Retry action", exact: true }).click();
  await expect(row.getByRole("checkbox")).toBeChecked();
});

test("expired session resumes an unsaved draft after a real local session exchange", async ({
  page,
  context,
}) => {
  await signIn(page);
  await draft(page, "Resume after expiry");
  await context.clearCookies();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your session has expired" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in as development owner" })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Resume after expiry",
  );
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(taskRow(page, "Resume after expiry")).toBeVisible();
});

test("mobile task text remains literal and the layout stays within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const title = '<img src="https://stranger.invalid/x" onerror="alert(1)">';
  await draft(page, title);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(taskRow(page, title)).toBeVisible();
  await expect(page.locator("article img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a lost create response cannot resurrect a task deleted in another tab", async ({
  page,
  context,
}) => {
  await signIn(page);
  const title = "Deleted after lost create response";
  await draft(page, title);
  await page.route(
    "**/life.v1.TaskService/CreateTask",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Try saving again", exact: true }),
  ).toBeEnabled();
  const other = await context.newPage();
  await other.goto("/");
  await taskRow(other, title)
    .getByRole("button", { name: "Move task to Trash:" })
    .click();
  await other
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(taskRow(other, title)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Try saving again", exact: true })
    .click();
  await expect(
    page
      .locator("#save-error")
      .getByText(
        "This task no longer exists. Reload the list; your draft is still here.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
  await other.reload();
  await expect(
    other.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
  await expect(taskRow(other, title)).toHaveCount(0);
});

test("stale-tab deletion cannot discard a newer edit", async ({
  page,
  context,
}) => {
  await signIn(page);
  const title = "Before stale-tab deletion";
  await draft(page, title);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(taskRow(page, title)).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await expect(taskRow(other, title)).toBeVisible();
  await taskRow(page, title)
    .getByRole("button", { name: "Edit task:" })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Keep the newer edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(taskRow(page, "Keep the newer edit")).toBeVisible();
  await taskRow(other, title)
    .getByRole("button", { name: "Move task to Trash:" })
    .click();
  await other
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(
    other
      .locator("#list-error")
      .getByText(
        "This collection changed. Keep your draft and review the latest version before saving again.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.reload();
  await expect(taskRow(page, "Keep the newer edit")).toBeVisible();
});
