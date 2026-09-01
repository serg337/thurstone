import { expect, test } from "@playwright/test";

import { invokeFreshV2, openFreshV2, prepareV2Handoff, startFreshV2 } from "./support/demo-v2-flow";

async function passingResult(
  context: import("@playwright/test").BrowserContext,
  owner: import("@playwright/test").Page
) {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "checkout_request", { operationId: "diagnosis_pass_0001" });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  return fresh;
}

test("PASS explains trusted facts, replay scope, and saves/exports Result v3", async ({
  context,
  page: owner
}) => {
  const fresh = await passingResult(context, owner);
  await expect(
    fresh.getByRole("heading", { name: "Why Thurstone reached this verdict" })
  ).toBeVisible();
  await expect(fresh.getByText(/Replay was not measured in this one-call trial/iu)).toBeVisible();
  await fresh.getByRole("button", { name: "Save as regression" }).click();
  await expect(fresh.getByRole("button", { name: "Saved as regression" })).toBeVisible();
  const downloadPromise = fresh.waitForEvent("download");
  await fresh.getByRole("button", { name: "Export Result v3 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^thurstone-result-v3-/u);
  await fresh.close();
});

test("ISSUE separates verified facts from hypothesis and gives one next step", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "order_review", {});
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();
  await expect(fresh.getByRole("heading", { name: "Verified facts" })).toBeVisible();
  await expect(
    fresh.getByText("Investigation hypothesis—not private agent reasoning")
  ).toBeVisible();
  await expect(fresh.getByText(/Recommended next step/iu)).toBeVisible();
  await expect(fresh.getByText(/Release guidance:/iu)).toBeVisible();
  await fresh.close();
});

test("Edit a copy reconstructs one selected case in a new owner suite", async ({
  context,
  page: owner
}) => {
  const fresh = await passingResult(context, owner);
  await fresh.getByRole("button", { name: "Edit a copy" }).click();
  await fresh.waitForURL(/\/demo$/u);
  await fresh.getByRole("button", { name: "Choose the test catalog" }).click();
  await fresh.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(fresh.getByRole("heading", { name: "Request checkout" })).toBeVisible();
  await expect(fresh.getByText("I am ready—request checkout for this cart.")).toBeVisible();
  await fresh.close();
});

test("Rerun creates a fresh linked handoff instead of overwriting the terminal result", async ({
  context,
  page: owner
}) => {
  const fresh = await passingResult(context, owner);
  const sourceDigest = await fresh.evaluate(() => {
    const bytes = sessionStorage.getItem("thurstone:byoa-result@3");
    return bytes ? (JSON.parse(bytes) as { resultDigest: string }).resultDigest : null;
  });
  await fresh.getByRole("button", { name: "Rerun in a fresh agent" }).click();
  await fresh.waitForURL(/\/demo\/run\?source=[^#]+#handoff-source-v2$/u);
  await expect(
    fresh.getByRole("heading", { name: "Send this case to a genuinely fresh agent." })
  ).toBeVisible();
  const link = await fresh.evaluate(() => {
    const bytes = sessionStorage.getItem("thurstone:byoa-session@2");
    return bytes
      ? (JSON.parse(bytes) as { regressionLink: { previousResultDigest: string } | null })
          .regressionLink
      : null;
  });
  expect(link?.previousResultDigest).toBe(sourceDigest);
  await fresh.close();
});
