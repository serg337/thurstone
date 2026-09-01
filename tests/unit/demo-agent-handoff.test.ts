import { describe, expect, it } from "vitest";

import {
  agentVisibleRunProjection,
  createCompiledByoaSession,
  transitionByoaSession
} from "@/lib/demo/agent-session";
import {
  BYOA_HANDOFF_BOOTSTRAP_VERSION,
  BYOA_HANDOFF_TOKEN_MAX_BYTES,
  byoaHandoffBootstrapResponseSchema,
  hydrateRemoteByoaSession,
  redactByoaSession,
  transitionRemoteByoaSession
} from "@/lib/demo/agent-handoff";
import {
  createByoaHandoffEnvelope,
  openByoaHandoff,
  sealByoaHandoff
} from "@/lib/demo/agent-handoff-token.server";
import {
  byoaContractDigest,
  createByoaContract,
  createByoaDescriptorSnapshot
} from "@/lib/demo/contract-v2";

const environment = {
  NODE_ENV: "test",
  TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 19).toString("base64url")
} as NodeJS.ProcessEnv;

async function fixture() {
  const descriptors = await createByoaDescriptorSnapshot();
  const contract = createByoaContract({
    contractId: "byoa_15151515-1515-4515-8515-151515151515",
    request: "I am ready—request checkout for this cart.",
    expectedTool: "checkout_request",
    argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
    allowedEffects: [{ kind: "pending_checkout" }],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    approvalClass: "consequential",
    ...descriptors,
    buildCommit: "d".repeat(40),
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  const compiled = createCompiledByoaSession({
    runId: "byoa_run_16161616-1616-4616-8616-161616161616",
    contract,
    contractDigest: await byoaContractDigest(contract),
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:30:00.000Z"
  });
  const session = transitionByoaSession(compiled, "NAVIGATING", {
    at: "2026-09-01T00:00:01.000Z",
    reasonCode: "owner_armed_live_test"
  });
  return { contract, session, projection: agentVisibleRunProjection(session) };
}

describe("BYOA fresh-agent handoff", () => {
  it("seals the hidden contract while exposing only a redacted bootstrap projection", async () => {
    const value = await fixture();
    const envelope = createByoaHandoffEnvelope({
      session: value.session,
      projection: value.projection,
      rerun: null,
      now: new Date("2026-09-01T00:00:02.000Z")
    });
    const token = sealByoaHandoff(envelope, environment);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(BYOA_HANDOFF_TOKEN_MAX_BYTES);
    expect(token).not.toContain(value.contract.request);
    expect(token).not.toContain("expectedTool");
    const opened = openByoaHandoff(token, {
      environment,
      now: new Date("2026-09-01T00:00:03.000Z")
    });
    expect(opened.session.contract).toEqual(value.contract);
    const bootstrap = byoaHandoffBootstrapResponseSchema.parse({
      version: BYOA_HANDOFF_BOOTSTRAP_VERSION,
      session: redactByoaSession(opened.session),
      projection: opened.projection,
      rerun: null
    });
    const encoded = JSON.stringify(bootstrap);
    for (const sentinel of [
      "expectedTool",
      "argumentPredicate",
      "allowedEffects",
      "forbiddenEffects",
      "replayPolicy",
      "approvalClass"
    ]) {
      expect(encoded).not.toContain(sentinel);
    }
    expect(() =>
      byoaHandoffBootstrapResponseSchema.parse({
        ...bootstrap,
        projection: {
          ...bootstrap.projection,
          runId: "byoa_run_17171717-1717-4717-8717-171717171717"
        }
      })
    ).toThrow(/identities must match/iu);
  });

  it("rejects tampering and expiry, then hydrates the exact contract only after reveal", async () => {
    const value = await fixture();
    const envelope = createByoaHandoffEnvelope({
      session: value.session,
      projection: value.projection,
      rerun: null,
      now: new Date("2026-09-01T00:00:02.000Z")
    });
    const token = sealByoaHandoff(envelope, environment);
    expect(() =>
      openByoaHandoff(`${token.slice(0, -1)}x`, {
        environment,
        now: new Date("2026-09-01T00:00:03.000Z")
      })
    ).toThrow(/invalid or expired/iu);
    expect(() =>
      openByoaHandoff(token, {
        environment,
        now: new Date("2026-09-01T00:11:00.000Z")
      })
    ).toThrow(/invalid or expired/iu);

    let remote = redactByoaSession(envelope.session);
    remote = transitionRemoteByoaSession(remote, "PREPARING", {
      at: "2026-09-01T00:00:03.000Z",
      reasonCode: "isolated_document_loaded"
    });
    remote = transitionRemoteByoaSession(remote, "PROVIDER_READY", {
      at: "2026-09-01T00:00:04.000Z",
      reasonCode: "frozen_catalog_registered"
    });
    remote = transitionRemoteByoaSession(remote, "ARMED", {
      at: "2026-09-01T00:00:05.000Z",
      reasonCode: "observation_boundary_armed"
    });
    const hydrated = hydrateRemoteByoaSession(remote, envelope.session.contract);
    expect(hydrated.contract).toEqual(value.contract);
    expect(hydrated.state).toBe("ARMED");
    expect(hydrated.contractDigest).toBe(value.session.contractDigest);
  });
});
