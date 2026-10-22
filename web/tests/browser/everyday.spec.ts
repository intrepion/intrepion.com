import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// List workflows share a real owner session so the expanded suite respects the
// production rate limiter. Dedicated task/auth recovery tests still log in.
let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
async function owner(page: Page) {
  if (ownerCookies) await page.context().addCookies(ownerCookies);
  await page.goto("/");
  if (!ownerCookies)
    await page
      .getByRole("button", { name: "Sign in as development owner" })
      .click();
  await expect(
    page.getByRole("button", { name: "Shopping", exact: true }),
  ).toBeVisible();
  ownerCookies ??= await page.context().cookies();
}

test("shopping list, item and quantity persist through the real API", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Weekly groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekly groceries", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Oat milk");
  await page.getByLabel("Quantity", { exact: true }).fill("2 cartons");
  await page.getByLabel("Notes", { exact: true }).fill("Unsweetened");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Oat milk purchased",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Mark Oat milk purchased", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Mark Oat milk needed", exact: true }),
  ).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Weekly groceries", exact: true })
    .click();
  await expect(page.getByText("2 cartons", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsweetened", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Mark Oat milk needed", exact: true }),
  ).toBeChecked();
});

test("a reusable travel template starts an independent run that can finish and reopen", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Weekend travel");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Pack passport");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Friday trip");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(
    page.getByText("0 of 1 complete", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Complete Pack passport", exact: true })
    .click();
  await expect(
    page.getByText("1 of 1 complete", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish run", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Reopen Pack passport", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reopen run", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Reopen Pack passport", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Archive collection", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(
    page.getByText("Archived · read-only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish run", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Weekend travel", exact: true })
    .click();
  await expect(page.getByText("Pack passport", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("shopping management explains section removal and preserves items through Archive and Trash", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Management groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Produce");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Apples");
  await page
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "Produce" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove section Produce", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Unsectioned");
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Mark Apples purchased", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Mark all purchased items as needed",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Reset purchases", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Mark Apples purchased", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Section removed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Marked needed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Back to collection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive collection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Mark Apples purchased", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Move collection to Trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore collection", exact: true })
    .click();
  await expect(
    page.getByText("Archived · read-only", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Unarchive collection", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Mark Apples purchased", exact: true }),
  ).toBeEnabled();
});

test("Trash restores an item and independently confirms permanent erasure", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Trash groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Erase this item");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Move item to Trash: Erase this item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore item: Erase this item", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Erase this item purchased",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Move item to Trash: Erase this item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Erase item permanently: Erase this item",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("history");
  await page
    .getByRole("button", { name: "Erase permanently", exact: true })
    .click();
  await expect(page.getByText("Erase this item", { exact: true })).toHaveCount(
    0,
  );
});

test("shopping draft survives session expiry and an uncertain save retries exactly once", async ({
  page,
  context,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Recovered groceries");
  await context.clearCookies();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your session has expired" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in as development owner" })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered groceries",
  );
  await expect(
    page.getByRole("button", { name: "Retry action", exact: true }),
  ).toBeVisible();
  await page.route(
    "**/life.v1.ListService/ApplyChange",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Retry action", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry action", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered groceries",
  );
  await page.getByRole("button", { name: "Retry action", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recovered groceries", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Recovered groceries", exact: true }),
  ).toHaveCount(1);
});

test("preparation items can be reordered and moved with keyboard-usable controls", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Cooking order");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  for (const name of ["Chop", "Cook"]) {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
  }
  await expect(
    page.getByRole("button", { name: "Move Cook up", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move Cook up", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#everyday-view .task-title")).toHaveText([
    "Cook",
    "Chop",
  ]);
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Preparation");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Rename section Preparation", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Ingredients");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit item: Chop", exact: true })
    .click();
  await page
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "Ingredients" });
  await page.getByLabel("Notes", { exact: true }).fill("Use a sharp knife");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Use a sharp knife", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ingredients", exact: true }),
  ).toBeVisible();
});

test("ordinary tasks expose history and reversible Trash instead of permanent deletion", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Recoverable personal task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Task history: Recoverable personal task",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Task history: Recoverable personal task",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "History · Recoverable personal task",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Move task to Trash: Recoverable personal task",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("restore");
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(
    page
      .locator("article.task")
      .filter({ hasText: "Recoverable personal task" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open Recoverable personal task",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Restore collection", exact: true })
    .click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page
      .locator("article.task")
      .filter({ hasText: "Recoverable personal task" }),
  ).toBeVisible();
});

test("a conflicting collection edit preserves the draft and shows latest saved values for review", async ({
  page,
  context,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Before concurrent edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit collection", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Preserved draft name");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Shopping", exact: true }).click();
  await other
    .getByRole("button", { name: "Open Before concurrent edit", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Edit collection", exact: true })
    .click();
  await other.getByLabel("Name", { exact: true }).fill("Newer saved name");
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review latest", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review latest", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Preserved draft name",
  );
  await expect(
    page.getByText("Newer saved name", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preserved draft name", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("long shopping content keeps every action within a 320px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Small screen groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const title = "X".repeat(200);
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Quantity", { exact: true }).fill("Y".repeat(100));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: `Mark ${title} purchased`,
      exact: true,
    }),
  ).toBeVisible();
  const outside = await page
    .locator("#app button:visible")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const r = button.getBoundingClientRect();
          return r.left < 0 || r.right > innerWidth + 1 || r.height < 44;
        })
        .map((button) => button.textContent),
    );
  expect(outside).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("shopping-mobile.png"),
    fullPage: true,
  });
});

test("a collection erasure interrupted by a reload can be completed from Trash", async ({
  page,
  request,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Interrupted collection erasure");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Move collection to Trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await request.post("http://127.0.0.1:8792/fault", {
    headers: { authorization: "Bearer local-erasure-only" },
    data: { fail_next: "before" },
  });
  await page
    .getByRole("button", { name: "Erase collection permanently", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Erase permanently", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry action", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open Interrupted collection erasure",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry pending erasure", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry pending erasure", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open Interrupted collection erasure",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Interrupted collection erasure",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("restoring an item whose section was removed explains its Unsectioned destination", async ({
  page,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Missing section groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Former section");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Restored at end");
  await page
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "Former section" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Move item to Trash: Restored at end",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove section Former section", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore item: Restored at end", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Unsectioned");
  await page.getByRole("button", { name: "Restore item", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Restored at end purchased",
      exact: true,
    }),
  ).toBeVisible();
});

test("conflicting item review displays the latest quantity and section beside the retained draft", async ({
  page,
  context,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Item comparison groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Chilled");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Comparison milk");
  await page.getByLabel("Quantity", { exact: true }).fill("1 carton");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit item: Comparison milk", exact: true })
    .click();
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Preserve these draft notes");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Shopping", exact: true }).click();
  await other
    .getByRole("button", {
      name: "Open Item comparison groceries",
      exact: true,
    })
    .click();
  await other
    .getByRole("button", { name: "Edit item: Comparison milk", exact: true })
    .click();
  await other.getByLabel("Quantity", { exact: true }).fill("2 cartons");
  await other
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "Chilled" });
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.getByText("2 cartons", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Review latest", exact: true })
    .click();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Preserve these draft notes",
  );
  await expect(page.locator(".saved-comparison")).toContainText("2 cartons");
  await expect(page.locator(".saved-comparison")).toContainText("Chilled");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue(
    "1 carton",
  );
  await other.close();
});

test("a pending item erasure pauses all run mutations after a reload", async ({
  page,
  request,
}) => {
  await owner(page);
  await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Pending erasure template");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  for (const name of ["Keep working item", "Erase run item"]) {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
  }
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Paused run");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Move item to Trash: Erase run item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await request.post("http://127.0.0.1:8792/fault", {
    headers: { authorization: "Bearer local-erasure-only" },
    data: { fail_next: "before" },
  });
  await page
    .getByRole("button", {
      name: "Erase item permanently: Erase run item",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Erase permanently", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry action", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Erase item permanently: Erase run item",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByRole("button", { name: "Active runs", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Paused run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry pending erasure", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("aria-busy", "false");
  for (const name of [
    "Finish run",
    "Archive collection",
    "Move collection to Trash",
  ])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Keep working item",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry pending erasure", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry pending erasure", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Keep working item",
      exact: true,
    }),
  ).toBeEnabled();
});

test("a failed list load does not claim the collection is empty", async ({
  page,
}) => {
  await owner(page);
  await page.route(
    "**/life.v1.ListService/ListCollections",
    (route) => route.abort("failed"),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await expect(page.locator("#everyday-view [role=alert]")).toBeVisible();
  await expect(
    page.getByText(
      "Nothing here yet. Create a list or start a run from a template.",
      { exact: true },
    ),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("#everyday-view [role=alert]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New shopping list", exact: true }),
  ).toBeEnabled();
});
