import { expect, test } from "@playwright/test";

import { installEmulatedConsumer } from "./support/emulated-consumer";
import { openFreshV2, prepareV2Handoff, startFreshV2 } from "./support/demo-v2-flow";

test("canceling an unclaimed handoff revokes it and preserves the owner suite", async ({
  context,
  page: owner
}) => {
  const handoffUrl = await prepareV2Handoff(owner);
  await owner.getByRole("button", { name: "Cancel unstarted handoff" }).click();
  await owner.waitForURL(/\/demo$/u);
  await expect(
    owner.getByRole("heading", { name: "You are the website owner preparing a WebMCP release." })
  ).toBeVisible();
  await owner.getByRole("button", { name: "Choose the test catalog" }).click();
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  await expect(owner.getByRole("heading", { name: "Request checkout" })).toBeVisible();

  const revoked = await context.newPage();
  await installEmulatedConsumer(revoked);
  await revoked.goto(handoffUrl);
  await expect(revoked.getByRole("heading", { name: "Open a fresh handoff link." })).toBeVisible();
  await expect
    .poll(() =>
      revoked.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await revoked.close();
});

test("reload after arm but before invocation fails closed without re-registering", async ({
  context,
  page: owner
}) => {
  const fresh = await openFreshV2(context, await prepareV2Handoff(owner));
  await startFreshV2(fresh);
  await fresh.reload();
  await expect(
    fresh.getByRole("heading", { name: "This fresh-agent test cannot continue." })
  ).toBeVisible();
  await expect(fresh.getByText(/ended mid-observation/iu)).toBeVisible();
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.close();
});

test("unsupported provider becomes honest pre-arm UNAVAILABLE only after explicit start", async ({
  context,
  page: owner
}) => {
  const handoffUrl = await prepareV2Handoff(owner);
  const fresh = await context.newPage();
  await fresh.goto(handoffUrl);
  await fresh.waitForURL(/\/demo\/run$/u);
  await fresh.getByRole("button", { name: "Continue to readiness" }).click();
  await fresh.getByRole("button", { name: "Start live observation" }).click();
  await expect(fresh.locator("[data-byoa-v2-state='UNAVAILABLE']")).toBeVisible();
  await expect(
    fresh.getByRole("heading", { name: "This environment could not expose the live test." })
  ).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Save as regression" })).toHaveCount(0);
  await expect(fresh.getByRole("button", { name: "Export Result v3 JSON" })).toBeVisible();
  await fresh.close();
});
