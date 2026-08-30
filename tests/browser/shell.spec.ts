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
  const expertDisclosure = page.getByText("Lab plumbing, reset receipts, and Gate 1 proof", {
    exact: true
  });
  await expect(expertDisclosure).toBeVisible();
  await expect(page.getByText(/No operator-triggered executeOnce call yet/iu)).toBeHidden();
  await expertDisclosure.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/No operator-triggered executeOnce call yet/iu)).toBeVisible();

  await page.getByRole("link", { name: "Integrity" }).click();
  await expect(page).toHaveURL(/\/invocation-integrity$/);
  await expect(
    page.getByRole("heading", {
      name: "Hostile direct calls must preserve site-defined boundaries."
    })
  ).toBeVisible();

  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(
    page.getByRole("heading", {
      name: "Did the clearer checkout description improve the agent's measured behavior?"
    })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("23/24 → 23/24", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The description looked better, but it did not fix the measured behavior. Thurstone caught that before anyone claimed success."
    )
  ).toBeVisible();
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

// thurstone-impact-execution:acceptance-start
test("home names the release audience and the missing semantic test", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("For product, QA, safety, and release teams shipping agent-callable sites.")
  ).toBeVisible();
  await expect(
    page.getByText(
      "Handler tests prove a tool can run. They do not prove that a natural-language request selected the human-approved action or produced the represented page effect."
    )
  ).toBeVisible();
});

test("home shows the complete human-agent release loop", async ({ page }) => {
  await page.goto("/");
  const loop = page.getByRole("list", { name: "Thurstone release loop" });
  await expect(loop).toContainText("Human declares meaning");
  await expect(loop).toContainText("Agent acts through WebMCP");
  await expect(loop).toContainText("Thurstone verifies the effect");
  await expect(loop).toContainText("Reviewer decides");
});

test("home labels the any-browser and supported-WebMCP paths before navigation", async ({
  page
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Inspect sealed Results — works in any browser" })
  ).toHaveAttribute("href", "/results");
  await expect(
    page.getByRole("link", { name: "Open checkout lab — WebMCP browser required" })
  ).toHaveAttribute("href", "/lab");
  await expect(
    page.getByText(
      "Results works anywhere. Lab ready = tools offered → found → executable. Requires the ChatGPT in-app browser or Chrome 149+ with WebMCP."
    )
  ).toBeVisible();
});

test("home translates the three WebMCP readiness stages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Lab ready = tools offered → found → executable/iu)).toBeVisible();
});

test("home keeps both judge paths inside the first viewport", async ({ page }) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const link of [
    page.getByRole("link", { name: "Inspect sealed Results — works in any browser" }),
    page.getByRole("link", { name: "Open checkout lab — WebMCP browser required" })
  ]) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  }
});
// thurstone-impact-execution:acceptance-end
