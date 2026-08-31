import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("back, forward, and refresh preserve honest top-level document boundaries", async ({
  page
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page).toHaveURL(/\/lab$/u);
  await expect(page.getByRole("heading", { name: "Seeded checkout sandbox" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/lab$/u);
  await page.reload();
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();
});

test("cold slow-network rendering honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 35));
    await route.continue();
  });
  await page.goto(`/?cold=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Unit tests for meaning", {
    timeout: 20_000
  });
  const motion = await page.getByRole("link", { name: "Open checkout lab" }).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration
    };
  });
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("keyboard focus and live status announcements expose the deterministic path", async ({
  page
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/u);
  await page.goto("/lab");
  const review = page.getByRole("button", { name: "Review order in UI" });
  await expect(review).toBeEnabled();
  await review.focus();
  await page.keyboard.press("Enter");
  const announced = page.locator(".receipt-line[aria-live='polite']").first();
  await expect(announced).toContainText('"totalCents": 7300');
});

test("pre-unlock Lab DOM, transport, console, and storage omit frozen truth", async ({ page }) => {
  const manifest = JSON.parse(
    await readFile(path.resolve(process.cwd(), "scripts/gate3-leakage-sentinels.json"), "utf8")
  ) as { readonly sentinels: readonly string[] };
  const observed: string[] = [];
  const responseReads: Promise<void>[] = [];
  page.on("console", (message) => observed.push(message.text()));
  page.on("request", (request) => {
    observed.push(request.url(), request.postData() ?? "");
  });
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (/text|json|javascript/iu.test(type) && response.url().startsWith("http")) {
      responseReads.push(
        response
          .text()
          .then((text) => {
            observed.push(text);
          })
          .catch(() => undefined)
      );
    }
  });
  await page.goto("/lab");
  await page.waitForLoadState("networkidle");
  await Promise.all(responseReads);
  observed.push(
    await page.content(),
    await page.locator("body").innerText(),
    await page.evaluate(() =>
      JSON.stringify({
        url: location.href,
        session: Object.fromEntries(Object.entries(sessionStorage)),
        local: Object.fromEntries(Object.entries(localStorage))
      })
    )
  );
  const joined = observed.join("\n");
  for (const sentinel of manifest.sentinels) expect(joined).not.toContain(sentinel);
});

// thurstone-impact-execution:acceptance-start
test("current Results survive navigation and reload without exposing superseded evidence", async ({
  page
}) => {
  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Every approved behavior passed." })
  ).toBeVisible();
  await expect(page.getByText(/23\s*\/\s*24/u)).toHaveCount(0);
  await page.goto("/");
  await page.goBack();
  await expect(page).toHaveURL(/\/results$/u);
  await expect(
    page.getByRole("heading", { name: "Every approved behavior passed." })
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Current evaluation summary")).toContainText("24");
});
// thurstone-impact-execution:acceptance-end
