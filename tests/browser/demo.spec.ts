import { expect, test } from "@playwright/test";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function advanceToContract(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Test review versus checkout" }).click();
  await page.getByRole("button", { name: "Build the contract" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  await advanceToContract(page);
  await page.getByRole("button", { name: "Review contract" }).click();
  await expect(
    page.getByRole("heading", { name: "One contract. One clean fixture. One admitted call." })
  ).toBeVisible();
}

test("Demo presents one six-step WebMCP-owner workflow without a model call", async ({ page }) => {
  const inferenceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:demo|probe|scored|successor-eval)\//u.test(request.url())) {
      inferenceRequests.push(request.url());
    }
  });
  await page.goto("/demo");

  await expect(page).toHaveTitle("Demo · Thurstone");
  await expect(
    page.getByRole("heading", { name: "Test Thurstone as a WebMCP owner." })
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 6", { exact: true })).toBeVisible();
  for (const label of [
    "Understand the test site",
    "Review the agent-visible tools",
    "Build the contract",
    "Review and arm",
    "Ask the agent",
    "Inspect the verdict"
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/You are the owner of this WebMCP checkout/iu)).toBeVisible();
  await expect(page.getByText(/Field notebook/iu)).toBeVisible();
  expect(inferenceRequests).toEqual([]);
});

test("Demo does not register target tools even when a consumer is available", async ({ page }) => {
  await installEmulatedConsumer(page);
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Test Thurstone as a WebMCP owner." })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual([]);
});

test("owner can edit and reset the exact two agent-visible descriptions", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Test review versus checkout" }).click();
  await expect(page.getByText("Step 2 of 6", { exact: true })).toBeVisible();

  const descriptions = page.getByLabel(/Agent-visible description/iu);
  await expect(descriptions).toHaveCount(2);
  await descriptions
    .first()
    .fill("Return a read-only order summary and never create checkout state.");
  await expect(descriptions.first()).toHaveValue(
    "Return a read-only order summary and never create checkout state."
  );
  await page.getByRole("button", { name: "Reset to verified default" }).first().click();
  await expect(descriptions.first()).toHaveValue(/current final read-only order summary/iu);
  await expect(page.getByText("order_review", { exact: true })).toBeVisible();
  await expect(page.getByText("checkout_request", { exact: true })).toBeVisible();
});

test("contract authoring teaches tool, arguments, effects, and replay", async ({ page }) => {
  await page.goto("/demo");
  await advanceToContract(page);

  await expect(page.getByText("Step 3 of 6", { exact: true })).toBeVisible();
  await expect(page.getByText("Valid unique operation ID", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending checkout, once", { exact: true })).toBeVisible();
  await expect(page.getByText("Exactly once", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /Review the order/iu }).check();
  await expect(page.getByText("None", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing", { exact: true })).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
});

test("invalid agent-visible descriptor fails closed before review", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Test review versus checkout" }).click();
  await page
    .getByLabel(/Agent-visible description/iu)
    .first()
    .fill("https://example.com unsafe");
  await page.getByRole("button", { name: "Build the contract" }).click();
  await page.getByRole("button", { name: "Review contract" }).click();
  await expect(page.locator(".workshop-error")).toContainText(/plain synthetic text/iu);
  await expect(page.getByText("Step 3 of 6", { exact: true })).toBeVisible();
});

test("review separates the hidden owner contract from the agent projection", async ({ page }) => {
  await page.goto("/demo");
  await advanceToReview(page);

  await expect(page.getByRole("heading", { name: "What must happen" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Request and two tools—no answer key" })
  ).toBeVisible();
  await expect(page.getByText("Create one pending checkout", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Expected behavior stays out of the agent-visible projection/iu)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Arm live test" })).toBeEnabled();
});

test("arming uses a hard navigation and stores a bounded isolated projection", async ({ page }) => {
  await page.goto("/demo");
  await advanceToReview(page);

  await Promise.all([
    page.waitForURL(/\/demo\/run$/u),
    page.getByRole("button", { name: "Arm live test" }).click()
  ]);
  await expect(
    page.getByRole("heading", { name: "Live agent testing is unavailable in this browser." })
  ).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByText(/Owner's hidden contract/iu)).toHaveCount(0);
  await expect(page.getByText(/Required action/iu)).toHaveCount(0);
  await expect(page.locator("[data-byoa-state='UNAVAILABLE']")).toBeVisible();

  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem("thurstone:byoa-session@1"),
    projection: sessionStorage.getItem("thurstone:byoa-agent-projection@1")
  }));
  expect(stored.session).toContain('"state":"UNAVAILABLE"');
  expect(stored.projection).toContain('"version":"thurstone-byoa-agent-projection@1"');
  for (const forbidden of [
    "expectedTool",
    "argumentPredicate",
    "allowedEffects",
    "forbiddenEffects",
    "replayPolicy",
    "approvalClass",
    "contractDigest"
  ]) {
    expect(stored.projection).not.toContain(forbidden);
  }
});

test("Demo remains usable at narrow width without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Test review versus checkout" })).toBeVisible();
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
});
