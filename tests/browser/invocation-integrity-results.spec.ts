import { expect, test } from "@playwright/test";

test("Results keeps the three-case Invocation Integrity lane separate", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Invocation Integrity Matrix" })).toBeVisible();
  await expect(
    page.getByText(/Three frozen cases and four deterministic calls exercise/u)
  ).toBeVisible();
  await expect(page.getByLabel("Invocation Integrity Matrix").getByRole("row")).toHaveCount(4);
  for (const [caseId, title] of [
    ["II-01", "Privileged-field injection"],
    ["II-02", "Nonexistent item"],
    ["II-03", "Replay"]
  ] as const) {
    const row = page
      .getByLabel("Invocation Integrity Matrix")
      .getByRole("row")
      .filter({ hasText: caseId });
    await expect(row).toContainText(title);
  }
  await expect(page.getByLabel("Invocation Integrity accounting")).toContainText("0");
  await expect(page.getByLabel("Invocation Integrity accounting")).toContainText("23/24 → 23/24");
  await expect(page.getByText("no measured improvement", { exact: false })).toBeVisible();
  await expect(
    page.getByText(
      "The three-case score is separate from semantic accuracy and must never be combined with the Meaning Matrix denominator.",
      { exact: true }
    )
  ).toBeVisible();

  const evidenceResponse = await page.request.get("/api/evidence/invocation-integrity");
  if (evidenceResponse.status() === 200) {
    const exported = (await evidenceResponse.json()) as {
      readonly evidencePackage?: { readonly evidenceClass?: unknown };
    };
    await expect(
      page.getByRole("link", { name: "Download Invocation Integrity JSON" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download Invocation Integrity Markdown" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Descriptors, preflight, compatibility/reset, and native traces"
      })
    ).toBeVisible();
    if (exported.evidencePackage?.evidenceClass === "supplemental-invocation-integrity-failure") {
      await expect(page.getByText(/Measured terminal failure/u)).toBeVisible();
      await expect(page.getByText(/success claim forbidden/u)).toBeVisible();
      await expect(
        page.getByText(
          "Thurstone tests both sides of a declared WebMCP contract: whether benign requests produce the represented effects, and whether tested hostile invocations preserve site-defined invariants.",
          { exact: true }
        )
      ).toHaveCount(0);
    } else {
      await expect(page.getByText("3/3", { exact: true }).first()).toBeVisible();
    }
  } else {
    expect(evidenceResponse.status()).toBe(404);
    await expect(
      page.getByRole("button", { name: "Download Invocation Integrity JSON" })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Download Invocation Integrity Markdown" })
    ).toBeDisabled();
    await expect(page.getByText("Pending / 3", { exact: true })).toBeVisible();
  }
});
