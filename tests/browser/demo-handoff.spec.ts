import { expect, test } from "@playwright/test";

import { openFreshV2, prepareV2Handoff } from "./support/demo-v2-flow";

test("opaque v2 handoff opens one answer-isolated fresh context before explicit start", async ({
  context,
  page: owner
}) => {
  const handoffUrl = await prepareV2Handoff(owner);
  const fresh = await openFreshV2(context, handoffUrl);
  await expect(fresh.getByText("I am ready—request checkout for this cart.")).toBeVisible();
  await expect(fresh.getByText("order_review", { exact: true })).toBeVisible();
  await expect(fresh.getByText("checkout_request", { exact: true })).toBeVisible();
  await expect(
    fresh.getByText(/owner answer key|required action|expected tool|allowed effects/iu)
  ).toHaveCount(0);
  await expect(fresh.getByRole("link", { name: /Thurstone home/iu })).toHaveCount(0);
  await expect(fresh.getByRole("navigation")).toHaveCount(0);
  await expect
    .poll(() =>
      fresh.evaluate(async () => (await document.modelContext?.getTools?.())?.length ?? 0)
    )
    .toBe(0);
  await fresh.close();
});
