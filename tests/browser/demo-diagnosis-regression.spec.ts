import { expect, test, type Page } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function arm(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Test review versus checkout" }).click();
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

async function invoke(page: Page, name: "order_review" | "checkout_request", operationId?: string) {
  await page.evaluate(
    async ({ name, operationId }) => {
      const context = document.modelContext as RuntimeModelContext | undefined;
      if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable");
      const tools = await context.getTools();
      const selected = tools.find((tool) => tool.name === name);
      if (!selected) throw new Error(`Missing tool: ${name}`);
      await context.executeTool(selected, JSON.stringify(operationId ? { operationId } : {}), {
        signal: new AbortController().signal
      });
    },
    { name, operationId }
  );
}

test("PASS explains verified facts, replay scope, and saves/exports the regression case", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await invoke(page, "checkout_request", "byoa_regression_checkout_0001");
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await expect(page.getByText("What Thurstone verified", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No mismatch to investigate" })).toBeVisible();
  await expect(
    page.getByText(/Replay was not measured inside this one-call BYOA trial/iu)
  ).toBeVisible();

  await page.getByRole("button", { name: "Save as regression test" }).click();
  await expect(page.getByRole("button", { name: "Saved in My Tests" })).toBeVisible();
  const saved = await page.evaluate(() => sessionStorage.getItem("thurstone:my-tests@1"));
  expect(saved).toContain('"version":"thurstone-my-tests@1"');
  expect(saved).toContain('"results":[');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export result JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^thurstone-byoa-/u);
});

test("ISSUE separates verified facts from hypothesis and gives a concrete next step", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await invoke(page, "order_review");
  await expect(page.locator("[data-byoa-state='ISSUE']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wrong tool selected" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Evidence-backed investigation area" })
  ).toBeVisible();
  await expect(
    page
      .locator(".diagnostic-investigation")
      .getByText(/cannot establish why the agent made that choice/iu)
  ).toBeVisible();
  await expect(page.getByText("Recommended next step", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".diagnostic-next-step")
      .getByText(/Compare the expected and observed tool descriptions/iu)
  ).toBeVisible();
  await expect(
    page
      .locator(".diagnostic-release-guidance")
      .getByText(/Do not release this WebMCP change until this case passes/iu)
  ).toBeVisible();
});

test("Edit contract restores the saved request and descriptors in the owner wizard", async ({
  page
}) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await invoke(page, "checkout_request", "byoa_regression_checkout_0002");
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await page.getByRole("button", { name: "Edit contract" }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect(page.getByText("Step 2 of 6", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Agent-visible description/iu).first()).toHaveValue(
    /current final read-only order summary/iu
  );
});

test("Rerun appends a successor result under one immutable regression case", async ({ page }) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await invoke(page, "checkout_request", "byoa_regression_checkout_0003");
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await page.getByRole("button", { name: "Save as regression test" }).click();
  await page.getByRole("button", { name: "Rerun this case" }).click();
  await expect(page.locator("[data-byoa-state='ARMED']")).toBeVisible();
  await invoke(page, "checkout_request", "byoa_regression_checkout_0004");
  await expect(page.locator("[data-byoa-state='PASS']")).toBeVisible();
  await page.getByRole("button", { name: "Save as regression test" }).click();

  const stored = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("thurstone:my-tests@1") ?? "null") as {
        entries: Array<{
          results: Array<{ resultDigest: string; previousResultDigest: string | null }>;
        }>;
      }
  );
  expect(stored.entries).toHaveLength(1);
  expect(stored.entries[0]?.results).toHaveLength(2);
  expect(stored.entries[0]?.results[1]?.previousResultDigest).toBe(
    stored.entries[0]?.results[0]?.resultDigest
  );
});

test("INCOMPLETE cannot be saved as verified regression evidence", async ({ page }) => {
  await installEmulatedConsumer(page);
  await arm(page);
  await page.reload();
  await expect(page.locator("[data-byoa-state='INCOMPLETE']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as regression test" })).toHaveCount(0);
  await expect(
    page.getByText(/No semantic release conclusion is valid from this run/iu)
  ).toBeVisible();
});
