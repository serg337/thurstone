import { expect, test } from "@playwright/test";

test("judge shell is honest, navigable, and permanently marks the simulation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Unit tests for meaning");
  await expect(page.getByText("Simulated checkout — no purchase occurs.")).toBeVisible();

  await page.getByRole("link", { name: "Open checkout lab" }).click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByRole("heading", { name: "Seeded checkout sandbox" })).toBeVisible();
  await expect(page.getByText(/No operator-triggered executeOnce call yet/iu)).toBeVisible();

  await page.getByRole("link", { name: "Integrity" }).click();
  await expect(page).toHaveURL(/\/invocation-integrity$/);
  await expect(
    page.getByRole("heading", {
      name: "Fixed browser-native calls, checked by a source-fixed verifier."
    })
  ).toBeVisible();

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/);
  if (process.env.TOOLPROOF_BASE_URL) {
    await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeVisible({
      timeout: 15_000
    });
    await expect(page.getByText("23 / 24 → 23 / 24", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "No run yet" })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test("health and degraded readiness diagnostics are explicit", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ status: "ok", simulation: true });

  const readiness = await request.get("/api/readiness");
  expect(readiness.status()).toBe(503);
  await expect(readiness.json()).resolves.toMatchObject({
    status: "degraded",
    probe: { enabled: false }
  });

  const pageResponse = await request.get("/");
  expect(pageResponse.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(pageResponse.headers()["permissions-policy"]).toContain("tools=(self)");
  expect(pageResponse.headers()["origin-agent-cluster"]).toBe("?1");
  expect(pageResponse.headers()["strict-transport-security"]).toContain("max-age=63072000");
  expect(pageResponse.headers()["x-frame-options"]).toBe("DENY");
});

test("Probe controls disclose policy while inference routes fail closed", async ({ request }) => {
  const status = await request.get("/api/probe/status");
  const productionGuardExpected = Boolean(process.env.TOOLPROOF_BASE_URL);
  expect(status.status()).toBe(productionGuardExpected ? 200 : 503);
  await expect(status.json()).resolves.toMatchObject({
    status: productionGuardExpected ? "controls-ready" : "controls-pending",
    enabled: false,
    activation: "disabled",
    policy: { callLimit: 160, spendCeilingUsd: "10.00" }
  });

  const headers = {
    Origin: "https://toolproof-rust.vercel.app",
    "Sec-Fetch-Site": "same-origin",
    "X-ToolProof-CSRF": "disabled-route-boundary-token-0001"
  };
  for (const route of [
    "/api/probe/issue",
    "/api/probe/decide",
    "/api/probe/native",
    "/api/probe/complete"
  ]) {
    const response = await request.post(route, { headers, data: {} });
    expect(response.status()).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "probe_disabled",
      inferencePerformed: false
    });
  }

  const crossSite = await request.post("/api/probe/issue", {
    headers: { ...headers, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    data: {}
  });
  expect(crossSite.status()).toBe(403);
});
