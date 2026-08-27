import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/", "/studio", "/lab", "/lab/arm", "/results"]) {
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
