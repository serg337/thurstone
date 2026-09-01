import { expect, test } from "@playwright/test";

test("primary copy tells one coherent semantic-release story at readable sizes", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByText(/website owners define what a request should mean/iu)).toBeVisible();
  await expect(page.getByText("Challenge scope", { exact: true })).toBeVisible();
  await expect(page.getByText(/The code worked\. The behavior was wrong/iu)).toBeVisible();
  await expect(page.getByText(/runtime enforcement/iu)).toHaveCount(0);

  const essentialSizes = await page
    .locator(".signal-flow p, .semantic-failure-example strong")
    .evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    );
  expect(essentialSizes.length).toBeGreaterThan(0);
  expect(Math.min(...essentialSizes)).toBeGreaterThanOrEqual(14);

  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Test Thurstone as a WebMCP owner." })
  ).toBeVisible();
  await expect(page.locator(".demo-mode-nav, .demo-readiness")).toHaveCount(0);

  await page.goto("/workflow");
  await expect(
    page.getByText("Product direction — not in the challenge release", { exact: true })
  ).toBeVisible();

  await page.goto("/research");
  await expect(page.locator(".research-equations, .research-boundary")).toHaveCount(0);
  const paperHeadingSizes = await page
    .locator(".research-paper h3")
    .evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    );
  expect(Math.max(...paperHeadingSizes)).toBeLessThanOrEqual(46);
});

test("results and expert routes lead with conclusions before setup detail", async ({ page }) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "See what the contract required—and what actually happened."
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fresh-agent results and regression cases." })
  ).toBeVisible();

  await page.goto("/lab");
  await expect(
    page.getByRole("heading", { name: "Explore the live WebMCP sandbox." })
  ).toBeVisible();
  const setup = page.getByText("Native browser setup", { exact: true });
  await expect(setup).toBeVisible();
  await expect(
    page.getByText("chrome://flags/#enable-webmcp-testing", { exact: true })
  ).toBeHidden();
  await expect(page.locator(".capability-list > div")).toHaveCount(4);

  await page.goto("/invocation-integrity");
  await expect(
    page.getByRole("heading", { name: "Test whether hostile WebMCP calls preserve site rules." })
  ).toBeVisible();
});
