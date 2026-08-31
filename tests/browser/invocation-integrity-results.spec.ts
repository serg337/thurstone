import { expect, test } from "@playwright/test";

// thurstone-impact-execution:acceptance-start
test("unsupported Integrity explains WebMCP setup without hiding real failures", async ({
  page
}) => {
  await page.goto("/invocation-integrity");
  await expect(
    page.getByRole("heading", {
      name: "Hostile direct calls must preserve site-defined boundaries."
    })
  ).toBeVisible();
  await expect(
    page.getByText("chrome://flags/#enable-webmcp-testing", { exact: true })
  ).toBeVisible();
  const scope = page.getByText(
    "Scope: three frozen synthetic checkout cases on the exact tested build. Thurstone is a testing/audit system—not runtime enforcement, certification, guaranteed security, or arbitrary-site verification."
  );
  await expect(scope).toBeVisible();
  const viewport = page.viewportSize();
  const scopeBox = await scope.boundingBox();
  expect(viewport).not.toBeNull();
  expect(scopeBox).not.toBeNull();
  expect(scopeBox!.y + scopeBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(page.getByText(/choose Enabled, and relaunch Chrome/iu)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "WebMCP unavailable? Inspect sealed Results" })
  ).toHaveAttribute("href", "/results");
  await expect(
    page.getByText("WebMCP unavailable in this browser", { exact: true }).first()
  ).toBeVisible();
});
// thurstone-impact-execution:acceptance-end
