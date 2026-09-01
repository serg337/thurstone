import { expect, test, type Page } from "@playwright/test";

import {
  BYOA_HANDOFF_URL_STORAGE_KEY,
  BYOA_REMOTE_SESSION_STORAGE_KEY
} from "@/lib/demo/agent-handoff";
import { BYOA_AGENT_PROJECTION_STORAGE_KEY } from "@/lib/demo/agent-projection";
import { BYOA_SESSION_STORAGE_KEY } from "@/lib/demo/agent-session";
import { BYOA_RESULT_STORAGE_KEY } from "@/lib/demo/byoa-result-storage";
import { REGRESSION_RERUN_STORAGE_KEY } from "@/lib/demo/regression-rerun";
import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./support/emulated-consumer";

async function waitForArmed(page: Page) {
  await expect(page.locator("[data-byoa-state='ARMED']")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting for agent");
}

test("opaque handoff opens an isolated fresh-browser run without exposing the answer key", async ({
  page,
  browser
}) => {
  await installEmulatedConsumer(page);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Choose the test catalog" }).click();
  await page.getByRole("button", { name: "Build the contract" }).click();
  await page.getByRole("button", { name: "Review contract" }).click();
  await Promise.all([
    page.waitForURL(/\/demo\/run#handoff-source$/u),
    page.getByRole("button", { name: "Arm live test" }).click()
  ]);
  await expect(page.locator("[data-byoa-state='HANDOFF_SOURCE']")).toBeVisible();
  const sourceTools = await page.evaluate(async () =>
    (await document.modelContext?.getTools?.())?.map(({ name }) => name)
  );
  expect(sourceTools).toEqual([]);

  const handoffUrl = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    BYOA_HANDOFF_URL_STORAGE_KEY
  );
  expect(handoffUrl).toMatch(/\/demo\/handoff#[A-Za-z0-9._-]+$/u);
  expect(handoffUrl).not.toContain("checkout_request");
  expect(handoffUrl).not.toContain("expectedTool");

  const freshContext = await browser.newContext();
  const target = await freshContext.newPage();
  await installEmulatedConsumer(target);
  const bootstrapBodies: string[] = [];
  target.on("response", async (response) => {
    if (response.url().endsWith("/api/demo/handoff/bootstrap")) {
      bootstrapBodies.push(await response.text());
    }
  });
  await target.goto("/");
  await target.evaluate(
    ({ localSession, projection, result, rerun, remote, handoff }) => {
      for (const key of [localSession, projection, result, rerun, remote, handoff]) {
        sessionStorage.setItem(key, "stale");
      }
    },
    {
      localSession: BYOA_SESSION_STORAGE_KEY,
      projection: BYOA_AGENT_PROJECTION_STORAGE_KEY,
      result: BYOA_RESULT_STORAGE_KEY,
      rerun: REGRESSION_RERUN_STORAGE_KEY,
      remote: BYOA_REMOTE_SESSION_STORAGE_KEY,
      handoff: BYOA_HANDOFF_URL_STORAGE_KEY
    }
  );
  await target.goto(handoffUrl!);
  await target.waitForURL(/\/demo\/run$/u);
  await waitForArmed(target);
  expect(target.url()).not.toContain("#");
  await expect(target.getByText("Owner's hidden contract", { exact: true })).toHaveCount(0);
  await expect(target.getByText("Required action", { exact: true })).toHaveCount(0);
  const isolatedStorage = await target.evaluate(
    ({ localSession, result, rerun, remote, handoff }) => ({
      localSession: sessionStorage.getItem(localSession),
      result: sessionStorage.getItem(result),
      rerun: sessionStorage.getItem(rerun),
      remote: sessionStorage.getItem(remote),
      handoff: sessionStorage.getItem(handoff)
    }),
    {
      localSession: BYOA_SESSION_STORAGE_KEY,
      result: BYOA_RESULT_STORAGE_KEY,
      rerun: REGRESSION_RERUN_STORAGE_KEY,
      remote: BYOA_REMOTE_SESSION_STORAGE_KEY,
      handoff: BYOA_HANDOFF_URL_STORAGE_KEY
    }
  );
  expect(isolatedStorage).toMatchObject({
    localSession: null,
    result: null,
    rerun: null,
    handoff: null
  });
  expect(isolatedStorage.remote).not.toBe("stale");
  const bootstrap = bootstrapBodies.join("\n");
  for (const forbidden of [
    "expectedTool",
    "argumentPredicate",
    "allowedEffects",
    "forbiddenEffects",
    "replayPolicy",
    "approvalClass"
  ]) {
    expect(bootstrap).not.toContain(forbidden);
  }

  await target.evaluate(async () => {
    const context = document.modelContext as RuntimeModelContext | undefined;
    if (!context?.getTools || !context.executeTool) throw new Error("Consumer unavailable");
    const selected = (await context.getTools()).find(({ name }) => name === "checkout_request");
    if (!selected) throw new Error("Missing checkout_request");
    await context.executeTool(
      selected,
      JSON.stringify({ operationId: "byoa_handoff_checkout_0001" }),
      { signal: new AbortController().signal }
    );
  });
  await expect(target.locator("[data-byoa-state='PASS']")).toBeVisible();
  await expect(target.getByText("Revision 1", { exact: true })).toBeVisible();
  await freshContext.close();
});
