import { expect, test, type Page } from "@playwright/test";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function arm(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await page.getByRole("button", { name: "Build the contract" }).click();
  await page.getByRole("button", { name: "Review contract" }).click();
  await Promise.all([
    page.waitForURL(/\/demo\/run#handoff-source$/u),
    page.getByRole("button", { name: "Arm live test" }).click()
  ]);
  await Promise.all([
    page.waitForURL(/\/demo\/run$/u),
    page.getByRole("button", { name: "Run in this tab instead" }).click()
  ]);
  await expect(page.locator("[data-byoa-state='ARMED']")).toBeVisible();
}

test("cancel before invocation clears only the unfinished BYOA session and retires tools", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await Promise.all([
    page.waitForURL(/\/demo$/u),
    page.getByRole("link", { name: "Cancel test" }).click()
  ]);
  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem("thurstone:byoa-session@1"),
    projection: sessionStorage.getItem("thurstone:byoa-agent-projection@1"),
    result: sessionStorage.getItem("thurstone:byoa-result@2")
  }));
  expect(stored).toEqual({ session: null, projection: null, result: null });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual([]);
});

test("reload after arming but before a call fails closed as incomplete", async ({ page }) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Thurstone could not verify an agent decision." })
  ).toBeVisible();
  await expect(page.locator("[data-byoa-state='INCOMPLETE']")).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem("thurstone:byoa-result@2"));
  expect(stored).toContain('"verdict":"incomplete"');
  expect(stored).toContain("native_invocation_missing");
});
