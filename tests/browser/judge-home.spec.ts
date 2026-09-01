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
  await expect(page.getByRole("link", { name: "See verified results" })).toHaveAttribute(
    "href",
    "/results"
  );
  const backdrop = page.locator(".hero-signal-backdrop");
  await expect(backdrop).toHaveCount(1);
  await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  await expect(backdrop.locator(".hero-input-nodes > *")).toHaveCount(5);
});

test("Home explains the failure, real-agent mechanism, and five evidence stages", async ({
  page
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "The missing failure lives between the user’s words and your code."
    })
  ).toBeVisible();
  await expect(page.getByText(/The code worked\. The behavior was wrong/iu)).toBeVisible();
  await expect(page.getByText(/Unit tests prove that a tool works/iu)).toBeVisible();
  const flow = page.getByRole("list", { name: "Thurstone verification flow" });
  await expect(flow.getByRole("listitem")).toHaveCount(5);
  for (const stage of ["Define", "Agent decides", "Native WebMCP", "Verify reality", "Diagnose"]) {
    await expect(flow.getByText(stage, { exact: true })).toBeVisible();
  }
  await flow.getByText("What this means", { exact: true }).first().click();
  await expect(flow.getByText(/required tool, arguments, allowed effects/iu)).toBeVisible();
});

test("Home keeps semantic and Invocation Integrity proof separate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Semantic behaviors" })).toBeVisible();
  await expect(page.getByText("24/24", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invocation Integrity" })).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Separate test matrices", { exact: true })).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);
});

test("Home states the reference scope without promising arbitrary-site enforcement", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByText("Challenge scope", { exact: true })).toBeVisible();
  await expect(page.getByText(/synthetic reference checkout/iu)).toBeVisible();
  await expect(page.getByText(/does not intercept live customer sessions/iu)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /website url/iu })).toHaveCount(0);
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
});

test("Home answers the complete cold-review product contract", async ({ page }) => {
  await page.goto("/");
  const answers = [
    page.getByText(/code can be correct/iu),
    page.getByText(/website owners define what a request should mean/iu),
    page.getByText("Before the first launch", { exact: true }),
    page.getByRole("heading", { name: "Turn intent into a release test." }),
    page.getByText(/supported agent sees only the request and live tools/iu),
    page.getByRole("link", { name: "Test with your agent" }),
    page.getByText(/first admitted tool invocation/iu),
    page.getByText(/Check trusted state and ledger independently/iu),
    page.getByRole("heading", { name: "An issue should tell you where to look next." }),
    page.getByText(/scheduled regression suite after launch/iu),
    page.getByText("24/24", { exact: true }),
    page.getByText(/does not intercept live customer sessions/iu)
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
    page.getByRole("link", { name: "See verified results" })
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
