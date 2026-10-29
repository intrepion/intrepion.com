import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

async function requestAndApprove(page: Page, browser: Browser, email: string) {
  await page
    .getByRole("button", { name: "Create request link", exact: true })
    .click();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const link = await page
    .getByLabel("Request link", { exact: true })
    .inputValue();
  const context = await browser.newContext();
  try {
    const requester = await context.newPage();
    await requester.goto(link);
    await requester
      .getByRole("button", {
        name: "Use another development Google account",
        exact: true,
      })
      .click();
    await requester.getByLabel("Development Google email").fill(email);
    await requester
      .getByLabel("Development Google display name")
      .fill("Requester");
    await requester
      .getByRole("button", {
        name: "Continue development sign-in",
        exact: true,
      })
      .click();
    await requester
      .getByRole("button", { name: "Request invitation email", exact: true })
      .click();
    await expect(
      requester.getByRole("heading", {
        name: "Your request is pending",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  await page
    .getByRole("button", { name: "Refresh household", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve and send", exact: true })
    .click();
}

test("a person requests and accepts a household invitation without a pilot account", async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await page.getByRole("button", { name: "Households", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Consent family");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create request link", exact: true })
    .click();
  await page.getByLabel("Email me when someone requests an invitation").check();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  await expect(
    page.getByText(
      "Notifications are on for development-owner@example.invalid.",
      { exact: true },
    ),
  ).toBeVisible();
  const link = await page
    .getByLabel("Request link", { exact: true })
    .inputValue();
  expect(link).toContain("#request=");
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(link);
    await expect(
      recipient.getByText("Consent family", { exact: true }),
    ).toHaveCount(0);
    await recipient
      .getByRole("button", {
        name: "Use another development Google account",
        exact: true,
      })
      .click();
    await recipient
      .getByLabel("Development Google email")
      .fill("consent-wife@example.invalid");
    await recipient
      .getByLabel("Development Google display name")
      .fill("Taylor");
    await recipient
      .getByRole("button", {
        name: "Continue development sign-in",
        exact: true,
      })
      .click();
    await expect(
      recipient.getByRole("heading", {
        name: "Request an invitation to Consent family",
        exact: true,
      }),
    ).toBeVisible();
    await recipient
      .getByRole("button", { name: "Request invitation email", exact: true })
      .click();
    await expect(
      recipient.getByText("Your request is pending", { exact: true }),
    ).toBeVisible();
    let reviewLink = "";
    await expect
      .poll(
        async () => {
          const inbox = (await (
            await page.request.get("http://127.0.0.1:8793/messages", {
              headers: { authorization: "Bearer local-email-only" },
            })
          ).json()) as { messages: { recipient: string; text: string }[] };
          reviewLink =
            inbox.messages
              .find((m) => m.recipient === "development-owner@example.invalid")
              ?.text.match(
                /http:\/\/127\.0\.0\.1:4322\/#household=[a-f0-9-]{36}/,
              )?.[0] ?? "";
          return !!reviewLink;
        },
        { timeout: 15000 },
      )
      .toBeTruthy();
    await page.goto(reviewLink);
    await expect(
      page.getByRole("heading", { name: "Consent family", exact: true }),
    ).toBeVisible();
    await recipient
      .getByRole("button", { name: "My invitation requests", exact: true })
      .click();
    await recipient
      .getByRole("button", {
        name: "Use another development Google account",
        exact: true,
      })
      .click();
    await recipient
      .getByLabel("Development Google email")
      .fill("consent-wife@example.invalid");
    await recipient
      .getByLabel("Development Google display name")
      .fill("Taylor");
    await recipient
      .getByRole("button", {
        name: "Continue development sign-in",
        exact: true,
      })
      .click();
    await expect(
      recipient.getByRole("heading", {
        name: "My invitation requests",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recipient.getByText("consent-wife@example.invalid · pending", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Refresh household", exact: true })
      .click();
    await expect(
      page.getByText("consent-wife@example.invalid", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve and send", exact: true })
      .click();
    let invitation = "";
    await expect
      .poll(
        async () => {
          const inbox = (await (
            await page.request.get("http://127.0.0.1:8793/messages", {
              headers: { authorization: "Bearer local-email-only" },
            })
          ).json()) as { messages: { recipient: string; text: string }[] };
          invitation =
            inbox.messages
              .find((m) => m.recipient === "consent-wife@example.invalid")
              ?.text.match(
                /http:\/\/127\.0\.0\.1:4322\/#invite=[a-f0-9]{64}/,
              )?.[0] ?? "";
          return !!invitation;
        },
        { timeout: 15000 },
      )
      .toBeTruthy();
    await recipient.goto(invitation);
    await recipient
      .getByRole("button", {
        name: "Use another development Google account",
        exact: true,
      })
      .click();
    await recipient
      .getByLabel("Development Google email")
      .fill("consent-wife@example.invalid");
    await recipient
      .getByLabel("Development Google display name")
      .fill("Taylor");
    await recipient
      .getByRole("button", {
        name: "Continue development sign-in",
        exact: true,
      })
      .click();
    await recipient
      .getByRole("button", { name: "Create account and join", exact: true })
      .click();
    await expect(
      recipient.getByRole("heading", {
        name: "You joined Consent family",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("malformed invitation fragments are removed and explain how to recover", async ({
  page,
}) => {
  for (const token of ["", "broken-link"]) {
    await page.goto(`/#invite=${token}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: "This invitation is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Sign in as development owner",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Back to sign-in", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Sign in as development owner",
        exact: true,
      }),
    ).toBeVisible();
  }
});

test("a normal owner creates a household by name and sends an email without exposing acceptance links", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "My capacity", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Households", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Everyday email family");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Everyday email family", exact: true }),
  ).toBeVisible();
  await requestAndApprove(page, browser, "wife@example.invalid");
  await expect(
    page
      .locator("#household-view")
      .getByText("wife@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(
      async () => {
        const r = await page.request.get("http://127.0.0.1:8793/messages", {
          headers: { authorization: "Bearer local-email-only" },
        });
        const inbox = (await r.json()) as {
          messages: { recipient: string; text: string }[];
        };
        return inbox.messages.some(
          (m) => m.recipient === "wife@example.invalid",
        );
      },
      { timeout: 15000 },
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admin overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause growth", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(
    confirmation.getByRole("heading", { name: "Pause growth?", exact: true }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Keep current setting", exact: true })
    .click();
  await expect(page.getByText("Growth is open", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause growth", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Pause growth", exact: true })
    .click();
  await expect(
    page.getByText("Growth is paused", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Admin", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(
    page.getByText("Growth is paused", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume growth", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Resume growth", exact: true })
    .click();
  await expect(page.getByText("Growth is open", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit safety thresholds", exact: true })
    .click();
  await page
    .getByLabel("Personal items review threshold", { exact: true })
    .fill("799");
  await page
    .getByLabel("Household storage bytes review threshold", { exact: true })
    .fill("1");
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
  await confirmation
    .getByRole("button", { name: "Apply thresholds", exact: true })
    .click();
  await expect(
    page.getByText("Safety thresholds saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit safety thresholds", exact: true })
    .click();
  await expect(
    page.getByLabel("Personal items review threshold", { exact: true }),
  ).toHaveValue("799");
  await page
    .getByRole("button", { name: "Cancel threshold edit", exact: true })
    .click();
  await expect(
    page.getByText("Site owner · Access retained", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Site owner · Access retained" })
      .getByRole("button", { name: "Suspend account", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByText("Review recommended: storage bytes", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Email operations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^[1-9][0-9]* \/ 10,000 attempts this UTC month$/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Site audit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Site audit", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", {
        name: "Changed independent safety policy",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to admin overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recovery review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recovery review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 pending security changes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Check backup age watchdog", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/intrepion/intrepion.com/actions/workflows/backup-watchdog.yml",
  );
  await page
    .getByRole("button", { name: "Back to admin overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact support", exact: true }),
  ).toHaveAttribute("href", "mailto:support%40example.invalid");
});

test("an emailed recipient creates a real account and shares household tasks while keeping personal tasks private", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in as development owner", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Households", exact: true }).click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await page.getByLabel("Household name", { exact: true }).fill("Daily family");
  await page
    .getByRole("button", { name: "Review household", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Daily family", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Shared packing task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByText("Shared packing task", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await requestAndApprove(page, browser, "wife-browser@example.invalid");
  let link = "";
  await expect
    .poll(
      async () => {
        const r = await page.request.get("http://127.0.0.1:8793/messages", {
          headers: { authorization: "Bearer local-email-only" },
        });
        const inbox = (await r.json()) as {
          messages: { recipient: string; text: string }[];
        };
        link =
          inbox.messages
            .find((m) => m.recipient === "wife-browser@example.invalid")
            ?.text.match(
              /http:\/\/127\.0\.0\.1:4322\/#invite=[a-f0-9]{64}/,
            )?.[0] ?? "";
        return !!link;
      },
      { timeout: 15000 },
    )
    .toBeTruthy();
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(link);
    await expect(
      recipient.getByRole("heading", {
        name: "You have a household invitation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(recipient).not.toHaveURL(/invite=/);
    await expect(
      recipient.getByText("Daily family", { exact: true }),
    ).toHaveCount(0);
    await recipient
      .getByRole("button", {
        name: "Use another development Google account",
        exact: true,
      })
      .click();
    await recipient
      .getByLabel("Development Google email", { exact: true })
      .fill("wife-browser@example.invalid");
    await recipient
      .getByLabel("Development Google display name", { exact: true })
      .fill("Google wife name");
    await recipient
      .getByRole("button", {
        name: "Continue development sign-in",
        exact: true,
      })
      .click();
    await expect(
      recipient.getByRole("heading", {
        name: "Join Daily family",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recipient.getByLabel("Google account email", { exact: true }),
    ).toHaveValue("wife-browser@example.invalid");
    await expect(
      recipient.getByLabel("Your display name", { exact: true }),
    ).toHaveValue("Google wife name");
    await recipient
      .getByLabel("Your display name", { exact: true })
      .fill("Family head");
    await recipient
      .getByRole("button", { name: "Create account and join", exact: true })
      .click();
    await recipient
      .getByRole("button", { name: "Open household", exact: true })
      .click();
    await expect(
      recipient.getByText("Shared packing task", { exact: true }),
    ).toBeVisible();
    await expect(
      recipient.getByRole("button", { name: "Admin", exact: true }),
    ).toHaveCount(0);
    await recipient
      .getByLabel("Space", { exact: true })
      .selectOption("personal");
    await recipient
      .getByRole("button", { name: "New task", exact: true })
      .click();
    await recipient
      .getByLabel("Title", { exact: true })
      .fill("Wife private task");
    await recipient
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      recipient.getByText("Wife private task", { exact: true }),
    ).toBeVisible();
    await recipient.reload();
    await expect(
      recipient.getByText("Wife private task", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Space", { exact: true }).selectOption("personal");
    await expect(
      page.getByRole("heading", { name: "Tasks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Wife private task", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    const accountCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Family head", exact: true }),
    });
    await accountCard
      .getByRole("button", { name: "Suspend account", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Keep access", exact: true })
      .click();
    await expect(
      accountCard.getByRole("button", { name: "Suspend account", exact: true }),
    ).toBeVisible();
    await accountCard
      .getByRole("button", { name: "Suspend account", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Suspend account", exact: true })
      .click();
    await expect(
      accountCard.getByRole("button", { name: "Restore account", exact: true }),
    ).toBeVisible();
    await accountCard
      .getByRole("button", { name: "Restore account", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Restore account", exact: true })
      .click();
    await expect(
      accountCard.getByRole("button", { name: "Suspend account", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
