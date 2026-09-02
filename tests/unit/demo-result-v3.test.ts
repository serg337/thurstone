import { describe, expect, it } from "vitest";

import {
  createByoaAgentEnvironmentV2,
  createByoaAgentEnvironmentV2FromProjection,
  type ByoaAgentEnvironmentV2
} from "@/lib/demo/agent-environment-v2";
import {
  agentVisibleRunProjectionV2,
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  type ByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseInput
} from "@/lib/demo/contract-suite";
import { createNoInvocationResultV3, evaluateByoaEnvironmentV3 } from "@/lib/demo/evaluator-v3";
import {
  clearByoaResultV3,
  readByoaResultV3,
  writeByoaResultV3
} from "@/lib/demo/byoa-result-storage-v3";
import { BYOA_RESULT_VERSION, parseByoaDemoResult } from "@/lib/demo/result-v2";
import {
  parseByoaDemoResultV3,
  verifyByoaDemoResultV3,
  type ByoaDemoResultV3
} from "@/lib/demo/result-v3";
import type { ThurstoneDemoSelectableToolName } from "@/lib/demo/reference-tool-templates";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type {
  CommitDisposition,
  JsonSafeValue,
  OperationTraceStatus
} from "@/lib/evidence/operation-trace";

const buildCommit = "b".repeat(40);
const at = (second: number) => `2026-09-01T08:00:${String(second).padStart(2, "0")}.000Z`;
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function caseInput(tool: ThurstoneDemoSelectableToolName): ThurstoneContractCaseInput {
  if (tool === "cart_get" || tool === "order_review") {
    return {
      name: tool === "cart_get" ? "Read cart" : "Review order",
      request: tool === "cart_get" ? "What is in my cart?" : "Show me the complete order.",
      expectedTool: tool,
      argumentPredicate: { kind: "empty" },
      allowedEffects: [],
      forbiddenEffects: [
        { kind: "cart_mutation" },
        { kind: "pending_checkout" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "read_only",
      approvalClass: "read_only"
    };
  }
  if (tool === "cart_update") {
    return {
      name: "Update mug quantity",
      request: "Set the stoneware mug quantity to three.",
      expectedTool: tool,
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 3
      },
      allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 3 }],
      forbiddenEffects: [
        { kind: "pending_checkout" },
        { kind: "duplicate_transition" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "exactly_once",
      approvalClass: "consequential"
    };
  }
  return {
    name: "Request checkout",
    request: "I am ready—request checkout for this cart.",
    expectedTool: tool,
    argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
    allowedEffects: [{ kind: "pending_checkout" }],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    approvalClass: "consequential"
  };
}

async function evaluatingSession(
  tool: ThurstoneDemoSelectableToolName,
  index: number,
  targetState: "PREPARING" | "PROVIDER_READY" | "ARMED" | "OBSERVING" | "EVALUATING" = "EVALUATING",
  caseOverride?: ThurstoneContractCaseInput
): Promise<ByoaAgentSessionV2> {
  let suite = await createThurstoneContractSuite({
    suiteId: `suite_${uuid(index * 3 + 1)}`,
    name: `${tool} suite`,
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["cart_get", "cart_update", "order_review", "checkout_request"]
    }),
    createdAt: at(0)
  });
  const caseId = `case_${uuid(index * 3 + 2)}`;
  suite = addContractSuiteCase(suite, caseOverride ?? caseInput(tool), {
    caseId,
    updatedAt: at(1)
  });
  suite = selectContractSuiteCase(suite, caseId, { updatedAt: at(2) });
  const lineage = await expectedLineageForThurstoneSuite(suite);
  const contract = await createByoaContractV3({
    contractId: `byoa_${uuid(index * 3 + 3)}`,
    suite,
    buildCommit,
    createdAt: at(3)
  });
  let session = await createCompiledByoaSessionV2({
    runId: `byoa_run_${uuid(index * 3 + 4)}`,
    contract,
    lineage,
    createdAt: at(3),
    expiresAt: "2026-09-01T08:10:00.000Z"
  });
  const path = [
    "HANDOFF_ISSUED",
    "RECEIVED",
    "READY_TO_ARM",
    "PREPARING",
    "PROVIDER_READY",
    "ARMED",
    "OBSERVING",
    "EVALUATING"
  ] as const;
  for (const [step, state] of path.entries()) {
    session = transitionByoaSessionV2(session, state, {
      at: at(step + 4),
      reasonCode: state === "PREPARING" ? "agent_explicit_start" : `test_${state.toLowerCase()}`,
      ...(state === "PREPARING" ? { explicitStart: true as const } : {})
    });
    if (state === targetState) break;
  }
  return session;
}

async function invoke(
  environment: ByoaAgentEnvironmentV2,
  tool: ThurstoneDemoSelectableToolName,
  argumentsValue: Record<string, unknown>
) {
  const selected = environment.tools.find(({ name }) => name === tool);
  if (selected === undefined) throw new Error(`Missing test tool ${tool}.`);
  return selected.execute(argumentsValue, { signal: new AbortController().signal });
}

function argumentsFor(tool: ThurstoneDemoSelectableToolName): Record<string, unknown> {
  if (tool === "cart_get" || tool === "order_review") return {};
  if (tool === "cart_update") {
    return {
      operationId: "result_v3_update_0001",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 3
    };
  }
  return { operationId: "result_v3_checkout_0001" };
}

async function evaluateContextContaminated(
  session: ByoaAgentSessionV2,
  environment: ByoaAgentEnvironmentV2
): Promise<ByoaDemoResultV3> {
  return evaluateByoaEnvironmentV3({
    session,
    environment,
    launchMode: "fresh-agent-handoff",
    evidenceTier: "native-plumbing-context-contaminated",
    armedAt: at(9),
    completedAt: at(20)
  });
}

async function overrideLastTraceStatus(
  environment: ByoaAgentEnvironmentV2,
  status: OperationTraceStatus,
  commitDisposition: CommitDisposition,
  errorValue: JsonSafeValue | null = null
): Promise<void> {
  const snapshot = environment.ledger.snapshot();
  const trace = snapshot.current.at(-1);
  if (trace === undefined) throw new Error("Expected a native trace to override.");
  const error =
    errorValue === null
      ? null
      : {
          value: errorValue,
          bytes: canonicalJson(errorValue),
          sha256: await sha256Hex(canonicalJson(errorValue))
        };
  const current = Object.freeze([
    ...snapshot.current.slice(0, -1),
    Object.freeze({
      ...trace,
      status,
      commitDisposition,
      ...(error === null ? {} : { rawResult: null, canonicalResult: null, error })
    })
  ]);
  Object.defineProperty(environment.ledger, "snapshot", {
    configurable: true,
    value: () => Object.freeze({ ...snapshot, current })
  });
}

describe("BYOA Result v3 and dynamic evaluator", () => {
  it("passes each real dynamic tool using independent state and ledger evidence", async () => {
    const tools = ["cart_get", "order_review", "cart_update", "checkout_request"] as const;
    for (const [index, tool] of tools.entries()) {
      const session = await evaluatingSession(tool, index + 1);
      const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
      await invoke(environment, tool, argumentsFor(tool));
      const result = await evaluateContextContaminated(session, environment);

      expect(result.verdict).toBe("pass");
      expect(result.selectedExpectedTool).toBe(tool);
      expect(result.observedTool).toBe(tool);
      expect(result.sourceTruth).toEqual({
        trustedStateSource: "thurstone-reference-checkout-ledger",
        stateAuthority: "browser-local-site-owned-sandbox",
        ledgerAuthority: "append-only-native-operation-ledger",
        toolResponseRole: "corroborating-only"
      });
      expect(result.ledgerDiff.eventCountDelta).toBe(1);
      expect(result.ledgerDiff.stateTransitionCount).toBe(
        tool === "cart_get" || tool === "order_review" ? 0 : 1
      );
      expect(result.replayMeasurement).toBe("not-measured-single-admitted-call");
      expect(result.assertions.some(({ scope }) => scope === "replay")).toBe(false);
      expect(result.diagnostic.status).toBe("not-needed");
      await expect(verifyByoaDemoResultV3(result)).resolves.toEqual(result);
    }
  });

  it("treats quantity zero as a verified cart-line removal", async () => {
    const removalCase: ThurstoneContractCaseInput = {
      ...caseInput("cart_update"),
      name: "Remove notebook",
      request: "Remove the field notebook from my cart.",
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId: "field-notebook",
        quantity: 0
      },
      allowedEffects: [{ kind: "cart_quantity", itemId: "field-notebook", quantity: 0 }]
    };
    const session = await evaluatingSession("cart_update", 9, "EVALUATING", removalCase);
    const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
    await invoke(environment, "cart_update", {
      operationId: "result_v3_remove_0001",
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 0
    });
    const result = await evaluateContextContaminated(session, environment);

    expect(result.verdict).toBe("pass");
    expect(result.trustedStateAfter.value.lines).toEqual([
      expect.objectContaining({ itemId: "stoneware-mug", quantity: 2 })
    ]);
    expect(result.ledgerDiff.effect.quantities).toContainEqual(
      expect.objectContaining({
        itemId: "field-notebook",
        beforeQuantity: 1,
        afterQuantity: null,
        changed: true
      })
    );
  });

  it("records a wrong first tool as ISSUE without inventing a state transition", async () => {
    const session = await evaluatingSession("checkout_request", 10);
    const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
    await invoke(environment, "order_review", {});
    const result = await evaluateContextContaminated(session, environment);

    expect(result.verdict).toBe("issue");
    expect(result.selectedExpectedTool).toBe("checkout_request");
    expect(result.observedTool).toBe("order_review");
    expect(result.ledgerDiff.stateTransitionCount).toBe(0);
    expect(result.trustedStateAfter.sha256).toBe(result.trustedStateBefore.sha256);
    expect(result.diagnosticSignals.map(({ code }) => code)).toContain("wrong_tool_selected");
    expect(result.diagnosticSignals.map(({ code }) => code)).toContain("required_argument_missing");
    expect(result.diagnostic.findings.map(({ code }) => code)).toContain("required_effect_missing");
    const diagnosticRefs = result.diagnosticSignals.flatMap(({ evidenceRefs }) => evidenceRefs);
    for (const reference of diagnosticRefs) {
      if (
        (reference.source === "trusted-state-before" ||
          reference.source === "trusted-state-after") &&
        reference.jsonPointer === ""
      ) {
        expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/u);
      } else if (
        reference.source === "native-trace" &&
        reference.jsonPointer === "/canonicalArguments"
      ) {
        expect(reference.sha256).toBe(await sha256Hex(canonicalJson(result.canonicalArguments)));
      } else {
        expect(reference.sha256).toBeNull();
      }
    }
  });

  it("preserves invalid arguments and handler rejection as honest ISSUE evidence", async () => {
    const session = await evaluatingSession("cart_update", 20);
    const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
    await invoke(environment, "cart_update", {});
    const result = await evaluateContextContaminated(session, environment);

    expect(result.verdict).toBe("issue");
    expect(result.canonicalArguments).toBeNull();
    expect(result.handlerOutcome).toMatchObject({
      status: "validation_error",
      commitDisposition: "none",
      error: null
    });
    expect(result.handlerOutcome?.canonicalResult).toMatchObject({ ok: false });
    expect(result.ledgerDiff.stateTransitionCount).toBe(0);
    expect(result.diagnosticSignals.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "required_argument_missing",
        "handler_rejected_expected_call",
        "required_effect_missing"
      ])
    );
  });

  it("supports verified independent-agent provenance and rejects tier or digest tampering", async () => {
    const session = await evaluatingSession("cart_get", 30);
    const projection = agentVisibleRunProjectionV2(session);
    const environment = await createByoaAgentEnvironmentV2FromProjection(projection, buildCommit);
    await invoke(environment, "cart_get", {});
    const result = await evaluateByoaEnvironmentV3({
      session,
      environment,
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: at(9),
      completedAt: at(20)
    });

    expect(result).toMatchObject({
      verdict: "pass",
      answerKeyIsolation: "verified-withheld",
      evidenceTier: "independent-agent-native"
    });
    expect(() => parseByoaDemoResultV3({ ...result, unexpected: true })).toThrow();
    expect(() =>
      parseByoaDemoResultV3({
        ...result,
        launchMode: "direct-browser-compatibility"
      })
    ).toThrow(/incompatible/iu);
    await expect(
      verifyByoaDemoResultV3({ ...result, resultDigest: "0".repeat(64) })
    ).rejects.toThrow(/result bytes/iu);
    expect(BYOA_RESULT_VERSION).toBe("thurstone-byoa-result@2");
    expect(() => parseByoaDemoResult(result)).toThrow();
  });

  it("records a strict no-invocation terminal and round-trips Result v3 storage", async () => {
    const session = await evaluatingSession("checkout_request", 40);
    const projection = agentVisibleRunProjectionV2(session);
    const environment = await createByoaAgentEnvironmentV2FromProjection(projection, buildCommit);
    const result = await createNoInvocationResultV3({
      session,
      environment,
      verdict: "incomplete",
      detail: "No native invocation was observed before the bounded timeout.",
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: at(9),
      completedAt: at(20)
    });

    expect(result).toMatchObject({
      verdict: "incomplete",
      observedTool: null,
      rawArguments: null,
      canonicalArguments: null,
      handlerOutcome: null,
      answerKeyIsolation: "verified-withheld",
      ledgerDiff: { eventCountDelta: 0, stateTransitionCount: 0 }
    });
    expect(result.diagnosticSignals.map(({ code }) => code)).toEqual([
      "agent_decision_unobservable"
    ]);
    expect(result.diagnostic).toMatchObject({
      status: "inconclusive",
      releaseGuidance: "rerun-required"
    });

    sessionStorage.clear();
    await writeByoaResultV3(sessionStorage, result);
    await expect(readByoaResultV3(sessionStorage)).resolves.toEqual(result);
    sessionStorage.setItem(
      "thurstone:byoa-result@3",
      JSON.stringify({ ...result, verdict: "pass" })
    );
    await expect(readByoaResultV3(sessionStorage)).rejects.toThrow();
    clearByoaResultV3(sessionStorage);
    await expect(readByoaResultV3(sessionStorage)).resolves.toBeNull();
  });

  it("records pre-arm UNAVAILABLE without inventing an arm timestamp", async () => {
    const session = await evaluatingSession("checkout_request", 50, "PREPARING");
    const projection = agentVisibleRunProjectionV2(session);
    const environment = await createByoaAgentEnvironmentV2FromProjection(projection, buildCommit);
    const result = await createNoInvocationResultV3({
      session,
      environment,
      verdict: "unavailable",
      detail: "The native provider was unavailable before the observation boundary armed.",
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: null,
      completedAt: at(20)
    });

    expect(result).toMatchObject({ verdict: "unavailable", armedAt: null, observedTool: null });
    expect(() => parseByoaDemoResultV3({ ...result, verdict: "pass" })).toThrow(
      /pre-arm UNAVAILABLE/iu
    );
    await expect(verifyByoaDemoResultV3(result)).resolves.toEqual(result);
  });

  it("maps expected and unexpected handler errors to honest ISSUE results", async () => {
    const expectedSession = await evaluatingSession("cart_update", 60);
    const expectedEnvironment = await createByoaAgentEnvironmentV2(
      expectedSession.contract,
      buildCommit
    );
    await invoke(expectedEnvironment, "cart_update", {});
    await overrideLastTraceStatus(expectedEnvironment, "expected_error", "none");
    const expectedResult = await evaluateContextContaminated(expectedSession, expectedEnvironment);
    expect(expectedResult).toMatchObject({
      verdict: "issue",
      handlerOutcome: { status: "expected_error", commitDisposition: "none" }
    });

    const unexpectedSession = await evaluatingSession("order_review", 70);
    const unexpectedEnvironment = await createByoaAgentEnvironmentV2(
      unexpectedSession.contract,
      buildCommit
    );
    await invoke(unexpectedEnvironment, "order_review", {});
    await overrideLastTraceStatus(unexpectedEnvironment, "unexpected_error", "none", {
      name: "Error",
      message: "Synthetic unexpected handler error."
    });
    const unexpectedResult = await evaluateContextContaminated(
      unexpectedSession,
      unexpectedEnvironment
    );
    expect(unexpectedResult).toMatchObject({
      verdict: "issue",
      handlerOutcome: {
        status: "unexpected_error",
        error: { name: "Error", message: "Synthetic unexpected handler error." }
      }
    });
  });

  it("maps canceled and partial traces to INCOMPLETE without semantic diagnosis", async () => {
    for (const [index, status] of (["canceled", "partial"] as const).entries()) {
      const session = await evaluatingSession("order_review", 80 + index);
      const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
      await invoke(environment, "order_review", {});
      await overrideLastTraceStatus(
        environment,
        status,
        status === "partial" ? "partial" : "none",
        {
          name: status === "canceled" ? "AbortError" : "Error",
          message: status === "canceled" ? "Canceled before completion." : "Trace sink partial."
        }
      );
      const result = await evaluateContextContaminated(session, environment);
      expect(result.verdict).toBe("incomplete");
      expect(result.handlerOutcome?.status).toBe(status);
      expect(result.diagnosticSignals.map(({ code }) => code)).toEqual([
        "execution_canceled_or_partial"
      ]);
      expect(result.diagnostic.status).toBe("inconclusive");
    }
  });

  it("keeps direct-browser and controlled-example evidence in their exact tiers", async () => {
    const provenances = [
      ["direct-browser-compatibility", "direct-browser-compatibility"],
      ["controlled-example", "deterministic-controlled-example"]
    ] as const;
    for (const [index, provenance] of provenances.entries()) {
      const session = await evaluatingSession("cart_get", 90 + index);
      const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
      await invoke(environment, "cart_get", {});
      const result = await evaluateByoaEnvironmentV3({
        session,
        environment,
        launchMode: provenance[0],
        evidenceTier: provenance[1],
        armedAt: at(9),
        completedAt: at(20)
      });
      expect(result).toMatchObject({
        verdict: "pass",
        launchMode: provenance[0],
        evidenceTier: provenance[1],
        answerKeyIsolation: "not-applicable"
      });
    }
  });

  it("rejects a digest-valid but nondeterministic diagnostic rewrite", async () => {
    const session = await evaluatingSession("checkout_request", 100);
    const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
    await invoke(environment, "order_review", {});
    const result = await evaluateContextContaminated(session, environment);
    const diagnostic = {
      ...result.diagnostic,
      limitations: [
        ...result.diagnostic.limitations.slice(0, -1),
        "A syntactically valid but non-deterministic replacement limitation."
      ]
    };
    const withoutDigest = { ...result, diagnostic } as Record<string, unknown>;
    delete withoutDigest.resultDigest;
    const tampered = {
      ...withoutDigest,
      resultDigest: await canonicalSha256(withoutDigest)
    };

    await expect(verifyByoaDemoResultV3(tampered)).rejects.toThrow(
      /deterministic diagnostic signals/iu
    );
  });
});
