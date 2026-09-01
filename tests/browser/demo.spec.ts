import { expect, test } from "@playwright/test";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function advanceToContract(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();
}

async function advanceToReview(page: import("@playwright/test").Page) {
  await advanceToContract(page);
  await page.getByLabel("Test-case name").fill("Request checkout");
  await page
    .getByLabel("Representative user request")
    .fill("I am ready—request checkout for this cart.");
  await page.getByLabel("What should the agent do?").selectOption("checkout_request");
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByRole("button", { name: "Review and arm selected case" }).click();
  await expect(page.getByRole("dialog", { name: /Arm “Request checkout”/u })).toBeVisible();
}

test("Demo presents one five-stage WebMCP-owner workflow without a model call", async ({
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
  await expect(
    page.getByRole("heading", { name: "Test Thurstone as a WebMCP owner." })
  ).toBeVisible();
  await expect(page.getByText("Stage 1 of 5", { exact: true })).toBeVisible();
  for (const label of [
    "Understand the semantic boundary",
    "Choose the real WebMCP test catalog",
    "Build the contract suite",
    "Send the selected case to a fresh agent",
    "Inspect, diagnose, and preserve"
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/website owner preparing a WebMCP release/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The meaning boundary Thurstone will test" })
  ).toBeVisible();
  await expect(page.getByText("order_review", { exact: true })).toBeVisible();
  await expect(page.getByText("checkout_request", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/known starting state lets Thurstone prove exactly what changed/iu)
  ).toBeVisible();
  await expect(
    page.getByText(/deliberate minimum isolates one consequential meaning boundary/iu)
  ).toBeVisible();
  await expect(page.getByText(/Field notebook/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Open Thurstone in ChatGPT's Browser" })
  ).toBeVisible();
  await expect(
    page.getByText("@Browser Open https://thurstone.invarra.ai/demo", { exact: true })
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await expect(page.getByText("Stage 2 of 5", { exact: true })).toBeVisible();

  const descriptions = page.getByLabel(/Agent-visible description/iu);
  await expect(descriptions).toHaveCount(2);
  await descriptions
    .first()
    .fill("Return a read-only order summary and never create checkout state.");
  await expect(descriptions.first()).toHaveValue(
    "Return a read-only order summary and never create checkout state."
  );
  const reviewRow = page.locator('[data-tool-name="order_review"]');
  await reviewRow.getByRole("button", { name: "Apply agent wording" }).click();
  await reviewRow.getByRole("button", { name: "Reset to verified default" }).click();
  await expect(descriptions.first()).toHaveValue(/current final read-only order summary/iu);
  await expect(page.getByText("order_review", { exact: true })).toHaveCount(2);
  await expect(page.getByText("checkout_request", { exact: true })).toHaveCount(2);
});

test("contract authoring teaches tool, arguments, effects, and replay", async ({ page }) => {
  await page.goto("/demo");
  await advanceToContract(page);

  await expect(page.getByText("Stage 3 of 5", { exact: true })).toBeVisible();
  await page.getByLabel("Test-case name").fill("Checkout authorization");
  await page
    .getByLabel("Representative user request")
    .fill("I am ready—request checkout for this cart.");
  await page.getByLabel("What should the agent do?").selectOption("checkout_request");
  await expect(page.getByText(/One operation ID that is valid and unique/iu)).toBeVisible();
  await expect(page.getByText("pending checkout", { exact: true })).toBeVisible();
  await expect(page.getByText(/Exactly-once policy/iu)).toBeVisible();
  await page.getByRole("button", { name: "Add test case" }).click();
  await expect(page.getByRole("heading", { name: "Checkout authorization" })).toBeVisible();
});

test("invalid agent-visible descriptor fails closed before review", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await page
    .getByLabel(/Agent-visible description/iu)
    .first()
    .fill("https://example.com unsafe");
  await page.getByRole("button", { name: "Apply agent wording" }).first().click();
  await expect(page.getByText(/plain synthetic text/iu)).toBeVisible();
  await expect(page.getByText("Stage 2 of 5", { exact: true })).toBeVisible();
});

test("review separates the hidden owner contract from the agent projection", async ({ page }) => {
  await page.goto("/demo");
  await advanceToReview(page);

  await expect(page.getByText("Owner expects · hidden rubric")).toBeVisible();
  await expect(page.getByText("Agent receives · no answer key")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request plus the exact catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arm live test" })).toBeEnabled();
});

test("arming uses a hard navigation and stores a bounded isolated projection", async ({ page }) => {
  await page.goto("/demo");
  await advanceToReview(page);

  await Promise.all([
    page.waitForURL(/\/demo\/run#handoff-source-v2$/u),
    page.getByRole("button", { name: "Arm live test" }).click()
  ]);
  await expect(page.locator("[data-byoa-v2-state='HANDOFF_SOURCE']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy @Browser command" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run in this tab/iu })).toHaveCount(0);
  await expect(page.getByText(/Owner expects|Expected action|Allowed effects/iu)).toHaveCount(0);

  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem("thurstone:byoa-session@2"),
    projection: sessionStorage.getItem("thurstone:byoa-agent-projection@2")
  }));
  expect(stored.session).toContain('"state":"HANDOFF_ISSUED"');
  expect(stored.projection).toContain('"version":"thurstone-byoa-agent-projection@2"');
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
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Choose the test catalog" })).toBeVisible();
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
});
