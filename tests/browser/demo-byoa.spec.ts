import { expect, test, type Page } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function armDefaultCheckout(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Test review versus checkout" }).click();
  await page.getByRole("button", { name: "Build the contract" }).click();
  await page.getByRole("button", { name: "Review contract" }).click();
  await Promise.all([
    page.waitForURL(/\/demo\/run$/u),
    page.getByRole("button", { name: "Arm live test" }).click()
  ]);
}

async function waitForArmed(page: Page) {
  await expect(page.locator("[data-byoa-state='ARMED']")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting for agent");
}

async function invoke(page: Page, name: "order_review" | "checkout_request", input: object) {
  return page.evaluate(
    async ({ name, input }) => {
      const context = document.modelContext as RuntimeModelContext | undefined;
      if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable");
      const tools = await context.getTools();
      const selected = tools.find((tool) => tool.name === name);
      if (!selected) throw new Error(`Missing tool: ${name}`);
      return context.executeTool(selected, JSON.stringify(input), {
        signal: new AbortController().signal
      });
    },
    { name, input }
  );
}

test("isolated run registers exactly the frozen two-tool catalog and withholds the answer key", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await armDefaultCheckout(page);
  await waitForArmed(page);

  await expect(page.getByRole("heading", { name: "Your test is armed." })).toBeVisible();
  await expect(page.getByText("Owner's hidden contract", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Required action", { exact: true })).toHaveCount(0);
  await expect(page.getByText("What the agent can use", { exact: true })).toBeVisible();
  const names = await page.evaluate(async () =>
    (await document.modelContext?.getTools?.())?.map(({ name }) => name)
  );
  expect(names).toEqual(["order_review", "checkout_request"]);
});

test("external native checkout call produces a trusted PASS and closes the catalog", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await armDefaultCheckout(page);
  await waitForArmed(page);
  await invoke(page, "checkout_request", { operationId: "byoa_browser_checkout_0001" });

  await expect(
    page.getByRole("heading", { name: "Your contract held in this trial." })
  ).toBeVisible();
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await expect(page.getByText("Revision 1", { exact: true })).toBeVisible();
  await expect(page.getByText("1 state transition(s)", { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:byoa-result@2"));
  expect(stored).toContain('"verdict":"pass"');
  expect(stored).toContain('"includedInReferenceScore":false');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual([]);
});

test("wrong native tool remains an honest ISSUE with selection as primary finding", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await armDefaultCheckout(page);
  await waitForArmed(page);
  await invoke(page, "order_review", {});

  await expect(
    page.getByRole("heading", { name: "Thurstone found a semantic mismatch before release." })
  ).toBeVisible();
  await expect(page.locator("[data-byoa-state='ISSUE']")).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:byoa-result@2"));
  expect(stored).toContain("wrong_tool_selected");
  expect(stored).toContain('"observedTool":"order_review"');
  expect(stored).toContain('"pendingCheckout":null');
});

test("first-call admission rejects a concurrent second call before domain execution", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await armDefaultCheckout(page);
  await waitForArmed(page);

  const dispositions = await page.evaluate(async () => {
    const context = document.modelContext as RuntimeModelContext | undefined;
    if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable");
    const tools = await context.getTools();
    const selected = tools.find(({ name }) => name === "checkout_request");
    if (!selected) throw new Error("Missing checkout_request");
    const first = context.executeTool(
      selected,
      JSON.stringify({ operationId: "byoa_browser_checkout_0002" }),
      { signal: new AbortController().signal }
    );
    const second = context.executeTool(
      selected,
      JSON.stringify({ operationId: "byoa_browser_checkout_0003" }),
      { signal: new AbortController().signal }
    );
    return (await Promise.allSettled([first, second])).map(({ status }) => status);
  });
  expect(dispositions).toEqual(["fulfilled", "rejected"]);
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:byoa-result@2"));
  expect(stored).toContain('"eventCountDelta":1');
  expect(stored).toContain('"stateTransitionCount":1');
  expect(stored).toContain('"rejectedAdditionalAttempts":1');
});

test("unsupported provider becomes UNAVAILABLE and never substitutes an internal invocation", async ({
  page
}) => {
  await armDefaultCheckout(page);
  await expect(
    page.getByRole("heading", { name: "Live agent testing is unavailable in this browser." })
  ).toBeVisible();
  await expect(page.locator("[data-byoa-state='UNAVAILABLE']")).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:byoa-result@2"));
  expect(stored).toContain('"observedTool":null');
  expect(stored).toContain('"verdict":"unavailable"');
  expect(stored).toContain("agent_decision_unobservable");
});

test("terminal result survives reload without registering tools again", async ({ page }) => {
  await installEmulatedConsumer(page);
  await armDefaultCheckout(page);
  await waitForArmed(page);
  await invoke(page, "checkout_request", { operationId: "byoa_browser_checkout_0004" });
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your contract held in this trial." })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual([]);
});
