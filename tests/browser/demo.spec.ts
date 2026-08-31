import { expect, test } from "@playwright/test";

import { installEmulatedConsumer } from "./support/emulated-consumer";

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
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("thurstone:demo-result@1")))
    .toContain('"source":"verified_replay"');
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
  await expect(
    page.getByRole("heading", { name: "Write the behavior your site intends to permit." })
  ).toBeVisible();

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

test("Contract Workshop validates provider-free and keeps native execution honestly unavailable", async ({
  page
}) => {
  await page.goto("/demo#contract-workshop");
  await expect(page.getByText("Native run unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate contract", exact: true }).click();
  await expect(page.getByRole("article", { name: /^Pass:/u })).toContainText("Contract validation");
  await expect(page.getByRole("button", { name: "Run native invocation" })).toBeDisabled();
  await expect(page.locator(".live-agent-disabled")).toContainText("Live agent test unavailable");
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:demo-result@1"));
  expect(stored).toContain('"source":"contract_validation"');
});

test("JSON-string Contract Workshop runs a real read-only native invocation", async ({ page }) => {
  await installEmulatedConsumer(page, "json-string");
  await page.goto("/demo#contract-workshop");
  await expect(page.getByText("Native WebMCP ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate contract", exact: true }).click();
  const native = page.getByRole("button", { name: "Run native invocation" });
  await expect(native).toBeEnabled();
  await native.click();
  const result = page.getByRole("article", { name: /^Pass:/u });
  await expect(result).toContainText("Live native invocation");
  await expect(page.getByLabel("Workshop trusted state result")).toContainText("Revision 0");
  await expect(page.getByLabel("Workshop trusted state result")).toContainText("1 event(s)");
});

test("JSON-string Contract Workshop proves one cart transition plus replay no-op", async ({
  page
}) => {
  await installEmulatedConsumer(page, "json-string");
  await page.goto("/demo#contract-workshop");
  await expect(page.getByText("Native WebMCP ready", { exact: true })).toBeVisible();
  await page.getByLabel("Expected tool").selectOption("cart_update");
  await page.getByLabel("User request").fill("Set the stoneware mug quantity to four.");
  await page.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("4");
  await page.getByRole("button", { name: "Validate contract", exact: true }).click();
  await page.getByRole("button", { name: "Run native invocation" }).click();
  const state = page.getByLabel("Workshop trusted state result");
  await expect(state).toContainText("Revision 1");
  await expect(state).toContainText("2 event(s)");
  await expect(state).toContainText("replay observed");
  await expect(page.getByRole("article", { name: /^Pass:/u })).toContainText(
    "Replay produced no second state transition"
  );
});

test("Contract Workshop rejects incoherent effect and replay declarations", async ({ page }) => {
  await page.goto("/demo#contract-workshop");
  await page.getByLabel("Expected tool").selectOption("cart_update");
  await page.getByLabel("Replay policy").selectOption("read_only");
  await page.getByRole("button", { name: "Validate contract", exact: true }).click();
  await expect(page.locator(".workshop-error")).toContainText(/exactly_once replay/iu);
  await expect(page.getByText("Ready for an honestly labeled test.")).toHaveCount(0);
});

test("Contract Workshop exports only the current synthetic tab result and clears it on reset", async ({
  page
}) => {
  await page.goto("/demo#contract-workshop");
  await page.getByLabel("Test name").fill("Judge-authored review contract");
  await page.getByRole("button", { name: "Validate contract", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my result JSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(parsed).toMatchObject({
    version: "thurstone-demo-result@1",
    source: "contract_validation",
    verdict: "pass"
  });
  expect(text).not.toMatch(/api[_-]?key|cookie|browser history|authorization/iu);

  await page.getByRole("button", { name: "Reset workshop fixture" }).click();
  await expect(page.getByText("Your validated contract will appear here.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("thurstone:demo-result@1")))
    .toBeNull();
});
