import { expect, test } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";
import {
  handoffUrlFromCommand,
  invokeFreshV2,
  openFreshV2,
  startFreshV2
} from "./support/demo-v2-flow";

async function openOwner(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "You are the website owner preparing a WebMCP release." })
  ).toBeVisible();
}

async function goToCatalog(page: import("@playwright/test").Page) {
  await openOwner(page);
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose the tools you want Thurstone to test." })
  ).toBeVisible();
}

async function goToSuite(page: import("@playwright/test").Page) {
  await goToCatalog(page);
  await page.getByRole("button", { name: /order_review/u }).click();
  await page.getByRole("button", { name: /checkout_request/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(
    page.getByRole("heading", { name: "Turn representative requests into repeatable tests." })
  ).toBeVisible();
}

async function addCase(
  page: import("@playwright/test").Page,
  input: { readonly name: string; readonly request: string; readonly tool: string }
) {
  const starter = page
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: new RegExp(input.tool, "u") });
  if ((await starter.count()) > 0) await starter.click();
  else {
    await page
      .getByRole("region", { name: `${input.tool} test group` })
      .getByRole("button", { name: "+ Add requests" })
      .click();
  }
  await page.getByLabel("Test-case name").fill(input.name);
  await page.getByLabel("Request 1").fill(input.request);
  await page.getByRole("button", { name: "Add test case" }).click();
}

test("owner catalog exposes only selected real tools and registers none on the builder page", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await goToCatalog(page);
  await expect(page.getByText("No tools selected yet.")).toBeVisible();
  await expect(page.getByText("Fictional cart · 2 items · $73 · View details")).toHaveCount(0);

  await page.getByRole("button", { name: /cart_get/u }).click();
  await expect(
    page
      .getByRole("group", { name: "Available WebMCP tools" })
      .getByRole("button", { name: /cart_get/u })
  ).toHaveCount(0);
  await expect(page.locator('[data-tool-name="cart_get"]')).toBeVisible();
  await expect(page.getByText(/checkout_cancel.*advanced/iu)).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        async () => (await document.modelContext?.getTools?.())?.map(({ name }) => name) ?? []
      )
    )
    .toEqual([]);
});

test("owner can select one real tool or return to an empty draft", async ({ page }) => {
  await goToCatalog(page);
  const reviewChoice = page.getByRole("button", { name: /order_review/u });
  await reviewChoice.click();
  await expect(
    page
      .getByRole("group", { name: "Available WebMCP tools" })
      .getByRole("button", { name: /order_review/u })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build the contract suite" })).toBeEnabled();
  await page
    .locator('[data-tool-name="order_review"]')
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Available WebMCP tools" })
      .getByRole("button", { name: /order_review/u })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Build the contract suite" })).toBeDisabled();
});

test("selecting several Stage 2 tools never moves the owner down to an editor", async ({
  page
}) => {
  await goToCatalog(page);
  const picker = page.getByRole("region", { name: "Choose reference WebMCP tools" });
  await picker.scrollIntoViewIfNeeded();
  for (const toolName of ["cart_get", "cart_update", "order_review", "checkout_request"]) {
    const choice = page
      .getByRole("group", { name: "Available WebMCP tools" })
      .getByRole("button", { name: new RegExp(toolName, "u") });
    await choice.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await choice.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(before);
  }
  await expect(page.getByText("All available tools selected.")).toBeVisible();
});

test("Stage 2 defaults tools to Standard and persists explicit process-ending metadata", async ({
  page
}) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /checkout_request/u }).click();
  const checkout = page.locator('[data-tool-name="checkout_request"]');
  const processEnding = checkout.getByRole("checkbox", { name: "Process-ending" });
  await expect(processEnding).not.toBeChecked();
  await processEnding.check();
  await expect(processEnding).toBeChecked();
  await page.getByRole("button", { name: "Open stage 1", exact: true }).click();
  await page.getByRole("button", { name: "Open stage 2", exact: true }).click();
  await expect(processEnding).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Open stage 2", exact: true }).click();
  await expect(processEnding).toBeChecked();
});

test("stage navigation preserves work and unlocks only valid destinations", async ({ page }) => {
  await openOwner(page);
  await expect(page.getByRole("button", { name: "Open stage 1", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Open stage 2", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stage 3 locked", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Open stage 2", exact: true }).click();
  const reviewChoice = page.getByRole("button", { name: /order_review/u });
  await reviewChoice.click();
  await expect(page.getByRole("button", { name: "Open stage 3", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open stage 1", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Two shopper prompts. Two intended outcomes." })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open stage 2", exact: true }).click();
  await expect(page.locator('[data-tool-name="order_review"]')).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Available WebMCP tools" })
      .getByRole("button", { name: /order_review/u })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open stage 3", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Turn representative requests into repeatable tests." })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stage 4 locked", exact: true })).toBeDisabled();
});

test("Stage 3 offers only the curated starters selected in Stage 2", async ({ page }) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /cart_get/u }).click();
  await page.getByRole("button", { name: /checkout_request/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();

  const starters = page.getByRole("region", { name: "Start with a curated Demo case." });
  await expect(starters.getByRole("button")).toHaveCount(2);
  await expect(starters.getByRole("button", { name: /order_review/u })).toHaveCount(0);
  await starters.getByRole("button", { name: /checkout_request/u }).click();
  await expect(page.getByLabel("Test-case name")).toHaveValue("Begin checkout");
  await expect(page.getByLabel("Request 1")).toHaveValue(
    "I am ready—request checkout for this cart."
  );
  await expect(page.getByLabel("Contract rules derived from this tool")).toContainText(
    "checkout_request"
  );
  await expect(page.getByText(/Generated automatically at runtime/iu)).toBeVisible();
  await expect(page.getByText("Operation ID", { exact: true })).toHaveCount(0);
});

test("schema-generated cart_update arguments support quantity-zero removal per request", async ({
  page
}) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /cart_update/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();
  const quantity = page.getByLabel(/^Quantity/iu).first();
  await expect(quantity).toHaveAttribute("min", "0");
  await page.getByRole("button", { name: /Add request/u }).click();
  await page.getByLabel("Request 2").fill("Remove the field notebook from my cart.");
  await page
    .getByLabel(/^Quantity/iu)
    .nth(1)
    .fill("0");
  await page.getByRole("button", { name: "Add test case" }).click();
  await expect(page.getByText(/This request mentions Field notebook/iu)).toContainText(
    "This request mentions Field notebook, but its expected Item ID is Stoneware mug."
  );
  await page
    .getByLabel(/^Item ID/iu)
    .nth(1)
    .selectOption("field-notebook");
  await page.getByRole("button", { name: "Add test case" }).click();
  const group = page.getByRole("region", { name: "cart_update test group" });
  await expect(group.getByText(/Set field-notebook to 0/iu)).toBeVisible();
});

test("Stage 3 auto-saves an unfinished draft, resets it, and keeps the editor above the contract", async ({
  page
}) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /checkout_request/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();

  await expect(page.getByLabel("Test-case name")).toHaveValue("Begin checkout");
  await page.getByLabel("Test-case name").fill("My checkout boundary");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open stage 2", exact: true }).click();
  await page.getByRole("button", { name: "Open stage 3", exact: true }).click();
  await expect(page.getByLabel("Test-case name")).toHaveValue("My checkout boundary");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Test-case name")).toHaveValue("Begin checkout");

  const verticalOrder = await page.evaluate(() => {
    const editor = document
      .querySelector("[aria-label='Contract rules derived from this tool']")
      ?.closest("form")
      ?.getBoundingClientRect();
    const contract = document
      .querySelector("#contract-suite-cases-title")
      ?.closest("section")
      ?.getBoundingClientRect();
    return { editorTop: editor?.top, contractTop: contract?.top };
  });
  expect(verticalOrder.editorTop).toBeLessThan(verticalOrder.contractTop ?? 0);
});

test("one expected action can group multiple independent request cases", async ({ page }) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /checkout_request/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();

  await page.getByRole("button", { name: /Add request/u }).click();
  await page.getByLabel("Request 2").fill("Proceed to checkout.");
  await page.getByRole("button", { name: /Add request/u }).click();
  await page.getByLabel("Request 3").fill("Start checkout for this cart.");
  await page.getByRole("button", { name: "Add test case" }).click();

  const group = page.getByRole("region", { name: "checkout_request test group" });
  await expect(group.getByText("3 request cases")).toBeVisible();
  await expect(group.getByRole("article")).toHaveCount(3);
  await expect(
    page.getByText("All selected tools are represented in this contract.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add test case" })).toHaveCount(0);
  await group.getByRole("button", { name: "+ Add requests" }).click();
  await expect(page.getByRole("button", { name: "Add test case" })).toBeVisible();
});

test("owner builds multiple visible cases and reviews the answer-isolated suite plan", async ({
  page
}) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /cart_get/u }).click();
  await page.getByRole("button", { name: /checkout_request/u }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();

  await addCase(page, {
    name: "Read cart",
    request: "What is in my cart?",
    tool: "cart_get"
  });
  await addCase(page, {
    name: "Request checkout",
    request: "I am ready—request checkout for this cart.",
    tool: "checkout_request"
  });
  await expect(page.getByText("2 cases", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Read cart" })).toBeVisible();

  await page.getByRole("button", { name: "Run contract · 2 requests" }).click();
  const dialog = page.getByRole("dialog", { name: "Arm 2-request suite" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Run order" })).toBeVisible();
  await expect(dialog.getByText("What is in my cart?")).toHaveCount(1);
  await expect(dialog.getByText("cart_get", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("checkout_request", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("Withheld until verification")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Arm regression suite" })).toBeEnabled();
  await page.getByRole("button", { name: "Close review" }).click();
});

test("same-tab refresh restores the suite while a concurrently cloned tab fails closed", async ({
  context,
  page
}) => {
  await goToSuite(page);
  await addCase(page, {
    name: "Review order",
    request: "Show me the complete order.",
    tool: "order_review"
  });
  await page.reload();
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await page.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(page.getByRole("heading", { name: "Review order" })).toBeVisible();

  const clonePromise = context.waitForEvent("page");
  await page.evaluate(() => window.open("/demo", "_blank"));
  const clone = await clonePromise;
  await expect(
    clone.getByRole("heading", { name: "The contract workspace stopped safely." })
  ).toBeVisible();
  await expect(clone.getByText(/already open in another live tab/iu)).toBeVisible();
  await clone.close();
});

test("catalog and suite stages reflow at 320px without page-level overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await goToCatalog(page);
  for (const stage of ["catalog", "suite"] as const) {
    if (stage === "suite") {
      await page.getByRole("button", { name: /order_review/u }).click();
      await page.getByRole("button", { name: "Build the contract suite" }).click();
    }
    const width = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
  }
});

test("fresh v2 handoff registers nothing before explicit start, then exposes exactly the frozen catalog", async ({
  context,
  page
}) => {
  await installEmulatedConsumer(page);
  await goToSuite(page);
  await addCase(page, {
    name: "Request checkout",
    request: "I am ready—request checkout for this cart.",
    tool: "checkout_request"
  });
  await page.getByRole("button", { name: /Run contract/u }).click();
  await page.getByRole("button", { name: "Arm live test" }).click();
  await page.waitForURL(/\/demo\/run#handoff-source-v2$/u);

  const command = await page.getByLabel("Exact fresh-agent command").inputValue();
  expect(command).toMatch(/^@Browser Open https?:\/\/[^\s]+\/demo\/handoff#[^\s]+\n/u);
  expect(command).toContain("Treat this as my exact request:");
  expect(command).toContain("I authorize only the exact test-environment changes");
  expect(command).toContain("Do not act on production data or external systems.");
  expect(command).toContain("continue in this same Browser-enabled chat");
  expect(command).not.toContain("sub-agent");
  await expect(page.getByRole("radio", { name: /sub-agent/u })).toHaveCount(0);
  const handoffUrl = handoffUrlFromCommand(command);
  await expect(page.getByRole("button", { name: /Run in this tab/iu })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0))
    .toBe(0);

  const contaminatedPromise = context.waitForEvent("page");
  await page.evaluate((url) => window.open(url, "_blank"), handoffUrl);
  const contaminated = await contaminatedPromise;
  await expect(contaminated.getByText(/contains owner-side suite data/iu)).toBeVisible();
  await contaminated.close();

  const ordinary = await context.newPage();
  let ordinaryOpenRequests = 0;
  ordinary.on("request", (request) => {
    if (request.url().endsWith("/api/demo/handoff/open")) ordinaryOpenRequests += 1;
  });
  await ordinary.goto(handoffUrl);
  await expect(
    ordinary.getByRole("heading", { name: "Receive this test in ChatGPT's Browser." })
  ).toBeVisible();
  await expect(ordinary.getByText(/Do not receive this link in ordinary Chrome/iu)).toBeVisible();
  await ordinary.waitForTimeout(100);
  expect(ordinaryOpenRequests).toBe(0);
  await ordinary.close();

  const fresh = await context.newPage();
  await installEmulatedConsumer(fresh);
  await fresh.goto(handoffUrl);
  await fresh.getByRole("button", { name: "Receive isolated test" }).click();
  await fresh.waitForURL(/\/demo\/run$/u);
  await expect(
    fresh.getByRole("heading", { name: "Review what this agent receives." })
  ).toBeVisible();
  await expect(
    fresh.getByText(/owner answer key|required action|expected tool|allowed effects/iu)
  ).toHaveCount(0);
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);

  const earlyRevealStatus = await fresh.evaluate(async () => {
    const remoteBytes = sessionStorage.getItem("thurstone:byoa-remote-session@2");
    const contextBytes = sessionStorage.getItem("thurstone:byoa-fresh-context@2");
    if (!remoteBytes || !contextBytes) throw new Error("Fresh handoff bindings are missing.");
    const remote = JSON.parse(remoteBytes) as { runId: string; contractDigest: string };
    const contextBinding = JSON.parse(contextBytes) as { freshContextId: string };
    const response = await fetch("/api/demo/handoff/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff",
        "X-Thurstone-Fresh-Context": contextBinding.freshContextId
      },
      body: JSON.stringify({
        version: "thurstone-byoa-handoff-reveal@2",
        runId: remote.runId,
        contractDigest: remote.contractDigest
      })
    });
    return response.status;
  });
  expect(earlyRevealStatus).toBe(404);

  const secondFresh = await context.newPage();
  await installEmulatedConsumer(secondFresh);
  await secondFresh.goto(handoffUrl);
  await secondFresh.getByRole("button", { name: "Receive isolated test" }).click();
  await expect(
    secondFresh.getByRole("heading", { name: "Open a genuinely fresh handoff." })
  ).toBeVisible();
  await expect(secondFresh.getByText(/already claimed by another browser context/iu)).toBeVisible();
  await expect(secondFresh.getByLabel("Handoff claim failure receipt")).toContainText(
    "already claimed"
  );
  await expect(secondFresh.getByLabel("Handoff claim failure receipt")).toContainText(
    "No request, tools, or invocation"
  );
  await expect
    .poll(() =>
      secondFresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await secondFresh.close();

  await fresh.getByRole("button", { name: "Continue to readiness" }).click();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.getByRole("button", { name: "Start live observation" }).click();
  await expect
    .poll(() =>
      fresh.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual(["order_review", "checkout_request"]);

  await fresh.evaluate(async () => {
    const context = document.modelContext as RuntimeModelContext | undefined;
    if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable.");
    const tools = await context.getTools();
    const selected = tools?.find(({ name }) => name === "checkout_request");
    if (!selected) throw new Error("checkout_request was not registered.");
    await context.executeTool(
      selected,
      JSON.stringify({ operationId: "browser_v2_checkout_0001" }),
      { signal: new AbortController().signal }
    );
  });
  await expect(
    fresh.getByRole("heading", { name: "Your selected contract case held." })
  ).toBeVisible();
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect(
    fresh.getByRole("heading", { name: "Request → contract → observed reality" })
  ).toBeVisible();
  await expect(fresh.getByText("View technical evidence and assertion details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish contract run" })).toBeVisible({
    timeout: 10_000
  });
  await page.getByRole("button", { name: "Finish contract run" }).click();
  await page.waitForURL(/\/demo$/u);
  await expect(page.getByText("Contract run complete", { exact: true })).toBeVisible();
  await expect(page.getByText("1 independent request result preserved.")).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Save as regression" })).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Export Result v3 JSON" })).toBeVisible();
  await fresh.reload();
  await expect(
    fresh.getByRole("heading", { name: "Your selected contract case held." })
  ).toBeVisible();
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.getByRole("button", { name: "Save as regression" }).click();
  await expect(fresh.getByRole("button", { name: "Saved as regression" })).toBeVisible();
  await fresh.goto("/results");
  await expect(
    fresh.getByRole("heading", { name: "Fresh-agent results and regression cases." })
  ).toBeVisible();
  await expect(fresh.getByText("1 saved v3 case")).toBeVisible();
  await expect(fresh.getByRole("heading", { name: "Request checkout" }).first()).toBeVisible();
  await fresh.close();
});

test("regression suite runs every case in one agent chat and continues after an issue", async ({
  context,
  page: owner
}) => {
  test.setTimeout(120_000);
  await goToCatalog(owner);
  await owner.getByRole("button", { name: /cart_get/u }).click();
  await owner.getByRole("button", { name: /cart_update/u }).click();
  await owner.getByRole("button", { name: /order_review/u }).click();
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  await owner
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: /cart_update/u })
    .click();
  await owner.getByRole("button", { name: "Add test case" }).click();
  await owner
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: /order_review/u })
    .click();
  await owner.getByRole("button", { name: "Add test case" }).click();
  await owner
    .getByRole("region", { name: "order_review test group" })
    .getByRole("button", { name: "+ Add requests" })
    .click();
  await owner.getByLabel("Request 1").fill("Review this order for me.");
  await owner.getByRole("button", { name: "Add test case" }).click();

  await owner.getByRole("button", { name: "Run contract · 3 requests" }).click();
  await expect(owner.getByRole("heading", { name: "Arm 3-request suite" })).toBeVisible();
  await owner.getByRole("button", { name: "Arm regression suite" }).click();
  await owner.waitForURL(/\/demo\/run#handoff-source-v2$/u);
  const command = await owner.getByLabel("Exact fresh-agent command").inputValue();
  expect(command).toContain(
    "Continue through every queued request even when a case reports an issue."
  );
  const fresh = await openFreshV2(context, handoffUrlFromCommand(command));

  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review"]);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "regression_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await fresh.getByRole("button", { name: "Continue to case 2" }).click();
  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review"]);

  await invokeFreshV2(fresh, "cart_get", {});
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();
  await fresh.getByRole("button", { name: "Continue to case 3" }).click();
  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review"]);

  await invokeFreshV2(fresh, "order_review", {});
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect(
    fresh.getByText(/Regression suite complete\. 3 independently verified results/iu)
  ).toBeVisible();
  await expect(owner.getByRole("button", { name: "View regression results" })).toBeVisible({
    timeout: 10_000
  });
  await owner.getByRole("button", { name: "View regression results" }).click();
  await owner.waitForURL(/\/results\?journey=latest$/u);
  await expect(
    owner.getByRole("heading", { name: "2 passed, 1 issue, and 0 not run." })
  ).toBeVisible();
  await expect(owner.getByText("Issue", { exact: true })).toBeVisible();
  await expect(owner.getByText("Revision 0", { exact: true })).toBeVisible();
  await expect(owner.getByText("Stoneware mug × 2")).toBeVisible();
  await expect(
    owner.getByRole("table", { name: "Regression suite Demo results" }).getByRole("row")
  ).toHaveCount(4);
  await fresh.close();
});
