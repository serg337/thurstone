import { expect, test } from "@playwright/test";

// thurstone-impact-execution:acceptance-start
test("unsupported Integrity explains WebMCP setup without hiding real failures", async ({
  page
}) => {
  await page.goto("/invocation-integrity");
  await expect(
    page.getByRole("heading", {
      name: "Test whether hostile WebMCP calls preserve site rules."
    })
  ).toBeVisible();
  const setup = page.getByText("Native browser setup", { exact: true });
  await expect(setup).toBeVisible();
  await setup.click();
  await expect(
    page.getByText("chrome://flags/#enable-webmcp-testing", { exact: true })
  ).toBeVisible();
  const scope = page.getByText(
    "These three synthetic cases audit the tested build. They are not runtime enforcement, certification, or a universal security guarantee."
  );
  await expect(scope).toBeVisible();
  const viewport = page.viewportSize();
  const scopeBox = await scope.boundingBox();
  expect(viewport).not.toBeNull();
  expect(scopeBox).not.toBeNull();
  expect(scopeBox!.y + scopeBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(
    page.getByText(/enable chrome:\/\/flags\/#enable-webmcp-testing and relaunch/iu)
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "View verified integrity results" })).toHaveAttribute(
    "href",
    "/results"
  );
  await expect(
    page.getByText("WebMCP unavailable in this browser", { exact: true }).first()
  ).toBeVisible();
});
// thurstone-impact-execution:acceptance-end
