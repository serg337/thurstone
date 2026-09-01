import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { invokeFreshV2, openFreshV2, prepareV2Handoff, startFreshV2 } from "./support/demo-v2-flow";

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
  await expect(page.getByText(/The code worked\. The behavior was wrong/iu)).toBeVisible();
  await expect(page.getByText(/Unit tests prove that a tool works/iu)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Turn intent into a release test." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "An issue should tell you where to look next." })
  ).toBeVisible();
  await expect(
    page.getByText(/investigation hypothesis—not a claim about the agent’s private reasoning/iu)
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run Thurstone whenever meaning can drift." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Don’t watch a demo. Run one with your own agent." })
  ).toBeVisible();
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
});

test("primary navigation exposes Demo, Results, Workflow, Research with exact active state", async ({
  page
}) => {
  await page.goto("/workflow");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  for (const [label, href] of [
    ["Demo", "/demo"],
    ["Results", "/results"],
    ["Workflow", "/workflow"],
    ["Research", "/research"]
  ] as const) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "href",
      href
    );
  }
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

async function createCurrentResult(context: BrowserContext, owner: Page) {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "checkout_request", {
    operationId: "byoa_results_checkout_0001"
  });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  return fresh;
}

test("Results orders My Tests before unchanged 24/24 and separate 3/3", async ({
  context,
  page
}) => {
  const fresh = await createCurrentResult(context, page);
  await fresh.goto("/results");
  await expect(
    fresh.getByRole("heading", { name: "Fresh-agent results and regression cases." })
  ).toBeVisible();
  await expect(fresh.getByText("Current Result v3 run", { exact: true })).toBeVisible();
  await expect(
    fresh.locator(".my-test-decision").getByText(/Required.*checkout_request/iu)
  ).toBeVisible();
  const levels = await fresh
    .locator("[data-results-level]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-results-level"))
    );
  expect(levels).toEqual(["session-v2", "reference", "integrity"]);
  await expect(fresh.getByText("24/24 semantic behaviors", { exact: true })).toBeVisible();
  await expect(fresh.getByText("3/3 integrity cases", { exact: true })).toBeVisible();
  await fresh.close();
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
