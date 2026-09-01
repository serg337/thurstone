import { expect, test } from "@playwright/test";

test("Home presents the semantic release product before technical detail", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Thurstone — semantic testing for WebMCP");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Thurstone verifies whether AI agents choose the intended WebMCP tools, use safe arguments, and produce the site-defined effects."
  );
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
  await expect(page.getByRole("link", { name: "See verified reference results" })).toHaveAttribute(
    "href",
    "/results"
  );
  await expect(page.getByText(/uncover semantic mistakes in their WebMCP catalog/iu)).toBeVisible();
  await expect(page.getByLabel("Simulation notice")).toBeHidden();
  const backdrop = page.locator(".hero-signal-backdrop");
  await expect(backdrop).toHaveCount(1);
  await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  await expect(backdrop.locator(".hero-input-nodes > *")).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Open Thurstone in ChatGPT's Browser" })
  ).toBeVisible();
  await expect(
    page.getByText("@Browser Open https://thurstone.invarra.ai/demo", { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/enter this exact command in the chat/iu)).toBeVisible();
  await expect(page.getByText("Flagged Chrome compatibility", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the technical Lab" })).toHaveCount(0);
  const footer = page.locator("footer");
  await expect(footer.getByText("Thurstone by Invarra", { exact: true })).toBeVisible();
  await expect(footer.getByText("Open source · MIT License", { exact: true })).toBeVisible();
  await expect(footer.getByText(/created by Sergio|evolving draft|No affiliation/iu)).toHaveCount(
    0
  );
});

test("Home contrasts unchecked release with Thurstone's verified path", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Follow a semantic bug from the user’s words to a verified fix."
    })
  ).toBeVisible();
  const shared = page.getByRole("list", { name: "Shared WebMCP release preparation" });
  await expect(shared.getByRole("listitem")).toHaveCount(4);
  for (const stage of [
    "01 · Build your WebMCP",
    "02 · Configure the catalog",
    "03 · Test each handler",
    "04 · Prepare to release"
  ]) {
    await expect(shared.getByText(stage, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/handlers passed.*test whether agents understand/iu)).toBeVisible();
  const unchecked = page.getByRole("list", { name: "Release path without Thurstone" });
  await expect(unchecked.getByRole("listitem")).toHaveCount(2);
  await expect(unchecked).toContainText("Hidden bug reaches users");
  await expect(page.getByText("With Thurstone", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "With semantic release check" })).toBeVisible();
  await expect(page.getByText("05 · Run Thurstone", { exact: true })).toBeVisible();
  await expect(page.getByText("Fix and rerun", { exact: true })).toBeVisible();
  await expect(page.getByText("06 · Verified deploy", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not stop at.*failed/iu)).toBeVisible();
  await expect(page.getByText(/not a claim about the agent’s private reasoning/iu)).toBeVisible();
});

test("Home keeps semantic and Invocation Integrity proof separate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Intended behaviors verified" })).toBeVisible();
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tested hostile invocations preserved site rules" })
  ).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Separate test matrices", { exact: true })).toBeVisible();
  await page.getByText("Inspect all 24 semantic behaviors", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Homepage semantic reference matrix" }).getByRole("row")
  ).toHaveCount(25);
  await page.getByText("Inspect the 3 Invocation Integrity tests", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Homepage Invocation Integrity Matrix" }).getByRole("row")
  ).toHaveCount(4);
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
});

test("Demo owns the reference-sandbox scope instead of the sales homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Demo scope")).toHaveCount(0);
  await expect(page.getByText(/does not monitor live shoppers/iu)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /website url/iu })).toHaveCount(0);
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
  await page.goto("/demo");
  await expect(page.getByLabel("Demo scope")).toBeVisible();
  await expect(page.getByText(/synthetic checkout sandbox/iu)).toBeVisible();
  await expect(page.getByText(/does not monitor live shoppers/iu)).toBeVisible();
});

test("Home answers the complete cold-review product contract", async ({ page }) => {
  await page.goto("/");
  const answers = [
    page.getByText(/code can be correct/iu),
    page.getByText(/uncover semantic mistakes in their WebMCP catalog/iu),
    page.getByText("Before the first launch", { exact: true }),
    page.getByRole("heading", { name: /Follow a semantic bug/iu }),
    page.getByText(/semantic bugs can survive normal WebMCP development/iu),
    page.getByRole("link", { name: "Test with your agent" }),
    page.getByText("Without Thurstone", { exact: true }),
    page.getByText("05 · Run Thurstone", { exact: true }),
    page.getByText("06 · Verified deploy", { exact: true }),
    page.getByText(/scheduled regression suite after launch/iu),
    page.getByText("24/24", { exact: true }),
    page.getByText("Inspect the 3 Invocation Integrity tests", { exact: true })
  ];
  for (const answer of answers) await expect(answer).toBeVisible();
  expect(answers).toHaveLength(12);
});

test("Home keeps both primary judge actions inside the first viewport", async ({ page }) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const link of [
    page.getByRole("link", { name: "Test with your agent" }),
    page.getByRole("link", { name: "See verified reference results" })
  ]) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  }
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth);
});
