import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  handoffUrlFromCommand,
  invokeFreshV2,
  openFreshV2,
  startFreshV2
} from "./support/demo-v2-flow";
import { installEmulatedConsumer } from "./support/emulated-consumer";

const toolNames = ["cart_get", "cart_update", "order_review", "checkout_request"] as const;

async function armJudgeQuickStart(owner: Page, context: BrowserContext): Promise<Page> {
  await owner.goto("/judge");
  await owner.getByRole("button", { name: "Arm Judge Quick Start" }).click();
  await expect(owner.getByText("Armed. Three clean cases. 0 of 3 results received.")).toBeVisible();
  const command = await owner
    .locator("details")
    .filter({ hasText: "Preview the exact command" })
    .locator("pre")
    .textContent();
  expect(command).toMatch(
    /^@Browser Open https?:\/\/[^\s]+\/demo\/handoff#ths2_[A-Za-z0-9_-]{24}\n/u
  );
  expect(command).toContain("1. Set the Stoneware mug quantity to 3.");
  expect(command).toContain("2. Set the Field notebook quantity to 2.");
  expect(command).toContain("3. Show me my current order.");
  return openFreshV2(context, handoffUrlFromCommand(command!));
}

async function continueToCase(fresh: Page, number: 2 | 3): Promise<void> {
  await fresh.getByRole("button", { name: `Continue to case ${number}` }).click();
  await expect(
    fresh.getByText(
      number === 2 ? "Set the Field notebook quantity to 2." : "Show me my current order."
    )
  ).toBeVisible();
  await startFreshV2(fresh, toolNames);
}

test("homepage exposes a styled three-case quick start with no authoring", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Judges: start here" }).click();
  await expect(page).toHaveURL(/\/judge$/u);
  await expect(
    page.getByRole("heading", { name: "Three tests. Both sides of the WebMCP contract." })
  ).toBeVisible();
  await expect(page.getByText("Test 1 · Live agent baseline")).toBeVisible();
  await expect(page.getByText("Test 2 · Controlled planted site fault")).toBeVisible();
  await expect(page.getByText("Test 3 · Live agent semantic stress test")).toBeVisible();
  await expect(page.getByRole("button", { name: "Arm Judge Quick Start" })).toBeVisible();
  await expect(page.getByText(/Type @ and select Browser/iu)).toHaveCount(0);
  await expect(page.getByText(/JSON/iu)).toHaveCount(0);
});

test("three isolated cases become full Judge Results with an authentic collision issue", async ({
  context,
  page: owner
}) => {
  await installEmulatedConsumer(owner);
  const fresh = await armJudgeQuickStart(owner, context);
  await expect
    .poll(() =>
      owner.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await expect(
    fresh.getByText(/expected tool|expected arguments|expected site effect/iu)
  ).toHaveCount(0);

  await startFreshV2(fresh, toolNames);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "judge_baseline_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await continueToCase(fresh, 2);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "judge_planted_update_0001",
    operation: "set_quantity",
    itemId: "field-notebook",
    quantity: 2
  });
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();
  await continueToCase(fresh, 3);
  await invokeFreshV2(fresh, "cart_get", {});
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();

  await owner.waitForURL(/\/results\?judge=latest$/u);
  await expect(
    owner.getByRole("heading", { name: "Results from your three preloaded tests." })
  ).toBeVisible();
  await expect(
    owner.getByRole("heading", { name: "1 passed, 2 issues, and 0 not run." })
  ).toBeVisible();
  const results = owner.getByRole("table", { name: "Judge Quick Start results" });
  await expect(results.getByText("Live baseline", { exact: true })).toBeVisible();
  await expect(results.getByText("Planted site fault", { exact: true })).toBeVisible();
  await expect(results.getByText("Semantic collision", { exact: true })).toBeVisible();
  await expect(results.getByText(/The agent did everything right/iu)).toBeVisible();
  const collision = owner.locator("tr[data-test-variant='semantic-collision']");
  await expect(collision.getByText("order_review", { exact: true })).toBeVisible();
  await expect(collision.getByText("cart_get", { exact: true })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Download results" })).toBeVisible();
  await fresh.close();
});
