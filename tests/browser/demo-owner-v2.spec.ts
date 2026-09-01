import { expect, test } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";

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
    page.getByRole("heading", { name: "Choose the real WebMCP tools this test will expose." })
  ).toBeVisible();
}

async function goToSuite(page: import("@playwright/test").Page) {
  await goToCatalog(page);
  await page.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(
    page.getByRole("heading", { name: "Turn representative requests into repeatable tests." })
  ).toBeVisible();
}

async function addCase(
  page: import("@playwright/test").Page,
  input: { readonly name: string; readonly request: string; readonly tool: string }
) {
  await page.getByLabel("Test-case name").fill(input.name);
  await page.getByLabel("Representative user request").fill(input.request);
  await page.getByLabel("What should the agent do?").selectOption(input.tool);
  await page.getByRole("button", { name: "Add test case" }).click();
}

test("owner catalog exposes only selected real tools and registers none on the builder page", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await goToCatalog(page);
  await expect(page.getByText("2 real tools selected")).toBeVisible();
  await expect(page.getByText("2 discoverable tools")).toBeVisible();
  await expect(page.getByText("Fixture · 2 items · $73 · View details")).toBeVisible();

  await page.getByRole("button", { name: /Add cart_get/u }).click();
  await expect(page.getByText("3 real tools selected")).toBeVisible();
  await expect(page.getByText("3 discoverable tools")).toBeVisible();
  await expect(page.locator('[data-tool-name="cart_get"]')).toBeVisible();
  await expect(page.getByText(/checkout_cancel.*advanced/iu)).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        async () => (await document.modelContext?.getTools?.())?.map(({ name }) => name) ?? []
      )
    )
    .toEqual([]);
});

test("owner builds multiple visible cases and reviews exactly one answer-isolated live case", async ({
  page
}) => {
  await goToCatalog(page);
  await page.getByRole("button", { name: /Add cart_get/u }).click();
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
  await expect(page.getByText("2 cases", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read cart" })).toBeVisible();
  const checkoutArticle = page
    .getByRole("heading", { name: "Request checkout" })
    .locator("xpath=ancestor::article");
  await checkoutArticle.getByRole("radio", { name: "Select for live test" }).check();

  await page.getByRole("button", { name: "Review and arm selected case" }).click();
  const dialog = page.getByRole("dialog", { name: /Arm “Request checkout”/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Owner expects · hidden rubric")).toBeVisible();
  await expect(dialog.getByText("Agent receives · no answer key")).toBeVisible();
  await expect(dialog.getByText("I am ready—request checkout for this cart.")).toBeVisible();
  await expect(dialog.getByText("cart_get", { exact: true })).toBeVisible();
  await expect(dialog.getByText("checkout_request", { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Arm live test" })).toBeEnabled();
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
  await page.getByRole("radio", { name: "Select for live test" }).check();
  await page.getByRole("button", { name: "Review and arm selected case" }).click();
  await page.getByRole("button", { name: "Arm live test" }).click();
  await page.waitForURL(/\/demo\/run#handoff-source-v2$/u);

  const command = await page.getByLabel("Exact fresh-agent command").inputValue();
  const handoffUrl = command.replace(/^@Browser Open /u, "");
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
  await expect(
    fresh.getByRole("heading", { name: "Why Thurstone reached this verdict" })
  ).toBeVisible();
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
