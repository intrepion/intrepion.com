import { test, expect } from "@playwright/test";

test("the owner can activate the first normal-account safety policy", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit safety thresholds", exact: true })
    .click();
  for (const space of ["Personal", "Household"]) {
    for (const [label, soft, hard] of [
      ["items", 800, 1000],
      ["shopping lists", 80, 100],
      ["checklist templates", 80, 100],
      ["checklist runs", 800, 1000],
      ["storage bytes", 838860, 1048576],
    ] as const) {
      await page
        .getByLabel(`${space} ${label} review threshold`)
        .fill(String(soft));
      await page
        .getByLabel(`${space} ${label} hard threshold`)
        .fill(String(hard));
    }
  }
  await page.getByLabel("Personal households review threshold").fill("8");
  await page.getByLabel("Personal households hard threshold").fill("10");
  await page.getByLabel("Items per collection hard threshold").fill("500");
  await page.getByLabel("Sections per collection hard threshold").fill("100");
  await page
    .getByRole("button", { name: "Review threshold changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Review safety thresholds",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply reviewed thresholds", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply thresholds", exact: true })
    .click();
  await expect(
    page.getByText("Safety thresholds saved", { exact: true }),
  ).toBeVisible();
});
