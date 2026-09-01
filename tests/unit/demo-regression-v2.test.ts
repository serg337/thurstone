import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { RegressionActionsV3 } from "@/components/demo/regression-actions-v3";
import { BYOA_HANDOFF_TOKEN_MAX_BYTES } from "@/lib/demo/agent-handoff";
import {
  createByoaHandoffEnvelopeV2,
  openByoaHandoffV2,
  sealByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import { createByoaAgentEnvironmentV2 } from "@/lib/demo/agent-environment-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase
} from "@/lib/demo/contract-suite";
import { createNoInvocationResultV3, evaluateByoaEnvironmentV3 } from "@/lib/demo/evaluator-v3";
import {
  createRegressionCaseV2,
  parseRegressionCaseV2,
  verifyRegressionCaseV2
} from "@/lib/demo/regression-case-v2";
import {
  createEditableSuiteCopyFromResultV3,
  prepareRegressionRerunV2
} from "@/lib/demo/regression-rerun-v2";
import {
  MY_TESTS_V2_STORAGE_KEY,
  clearMyTestsV2,
  readMyTestsV2,
  regressionEntryV2ExportJson,
  removeMyTestV2,
  resultV3ExportJson,
  saveRegressionResultAcrossFreshContextV2,
  saveRegressionResultV2
} from "@/lib/demo/regression-store-v2";
import {
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  type ByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";

const buildCommit = "c".repeat(40);
const successorBuildCommit = "d".repeat(40);
const handoffEnvironment = {
  NODE_ENV: "test",
  TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 31).toString("base64url")
} as NodeJS.ProcessEnv;
const uuid = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const at = (second: number) => `2026-09-01T12:00:${String(second).padStart(2, "0")}.000Z`;

class SeparateStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function sessionAtEvaluating(index: number): Promise<ByoaAgentSessionV2> {
  let suite = await createThurstoneContractSuite({
    suiteId: `suite_${uuid(index * 10 + 1)}`,
    name: "Order review regression suite",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot(),
    createdAt: at(0)
  });
  const caseId = `case_${uuid(index * 10 + 2)}`;
  suite = addContractSuiteCase(
    suite,
    {
      name: "Review the order",
      request: "Show me the complete order before I decide.",
      expectedTool: "order_review",
      argumentPredicate: { kind: "empty" },
      allowedEffects: [],
      forbiddenEffects: [
        { kind: "cart_mutation" },
        { kind: "pending_checkout" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "read_only",
      approvalClass: "read_only"
    },
    { caseId, updatedAt: at(1) }
  );
  suite = selectContractSuiteCase(suite, caseId, { updatedAt: at(2) });
  const lineage = await expectedLineageForThurstoneSuite(suite);
  const contract = await createByoaContractV3({
    contractId: `byoa_${uuid(index * 10 + 3)}`,
    suite,
    buildCommit,
    createdAt: at(3)
  });
  let session = await createCompiledByoaSessionV2({
    runId: `byoa_run_${uuid(index * 10 + 4)}`,
    contract,
    lineage,
    createdAt: at(3),
    expiresAt: "2026-09-01T12:10:00.000Z"
  });
  const states = [
    "HANDOFF_ISSUED",
    "RECEIVED",
    "READY_TO_ARM",
    "PREPARING",
    "PROVIDER_READY",
    "ARMED",
    "OBSERVING",
    "EVALUATING"
  ] as const;
  for (const [step, state] of states.entries()) {
    session = transitionByoaSessionV2(session, state, {
      at: at(step + 4),
      reasonCode: state === "PREPARING" ? "agent_explicit_start" : `test_${state.toLowerCase()}`,
      ...(state === "PREPARING" ? { explicitStart: true as const } : {})
    });
  }
  return session;
}

async function terminalResult(
  verdict: "pass" | "issue" | "incomplete",
  index: number
): Promise<ByoaDemoResultV3> {
  const session = await sessionAtEvaluating(index);
  const environment = await createByoaAgentEnvironmentV2(session.contract, buildCommit);
  if (verdict === "incomplete") {
    return createNoInvocationResultV3({
      session,
      environment,
      verdict,
      detail: "No native invocation was observed before the bounded timeout.",
      launchMode: "fresh-agent-handoff",
      evidenceTier: "native-plumbing-context-contaminated",
      armedAt: at(9),
      completedAt: at(20)
    });
  }
  const selected = environment.tools.find(({ name }) =>
    verdict === "pass" ? name === "order_review" : name === "checkout_request"
  );
  if (!selected) throw new Error("Test tool is missing.");
  await selected.execute(verdict === "pass" ? {} : { operationId: `regression_issue_${index}` }, {
    signal: new AbortController().signal
  });
  return evaluateByoaEnvironmentV3({
    session,
    environment,
    launchMode: "fresh-agent-handoff",
    evidenceTier: "native-plumbing-context-contaminated",
    armedAt: at(9),
    completedAt: at(20)
  });
}

async function successorResult(
  source: ByoaDemoResultV3,
  regressionCaseDigest: string
): Promise<ByoaDemoResultV3> {
  const prepared = await prepareRegressionRerunV2({
    sourceResult: source,
    regressionCaseDigest,
    contractId: `byoa_${uuid(904)}`,
    runId: `byoa_run_${uuid(905)}`,
    buildCommit: successorBuildCommit,
    createdAt: "2026-09-01T13:00:00.000Z",
    expiresAt: "2026-09-01T13:10:00.000Z"
  });
  let session = prepared.session;
  const states = [
    "RECEIVED",
    "READY_TO_ARM",
    "PREPARING",
    "PROVIDER_READY",
    "ARMED",
    "OBSERVING",
    "EVALUATING"
  ] as const;
  for (const [step, state] of states.entries()) {
    session = transitionByoaSessionV2(session, state, {
      at: new Date(Date.parse(session.updatedAt) + step + 1).toISOString(),
      reasonCode: state === "PREPARING" ? "agent_explicit_start" : `test_${state.toLowerCase()}`,
      ...(state === "PREPARING" ? { explicitStart: true as const } : {})
    });
  }
  const environment = await createByoaAgentEnvironmentV2(session.contract, successorBuildCommit);
  const tool = environment.tools.find(({ name }) => name === "order_review");
  if (!tool) throw new Error("Test tool is missing.");
  await tool.execute({}, { signal: new AbortController().signal });
  return evaluateByoaEnvironmentV3({
    session,
    environment,
    launchMode: "fresh-agent-handoff",
    evidenceTier: "native-plumbing-context-contaminated",
    armedAt: new Date(Date.parse(session.updatedAt) - 2).toISOString(),
    completedAt: new Date(Date.parse(session.updatedAt) + 2).toISOString(),
    previousResultDigest: source.resultDigest
  });
}

beforeEach(() => window.sessionStorage.clear());

describe("Result v3 regression artifacts and actions", () => {
  it("creates a strict digest-bound Regression Case v2 only for PASS or ISSUE", async () => {
    for (const verdict of ["pass", "issue"] as const) {
      const source = await terminalResult(verdict, verdict === "pass" ? 1 : 2);
      const saved = await createRegressionCaseV2(source, at(21));
      expect(saved).toMatchObject({
        version: "thurstone-regression-case@2",
        sourceResultDigest: source.resultDigest,
        sourceVerdict: verdict,
        suiteId: source.suiteId,
        contractCaseId: source.caseId,
        catalogDigest: source.catalogDigest,
        originalBuildCommit: source.buildCommit,
        originalEvidenceTier: source.evidenceTier
      });
      await expect(verifyRegressionCaseV2(saved)).resolves.toEqual(saved);
      expect(() => parseRegressionCaseV2({ ...saved, unexpected: true })).toThrow();
      await expect(
        verifyRegressionCaseV2({ ...saved, suiteDigest: "0".repeat(64) })
      ).rejects.toThrow();
    }
    await expect(
      createRegressionCaseV2(await terminalResult("incomplete", 3), at(21))
    ).rejects.toThrow(/PASS or ISSUE/iu);
  });

  it("keeps one immutable original and appends only an exact Result v3 successor", async () => {
    const source = await terminalResult("issue", 4);
    const initial = await saveRegressionResultV2({
      storage: window.sessionStorage,
      result: source,
      createdAt: at(21)
    });
    const successor = await successorResult(source, initial.case.regressionCaseDigest);
    const updated = await saveRegressionResultV2({
      storage: window.sessionStorage,
      result: successor,
      existingCaseDigest: initial.case.regressionCaseDigest,
      createdAt: at(22)
    });
    expect(updated.case).toEqual(initial.case);
    expect(updated.results.map(({ resultDigest }) => resultDigest)).toEqual([
      source.resultDigest,
      successor.resultDigest
    ]);
    expect(updated.results[1]?.previousResultDigest).toBe(source.resultDigest);
    await expect(readMyTestsV2(window.sessionStorage)).resolves.toMatchObject({
      version: "thurstone-my-tests@2",
      entries: [{ entryDigest: updated.entryDigest }]
    });
  });

  it("preserves cross-task rerun lineage as an honest independent successor entry", async () => {
    const ownerTaskStorage = new SeparateStorage();
    const freshSuccessorStorage = new SeparateStorage();
    const source = await terminalResult("issue", 12);
    const original = await saveRegressionResultV2({
      storage: ownerTaskStorage,
      result: source,
      createdAt: at(21)
    });
    const successor = await successorResult(source, original.case.regressionCaseDigest);
    const saved = await saveRegressionResultAcrossFreshContextV2({
      storage: freshSuccessorStorage,
      result: successor,
      predecessorCaseDigest: original.case.regressionCaseDigest,
      createdAt: at(22)
    });
    expect(saved.disposition).toBe("independent-linked-successor");
    expect(saved.entry.results).toHaveLength(1);
    expect(saved.entry.case.sourceResultDigest).toBe(successor.resultDigest);
    expect(saved.entry.case.sourcePreviousResultDigest).toBe(source.resultDigest);
    await expect(readMyTestsV2(ownerTaskStorage)).resolves.toMatchObject({
      entries: [{ case: { regressionCaseDigest: original.case.regressionCaseDigest } }]
    });
    await expect(readMyTestsV2(freshSuccessorStorage)).resolves.toMatchObject({
      entries: [{ case: { sourcePreviousResultDigest: source.resultDigest } }]
    });
  });

  it("fails closed on wrong lineage, tampering, ineligible evidence, and inexact keys", async () => {
    const source = await terminalResult("pass", 5);
    const initial = await saveRegressionResultV2({
      storage: window.sessionStorage,
      result: source,
      createdAt: at(21)
    });
    await expect(
      saveRegressionResultV2({
        storage: window.sessionStorage,
        result: await terminalResult("pass", 6),
        existingCaseDigest: initial.case.regressionCaseDigest,
        createdAt: at(22)
      })
    ).rejects.toThrow(/lineage/iu);
    await expect(
      saveRegressionResultV2({
        storage: window.sessionStorage,
        result: await terminalResult("incomplete", 7),
        createdAt: at(22)
      })
    ).rejects.toThrow(/PASS or ISSUE/iu);
    await expect(removeMyTestV2(window.sessionStorage, "f".repeat(64))).rejects.toThrow(
      /not found/iu
    );
    window.sessionStorage.setItem(
      MY_TESTS_V2_STORAGE_KEY,
      JSON.stringify({ version: "thurstone-my-tests@2", entries: [], storeDigest: "0".repeat(64) })
    );
    await expect(readMyTestsV2(window.sessionStorage)).rejects.toThrow(/store digest/iu);
  });

  it("clears and exports exact keys without localStorage or handoff secrets", async () => {
    window.localStorage.setItem(MY_TESTS_V2_STORAGE_KEY, "must-not-change");
    const source = await terminalResult("pass", 8);
    const saved = await saveRegressionResultV2({
      storage: window.sessionStorage,
      result: source,
      createdAt: at(21)
    });
    window.sessionStorage.setItem("thurstone:unrelated", "retain-me");
    const resultExport = await resultV3ExportJson(source);
    const caseExport = await regressionEntryV2ExportJson(
      window.sessionStorage,
      saved.case.regressionCaseDigest
    );
    expect(resultExport).toContain('"version": "thurstone-byoa-result@3"');
    expect(caseExport).toContain('"version": "thurstone-regression-case@2"');
    expect(resultExport.toLowerCase()).not.toContain("handofftoken");
    expect(caseExport.toLowerCase()).not.toContain("handoffurl");
    expect(window.localStorage.getItem(MY_TESTS_V2_STORAGE_KEY)).toBe("must-not-change");
    clearMyTestsV2(window.sessionStorage);
    expect(window.sessionStorage.getItem(MY_TESTS_V2_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem("thurstone:unrelated")).toBe("retain-me");
  });

  it("prepares only a fresh Handoff v2 rerun and reconstructs an editable one-case copy", async () => {
    const source = await terminalResult("pass", 9);
    const regressionCase = await createRegressionCaseV2(source, at(21));
    const prepared = await prepareRegressionRerunV2({
      sourceResult: source,
      regressionCaseDigest: regressionCase.regressionCaseDigest,
      contractId: `byoa_${uuid(991)}`,
      runId: `byoa_run_${uuid(992)}`,
      buildCommit: successorBuildCommit,
      createdAt: "2026-09-01T14:00:00.000Z",
      expiresAt: "2026-09-01T14:10:00.000Z"
    });
    expect(prepared.session).toMatchObject({
      state: "HANDOFF_ISSUED",
      regressionLink: {
        previousResultDigest: source.resultDigest,
        regressionCaseDigest: regressionCase.regressionCaseDigest
      }
    });
    expect(prepared.session.contract.contractId).not.toBe(source.contract.contractId);
    expect(prepared.session.contract.buildCommit).toBe(successorBuildCommit);
    expect(prepared.session.contract.suiteDigest).toBe(source.suiteDigest);
    expect(prepared.projection).not.toHaveProperty("expectedTool");
    const envelope = createByoaHandoffEnvelopeV2({
      session: prepared.session,
      projection: prepared.projection,
      now: new Date("2026-09-01T14:00:02.000Z")
    });
    const token = sealByoaHandoffV2(envelope, handoffEnvironment);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(BYOA_HANDOFF_TOKEN_MAX_BYTES);
    expect(
      openByoaHandoffV2(token, {
        environment: handoffEnvironment,
        now: new Date("2026-09-01T14:00:03.000Z")
      }).session.regressionLink
    ).toEqual(prepared.regressionLink);

    const copy = await createEditableSuiteCopyFromResultV3({
      sourceResult: source,
      suiteId: `suite_${uuid(993)}`,
      caseId: `case_${uuid(994)}`,
      createdAt: "2026-09-01T14:01:00.000Z"
    });
    expect(copy).toMatchObject({
      cases: [
        {
          request: source.contract.request,
          expectedTool: source.contract.expectedTool,
          argumentPredicate: source.contract.argumentPredicate
        }
      ]
    });
    expect(copy.suiteId).not.toBe(source.suiteId);
    expect(copy.selectedCaseId).toBe(copy.cases[0]?.caseId);
  });

  it("renders honest Result v3 actions for eligible and inconclusive verdicts", async () => {
    const pass = await terminalResult("pass", 10);
    const eligibleView = render(createElement(RegressionActionsV3, { result: pass }));
    expect(screen.getByRole("button", { name: "Save as regression" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export Result v3 JSON" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rerun in a fresh agent" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit a copy" })).toBeVisible();
    expect(screen.getByText(/return to the original owner task/iu)).toBeVisible();
    eligibleView.unmount();

    const incomplete = await terminalResult("incomplete", 11);
    render(createElement(RegressionActionsV3, { result: incomplete }));
    expect(screen.queryByRole("button", { name: "Save as regression" })).toBeNull();
    expect(screen.getByText(/cannot be saved as a verified regression case/iu)).toBeVisible();
    expect(screen.getByRole("button", { name: "Export Result v3 JSON" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rerun in a fresh agent" })).toBeVisible();
  });
});
