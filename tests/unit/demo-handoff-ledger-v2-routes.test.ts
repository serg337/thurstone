import {
  BYOA_HANDOFF_CONTROL_V2_VERSION,
  BYOA_HANDOFF_REVEAL_V2_VERSION,
  BYOA_HANDOFF_REVOKE_V2_VERSION
} from "@/lib/demo/agent-handoff-v2";
import {
  BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS,
  BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS,
  claimByoaHandoffV2,
  createByoaHandoffLedgerV2Redis,
  issueByoaHandoffV2,
  receiveByoaHandoffV2,
  type ByoaHandoffLedgerV2Redis
} from "@/lib/demo/handoff-ledger-v2.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  runId: "byoa_run_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contractDigest: "a".repeat(64),
  token: "tbh2.route-test-token-material-0000000000000001",
  expiresAt: "2026-09-01T13:10:00.000Z"
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: mocked.token })
  })
}));

vi.mock("@/lib/demo/agent-handoff-token-v2.server", () => ({
  isByoaHandoffV2Token: (token: string) => token.startsWith("tbh2."),
  openByoaHandoffV2: () => ({
    expiresAt: mocked.expiresAt,
    session: {
      runId: mocked.runId,
      contractDigest: mocked.contractDigest,
      contract: { marker: "hidden-contract" },
      lineage: { marker: "digest-only-lineage" }
    }
  })
}));

import { POST as control } from "@/app/api/demo/handoff/control/route";
import { POST as open } from "@/app/api/demo/handoff/open/route";
import { POST as reveal } from "@/app/api/demo/handoff/reveal/route";
import { POST as revoke } from "@/app/api/demo/handoff/revoke/route";

const START = Date.parse("2026-09-01T13:00:00.000Z");
const CONTEXT = "fresh_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CONTEXT = "fresh_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function redis(): ByoaHandoffLedgerV2Redis {
  return createByoaHandoffLedgerV2Redis({
    NODE_ENV: "test",
    TOOLPROOF_BROWSER_FAKE_PROBE: "1"
  } as NodeJS.ProcessEnv);
}

function request(path: string, body: unknown, context?: string): Request {
  return new Request(`https://thurstone.invarra.ai${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://thurstone.invarra.ai",
      "X-Thurstone-Request": "byoa-handoff",
      ...(context ? { "X-Thurstone-Fresh-Context": context } : {})
    },
    body: JSON.stringify(body)
  });
}

async function issue() {
  await issueByoaHandoffV2(redis(), {
    runId: mocked.runId,
    contractDigest: mocked.contractDigest,
    token: mocked.token,
    expiresAtMs: Date.parse(mocked.expiresAt)
  });
}

describe("Handoff v2 route atomicity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TOOLPROOF_BROWSER_FAKE_PROBE", "1");
    mocked.runId = `byoa_run_aaaaaaaa-aaaa-4aaa-8aaa-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, "0")}`;
    mocked.contractDigest = `${Math.floor(Math.random() * 1e8)
      .toString(16)
      .padStart(8, "0")}${"a".repeat(56)}`;
    mocked.token = `tbh2.route-test-token-material-${mocked.contractDigest.slice(0, 24)}`;
    mocked.expiresAt = new Date(START + 10 * 60 * 1000).toISOString();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("allows same-context open retry and denies a second fresh context", async () => {
    await issue();
    const body = { token: mocked.token, freshContextId: CONTEXT };
    expect((await open(request("/api/demo/handoff/open", body))).status).toBe(200);
    expect((await open(request("/api/demo/handoff/open", body))).status).toBe(200);
    expect(
      (
        await open(
          request("/api/demo/handoff/open", {
            token: mocked.token,
            freshContextId: OTHER_CONTEXT
          })
        )
      ).status
    ).toBe(409);
  });

  it("blocks early reveal and second start, then reveals only after settlement", async () => {
    await issue();
    await claimByoaHandoffV2(redis(), {
      runId: mocked.runId,
      contractDigest: mocked.contractDigest,
      token: mocked.token,
      freshContextId: CONTEXT
    });
    await receiveByoaHandoffV2(redis(), {
      runId: mocked.runId,
      contractDigest: mocked.contractDigest,
      token: mocked.token,
      freshContextId: CONTEXT
    });
    const identity = {
      version: BYOA_HANDOFF_REVEAL_V2_VERSION,
      runId: mocked.runId,
      contractDigest: mocked.contractDigest
    };
    expect((await reveal(request("/api/demo/handoff/reveal", identity, CONTEXT))).status).toBe(404);
    const start = {
      version: BYOA_HANDOFF_CONTROL_V2_VERSION,
      action: "start",
      runId: mocked.runId,
      contractDigest: mocked.contractDigest
    } as const;
    expect((await control(request("/api/demo/handoff/control", start, CONTEXT))).status).toBe(200);
    expect((await control(request("/api/demo/handoff/control", start, CONTEXT))).status).toBe(409);
    expect((await reveal(request("/api/demo/handoff/reveal", identity, CONTEXT))).status).toBe(404);
    expect(
      (await control(request("/api/demo/handoff/control", { ...start, action: "settle" }, CONTEXT)))
        .status
    ).toBe(200);
    const revealed = await reveal(request("/api/demo/handoff/reveal", identity, CONTEXT));
    expect(revealed.status).toBe(200);
    expect(await revealed.json()).toMatchObject({ contract: { marker: "hidden-contract" } });
  });

  it("maps insufficient START lifetime to an expired handoff without mutating state", async () => {
    await issue();
    const binding = {
      runId: mocked.runId,
      contractDigest: mocked.contractDigest,
      token: mocked.token,
      freshContextId: CONTEXT
    } as const;
    await claimByoaHandoffV2(redis(), binding);
    await receiveByoaHandoffV2(redis(), binding);
    vi.setSystemTime(
      Date.parse(mocked.expiresAt) -
        BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS -
        BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS +
        1
    );
    const response = await control(
      request(
        "/api/demo/handoff/control",
        {
          version: BYOA_HANDOFF_CONTROL_V2_VERSION,
          action: "start",
          runId: mocked.runId,
          contractDigest: mocked.contractDigest
        },
        CONTEXT
      )
    );
    expect(response.status).toBe(410);
  });

  it("revokes idempotently before claim and refuses revocation after claim", async () => {
    await issue();
    const body = { version: BYOA_HANDOFF_REVOKE_V2_VERSION, token: mocked.token };
    expect((await revoke(request("/api/demo/handoff/revoke", body))).status).toBe(200);
    expect((await revoke(request("/api/demo/handoff/revoke", body))).status).toBe(200);

    mocked.runId = mocked.runId.replace(/a(?=[^a]*$)/u, "d");
    mocked.contractDigest = `d${mocked.contractDigest.slice(1)}`;
    mocked.token = `${mocked.token}-claimed`;
    await issue();
    await claimByoaHandoffV2(redis(), {
      runId: mocked.runId,
      contractDigest: mocked.contractDigest,
      token: mocked.token,
      freshContextId: CONTEXT
    });
    expect(
      (
        await revoke(
          request("/api/demo/handoff/revoke", {
            version: BYOA_HANDOFF_REVOKE_V2_VERSION,
            token: mocked.token
          })
        )
      ).status
    ).toBe(409);
  });
});
