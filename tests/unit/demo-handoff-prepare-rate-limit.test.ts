import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issue: vi.fn()
}));

const BUILD = "a".repeat(40);
const RUN_ID = "byoa_run_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTRACT_DIGEST = "b".repeat(64);
const TOKEN = "tbh2.prepare-rate-limit-test-token-material";
const EXPIRES_AT = "2026-09-01T13:10:00.000Z";

vi.mock("@/lib/demo/agent-handoff-v2", () => ({
  BYOA_HANDOFF_PREPARE_V2_VERSION: "thurstone-byoa-handoff-prepare@2",
  byoaHandoffPrepareRequestV2Schema: { parse: (value: unknown) => value }
}));

vi.mock("@/lib/demo/agent-handoff-token-v2.server", () => ({
  createByoaHandoffEnvelopeV2: () => ({
    expiresAt: EXPIRES_AT,
    session: { runId: RUN_ID, contractDigest: CONTRACT_DIGEST }
  }),
  sealByoaHandoffV2: () => TOKEN
}));

vi.mock("@/lib/demo/handoff-ledger-v2.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo/handoff-ledger-v2.server")>();
  return {
    ...actual,
    createByoaHandoffLedgerV2Redis: () => ({}),
    issueByoaHandoffV2: mocks.issue
  };
});

vi.mock("@/lib/deployment/commit", () => ({
  resolveDeploymentCommit: () => BUILD
}));

import { POST as prepare } from "@/app/api/demo/handoff/prepare/route";
import { ByoaHandoffLedgerV2Error } from "@/lib/demo/handoff-ledger-v2.server";

function request(): Request {
  return new Request("https://thurstone.invarra.ai/api/demo/handoff/prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://thurstone.invarra.ai",
      "X-Thurstone-Origin": "https://thurstone.invarra.ai",
      "X-Thurstone-Request": "byoa-handoff"
    },
    body: JSON.stringify({
      version: "thurstone-byoa-handoff-prepare@2",
      session: { contract: { buildCommit: BUILD } },
      projection: { buildCommit: BUILD }
    })
  });
}

describe("Handoff v2 prepare anti-abuse mapping", () => {
  beforeEach(() => {
    mocks.issue.mockReset();
  });

  it.each(["HANDOFF_ISSUE_RATE_LIMIT", "HANDOFF_ACTIVE_LIMIT"])(
    "maps %s to a retryable 429 without preparing a new handoff",
    async (code) => {
      mocks.issue.mockRejectedValueOnce(new ByoaHandoffLedgerV2Error(code));
      const response = await prepare(request());
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ error: "handoff_rate_limited" });
      expect(mocks.issue).toHaveBeenCalledTimes(1);
    }
  );
});
