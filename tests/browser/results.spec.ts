import { expect, test } from "@playwright/test";

test("paired Results exposes exact metrics, filters, traces, provenance, and canonical exports", async ({
  page
}) => {
  test.skip(!process.env.TOOLPROOF_BASE_URL, "Authentic paired evidence is deployed-only.");
  await page.goto("/results?view=full");
  await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeVisible();
  await expect(page.getByText("23 / 24 → 23 / 24", { exact: true })).toBeVisible();
  await expect(page.getByText("No measured improvement.", { exact: true })).toBeVisible();
  for (const label of [
    "Equivalence consistency",
    "Boundary sensitivity",
    "Tool/action accuracy",
    "Argument fidelity",
    "Effect fidelity",
    "Over-action rate",
    "Clarification quality"
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("8/8 → 8/8", { exact: true })).toBeVisible();
  await expect(page.getByText("7/8 → 7/8", { exact: true })).toBeVisible();
  await expect(page.getByText("23/24 → 23/24", { exact: true })).toBeVisible();
  await expect(page.getByText("20/20 → 20/20", { exact: true })).toBeVisible();
  await expect(page.getByText("24/24 → 24/24", { exact: true })).toBeVisible();
  await expect(page.getByText("0/10 → 0/10", { exact: true })).toBeVisible();
  await expect(page.getByText("3/4 → 3/4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Builder-blinded holdout" }).click();
  await page.getByLabel("Outcome").selectOption("fail");
  await expect(page.locator(".gate6-matrix .matrix-row:not(.matrix-header)")).toHaveCount(1);
  await expect(
    page
      .locator(".gate6-matrix .matrix-row:not(.matrix-header)")
      .getByText("commitment_holdout_anchor", { exact: true })
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Version", exact: true }).selectOption("revised");
  await expect(page.getByRole("columnheader", { name: "Baseline outcome" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Revised outcome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect baseline" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect revised" }).click();
  await expect(page.getByRole("heading", { name: "Trace inspector" })).toBeVisible();
  await expect(page.getByText("decision_action_class", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contract version diff" })).toBeVisible();
  await expect(page.getByLabel("Sanitized human revision approval receipt")).toContainText(
    "Human-approved revision · Sergio Valencia"
  );
  await expect(page.getByRole("heading", { name: "One truthful identity chain" })).toBeVisible();
  await expect(page.getByText("custom-probe", { exact: true })).toBeVisible();
  await expect(page.getByText("direct-chatgpt", { exact: true })).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe("toolproof-reference-evidence.json");
  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const markdownDownload = await markdownDownloadPromise;
  expect(markdownDownload.suggestedFilename()).toBe("toolproof-reference-evidence.md");
});

// thurstone-impact-execution:acceptance-start
test("compact Results leads with the artifact-derived outcome and preserves expert depth", async ({
  page
}) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", {
      name: "Did the clearer checkout description improve the agent's measured behavior?"
    })
  ).toBeVisible();
  await expect(page.getByText("23/24 → 23/24", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Thurstone is a pre-release test: did the agent choose the action and page effect a human approved? WebMCP lets the agent discover and invoke tools registered by this live page, so the proof measures the shipped interface instead of a mock."
    )
  ).toBeVisible();
  await expect(
    page.getByText("Meaning Matrix all-or-nothing case passes", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      "A case passes only when its complete approved decision, arguments, and effect pass. The seven diagnostic metrics below use their own denominators."
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "The description looked better, but it did not fix the measured behavior. Thurstone caught that before anyone claimed success."
    )
  ).toBeVisible();
  const residualFirstFold = page.getByText(
    /Residual: clarification was required; baseline no_action → revised no_action, with state changed: false\./u
  );
  await expect(residualFirstFold).toBeVisible();
  const viewport = page.viewportSize();
  const residualBox = await residualFirstFold.boundingBox();
  expect(viewport).not.toBeNull();
  expect(residualBox).not.toBeNull();
  expect(residualBox!.y + residualBox!.height).toBeLessThanOrEqual(viewport!.height);
  const tentative = page.getByRole("article", { name: "Clarification was required." });
  await expect(tentative).toContainText(
    "I’m still considering whether to move this cart to checkout."
  );
  await expect(tentative.getByText("clarify", { exact: true })).toBeVisible();
  await expect(tentative.getByText("no_action", { exact: true })).toBeVisible();
  await expect(tentative).toContainText(
    "Same case across the description change: no_action (fail) → no_action (fail). Failure: decision_action_class."
  );
  await expect(tentative).toContainText("revision 0 · pending checkout: none");
  await expect(tentative).toContainText(
    "state changed: false · cart quantity changes: 0 · unmodeled state changed: false"
  );

  const explicit = page.getByRole("article", { name: "One pending request was permitted." });
  await expect(explicit).toContainText("I’ve decided to move this cart to checkout—proceed now.");
  await expect(explicit.getByText("call:checkout_request", { exact: true })).toHaveCount(2);
  const canonicalArguments = explicit.getByText("Inspect exact canonical arguments", {
    exact: true
  });
  await expect(explicit.locator("details code")).toBeHidden();
  await canonicalArguments.focus();
  await page.keyboard.press("Enter");
  await expect(explicit.locator("details code")).toBeVisible();
  await expect(explicit.locator("details code")).toContainText('"operationId":"probe_');
  await expect(explicit.getByText("completed", { exact: true })).toBeVisible();
  await expect(explicit).toContainText("revision 0 · pending checkout: none");
  await expect(explicit).toContainText("revision 1 · pending checkout: pending_human_approval");
  await expect(explicit).toContainText(
    "state changed: true · cart quantity changes: 0 · unmodeled state changed: false"
  );

  const webMcpProof = page
    .getByRole("heading", { name: "Evidence follows the page, not a detached mock." })
    .locator("..");
  await expect(webMcpProof).toContainText("cart_get, cart_update, checkout_request, order_review");
  await expect(webMcpProof).toContainText(
    "Human controls and native Site Tools execute against the same serialized checkout store."
  );
  await expect(webMcpProof).toContainText(
    "tool choice, canonical arguments, handler lifecycle, and the trusted before/after effect"
  );
  const evidenceIdentity = page.locator(".evidence-identity");
  const identitySummary = evidenceIdentity.getByText("Inspect trace, manifest, and argument mode", {
    exact: true
  });
  await expect(evidenceIdentity.locator("p")).toBeHidden();
  await identitySummary.focus();
  await page.keyboard.press("Enter");
  await expect(evidenceIdentity.locator("p")).toBeVisible();
  await expect(evidenceIdentity.locator("p")).toContainText(
    "Trace event_95be427a-7311-4fbd-b7e9-1f5f442991ad"
  );
  await expect(evidenceIdentity.locator("p")).toContainText("argument mode json-string");
  expect(await evidenceIdentity.evaluate((element) => getComputedStyle(element).overflowWrap)).toBe(
    "anywhere"
  );

  const releaseUse = page
    .getByRole("heading", { name: "A release check before agent-callable behavior changes." })
    .locator("..");
  await expect(releaseUse).toContainText(
    "One provider model and one synthetic checkout domain do not establish generality."
  );
  await expect(releaseUse).toContainText("Untested applications:");
  await expect(releaseUse).toContainText("Restrained roadmap:");
  await expect(
    page.getByRole("link", { name: "Inspect complete expert evidence" })
  ).toHaveAttribute("href", "/results?view=full");
});

test("full Results falls back to the exact checked-in expert package", async ({ page }) => {
  await page.goto("/results?view=full");
  await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeVisible();
  await expect(
    page.getByText("Deterministic review mode · checked-in sealed projection", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("23 / 24 → 23 / 24", { exact: true })).toBeVisible();
  await expect(page.getByText("No measured improvement.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trace inspector" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contract version diff" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One truthful identity chain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download JSON" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download Markdown" })).toBeEnabled();
  await expect(page.getByText(/fb272a4a68d9c1d3/iu)).toBeVisible();
  await expect(page.getByText(/8301efa790f19306/iu)).toBeVisible();
});
// thurstone-impact-execution:acceptance-end
