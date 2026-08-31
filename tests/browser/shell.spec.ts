import { expect, test } from "@playwright/test";

test("judge shell is honest, navigable, and permanently marks the simulation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://thurstone.invarra.ai"
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "AI agents can operate websites."
  );
  await expect(page.getByText("Synthetic checkout. No purchase occurs.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Thurstone home" })).toHaveAttribute("href", "/");
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon.*\.png/u);
  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation.getByRole("link")).toHaveCount(3);
  await expect(primaryNavigation.getByRole("link", { name: "Demo", exact: true })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(
    primaryNavigation.getByRole("link", { name: "Results", exact: true })
  ).toHaveAttribute("href", "/results");
  await expect(
    primaryNavigation.getByRole("link", { name: "Research", exact: true })
  ).toHaveAttribute("href", "/research");
  await expect(primaryNavigation.locator('a[aria-current="page"]')).toHaveCount(0);

  await primaryNavigation.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
      name: "Demo"
    })
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", {
      name: "See whether intent becomes the permitted WebMCP action."
    })
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Sandbox", exact: true }).click();
  await page.getByRole("link", { name: "Open sandbox", exact: true }).click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByRole("heading", { name: "Synthetic cart" })).toBeVisible();
  const expertDisclosure = page.getByText("Technical receipts and native controls", {
    exact: true
  });
  await expect(expertDisclosure).toBeVisible();
  await expect(page.getByText(/No operator-triggered executeOnce call yet/iu)).toBeHidden();
  await expertDisclosure.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/No operator-triggered executeOnce call yet/iu)).toBeVisible();

  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(
    page.getByRole("heading", {
      name: "Every approved reference behavior passed."
    })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Current evaluation summary")).toContainText("24");
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
      name: "Results"
    })
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
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

  const brandedOrigin = await request.post("/api/probe/issue", {
    headers: { ...headers, Origin: "https://thurstone.invarra.ai" },
    data: {}
  });
  expect(brandedOrigin.status()).toBe(503);
  await expect(brandedOrigin.json()).resolves.toEqual({
    error: "probe_disabled",
    inferencePerformed: false
  });

  const crossSite = await request.post("/api/probe/issue", {
    headers: { ...headers, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    data: {}
  });
  expect(crossSite.status()).toBe(403);
});

// thurstone-impact-execution:acceptance-start
test("home states the WebMCP trust problem in human language", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText(
      /Turn a website owner’s expectations into a testable contract\. Thurstone runs it through live WebMCP/iu
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "Handler tests prove a tool can run. Thurstone verifies whether natural-language intent becomes the approved WebMCP action and effect."
    )
  ).toBeVisible();
});

test("home shows the complete five-stage verification flow", async ({ page }) => {
  await page.goto("/");
  const loop = page.getByRole("list", { name: "Thurstone verification flow" });
  await expect(loop).toContainText("Human contract");
  await expect(loop).toContainText("Agent decision");
  await expect(loop).toContainText("Native WebMCP");
  await expect(loop).toContainText("Trusted state");
  await expect(loop).toContainText("Pass/fail receipt");
});

test("home exposes the primary test and verified-results paths", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Test Thurstone", exact: true })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(
    page.getByRole("link", { name: "See verified results", exact: true })
  ).toHaveAttribute("href", "/results");
  await expect(
    page.getByText(/No account · synthetic data · guided path works without WebMCP/iu)
  ).toBeVisible();
});

test("home distinguishes the native boundary from trusted-state verification", async ({ page }) => {
  await page.goto("/");
  const flow = page.getByRole("list", { name: "Thurstone verification flow" });
  await expect(flow).toContainText("Native WebMCP");
  await expect(flow).toContainText("Trusted state");
});

test("home keeps both judge paths inside the first viewport", async ({ page }) => {
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
});
// thurstone-impact-execution:acceptance-end
