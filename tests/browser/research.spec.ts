import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Research connects the two papers to Thurstone without duplicating the canonical source", async ({
  page
}) => {
  await page.goto("/research");

  await expect(page).toHaveTitle("Research · Thurstone");
  await expect(
    page.getByRole("heading", { name: "The measurement research behind Thurstone." })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
      name: "Research"
    })
  ).toHaveAttribute("aria-current", "page");

  const papers = page.getByRole("article");
  await expect(papers).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "The Latent Invariance Principle" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Canonical Semantic Realization" })).toBeVisible();
  await expect(page.getByText("Why it matters to Thurstone", { exact: true })).toHaveCount(2);

  await expect(page.getByRole("link", { name: "Open Invarra Research" })).toHaveAttribute(
    "href",
    "https://invarra.ai/research"
  );
  await expect(page.getByRole("link", { name: "View PDF" }).first()).toHaveAttribute(
    "href",
    "https://invarra.ai/papers/latent_invariance_principle.pdf"
  );
  await expect(page.getByRole("link", { name: "View PDF" }).last()).toHaveAttribute(
    "href",
    "https://invarra.ai/papers/canonical_semantic_realization.pdf"
  );
  await expect(page.getByRole("link", { name: "Publication record" }).first()).toHaveAttribute(
    "href",
    "https://zenodo.org/records/21203401"
  );
  await expect(page.getByRole("link", { name: "Publication record" }).last()).toHaveAttribute(
    "href",
    "https://zenodo.org/records/21203393"
  );

  const phalanx = page.getByRole("complementary", { name: "From measurement to enforcement." });
  await expect(phalanx).toContainText("Different products, one evidence discipline.");
  await expect(phalanx.getByRole("link", { name: "Explore Phalanx" })).toHaveAttribute(
    "href",
    "https://invarra.ai/phalanx"
  );
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);

  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
});

test("Research is accessible and keeps external publication links explicit", async ({ page }) => {
  await page.goto("/research");
  const externalLinks = page.locator('a[target="_blank"]');
  expect(await externalLinks.count()).toBeGreaterThanOrEqual(8);
  for (const link of await externalLinks.all()) {
    await expect(link).toHaveAttribute("rel", "noreferrer");
  }

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id }) => id)
  ).toEqual([]);
});
