import { expect, test } from "@playwright/test";

test("paired Results exposes exact metrics, filters, traces, provenance, and canonical exports", async ({
  page
}) => {
  test.skip(!process.env.TOOLPROOF_BASE_URL, "Authentic paired evidence is deployed-only.");
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeVisible();
  await expect(page.getByText("23 / 24 → 23 / 24", { exact: true })).toBeVisible();
  await expect(page.getByText("No measured improvement.", { exact: true })).toBeVisible();
  for (const label of [
    "Equivalence consistency",
    "Boundary sensitivity",
    "Tool/action accuracy",
    "Argument fidelity",
    "Effect fidelity",
    "Over-action rate",
    "Clarification quality"
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("8/8 → 8/8", { exact: true })).toBeVisible();
  await expect(page.getByText("7/8 → 7/8", { exact: true })).toBeVisible();
  await expect(page.getByText("23/24 → 23/24", { exact: true })).toBeVisible();
  await expect(page.getByText("20/20 → 20/20", { exact: true })).toBeVisible();
  await expect(page.getByText("24/24 → 24/24", { exact: true })).toBeVisible();
  await expect(page.getByText("0/10 → 0/10", { exact: true })).toBeVisible();
  await expect(page.getByText("3/4 → 3/4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Builder-blinded holdout" }).click();
  await page.getByLabel("Outcome").selectOption("fail");
  await expect(page.locator(".gate6-matrix .matrix-row:not(.matrix-header)")).toHaveCount(1);
  await expect(page.getByText("commitment_holdout_anchor", { exact: true })).toBeVisible();
  await page.getByLabel("Version").selectOption("revised");
  await expect(page.getByRole("columnheader", { name: "Baseline outcome" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Revised outcome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect baseline" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect revised" }).click();
  await expect(page.getByRole("heading", { name: "Trace inspector" })).toBeVisible();
  await expect(page.getByText("decision_action_class", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contract version diff" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One truthful identity chain" })).toBeVisible();
  await expect(page.getByText("custom-probe", { exact: true })).toBeVisible();
  await expect(page.getByText("direct-chatgpt", { exact: true })).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe("toolproof-reference-evidence.json");
  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe("toolproof-reference-evidence.md");
});
