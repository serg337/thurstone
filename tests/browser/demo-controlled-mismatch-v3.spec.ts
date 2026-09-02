import { expect, test, type Page } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";
import { handoffUrlFromCommand } from "./support/demo-v2-flow";

async function prepareFreshCheckoutCase(owner: Page): Promise<string> {
  await owner.goto("/demo");
  await owner.getByRole("button", { name: "Choose the test catalog" }).click();
  await owner.getByRole("button", { name: /order_review/u }).click();
  await owner.getByRole("button", { name: /checkout_request/u }).click();
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  await owner
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: /checkout_request/u })
    .click();
  await owner.getByLabel("Test-case name").fill("Request checkout");
  await owner.getByLabel("Request 1").fill("I am ready—request checkout for this cart.");
  await owner.getByRole("button", { name: "Add test case" }).click();
  await owner.getByRole("button", { name: /Run contract/u }).click();
  await owner.getByRole("button", { name: "Arm live test" }).click();
  await owner.waitForURL(/\/demo\/run#handoff-source-v2$/u);
  return handoffUrlFromCommand(await owner.getByLabel("Exact fresh-agent command").inputValue());
}

async function invokeCheckout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const context = document.modelContext as RuntimeModelContext | undefined;
    if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable.");
    const selected = (await context.getTools()).find(({ name }) => name === "checkout_request");
    if (!selected) throw new Error("checkout_request was not registered.");
    await context.executeTool(
      selected,
      JSON.stringify({ operationId: "controlled_component_primary_checkout_0001" }),
      { signal: new AbortController().signal }
    );
  });
}

test("controlled mismatch uses one real JSON-string call and remains separate from the primary result", async ({
  context,
  page: owner
}) => {
  await installEmulatedConsumer(owner);
  const handoffUrl = await prepareFreshCheckoutCase(owner);

  const fresh = await context.newPage();
  await installEmulatedConsumer(fresh, "json-string");
  await fresh.goto(handoffUrl);
  await fresh.getByRole("button", { name: "Receive isolated test" }).click();
  await fresh.getByRole("button", { name: "Continue to readiness" }).click();
  await fresh.getByRole("button", { name: "Start live observation" }).click();
  await expect
    .poll(() =>
      fresh.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual(["order_review", "checkout_request"]);
  await invokeCheckout(fresh);
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  const primaryDigest = await fresh.evaluate(() => {
    const bytes = sessionStorage.getItem("thurstone:byoa-result@3");
    return bytes ? (JSON.parse(bytes) as { resultDigest: string }).resultDigest : null;
  });
  expect(primaryDigest).toMatch(/^[a-f0-9]{64}$/u);

  await expect(
    fresh.getByText("Controlled example — no model call", { exact: true })
  ).toBeVisible();
  await Promise.all([
    fresh.waitForURL(/\/demo\/controlled$/u),
    fresh.getByRole("link", { name: "Open controlled mismatch in a fresh document" }).click()
  ]);
  await expect(
    fresh.getByRole("heading", { name: "See how Thurstone catches a mismatch" })
  ).toBeVisible();
  await fresh.getByRole("button", { name: "Run controlled mismatch" }).click();
  const comparison = fresh.locator("[data-controlled-verdict='issue']");
  await expect(comparison).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "Without verification" })).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "With Thurstone" })).toBeVisible();
  await expect(comparison.getByText("order_review · completed", { exact: true })).toBeVisible();
  await expect(comparison.getByText(/failed contract assertions/iu)).toBeVisible();
  await expect(comparison.getByText("Investigation path", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Regression preservation", { exact: true })).toBeVisible();
  await expect(fresh.getByText(/Thurstone did not change the behavior/iu)).toBeVisible();

  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  expect(
    await fresh.evaluate(() => {
      const bytes = sessionStorage.getItem("thurstone:byoa-result@3");
      return bytes ? (JSON.parse(bytes) as { resultDigest: string }).resultDigest : null;
    })
  ).toBe(primaryDigest);

  await fresh.close();
});
