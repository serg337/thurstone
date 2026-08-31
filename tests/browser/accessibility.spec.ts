import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/", "/demo", "/research", "/studio", "/lab", "/lab/arm", "/results"]) {
  test(`${route} has no serious or critical automated accessibility violations`, async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(route);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const materialViolations = violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length }));

    expect(pageErrors).toEqual([]);
    expect(materialViolations).toEqual([]);
  });
}

// thurstone-impact-execution:acceptance-start
test("current Results exposes one accessible summary and three distinct boundary articles", async ({
  page
}) => {
  await page.goto("/results");
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.getByLabel("Current evaluation summary")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toHaveCount(1);
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByText("Approved behaviors passed", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Contract mismatches", { exact: true })).toHaveCount(1);
});
// thurstone-impact-execution:acceptance-end
