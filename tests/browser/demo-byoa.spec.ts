import { expect, test } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { invokeFreshV2, openFreshV2, prepareV2Handoff, startFreshV2 } from "./support/demo-v2-flow";

test("v2 fresh run registers exactly the frozen catalog only after explicit start", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.getByRole("button", { name: "Continue to readiness" }).click();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.getByRole("button", { name: "Start live observation" }).click();
  await expect
    .poll(() =>
      fresh.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual(["order_review", "checkout_request"]);
  await fresh.close();
});

test("external native checkout produces trusted Result v3 PASS and retires the catalog", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "checkout_request", { operationId: "v2_checkout_pass_0001" });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect(
    fresh.getByRole("heading", { name: "Your selected contract case held." })
  ).toBeVisible();
  const trustedState = fresh
    .getByRole("heading", { name: "Trusted before-and-after state" })
    .locator("xpath=ancestor::section");
  await expect(trustedState.getByText("Revision 0", { exact: true })).toBeVisible();
  await expect(trustedState.getByText("Revision 1", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.close();
});

test("wrong first native tool remains an honest ISSUE with deterministic diagnosis", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "order_review", {});
  await expect(fresh.locator("[data-byoa-v2-state='ISSUE']")).toBeVisible();
  await expect(
    fresh.getByRole("heading", { name: "Thurstone found a semantic mismatch before release." })
  ).toBeVisible();
  await expect(
    fresh.getByText("Expected checkout_request; observed order_review.", { exact: true })
  ).toBeVisible();
  await expect(
    fresh.getByText("Investigation hypothesis—not private agent reasoning")
  ).toBeVisible();
  await fresh.close();
});

test("one-call admission rejects a concurrent second call before domain execution", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  const outcomes = await fresh.evaluate(async () => {
    const consumer = document.modelContext as RuntimeModelContext | undefined;
    if (!consumer?.getTools || !consumer.executeTool) throw new Error("Consumer unavailable.");
    const tools = await consumer.getTools();
    const checkout = tools.find(({ name }) => name === "checkout_request");
    const review = tools.find(({ name }) => name === "order_review");
    if (!checkout || !review) throw new Error("Expected tools missing.");
    return Promise.allSettled([
      consumer.executeTool(
        checkout,
        JSON.stringify({ operationId: "v2_concurrent_checkout_0001" }),
        { signal: new AbortController().signal }
      ),
      consumer.executeTool(review, JSON.stringify({}), {
        signal: new AbortController().signal
      })
    ]).then((values) => values.map(({ status }) => status));
  });
  expect(outcomes.sort()).toEqual(["fulfilled", "rejected"]);
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect(fresh.getByText("Later calls rejected").locator("..")).toContainText("1");
  await fresh.close();
});

test("terminal Result v3 survives reload without registering tools again", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await invokeFreshV2(fresh, "checkout_request", { operationId: "v2_reload_checkout_0001" });
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  const digest = await fresh.evaluate(() => {
    const bytes = sessionStorage.getItem("thurstone:byoa-result@3");
    return bytes ? (JSON.parse(bytes) as { resultDigest: string }).resultDigest : null;
  });
  await fresh.reload();
  await expect(fresh.locator("[data-byoa-v2-state='PASS']")).toBeVisible();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  expect(
    await fresh.evaluate(() => {
      const bytes = sessionStorage.getItem("thurstone:byoa-result@3");
      return bytes ? (JSON.parse(bytes) as { resultDigest: string }).resultDigest : null;
    })
  ).toBe(digest);
  await fresh.close();
});
