import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function stageTwo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
}

test("catalog, suite, and arm dialog have no serious accessibility violations", async ({
  page
}) => {
  await stageTwo(page);
  for (const phase of ["catalog", "suite", "dialog"] as const) {
    if (phase === "suite")
      await page.getByRole("button", { name: "Build the contract suite" }).click();
    if (phase === "dialog") {
      await page.getByLabel("Test-case name").fill("Request checkout");
      await page
        .getByLabel("Representative user request")
        .fill("I am ready—request checkout for this cart.");
      await page.getByLabel("What should the agent do?").selectOption("checkout_request");
      await page.getByRole("button", { name: "Add test case" }).click();
      await page.getByRole("button", { name: "Review and arm selected case" }).click();
    }
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations
        .filter(({ impact }) => impact === "serious" || impact === "critical")
        .map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target }) => target)
        }))
    ).toEqual([]);
  }
});

test("owner stages remain operable in forced colors and reduced motion", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await stageTwo(page);
  await expect(page.getByRole("button", { name: "Build the contract suite" })).toBeVisible();
  await expect(page.locator('[data-tool-name="order_review"]')).toBeVisible();
  await page.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(page.getByRole("button", { name: "Add test case" })).toBeVisible();
});

test("owner catalog and suite reflow at simulated 200 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await stageTwo(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  for (const phase of ["catalog", "suite"] as const) {
    if (phase === "suite")
      await page.getByRole("button", { name: "Build the contract suite" }).click();
    const width = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1 &&
            !element.closest(".owner-progress")
        )
        .slice(0, 16)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: Math.round(element.getBoundingClientRect().right),
          width: Math.round(element.getBoundingClientRect().width)
        }))
    }));
    expect(width).toMatchObject({ scrollWidth: width.clientWidth, offenders: [] });
  }
});
