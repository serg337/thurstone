import { expect, test } from "@playwright/test";

test("primary copy tells one coherent story at readable sizes", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByText(/Turn a website owner’s expectations into a testable contract/iu)
  ).toBeVisible();
  await expect(page.getByText("Scope matters.", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Thurstone verifies that agents do what the website owner intended—and nothing the owner prohibited."
    )
  ).toHaveCount(0);

  const essentialSizes = await page
    .locator(".signal-flow p, .example-card .example-request")
    .evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    );
  expect(essentialSizes.length).toBeGreaterThan(0);
  expect(Math.min(...essentialSizes)).toBeGreaterThanOrEqual(14);

  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "See whether intent becomes the permitted WebMCP action." })
  ).toBeVisible();
  await expect(page.locator(".demo-readiness")).toHaveCount(0);

  await page.goto("/research");
  await expect(page.locator(".research-equations, .research-boundary")).toHaveCount(0);
  const paperHeadingSizes = await page
    .locator(".research-paper h3")
    .evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    );
  expect(Math.max(...paperHeadingSizes)).toBeLessThanOrEqual(46);

  await page.goto("/studio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("results and expert routes lead with conclusions before setup detail", async ({ page }) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "See what the contract required—and what actually happened."
    })
  ).toBeVisible();
  await expect(page.locator(".route-hero .status-pill")).toHaveCount(0);

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
  await expect(page.getByRole("heading", { name: "Live WebMCP status" })).toBeVisible();

  await page.goto("/invocation-integrity");
  await expect(
    page.getByRole("heading", { name: "Test whether hostile WebMCP calls preserve site rules." })
  ).toBeVisible();
  await expect(
    page.getByText("chrome://flags/#enable-webmcp-testing", { exact: true })
  ).toBeHidden();
});
