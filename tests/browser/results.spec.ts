import { expect, test } from "@playwright/test";

test("development QA preview renders the production Demo report without storing evidence", async ({
  page
}) => {
  await page.goto("/results?qa=journey");
  await expect(
    page.getByRole("heading", { level: 1, name: "Results from your latest Demo run." })
  ).toBeVisible();
  const preview = page.locator('[data-results-level="owner-journey"][data-qa-preview="true"]');
  await expect(preview.getByRole("heading", { name: "7 of 7 tests passed." })).toBeVisible();
  await expect(preview.getByText(/QA preview|Development-only synthetic preview/iu)).toHaveCount(0);
  await expect(
    preview.getByRole("table", { name: "Continuous journey Demo results" }).getByRole("row")
  ).toHaveCount(8);
  await expect(
    preview.getByText(/Thurstone matched the returned line items to site-owned state/iu)
  ).toBeVisible();
  const receiptDigests = preview.locator(".latest-journey-receipts code");
  await expect(receiptDigests).toHaveCount(8);
  for (const digest of await receiptDigests.allTextContents()) {
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(new Set(digest).size).toBeGreaterThan(8);
  }
  await expect(preview.getByRole("button", { name: "Clear results" })).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("thurstone:owner-journey-report@3"))
  ).toBeNull();
});

test("development issue preview explains the mismatch and unexecuted remainder", async ({
  page
}) => {
  await page.goto("/results?qa=issue");
  const preview = page.locator('[data-results-level="owner-journey"][data-qa-preview="true"]');
  await expect(
    preview.getByRole("heading", { name: "3 passed, 1 issue, and 3 not run." })
  ).toBeVisible();
  await expect(preview.getByText("Issue", { exact: true })).toBeVisible();
  await expect(
    preview
      .locator(".latest-journey-metrics article")
      .filter({ hasText: "Passed" })
      .locator("strong")
  ).toHaveText("3");
  await expect(
    preview
      .locator(".latest-journey-metrics article")
      .filter({ hasText: "Not run" })
      .locator("strong")
  ).toHaveText("3");
  await expect(
    preview.getByText(/supplied Stoneware mug where the contract required Field notebook/iu)
  ).toBeVisible();
  await expect(
    preview.getByText(/stopped before downstream results became unreliable/iu)
  ).toBeVisible();
  const notRunRows = preview.locator('tr[data-verdict="not-run"]');
  await expect(notRunRows).toHaveCount(3);
  await expect(notRunRows.first().getByText("Not run", { exact: true })).toBeVisible();
  await expect(
    notRunRows
      .first()
      .getByText(/continuing from an unverified state could produce unreliable results/iu)
  ).toBeVisible();
  await expect(
    preview.getByRole("table", { name: "Continuous journey Demo results" }).getByRole("row")
  ).toHaveCount(8);
});

test("Results is an empty Demo report before this tab runs a test", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByText("Demo test results", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run a Demo test to create a results report." })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the Demo" })).toHaveAttribute("href", "/demo");
  await expect(page.getByText(/24\/24 semantic behaviors|3\/3 integrity/iu)).toHaveCount(0);
  await expect(
    page.getByText(/Potential impact|missing testing layer|before release/iu)
  ).toHaveCount(0);
});

test("Results contains no expanded technical material by default", async ({ page }) => {
  await page.goto("/results?qa=journey");
  await expect(page.getByText("Technical receipt digests")).toBeVisible();
  await expect(page.locator("details[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download results" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Run another Demo test" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Demo contract" })).toBeVisible();
});
