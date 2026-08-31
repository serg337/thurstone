import { expect, test } from "@playwright/test";

test("Intro presents the winning product story before technical detail", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Thurstone — semantic testing for WebMCP");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Thurstone verifies whether AI agents choose the intended WebMCP tools, use safe arguments, and produce the site-defined effects."
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://thurstone.invarra.ai/thurstone-og.png"
  );
  await expect(page.getByText("Semantic judge for WebMCP", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "AI agents can operate websites. Thurstone verifies what they actually do."
    })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Thurstone verifies that agents do what the website owner intended—and nothing the owner prohibited."
    )
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Test Thurstone", exact: true })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(
    page.getByRole("link", { name: "See verified results", exact: true })
  ).toHaveAttribute("href", "/results");
  await expect(
    page.getByAltText(
      "Streams representing website requests converge on Thurstone’s verification checkpoint, which separates a verified cyan outcome from a prohibited amber outcome."
    )
  ).toBeVisible();
});

test("Intro explains selection, arguments, effects, and all five evidence stages", async ({
  page
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Publishing a tool is not the same as proving its meaning."
    })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Selection", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arguments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Effects", exact: true })).toBeVisible();

  const flow = page.getByRole("list", { name: "Thurstone verification flow" });
  await expect(flow.getByRole("listitem")).toHaveCount(5);
  for (const stage of [
    "Human contract",
    "Agent decision",
    "Native WebMCP",
    "Trusted state",
    "Pass/fail receipt"
  ]) {
    await expect(flow.getByText(stage, { exact: true })).toBeVisible();
  }
  await flow.getByText("What this means", { exact: true }).first().click();
  await expect(
    flow.getByText(/The contract fixes the request meaning, expected action or clarification/iu)
  ).toBeVisible();
});

test("Intro keeps semantic and Invocation Integrity proof separate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Semantic behavior" })).toBeVisible();
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invocation Integrity" })).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Separate test matrices")).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
});

test("Intro retains explicit limitations and no arbitrary-site promise", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "A strong result about one declared contract and tested build."
    })
  ).toBeVisible();
  await expect(
    page.getByText(
      /not runtime enforcement, guaranteed security, or proof about arbitrary websites/iu
    )
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /website url/iu })).toHaveCount(0);
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
});

test("Intro answers all six cold-review comprehension questions", async ({ page }) => {
  await page.goto("/");

  const answers = [
    page.getByText(/Test whether an agent chose the intended tool, supplied safe arguments/iu),
    page.getByRole("heading", {
      name: "Publishing a tool is not the same as proving its meaning."
    }),
    page.getByText("The website owner declares the intended action and allowed effects.", {
      exact: true
    }),
    page.getByText("Before and after state are checked independently of the tool response.", {
      exact: true
    }),
    page.getByText("Separate test matrices", { exact: true }),
    page.getByRole("link", { name: "Test Thurstone", exact: true })
  ];
  for (const answer of answers) await expect(answer).toBeVisible();
  expect(answers).toHaveLength(6);
});

test("Intro remains inside the viewport and page width at desktop and mobile", async ({ page }) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  for (const link of [
    page.getByRole("link", { name: "Test Thurstone", exact: true }),
    page.getByRole("link", { name: "See verified results", exact: true })
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
