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
    "Your WebMCP code can be correct."
  );
  await expect(page.getByText("Synthetic checkout. No purchase occurs.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Thurstone home" })).toHaveAttribute("href", "/");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  for (const [label, href] of [
    ["Demo", "/demo"],
    ["Results", "/results"],
    ["Workflow", "/workflow"],
    ["Research", "/research"]
  ] as const) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "href",
      href
    );
  }
  await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(0);

  await navigation.getByRole("link", { name: "Demo" }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect(
    page.getByRole("heading", { name: "Test Thurstone as a WebMCP owner." })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Demo" })
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Workflow" }).click();
  await expect(page).toHaveURL(/\/workflow$/u);
  await expect(
    page.getByRole("heading", { name: "From human intent to a release decision." })
  ).toBeVisible();

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/u);
  await expect(
    page.getByRole("heading", { name: "Every approved reference behavior passed." })
  ).toBeVisible();
  await expect(page.getByLabel("Current evaluation summary")).toContainText("24");
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

  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(response.headers()["permissions-policy"]).toContain("tools=(self)");
  expect(response.headers()["origin-agent-cluster"]).toBe("?1");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});

test("Probe controls disclose policy while inference routes fail closed", async ({ request }) => {
  const status = await request.get("/api/probe/status");
  const productionGuardExpected = status.status() === 200;
  expect(status.status()).toBe(productionGuardExpected ? 200 : 503);
  await expect(status.json()).resolves.toMatchObject({
    status: productionGuardExpected ? "controls-ready" : "controls-pending",
    enabled: false,
    activation: "disabled",
    policy: { callLimit: 160, spendCeilingUsd: "10.00" }
  });

  const headers = {
    Origin: "https://thurstone.invarra.ai",
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
});

test("home makes WebMCP, trusted reality, and both judge paths explicit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/uncover semantic mistakes in their WebMCP catalog/iu)).toBeVisible();
  const flow = page.getByRole("list", {
    name: "How Thurstone turns a semantic mismatch into a verified fix"
  });
  await expect(flow).toContainText("Native WebMCP");
  await expect(flow).toContainText("Trusted verdict");
  await expect(page.getByRole("link", { name: "Test with your agent" })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(page.getByRole("link", { name: "See verified reference results" })).toHaveAttribute(
    "href",
    "/results"
  );
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
});
