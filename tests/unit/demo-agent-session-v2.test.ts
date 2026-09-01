import { beforeEach, describe, expect, it } from "vitest";

import {
  BYOA_AGENT_PROJECTION_V2_STORAGE_KEY,
  parseAgentVisibleRunProjectionV2,
  readAgentVisibleRunProjectionV2,
  writeAgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  BYOA_SESSION_V2_MAX_BYTES,
  BYOA_SESSION_V2_STORAGE_KEY,
  agentVisibleRunProjectionV2,
  canTransitionByoaSessionV2,
  clearByoaAgentSessionV2,
  createCompiledByoaSessionV2,
  parseByoaAgentSessionV2,
  readByoaAgentSessionV2,
  transitionByoaSessionV2,
  verifyByoaAgentSessionV2,
  writeByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import {
  BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
  byoaHandoffV2ReceivedAt,
  byoaHandoffBootstrapResponseV2Schema,
  parseHandoffEnvelopeV2,
  receiveAndRedactByoaSessionV2,
  transitionRemoteByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
import {
  createByoaHandoffEnvelopeV2,
  openByoaHandoffV2,
  sealByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import { BYOA_HANDOFF_TOKEN_MAX_BYTES } from "@/lib/demo/agent-handoff";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase
} from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";

const at = (second: number) => `2026-09-01T00:00:${String(second).padStart(2, "0")}.000Z`;
const environment = {
  NODE_ENV: "test",
  TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 23).toString("base64url")
} as NodeJS.ProcessEnv;

async function fixture() {
  let suite = await createThurstoneContractSuite({
    suiteId: "suite_10101010-1010-4010-8010-101010101010",
    name: "Reference checkout",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["cart_get", "cart_update", "order_review", "checkout_request"]
    }),
    createdAt: at(0)
  });
  suite = addContractSuiteCase(
    suite,
    {
      name: "Request checkout",
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
      approvalClass: "consequential"
    },
    {
      caseId: "case_20202020-2020-4020-8020-202020202020",
      updatedAt: at(1)
    }
  );
  suite = selectContractSuiteCase(suite, suite.cases[0]!.caseId, { updatedAt: at(2) });
  const lineage = await expectedLineageForThurstoneSuite(suite);
  const contract = await createByoaContractV3({
    contractId: "byoa_30303030-3030-4030-8030-303030303030",
    suite,
    buildCommit: "d".repeat(40),
    createdAt: at(3)
  });
  const session = await createCompiledByoaSessionV2({
    runId: "byoa_run_40404040-4040-4040-8040-404040404040",
    contract,
    lineage,
    createdAt: at(4),
    expiresAt: "2026-09-01T00:20:00.000Z"
  });
  return { suite, lineage, contract, session };
}

beforeEach(() => window.sessionStorage.clear());

describe("BYOA Agent Session v2", () => {
  it("preserves the exact lifecycle and requires an explicit start", async () => {
    const { session } = await fixture();
    expect(canTransitionByoaSessionV2("COMPILED", "HANDOFF_ISSUED")).toBe(true);
    expect(canTransitionByoaSessionV2("HANDOFF_ISSUED", "RECEIVED")).toBe(true);
    expect(canTransitionByoaSessionV2("RECEIVED", "READY_TO_ARM")).toBe(true);
    expect(canTransitionByoaSessionV2("READY_TO_ARM", "PREPARING")).toBe(true);
    expect(canTransitionByoaSessionV2("COMPILED", "PREPARING")).toBe(false);

    let current = transitionByoaSessionV2(session, "HANDOFF_ISSUED", {
      at: at(5),
      reasonCode: "owner_issued_fresh_handoff"
    });
    current = transitionByoaSessionV2(current, "RECEIVED", {
      at: at(6),
      reasonCode: "fresh_agent_handoff_received"
    });
    current = transitionByoaSessionV2(current, "READY_TO_ARM", {
      at: at(7),
      reasonCode: "agent_acknowledged_test"
    });
    expect(() =>
      transitionByoaSessionV2(current, "PREPARING", {
        at: at(8),
        reasonCode: "implicit_document_load"
      })
    ).toThrow(/explicit start/iu);
    current = transitionByoaSessionV2(current, "PREPARING", {
      at: at(8),
      reasonCode: "ignored_by_explicit_boundary",
      explicitStart: true
    });
    expect(current.transitions.at(-1)?.reasonCode).toBe("agent_explicit_start");
    expect(current.state).toBe("PREPARING");
  });

  it("binds Contract v3 to independent lineage and its canonical digest", async () => {
    const { session, lineage } = await fixture();
    await expect(verifyByoaAgentSessionV2(session, lineage)).resolves.toEqual(session);
    await expect(
      verifyByoaAgentSessionV2(session, { ...lineage, suiteDigest: "0".repeat(64) })
    ).rejects.toThrow();
    expect(() =>
      parseByoaAgentSessionV2({
        ...session,
        lineage: { ...session.lineage, caseId: "case_99999999-9999-4999-8999-999999999999" }
      })
    ).toThrow(/lineage/iu);
    expect(() => parseByoaAgentSessionV2({ ...session, unknown: true })).toThrow();
  });

  it("projects the exact 2–4 tool catalog without the owner rubric", async () => {
    const { session } = await fixture();
    const projection = agentVisibleRunProjectionV2(session);
    expect(projection.descriptors.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);
    const encoded = JSON.stringify(projection);
    for (const forbidden of [
      "expectedTool",
      "argumentPredicate",
      "allowedEffects",
      "forbiddenEffects",
      "replayPolicy",
      "approvalClass",
      "suiteDigest",
      "caseDigest"
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    expect(() =>
      parseAgentVisibleRunProjectionV2({ ...projection, expectedTool: "checkout_request" })
    ).toThrow();
    writeAgentVisibleRunProjectionV2(window.sessionStorage, projection);
    expect(readAgentVisibleRunProjectionV2(window.sessionStorage)).toEqual(projection);
    expect(window.sessionStorage.getItem(BYOA_AGENT_PROJECTION_V2_STORAGE_KEY)).not.toBeNull();
  });

  it("uses a separate bounded storage key without changing v1 bytes", async () => {
    const { session } = await fixture();
    writeByoaAgentSessionV2(window.sessionStorage, session);
    expect(readByoaAgentSessionV2(window.sessionStorage)).toEqual(session);
    clearByoaAgentSessionV2(window.sessionStorage);
    expect(readByoaAgentSessionV2(window.sessionStorage)).toBeNull();
    window.sessionStorage.setItem(
      BYOA_SESSION_V2_STORAGE_KEY,
      "x".repeat(BYOA_SESSION_V2_MAX_BYTES + 1)
    );
    expect(() => readByoaAgentSessionV2(window.sessionStorage)).toThrow(/exceeds/iu);
  });
});

describe("BYOA fresh-agent Handoff v2", () => {
  it("derives a RECEIVED timestamp strictly after HANDOFF_ISSUED even on an equal clock", () => {
    expect(byoaHandoffV2ReceivedAt(at(5), Date.parse(at(5)))).toBe("2026-09-01T00:00:05.001Z");
  });

  it("seals only the selected Contract v3 and opens in RECEIVED without starting observation", async () => {
    const { session, contract } = await fixture();
    const issued = transitionByoaSessionV2(session, "HANDOFF_ISSUED", {
      at: at(5),
      reasonCode: "owner_issued_fresh_handoff"
    });
    const projection = agentVisibleRunProjectionV2(issued);
    const envelope = createByoaHandoffEnvelopeV2({
      session: issued,
      projection,
      now: new Date(at(6))
    });
    const token = sealByoaHandoffV2(envelope, environment);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(BYOA_HANDOFF_TOKEN_MAX_BYTES);
    expect(token).not.toContain(contract.request);
    expect(token).not.toContain("expectedTool");

    const opened = openByoaHandoffV2(token, {
      environment,
      now: new Date(at(7))
    });
    expect(parseHandoffEnvelopeV2(opened)).toEqual(envelope);
    const envelopeBytes = JSON.stringify(opened);
    expect(envelopeBytes).not.toContain("issuedCaseIds");
    expect(envelopeBytes).not.toContain('"cases"');

    const remote = receiveAndRedactByoaSessionV2(opened.session, opened.issuedAt);
    const openedProjection = agentVisibleRunProjectionV2(opened.session);
    const bootstrap = byoaHandoffBootstrapResponseV2Schema.parse({
      version: BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
      session: remote,
      projection: openedProjection
    });
    expect(bootstrap.session.state).toBe("RECEIVED");
    const bootstrapBytes = JSON.stringify(bootstrap);
    for (const forbidden of [
      "expectedTool",
      "argumentPredicate",
      "allowedEffects",
      "forbiddenEffects",
      "replayPolicy",
      "approvalClass",
      "observationStartedAt",
      "registryGeneration"
    ]) {
      expect(bootstrapBytes).not.toContain(forbidden);
    }
  });

  it("keeps preparation behind READY_TO_ARM and explicit start", async () => {
    const { session } = await fixture();
    const issued = transitionByoaSessionV2(session, "HANDOFF_ISSUED", {
      at: at(5),
      reasonCode: "owner_issued_fresh_handoff"
    });
    let remote = receiveAndRedactByoaSessionV2(issued, at(6));
    remote = transitionRemoteByoaSessionV2(remote, "READY_TO_ARM", {
      at: at(7),
      reasonCode: "fresh_page_ready"
    });
    expect(() =>
      transitionRemoteByoaSessionV2(remote, "PREPARING", {
        at: at(8),
        reasonCode: "page_loaded"
      })
    ).toThrow(/explicit start/iu);
    remote = transitionRemoteByoaSessionV2(remote, "PREPARING", {
      at: at(8),
      reasonCode: "start_button_activated",
      explicitStart: true
    });
    expect(remote.state).toBe("PREPARING");
    expect(remote.transitions.at(-1)?.reasonCode).toBe("agent_explicit_start");
  });

  it("rejects unknown fields, tampering, and expiry", async () => {
    const { session } = await fixture();
    const issued = transitionByoaSessionV2(session, "HANDOFF_ISSUED", {
      at: at(5),
      reasonCode: "owner_issued_fresh_handoff"
    });
    const envelope = createByoaHandoffEnvelopeV2({
      session: issued,
      projection: agentVisibleRunProjectionV2(issued),
      now: new Date(at(6))
    });
    expect(() => parseHandoffEnvelopeV2({ ...envelope, answerKey: true })).toThrow();
    const token = sealByoaHandoffV2(envelope, environment);
    expect(() =>
      openByoaHandoffV2(`${token.slice(0, -1)}x`, {
        environment,
        now: new Date(at(7))
      })
    ).toThrow(/invalid or expired/iu);
    expect(() =>
      openByoaHandoffV2(token, {
        environment,
        now: new Date("2026-09-01T00:21:00.000Z")
      })
    ).toThrow(/invalid or expired/iu);
  });
});
