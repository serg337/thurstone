import { expect, test } from "@playwright/test";

test("homepage sells the semantic release problem, mechanism, and action", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("Semantic release testing for WebMCP", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Your WebMCP code can be correct. The agent can still choose the wrong action."
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Test with your agent" })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(
    page.getByRole("heading", {
      name: "Follow a semantic bug from the user’s words to a verified fix."
    })
  ).toBeVisible();
  await expect(page.getByText("Without Thurstone", { exact: true })).toBeVisible();
  await expect(page.getByText("With Thurstone", { exact: true })).toBeVisible();
  await expect(page.getByText("06 · Hidden bug reaches users", { exact: true })).toBeVisible();
  await expect(page.getByText("06 · Verified deploy", { exact: true })).toBeVisible();
  await expect(page.getByText(/not a claim about the agent’s private reasoning/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run Thurstone whenever meaning can drift." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Don’t watch a demo. Run one with your own agent." })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Test Thurstone with your agent" })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
});

test("primary navigation keeps Results contextual until an owner journey exists", async ({
  page
}) => {
  await page.goto("/workflow");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(3);
  for (const [label, href] of [
    ["Demo", "/demo"],
    ["Workflow", "/workflow"],
    ["Research", "/research"]
  ] as const) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "href",
      href
    );
  }
  await expect(navigation.getByRole("link", { name: /Results/u })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Workflow" })).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("Workflow separates the working challenge product from product direction", async ({
  page
}) => {
  await page.goto("/workflow");
  await expect(
    page.getByRole("heading", { name: "From human intent to a release decision." })
  ).toBeVisible();
  for (const stage of [
    "Define",
    "Arm",
    "Test with an agent",
    "Verify reality",
    "Diagnose",
    "Save",
    "Rerun"
  ]) {
    await expect(page.getByRole("heading", { name: stage, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Challenge release" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not yet" })).toBeVisible();
  await expect(page.getByText("Arbitrary customer-site connection", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Product direction — not in the challenge release", { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/directions, not current capabilities or promises/iu)).toBeVisible();
});

test("Results is reserved for Demo runs while reference evidence remains on Home", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Run a Demo test to create a results report." })
  ).toBeVisible();
  await expect(page.getByText(/24\/24|3\/3/u)).toHaveCount(0);
});

test("new judge pages reflow without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/workflow", "/results"]) {
    await page.goto(route);
    const width = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
  }
});
