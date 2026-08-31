import { expect, test } from "@playwright/test";

test("Guided Demo completes the six-step reference walkthrough without a model call", async ({
  page
}) => {
  const inferenceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:demo|probe|scored|successor-eval)\//u.test(request.url())) {
      inferenceRequests.push(request.url());
    }
  });
  await page.goto("/demo");

  await expect(page).toHaveTitle("Demo · Thurstone");
  await expect(page.getByText("Guided demo ready", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Step 1 of 6")).toBeVisible();
  await expect(page.getByText("Explanation only", { exact: true })).toBeVisible();

  for (const action of [
    "Read the contract",
    "Test tentative intent",
    "Reveal verified decision",
    "Verify trusted state",
    "Change one meaning field",
    "Reveal verified execution",
    "Verify the transition",
    "See the verdict"
  ]) {
    await page.getByRole("button", { name: action, exact: true }).click();
  }

  await expect(page.getByLabel("Step 6 of 6")).toBeVisible();
  await expect(page.getByRole("article", { name: /^Pass:/u })).toContainText(
    "Uncertainty stayed uncertain"
  );
  await expect(page.getByText("Live native execution", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Reference replay · no provider call/iu)).toBeVisible();
  expect(inferenceRequests).toEqual([]);
});

test("Guided Demo labels decisions, execution, and trusted-state evidence honestly", async ({
  page
}) => {
  await page.goto("/demo");

  await page.getByRole("button", { name: "Read the contract" }).click();
  await page.getByRole("button", { name: "Test tentative intent" }).click();
  await page.getByRole("button", { name: "Reveal verified decision" }).click();
  await expect(page.getByText("Verified reference decision", { exact: true })).toBeVisible();
  await expect(page.getByText("Asked for confirmation", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Verify trusted state" }).click();
  await expect(page.getByText("Trusted state replay", { exact: true })).toBeVisible();
  const tentativeState = page.getByLabel("Trusted state before and after");
  await expect(tentativeState).toContainText("Ledger delta 0");

  await page.getByRole("button", { name: "Change one meaning field" }).click();
  await page.getByRole("button", { name: "Reveal verified execution" }).click();
  await expect(page.getByText("Verified reference execution", { exact: true })).toBeVisible();
  await expect(page.getByText("Called checkout_request")).toBeVisible();

  await page.getByRole("button", { name: "Verify the transition" }).click();
  const explicitState = page.getByLabel("Trusted state before and after");
  await expect(explicitState).toContainText("pending_human_approval");
  await expect(explicitState).toContainText("Ledger delta 1");
});

test("Guided Demo Back and restart never duplicate a reference transition", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Read the contract" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("Explanation only", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Read the contract" }).click();
  await page.getByRole("button", { name: "Test tentative intent" }).click();
  await page.getByRole("button", { name: "Restart verified fixture" }).click();
  await expect(page.getByLabel("Step 1 of 6")).toBeVisible();
  await expect(page.getByText(/fixture checkout-seed-v1/iu)).toBeVisible();
});

test("Demo mode navigation preserves the URL hash and opens the complete Sandbox", async ({
  page
}) => {
  await page.goto("/demo#contract-workshop");
  await expect(page.getByRole("heading", { name: /Turn your expectation into/iu })).toBeVisible();

  await page.getByRole("link", { name: "Open Sandbox", exact: true }).click();
  await expect(page).toHaveURL(/\/demo#open-sandbox$/u);
  await expect(
    page.getByRole("link", { name: "Open full technical sandbox", exact: true })
  ).toHaveAttribute("href", "/lab");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Open the complete native WebMCP sandbox." })
  ).toBeVisible();
});

test("Demo remains useful without WebMCP and has no superseded score or horizontal overflow", async ({
  page
}) => {
  await page.goto("/demo");
  await expect(page.getByText("Guided demo ready", { exact: true })).toBeVisible();
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
});
