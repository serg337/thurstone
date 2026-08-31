import { expect, test } from "@playwright/test";

test("Results presents the current verified run without superseded comparison evidence", async ({
  page
}) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Every approved behavior passed." })
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
    .getByRole("heading", { name: "Uncertainty did not become an unintended checkout." })
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
  expect((await page.request.get("/api/evidence/reference/markdown")).status()).toBe(404);
});

test("Results exposes all 24 current cases only on request", async ({ page }) => {
  await page.goto("/results?view=full");
  const details = page.getByText("See the 24 case outcomes", { exact: true });
  await expect(details).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(25);
  await expect(
    page.getByRole("row").filter({ hasText: "I’m still considering whether to move this cart" })
  ).toContainText("Pass");
});
