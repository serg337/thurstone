import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { installEmulatedConsumer } from "./support/emulated-consumer";
import {
  handoffUrlFromCommand,
  invokeFreshV2,
  openFreshV2,
  startFreshV2
} from "./support/demo-v2-flow";

async function addStarter(page: Page, toolName: string) {
  await page
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: new RegExp(toolName, "u") })
    .click();
  await page.getByRole("button", { name: "Add test case" }).click();
}

async function expectPassAndContinue(page: Page, nextPosition: number) {
  await expect(page.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await page.getByRole("button", { name: `Continue to step ${nextPosition}` }).click();
  await expect(
    page.getByText(new RegExp(`continuous journey ${nextPosition} of \\d+`, "iu"))
  ).toBeVisible();
}

async function startNextJourneyStep(page: Page, expectedToolCount = 4) {
  await page.getByRole("button", { name: "Continue to readiness" }).click();
  await page.getByRole("button", { name: "Start live observation" }).click();
  await expect(page.locator("[data-byoa-v2-state='ARMED']")).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0))
    .toBe(expectedToolCount);
}

test("continuous journey repeats tools in one agent page and carries trusted state across every call", async ({
  context,
  page: owner
}) => {
  await installEmulatedConsumer(owner);
  await owner.goto("/demo");
  await owner.getByRole("button", { name: "Choose the test catalog" }).click();
  for (const toolName of ["cart_get", "cart_update", "order_review", "checkout_request"]) {
    await owner.getByRole("button", { name: new RegExp(toolName, "u") }).click();
  }
  await owner
    .locator('[data-tool-name="checkout_request"]')
    .getByRole("checkbox", { name: "Process-ending" })
    .check();
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  for (const toolName of ["cart_get", "cart_update", "order_review", "checkout_request"]) {
    await addStarter(owner, toolName);
  }
  await owner
    .getByRole("region", { name: "cart_update test group" })
    .getByRole("button", { name: "+ Add requests" })
    .click();
  await owner.getByLabel("Request 1").fill("Remove the field notebook from my cart.");
  await owner.getByLabel(/^Item ID/iu).selectOption("field-notebook");
  await owner.getByLabel(/^Quantity/iu).fill("0");
  await owner.getByRole("button", { name: "Add test case" }).click();
  await owner.getByRole("radio", { name: /Continuous journey/u }).check();
  await expect(
    owner.getByRole("heading", { name: "Arrange the customer journey before arming it." })
  ).toBeVisible();
  const checkoutStep = owner.getByLabel(/checkout_request, Begin checkout/iu);
  await expect(
    owner.getByRole("button", { name: "Run continuous journey · 4 steps" })
  ).toBeEnabled();
  await checkoutStep.press("Alt+ArrowUp");
  await expect(owner.getByText("Fix the journey order before arming.")).toBeVisible();
  await expect(
    owner.getByRole("button", { name: "Run continuous journey · 4 steps" })
  ).toBeDisabled();
  await checkoutStep.press("Alt+ArrowDown");
  await expect(owner.getByText("Fix the journey order before arming.")).toHaveCount(0);
  const addRequestPicker = owner.getByLabel("Add another contract request");
  const repeatedUpdateCaseId = await addRequestPicker
    .locator("option")
    .filter({ hasText: "cart_update — Remove the field notebook" })
    .getAttribute("value");
  if (!repeatedUpdateCaseId) throw new Error("Repeated update case was not offered.");
  await addRequestPicker.selectOption(repeatedUpdateCaseId);
  await owner.getByRole("button", { name: "Add step" }).click();
  await expect(
    owner.getByRole("button", { name: "Run continuous journey · 5 steps" })
  ).toBeEnabled();
  await owner.getByRole("button", { name: "Run continuous journey · 5 steps" }).click();
  await expect(owner.getByRole("heading", { name: "Arm 5-step journey" })).toBeVisible();
  await owner.getByRole("button", { name: "Arm continuous journey" }).click();
  await owner.waitForURL(/\/demo\/run#handoff-source-v2$/u);
  const handoffCommand = await owner.getByLabel("Exact fresh-agent command").inputValue();
  expect(handoffCommand).toContain("Treat these as my exact requests, in order:");
  expect(handoffCommand).toContain("Remove the field notebook from my cart.");
  expect(handoffCommand).toContain("I authorize only the exact test-environment changes");
  expect(handoffCommand).not.toContain("expectedTool");
  expect(handoffCommand).not.toContain("allowedEffects");
  const handoffUrl = handoffUrlFromCommand(handoffCommand);
  const fresh = await openFreshV2(context, handoffUrl);

  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review", "checkout_request"]);
  await invokeFreshV2(fresh, "cart_get", {});
  await expectPassAndContinue(fresh, 2);

  await startNextJourneyStep(fresh);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "journey_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  });
  await expectPassAndContinue(fresh, 3);

  await startNextJourneyStep(fresh);
  await invokeFreshV2(fresh, "order_review", {});
  await expectPassAndContinue(fresh, 4);

  await startNextJourneyStep(fresh);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "journey_update_0002",
    operation: "set_quantity",
    itemId: "field-notebook",
    quantity: 0
  });
  await expectPassAndContinue(fresh, 5);

  await startNextJourneyStep(fresh);
  await invokeFreshV2(fresh, "checkout_request", {
    operationId: "journey_checkout_0001"
  });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect(
    fresh.getByText("Journey complete. 5 independently verified results were preserved.")
  ).toBeVisible();
  await expect(owner.getByRole("button", { name: "View journey results" })).toBeVisible({
    timeout: 10_000
  });
  await owner.getByRole("button", { name: "View journey results" }).click();
  await owner.waitForURL(/\/results\?journey=latest$/u);
  await expect(owner.getByRole("link", { name: "Latest Results" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(owner.getByRole("heading", { name: "5 of 5 tests passed." })).toBeVisible();
  await expect(
    owner.getByRole("table", { name: "Continuous journey Demo results" }).getByRole("row")
  ).toHaveCount(6);
  await expect(owner.getByText("Revision 3")).toBeVisible();
  await expect(owner.getByText("Stoneware mug × 3")).toBeVisible();
  await expect(owner.getByText("Checkout: pending human approval")).toBeVisible();
  await expect(owner.getByRole("link", { name: "Run another Demo test" })).toBeVisible();
  await expect(owner.getByRole("link", { name: "Edit Demo contract" })).toBeVisible();
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Download results" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(
    /^thurstone-continuous-[a-f0-9]{12}\.json$/u
  );
  const { violations } = await new AxeBuilder({ page: owner }).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id }) => id)
  ).toEqual([]);
  await owner.getByRole("button", { name: "Clear results" }).click();
  await expect(owner.getByRole("heading", { name: "5 of 5 tests passed." })).toHaveCount(0);
  await expect(owner.getByRole("link", { name: "Latest Results" })).toHaveCount(0);
});

test("an early argument issue stops the journey and becomes actionable in the owner tab", async ({
  context,
  page: owner
}) => {
  await installEmulatedConsumer(owner);
  await owner.goto("/demo");
  await owner.getByRole("button", { name: "Choose the test catalog" }).click();
  for (const toolName of ["cart_get", "cart_update", "order_review"]) {
    await owner.getByRole("button", { name: new RegExp(toolName, "u") }).click();
  }
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  for (const toolName of ["cart_get", "cart_update", "order_review"]) {
    await addStarter(owner, toolName);
  }
  await owner.getByRole("radio", { name: /Continuous journey/u }).check();
  await owner.getByRole("button", { name: "Run continuous journey · 3 steps" }).click();
  await owner.getByRole("button", { name: "Arm continuous journey" }).click();
  await owner.waitForURL(/\/demo\/run#handoff-source-v2$/u);
  const handoffUrl = handoffUrlFromCommand(
    await owner.getByLabel("Exact fresh-agent command").inputValue()
  );
  const fresh = await openFreshV2(context, handoffUrl);

  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review"]);
  await invokeFreshV2(fresh, "cart_get", {});
  await expectPassAndContinue(fresh, 2);
  await startNextJourneyStep(fresh, 3);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "journey_wrong_item_0001",
    operation: "set_quantity",
    itemId: "field-notebook",
    quantity: 0
  });
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();
  await expect(
    fresh.getByRole("heading", { name: "The request and contract arguments diverged" })
  ).toBeVisible();
  await expect(fresh.getByText("Set Stoneware mug quantity to 3")).toBeVisible();
  await expect(fresh.getByText(/Set Field notebook quantity to 0/iu)).toBeVisible();
  await expect(
    fresh.locator("details", { hasText: "View technical evidence and assertion details" })
  ).not.toHaveAttribute("open", "");

  await expect(
    owner.getByRole("heading", { name: "The request and contract arguments diverged" })
  ).toBeVisible({ timeout: 10_000 });
  await expect(owner.getByText("1 passed · 1 issue · 1 not run")).toBeVisible();
  await expect(owner.getByText("Set Stoneware mug quantity to 3")).toBeVisible();
  await expect(owner.getByText("Set Field notebook quantity to 0")).toBeVisible();
  await expect(owner.getByText("Removed Field notebook", { exact: true })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Reset journey and rerun" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page: owner }).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id }) => id)
  ).toEqual([]);
  await owner.getByRole("button", { name: "Edit this test" }).click();
  await expect(owner.getByRole("heading", { name: "Update the selected case" })).toBeVisible();
  await expect(owner.getByLabel(/^Item ID/iu)).toHaveValue("stoneware-mug");
});
