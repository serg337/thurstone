import { expect, test } from "@playwright/test";

import {
  handoffUrlFromCommand,
  invokeFreshV2,
  openFreshV2,
  startFreshV2
} from "./support/demo-v2-flow";
import { installEmulatedConsumer } from "./support/emulated-consumer";

test("homepage exposes the judge quick start and the cold page needs no authoring", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Judges: start here" })).toHaveAttribute(
    "href",
    "/judge"
  );
  await page.getByRole("link", { name: "Judges: start here" }).click();
  await expect(page).toHaveURL(/\/judge$/u);
  await expect(
    page.getByRole("heading", { name: "See one real WebMCP contract reach a verdict." })
  ).toBeVisible();
  await expect(page.getByText("Set the Stoneware mug quantity to 3.")).toBeVisible();
  await expect(page.getByText("Stoneware mug · quantity 3 · unique operation ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Arm quick test" })).toBeVisible();
  await expect(page.getByText(/JSON/iu)).toHaveCount(0);
});

test("the owner quick-start page registers no target tools", async ({ page }) => {
  await installEmulatedConsumer(page);
  await page.goto("/judge");
  await page.getByRole("button", { name: "Arm quick test" }).click();
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0))
    .toBe(0);
  await page.getByRole("button", { name: "Reset quick test" }).click();
  await expect(page.getByRole("button", { name: "Arm quick test" })).toBeVisible();
});

test("one arm action reaches a live visual verdict while the fresh agent stays answer-isolated", async ({
  context,
  page: owner
}) => {
  await owner.goto("/judge");
  await owner.getByRole("button", { name: "Arm quick test" }).click();
  await expect(
    owner.getByText("Armed. Clean revision 0. Awaiting one agent action.")
  ).toBeVisible();
  const command = await owner
    .locator("details")
    .filter({ hasText: "Preview the exact command" })
    .locator("pre")
    .textContent();
  expect(command).not.toBeNull();
  const handoffUrl = handoffUrlFromCommand(command!);

  const fresh = await openFreshV2(context, handoffUrl);
  await expect(fresh.getByText("Set the Stoneware mug quantity to 3.")).toBeVisible();
  await expect(
    fresh.getByText(/expected tool|expected arguments|expected site effect/iu)
  ).toHaveCount(0);
  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review", "checkout_request"]);
  await invokeFreshV2(fresh, "cart_update", {
    operationId: "judge_quick_start_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();

  const result = owner.locator("[data-verdict='pass']");
  await expect(result).toBeVisible();
  await expect(result.getByRole("heading", { name: "Contract passed." })).toBeVisible();
  await expect(result.getByText("Mug 2 → 3", { exact: true })).toBeVisible();
  await expect(result.getByText("1 state transition", { exact: true })).toBeVisible();
  await expect(result.getByText(/contract checks passed/iu)).toBeVisible();
  await expect(result.getByText(/operation ID supplied/iu)).toBeVisible();
  await fresh.close();
});

test("a wrong native tool still becomes a readable owner-side issue", async ({
  context,
  page: owner
}) => {
  await owner.goto("/judge");
  await owner.getByRole("button", { name: "Arm quick test" }).click();
  const command = await owner
    .locator("details")
    .filter({ hasText: "Preview the exact command" })
    .locator("pre")
    .textContent();
  const fresh = await openFreshV2(context, handoffUrlFromCommand(command!));
  await startFreshV2(fresh, ["cart_get", "cart_update", "order_review", "checkout_request"]);
  await invokeFreshV2(fresh, "order_review", {});
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();

  const result = owner.locator("[data-verdict='issue']");
  await expect(result).toBeVisible();
  await expect(result.getByRole("heading", { name: "Thurstone found an issue." })).toBeVisible();
  await expect(result.getByText("cart_update", { exact: true })).toBeVisible();
  await expect(result.getByText("order_review", { exact: true })).toBeVisible();
  await expect(result.getByText("Mug 2 → 2", { exact: true })).toBeVisible();
  await expect(result.getByText(/contract checks passed/iu)).toBeVisible();
  await expect(result.getByText("What to investigate next", { exact: true })).toBeVisible();
  await fresh.close();
});
