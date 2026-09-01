import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Studio keeps historical target truth and human authority explicit", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/studio");

  await expect(
    page.getByRole("heading", { name: "Last verified target—not a live Lab claim" })
  ).toBeVisible();
  await expect(page.getByText("e78c5752c16296c2dcc273e5…")).toBeVisible();
  await expect(page.getByText("93a602ea6d8e", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Six families · balanced 12 / 12" })
  ).toBeVisible();
  await expect(page.getByText("Trial per case and version")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exact v1 checkout_request description" })
  ).toBeVisible();

  await expect(page.locator(".studio-case-list > li")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "Copy exact review package" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download exact review package" })).toBeEnabled();

  if (process.env.TOOLPROOF_BASE_URL) {
    await expect(page.getByRole("button", { name: "Semantic package approved" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Gate 3 frozen" })).toBeDisabled();
    await expect(page.getByText("Human-approved protocol frozen", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Authoring context permanently terminated" })
    ).toBeVisible();
    await expect(page.getByText("No authoring tools exposed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Inspect snapshot and open drafting" })
    ).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Approve semantic package" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Freeze Gate 3" })).toBeDisabled();
    await expect(page.getByText("awaiting-human", { exact: true })).toBeVisible();
    await expect(page.getByText("toolproof_inspect", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Inspect snapshot and open drafting" }).click();
    await expect(page.getByText("toolproof_inspect, toolproof_draft_contract")).toBeVisible();

    await page.getByLabel("Contract title").fill("Human draft candidate");
    await page.getByRole("button", { name: "Save structured draft for human review" }).click();
    await expect(
      page.getByText("toolproof_inspect, toolproof_draft_contract, toolproof_submit_review")
    ).toBeVisible();
    await page.getByRole("button", { name: "Present draft to human UI" }).click();
    await expect(page.getByText("Presented—not approved.")).toBeVisible();
    await expect(
      page.getByText(/No semantic decision, review receipt, provider call, or freeze/iu)
    ).toBeVisible();
  }

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id }) => id)
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Lab stays free of every Gate 3 prompt and evaluator-side label", async ({ page }) => {
  const manifest = JSON.parse(
    await readFile(path.resolve(process.cwd(), "scripts/gate3-leakage-sentinels.json"), "utf8")
  ) as { readonly sentinels: readonly string[] };
  await page.goto("/lab");
  const html = await page.content();
  const accessibleText = await page.locator("body").innerText();
  for (const sentinel of manifest.sentinels) {
    expect(html).not.toContain(sentinel);
    expect(accessibleText).not.toContain(sentinel);
  }
});

test("Studio and Demo navigation replaces the top-level document", async ({ page }) => {
  await page.goto("/studio");
  await page.evaluate(() => {
    Reflect.set(window, "__toolproofStudioDocumentMarker", "must-not-survive");
  });
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__toolproofStudioDocumentMarker") ?? null))
    .toBeNull();
  await expect(
    page.getByRole("heading", {
      name: "Test Thurstone as a WebMCP owner."
    })
  ).toBeVisible();
});

test("Home does not prefetch Studio and hard-navigates into Demo", async ({ page }) => {
  const studioRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/studio(?:\?|$)/u.test(request.url())) studioRequests.push(request.url());
  });
  await page.goto("/");
  await page.evaluate(() => {
    Reflect.set(window, "__toolproofHomeDocumentMarker", "must-not-survive");
  });
  await expect.poll(() => studioRequests).toEqual([]);
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__toolproofHomeDocumentMarker") ?? null))
    .toBeNull();
});

// thurstone-impact-execution:acceptance-start
test("Studio leads with the human-approved contract before operational detail", async ({
  page
}) => {
  await page.goto("/studio");
  if (process.env.TOOLPROOF_BASE_URL) {
    await expect(page.getByText("Human-approved contract", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "The contract defines what each request is allowed to mean."
      })
    ).toBeVisible();
    await expect(page.getByText("Contract awaiting human review", { exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByText("Contract awaiting human review", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This contract still requires human approval." })
    ).toBeVisible();
    await expect(page.getByText("Human-approved contract", { exact: true })).toHaveCount(0);
  }
  await expect(
    page.getByText(
      "Tentative checkout intent must stay tentative. Explicit authorization may create one pending approval—and nothing beyond it."
    )
  ).toBeVisible();
});
// thurstone-impact-execution:acceptance-end
