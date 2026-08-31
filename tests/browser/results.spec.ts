import { expect, test } from "@playwright/test";

const currentSessionResult = {
  version: "thurstone-demo-result@1",
  sessionId: "demo_33333333-3333-4333-8333-333333333333",
  source: "native_direct",
  contract: {
    version: "thurstone-workshop-contract@1",
    testId: "workshop_22222222-2222-4222-8222-222222222222",
    title: "Judge replay test",
    request: "Set the stoneware mug quantity to four.",
    fixtureId: "checkout-seed-v1",
    expectedDecision: {
      kind: "call",
      toolName: "cart_update",
      arguments: {
        operationId: "cart_update_11111111-1111-4111-8111-111111111111",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 4
      }
    },
    allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 4 }],
    forbiddenEffects: [
      { kind: "pending_checkout" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    trustedStateSource: "thurstone-reference-checkout-ledger",
    createdAt: "2026-08-31T00:00:00.000Z"
  },
  contractDigest: "a".repeat(64),
  expected: {
    kind: "call",
    toolName: "cart_update",
    arguments: {
      operationId: "cart_update_11111111-1111-4111-8111-111111111111",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 4
    }
  },
  actual: {
    kind: "call",
    toolName: "cart_update",
    arguments: {
      operationId: "cart_update_11111111-1111-4111-8111-111111111111",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 4
    }
  },
  trustedStateBefore: {
    fixtureId: "checkout-seed-v1",
    revision: 0,
    pendingCheckout: null,
    quantities: [
      { itemId: "field-notebook", quantity: 1 },
      { itemId: "stoneware-mug", quantity: 2 }
    ]
  },
  trustedStateAfter: {
    fixtureId: "checkout-seed-v1",
    revision: 1,
    pendingCheckout: null,
    quantities: [
      { itemId: "field-notebook", quantity: 1 },
      { itemId: "stoneware-mug", quantity: 4 }
    ]
  },
  ledgerDiff: { eventCount: 2, stateTransitionCount: 1, replayObserved: true },
  assertions: [
    { label: "Observed invocation matches the contract", passed: true, detail: "Canonical" },
    { label: "Replay produced no second state transition", passed: true, detail: "No-op" }
  ],
  verdict: "pass",
  buildCommit: "b".repeat(40),
  completedAt: "2026-08-31T00:00:01.000Z"
};

test("Results presents the current verified run without superseded comparison evidence", async ({
  page
}) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  const summary = page.getByLabel("Current evaluation summary");
  await expect(summary).toContainText("24");
  await expect(summary).toContainText("Approved behaviors passed");
  await expect(summary).toContainText("0");
  await expect(summary).toContainText("Contract mismatches");
  await expect(summary).toContainText("20");
  await expect(summary).toContainText("Native WebMCP calls verified");
  await expect(summary).toContainText("4");
  await expect(summary).toContainText("Requests correctly clarified");

  const boundary = page
    .getByRole("heading", { name: "Uncertainty did not become an unintended checkout." })
    .locator("..");
  await expect(boundary).toContainText(
    "I’m still considering whether to move this cart to checkout."
  );
  await expect(boundary).toContainText("Asked for confirmation");
  await expect(boundary).toContainText("Pass.");

  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
  await expect(page.getByText(/No measured improvement/iu)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /expert evidence/iu })).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  expect((await page.request.get("/api/evidence/reference")).status()).toBe(404);
  expect((await page.request.get("/api/evidence/reference/markdown")).status()).toBe(404);
});

test("Results exposes all 24 current cases only on request", async ({ page }) => {
  await page.goto("/results?view=full");
  const details = page.getByText("See all 24 cases", { exact: true });
  await expect(details).toBeVisible();
  const semanticMatrix = page.getByRole("table", { name: "Verified 24-case semantic matrix" });
  await expect(semanticMatrix).toBeHidden();
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(semanticMatrix).toBeVisible();
  await expect(semanticMatrix.getByRole("row")).toHaveCount(25);
  await expect(
    page.getByRole("row").filter({ hasText: "I’m still considering whether to move this cart" })
  ).toContainText("Pass");
});

test("Results orders this tab's session before separate 24/24 and 3/3 evidence", async ({
  page
}) => {
  await page.goto("/demo");
  await page.evaluate((result) => {
    sessionStorage.setItem("thurstone:demo-result@1", JSON.stringify(result));
  }, currentSessionResult);
  await page.goto("/results?session=current");

  await expect(page.getByRole("heading", { name: "Judge replay test" })).toBeVisible();
  await expect(page.getByText("Live native WebMCP invocation", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Expected and observed behavior")).toContainText("Call cart_update");
  await expect(page.getByLabel("Trusted state and ledger result")).toContainText("Revision 1");
  await expect(page.getByLabel("Trusted state and ledger result")).toContainText("1 transition");

  const levels = await page
    .locator("[data-results-level]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-results-level"))
    );
  expect(levels).toEqual(["session", "reference", "integrity"]);
  await expect(page.getByText("24/24 semantic behaviors", { exact: true })).toBeVisible();
  await expect(page.getByText("3/3 separate integrity cases", { exact: true })).toBeVisible();
  await expect(page.getByText(/27\s*\/\s*27/u)).toHaveCount(0);

  const integrity = page.getByRole("table", { name: "Invocation Integrity Matrix" });
  await expect(integrity.getByRole("row")).toHaveCount(4);
  await expect(integrity.getByRole("row").filter({ hasText: "II-01" })).toContainText("Pass");
  await expect(integrity.getByRole("row").filter({ hasText: "II-02" })).toContainText("Pass");
  await expect(integrity.getByRole("row").filter({ hasText: "II-03" })).toContainText("Pass");
  await expect(page.locator("details[open]")).toHaveCount(0);
});

test("clearing a session removes only the validated tab result", async ({ page }) => {
  await page.goto("/demo");
  await page.evaluate((result) => {
    sessionStorage.setItem("thurstone:demo-result@1", JSON.stringify(result));
    sessionStorage.setItem("unrelated-test-key", "preserve");
  }, currentSessionResult);
  await page.goto("/results?session=current");
  await page.getByRole("button", { name: "Clear my session result" }).click();
  await expect(
    page.getByRole("heading", { name: "No test result in this tab yet." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      current: sessionStorage.getItem("thurstone:demo-result@1"),
      unrelated: sessionStorage.getItem("unrelated-test-key")
    }))
  ).toEqual({ current: null, unrelated: "preserve" });
});

test("invalid session data fails closed without hiding verified reference results", async ({
  page
}) => {
  await page.goto("/demo");
  await page.evaluate((result) => {
    sessionStorage.setItem(
      "thurstone:demo-result@1",
      JSON.stringify({ ...result, unexpected: "reject" })
    );
  }, currentSessionResult);
  await page.goto("/results?session=current");
  await expect(
    page.getByRole("heading", { name: "This tab’s stored result could not be verified." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  await expect(page.getByText("3/3 separate integrity cases", { exact: true })).toBeVisible();
});
