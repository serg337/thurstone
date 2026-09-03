import { describe, expect, it } from "vitest";

import {
  isByoaHandoffShortCode,
  issueByoaHandoffShortCode,
  resolveByoaHandoffV2Credential
} from "@/lib/demo/handoff-short-code.server";

const environment = {
  NODE_ENV: "test",
  TOOLPROOF_BROWSER_FAKE_PROBE: "1"
} as NodeJS.ProcessEnv;

describe("short BYOA handoff codes", () => {
  it("stores a short expiring alias without changing the encrypted credential", async () => {
    const token = `tbh2.${"a".repeat(120)}`;
    const code = await issueByoaHandoffShortCode(token, Date.now() + 60_000, environment);

    expect(code).toMatch(/^ths2_[A-Za-z0-9_-]{24}$/u);
    expect(isByoaHandoffShortCode(code)).toBe(true);
    await expect(resolveByoaHandoffV2Credential(code, environment)).resolves.toBe(token);
    await expect(resolveByoaHandoffV2Credential(token, environment)).resolves.toBe(token);
  });

  it("fails closed for missing and expired aliases", async () => {
    await expect(
      resolveByoaHandoffV2Credential(`ths2_${"z".repeat(24)}`, environment)
    ).resolves.toBeNull();
    await expect(
      issueByoaHandoffShortCode("tbh2.invalid", Date.now() - 1, environment)
    ).rejects.toThrow("SHORT_CODE_EXPIRED");
  });
});
