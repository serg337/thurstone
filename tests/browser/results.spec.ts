import { expect, test } from "@playwright/test";

test("Results presents the current verified run without superseded comparison evidence", async ({
  page
}) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Fresh-agent results and regression cases." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  const summary = page.getByLabel("Current evaluation summary");
  await expect(summary).toContainText("24");
  await expect(summary).toContainText("Approved behaviors passed");
  await expect(summary).toContainText("0");
  await expect(summary).toContainText("Contract mismatches");
  await expect(summary).toContainText("20");
  await expect(summary).toContainText("Native WebMCP calls verified");
  await expect(summary).toContainText("4");
  await expect(summary).toContainText("Requests correctly clarified");

  const boundary = page
    .getByRole("heading", { name: "Tentative intent stayed tentative." })
    .locator("..");
  await expect(boundary).toContainText(
    "I’m still considering whether to move this cart to checkout."
  );
  await expect(boundary).toContainText("Asked for confirmation");
  await expect(boundary).toContainText("Pass.");

  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
  await expect(page.getByText(/No measured improvement/iu)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /expert evidence/iu })).toHaveCount(0);
  expect((await page.request.get("/api/evidence/reference")).status()).toBe(404);
});

test("Results exposes all 24 current cases only on request", async ({ page }) => {
  await page.goto("/results?view=full");
  const details = page.getByText("See all 24 cases", { exact: true });
  await expect(details).toBeVisible();
  const matrix = page.getByRole("table", { name: "Verified 24-case semantic matrix" });
  await expect(matrix).toBeHidden();
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole("row")).toHaveCount(25);
});

test("Results orders My Tests before separate 24/24 and 3/3 evidence", async ({ page }) => {
  await page.goto("/results");
  const levels = await page
    .locator("[data-results-level]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-results-level"))
    );
  expect(levels).toEqual(["session-v2", "reference", "integrity"]);
  await expect(page.getByText("24/24 semantic behaviors", { exact: true })).toBeVisible();
  await expect(page.getByText("3/3 integrity cases", { exact: true })).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
  await expect(page.locator("details[open]")).toHaveCount(0);
});

test("invalid My Tests data fails closed without hiding verified reference results", async ({
  page
}) => {
  await page.goto("/demo");
  await page.evaluate(() => {
    sessionStorage.setItem(
      "thurstone:my-tests@1",
      JSON.stringify({ version: "thurstone-my-tests@1", entries: [], unexpected: true })
    );
    sessionStorage.setItem("unrelated-test-key", "preserve");
  });
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Stored local test data could not be verified." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear invalid local data" }).click();
  await expect(
    page.getByRole("heading", { name: "No Contract v3 result in this browser session yet." })
  ).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("unrelated-test-key"))).toBe("preserve");
});
