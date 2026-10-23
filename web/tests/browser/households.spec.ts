import { test, expect } from "@playwright/test";

test("a head creates a household and switches between private and shared task lists", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner" })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Private household planning");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Everyday family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Everyday family");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(
    page.getByText("Household created. Personal content remains private.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Everyday family · Shared · Head" });
  await expect(
    page.getByText("Private household planning", { exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Shared shopping preparation");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption("personal");
  await expect(
    page.getByText("Private household planning", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Shared shopping preparation", { exact: true }),
  ).toBeHidden();
  await page.reload();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Everyday family · Shared · Head" });
  await expect(
    page.getByText("Shared shopping preparation", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Household", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/intrepion-mvp3-production-household-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/intrepion-mvp3-production-capacity-mobile.png",
    fullPage: true,
  });
});

test("recipient-bound head invitations work in the browser and removal clears an existing household draft without logging the person out", async ({
  page,
  browser,
}) => {
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await second.goto("/");
    await second
      .getByRole("button", {
        name: "Sign in as development Morgan",
        exact: true,
      })
      .click();
    await second
      .getByRole("button", { name: "My capacity", exact: true })
      .click();
    const recipient = await second
      .getByLabel("Your account ID", { exact: true })
      .inputValue();
    await page.goto("/");
    await page
      .getByRole("button", {
        name: "Sign in as development owner",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "My capacity", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create household", exact: true })
      .click();
    await page
      .getByLabel("Household name", { exact: true })
      .fill("Invited family");
    await page.getByLabel("Items to allocate", { exact: true }).fill("10");
    await page
      .getByLabel("Storage bytes to allocate", { exact: true })
      .fill("65536");
    await page
      .getByRole("button", { name: "Review household", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create household", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Space", exact: true })
      .selectOption({ label: "Invited family · Shared · Head" });
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page
      .getByRole("button", { name: "Invite approved head", exact: true })
      .click();
    await page
      .getByLabel("Recipient account ID", { exact: true })
      .fill(recipient);
    await page
      .getByRole("button", { name: "Review invitation", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    const link = await page
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    await second.goto(link);
    await expect(
      second.getByRole("heading", { name: "Head invitation", exact: true }),
    ).toBeVisible();
    expect(second.url()).not.toContain("invite=");
    await second
      .getByRole("button", { name: "Accept head membership", exact: true })
      .click();
    await second
      .getByRole("dialog")
      .getByRole("button", { name: "Join household", exact: true })
      .click();
    await second.getByRole("button", { name: "New task", exact: true }).click();
    await second
      .getByLabel("Title", { exact: true })
      .fill("Draft from ended household access");
    await page
      .getByRole("button", { name: "Refresh household", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove head Morgan", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove head", exact: true })
      .click();
    await second
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      second.getByRole("heading", {
        name: "Household access ended",
        exact: true,
      }),
    ).toBeVisible();
    expect(await second.locator("body").textContent()).not.toContain(
      "Draft from ended household access",
    );
    await second
      .getByRole("button", { name: "Open personal space", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Tasks", exact: true }),
    ).toBeVisible();
    await expect(
      second.getByText("Morgan · Approved Google account", { exact: true }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test("a head previews and changes only their own reserved allocation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Allocation family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Manage my allocation for Allocation family",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Storage bytes allocated", { exact: true })
    .fill("32768");
  await page
    .getByRole("button", { name: "Preview allocation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("65,536 → 32,768");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply allocation", exact: true })
    .click();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Allocation family",
      exact: true,
    }),
  });
  await expect(card).toContainText("Storage bytes: 32,768");
  await page
    .getByRole("button", {
      name: "Manage my allocation for Allocation family",
      exact: true,
    })
    .click();
  await page.getByLabel("Storage bytes allocated", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Preview allocation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("retained");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("full storage recovery confirms the active task and resumes protected erasure after a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Storage family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Storage family · Shared · Head" });
  for (const title of ["Erase this active task", "Keep this shared task"]) {
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Save task", exact: true }).click();
  }
  await page.getByRole("button", { name: "Household", exact: true }).click();
  const usage = await page
    .getByRole("term")
    .filter({ hasText: /^Storage bytes$/ })
    .locator("xpath=following-sibling::dd[1]")
    .innerText();
  const exactUsage = usage.split("/")[0].replaceAll(",", "").trim();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Manage my allocation for Storage family",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Storage bytes allocated", { exact: true })
    .fill(exactUsage);
  await page
    .getByRole("button", { name: "Preview allocation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply allocation", exact: true })
    .click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Move task to Trash: Erase this active task",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("storage allowance");
  await page
    .getByRole("button", { name: "Review storage recovery", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Erase active content permanently",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Storage family");
  await expect(page.getByRole("dialog")).toContainText(
    "Erase this active task",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Erase this active task", exact: true }),
  ).toBeVisible();
  await page.request.post("http://127.0.0.1:8792/fault", {
    headers: { authorization: "Bearer local-erasure-only" },
    data: { fail_next: "after" },
  });
  await page
    .getByRole("button", {
      name: "Erase active content permanently",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Erase permanently", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("pending");
  await page.reload();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Storage family · Shared · Head" });
  await page
    .getByRole("button", {
      name: "Resume erasure: Erase this active task",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Retry pending erasure", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Keep this shared task", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Erase this active task", { exact: true }),
  ).toBeHidden();
});

test("the last head confirms a final UTC month-end closure and sees retained capacity privately", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Closing family");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("4096");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Closing family · Shared · Head" });
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave household", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closure is final");
  await expect(dialog).toContainText(/\d{4}-\d{2}-01T00:00:00\.000Z UTC/);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Closing family", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Leave household", exact: true })
    .click();
  await page.request.post("http://127.0.0.1:8792/fault", {
    headers: { authorization: "Bearer local-erasure-only" },
    data: { fail_next: "after" },
  });
  await dialog
    .getByRole("button", { name: "Leave and close household", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My capacity", exact: true }),
  ).toBeVisible();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Closing family", exact: true }),
  });
  await expect(card).toContainText("closed");
  await expect(card).toContainText("Capacity remains reserved");
  await expect(card).toContainText("Storage bytes: 4,096");
  await expect(card).toContainText("Closure recovery protection pending");
  await page
    .getByRole("button", {
      name: "Retry closure protection for Closing family",
      exact: true,
    })
    .click();
  await expect(card).not.toContainText("Closure recovery protection pending");
  await expect(
    page.getByRole("combobox", { name: "Space", exact: true }),
  ).toHaveValue("personal");
  await expect(
    page
      .getByRole("combobox", { name: "Space", exact: true })
      .locator("option"),
  ).not.toContainText(["Closing family · Shared · Head"]);
});

test("a head changes their own count ceiling without changing household capacity", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Ceiling family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Ceiling family · Shared · Head" });
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit my count ceilings", exact: true })
    .click();
  await page.getByLabel("My Items ceiling", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Review my ceilings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply my ceilings", exact: true })
    .click();
  await expect(
    page.getByText("Items · created by you: 0 / ceiling 0", { exact: true }),
  ).toBeVisible();
  const adminHistory = page.getByRole("region", {
    name: "Household administrative History",
    exact: true,
  });
  await expect(adminHistory).toContainText(
    "Changed own individual count ceilings",
  );
  await expect(adminHistory).toContainText("Owner");
  await expect(adminHistory).toContainText("Items: 10 → 0");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Blocked by my ceiling");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "individual retained-item ceiling",
  );
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Blocked by my ceiling",
  );
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Items$/ })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("0 / 10");
});

test("a personal shopping list is explicitly copied into a household with fresh History", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page.getByLabel("Household name", { exact: true }).fill("Copy family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Shopping lists to allocate", { exact: true })
    .fill("2");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "New shopping list", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Family groceries");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Rice for supper");
  await page.getByLabel("Quantity", { exact: true }).fill("2 bags");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Copy to household", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Destination household", exact: true })
    .selectOption({ label: "Copy family" });
  await page
    .getByRole("button", { name: "Preview independent copy", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Family groceries");
  await expect(page.getByRole("dialog")).toContainText("Copy family");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create independent copy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Family groceries", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Space", exact: true }),
  ).not.toHaveValue("personal");
  await expect(page.getByText("2 bags", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Copied from personal space", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption("personal");
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Family groceries", exact: true })
    .click();
  await expect(page.getByText("2 bags", { exact: true })).toBeVisible();
});

test("a head resumes the confirmed shared-content erasure snapshot after protection uncertainty", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Erasure family");
  await page.getByLabel("Items to allocate", { exact: true }).fill("10");
  await page
    .getByLabel("Storage bytes to allocate", { exact: true })
    .fill("65536");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Erasure family · Shared · Head" });
  for (const title of ["Shared erased one", "Shared erased two"]) {
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Save task", exact: true }).click();
  }
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Erase all shared content", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Erasure family");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.request.post("http://127.0.0.1:8792/fault", {
    headers: { authorization: "Bearer local-erasure-only" },
    data: { fail_next: "after" },
  });
  await page
    .getByRole("button", { name: "Erase all shared content", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "Erase shared content permanently",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText("pending");
  await page.reload();
  await page
    .getByRole("combobox", { name: "Space", exact: true })
    .selectOption({ label: "Erasure family · Shared · Head" });
  await expect(
    page.getByText("Shared erased one", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Resume confirmed shared-content erasure",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Items$/ })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("0 / 10");
  await expect(
    page.getByRole("button", { name: "Leave household", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByText("Shared erased one", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByText("Shared erased two", { exact: true }),
  ).toBeHidden();
});

test("a household draft requires confirmation before sign-out", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Unsaved private household draft");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(page.getByLabel("Household name", { exact: true })).toHaveValue(
    "Unsaved private household draft",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in as development Morgan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My capacity", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(page.getByLabel("Household name", { exact: true })).toHaveValue(
    "",
  );
});

test("signing in as a different approved identity after expiry does not recover another person's task draft", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Private draft belonging to Owner");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Owner-only unsaved notes");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your session has expired",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in as development Morgan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Morgan · Approved Google account", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("");
});
