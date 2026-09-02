"use client";

import { useEffect, useRef, useState } from "react";

import { DiagnosticResultV3 } from "@/components/demo/diagnostic-result-v3";
import { RegressionActionsV3 } from "@/components/demo/regression-actions-v3";
import {
  createCarriedByoaAgentEnvironmentV2FromProjection,
  createByoaAgentEnvironmentV2FromProjection,
  createResetByoaAgentEnvironmentV2FromProjection,
  type ByoaAgentEnvironmentV2
} from "@/lib/demo/agent-environment-v2";
import {
  BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION,
  BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION,
  BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
  BYOA_HANDOFF_REPORT_V2_VERSION,
  BYOA_HANDOFF_REVOKE_V2_VERSION,
  BYOA_HANDOFF_REVEAL_V2_VERSION,
  BYOA_HANDOFF_STATUS_V2_VERSION,
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaHandoffBootstrapResponseV2Schema,
  byoaContinuousJourneyStatusResponseSchema,
  byoaHandoffRevealResponseV2Schema,
  byoaHandoffStatusResponseV2Schema,
  clearRemoteByoaSessionV2,
  hydrateRemoteByoaSessionV2,
  readRemoteByoaSessionV2,
  transitionRemoteByoaSessionV2,
  writeRemoteByoaSessionV2,
  type ByoaOwnerResultSummaryV1,
  type HandoffClaimFailureReceiptV1,
  type RemoteByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
import { clearByoaHandoffUrl, readByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import {
  clearAgentVisibleRunProjectionV2,
  readAgentVisibleRunProjectionV2,
  writeAgentVisibleRunProjectionV2,
  type AgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  clearByoaAgentSessionV2,
  readByoaAgentSessionV2,
  type ByoaSessionV2State
} from "@/lib/demo/agent-session-v2";
import {
  clearByoaResultV3,
  readByoaResultV3,
  writeByoaResultV3
} from "@/lib/demo/byoa-result-storage-v3";
import { createNoInvocationResultV3, evaluateByoaEnvironmentV3 } from "@/lib/demo/evaluator-v3";
import {
  byoaHandoffV2ContextHeaders,
  controlByoaHandoffV2,
  readFreshContextForByoaHandoffV2
} from "@/lib/demo/handoff-context-v2";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";
import {
  clearContractRunQueue,
  readContractRunQueue,
  recordContractRunResult,
  writeContractRunQueue
} from "@/lib/demo/contract-run-queue";
import { selectContractSuiteCase } from "@/lib/demo/contract-suite";
import { writeOwnerJourneyReport } from "@/lib/demo/owner-journey-report";
import { loadThurstoneContractSuite, saveThurstoneContractSuite } from "@/lib/demo/suite-storage";
import { detectWebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const OBSERVATION_TIMEOUT_MS = 120_000;
const CONSUMER_DELIVERY_GRACE_MS = 50;
const JOURNEY_RESULTS_STORAGE_KEY = "thurstone:continuous-journey-results@1";
const OWNER_JOURNEY_ISSUE_STORAGE_KEY = "thurstone:last-owner-journey-issue@1";

function nextTimestamp(after: string): string {
  return new Date(Math.max(Date.now(), Date.parse(after) + 1)).toISOString();
}

function terminalState(verdict: ByoaDemoResultV3["verdict"]): ByoaSessionV2State {
  if (verdict === "pass") return "PASS";
  if (verdict === "issue") return "ISSUE";
  if (verdict === "unavailable") return "UNAVAILABLE";
  return "INCOMPLETE";
}

function itemName(result: ByoaDemoResultV3, itemId: string): string {
  return (
    result.trustedStateBefore.value.lines.find((line) => line.itemId === itemId)?.name ??
    result.trustedStateAfter.value.lines.find((line) => line.itemId === itemId)?.name ??
    itemId
  );
}

function summarizeVerifiedEffect(result: ByoaDemoResultV3): string {
  const changes = result.ledgerDiff.effect.quantities
    .filter(({ changed }) => changed)
    .map(({ itemId, afterQuantity }) =>
      afterQuantity === null
        ? `Removed ${itemName(result, itemId)}`
        : `Set ${itemName(result, itemId)} quantity to ${afterQuantity}`
    );
  if (result.ledgerDiff.effect.pendingCheckout.changed) changes.push("Changed pending checkout");
  if (result.ledgerDiff.effect.unmodeledStateChanged) changes.push("Changed unmodeled state");
  return changes.length > 0 ? changes.join("; ") : "No trusted state change";
}

function ownerSummaryFor(result: ByoaDemoResultV3): ByoaOwnerResultSummaryV1 {
  const primary = result.diagnostic.findings.find(
    ({ findingId }) => findingId === result.diagnostic.primaryFindingId
  );
  const verifiedEffect = summarizeVerifiedEffect(result);
  const passedAssertions = result.assertions.filter(({ passed }) => passed).length;
  const resultExplanation =
    result.verdict === "pass"
      ? `The agent selected ${result.observedTool ?? "no tool"} with contract-matching arguments. Thurstone independently checked ${verifiedEffect.toLocaleLowerCase("en-US")} against site-owned state and ledger evidence; all ${passedAssertions} measured assertions passed.`
      : `The contract required ${result.selectedExpectedTool}, while the agent produced ${result.observedTool ?? "no native invocation"}. Thurstone verified ${verifiedEffect.toLocaleLowerCase("en-US")} and identified ${result.assertions.length - passedAssertions} failed assertion${result.assertions.length - passedAssertions === 1 ? "" : "s"} for review.`;
  return {
    caseId: result.caseId,
    request: result.contract.request,
    expectedTool: result.selectedExpectedTool,
    observedTool: result.observedTool,
    expectedArguments: result.contract.argumentPredicate,
    actualArguments: result.canonicalArguments,
    verifiedEffect,
    resultExplanation,
    primaryFindingCode: primary?.code ?? null,
    primaryFindingTitle: primary?.title ?? null,
    recommendedNextStep: primary?.nextStep.instruction ?? null,
    trustedStateAfter: {
      revision: result.trustedStateAfter.value.revision,
      lines: result.trustedStateAfter.value.lines.map(({ itemId, name, quantity }) => ({
        itemId,
        name,
        quantity
      })),
      pendingCheckoutStatus: result.trustedStateAfter.value.pendingCheckout?.status ?? null
    }
  };
}

function readableItemId(value: unknown): string {
  if (value === "field-notebook") return "Field notebook";
  if (value === "stoneware-mug") return "Stoneware mug";
  return typeof value === "string" ? value : "unspecified item";
}

function summarizeArguments(value: unknown): string {
  if (value === null) return "No arguments observed";
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  if (record.itemId !== undefined && typeof record.quantity === "number") {
    return `Set ${readableItemId(record.itemId)} quantity to ${record.quantity}`;
  }
  if (record.kind === "empty" || Object.keys(record).length === 0) return "No arguments";
  if (record.kind === "checkout_request") return "One valid, unique operation ID";
  return JSON.stringify(value);
}

interface HandoffSourceV2 {
  readonly url: string;
  readonly request: string;
  readonly toolNames: readonly string[];
  readonly caseName: string;
  readonly caseId: string;
  readonly runId: string;
  readonly contractDigest: string;
  readonly token: string;
}

interface HandoffSourcePlanStep {
  readonly caseId: string;
  readonly name: string;
  readonly request: string;
  readonly toolName: string;
}

type HandoffLedgerState =
  | "ISSUED"
  | "CLAIMED"
  | "RECEIVED"
  | "STARTED"
  | "SETTLED"
  | "TIMED_OUT"
  | "UNAVAILABLE"
  | "REVOKED"
  | null;

export function ByoaRunnerV2() {
  const [projection, setProjection] = useState<AgentVisibleRunProjectionV2>();
  const [sessionState, setSessionState] = useState<ByoaSessionV2State>("RECEIVED");
  const [source, setSource] = useState<HandoffSourceV2>();
  const [sourceResult, setSourceResult] = useState<{
    readonly verdict: "pass" | "issue" | "incomplete" | "unavailable";
    readonly resultDigest: string;
  }>();
  const [sourceJourneyStatus, setSourceJourneyStatus] = useState<{
    readonly mode: "continuous" | "regression";
    readonly position: number;
    readonly total: number;
    readonly state: HandoffLedgerState;
    readonly complete: boolean;
    readonly results: readonly {
      readonly caseId: string;
      readonly verdict: "pass" | "issue" | "incomplete" | "unavailable";
      readonly resultDigest: string;
      readonly ownerSummary: ByoaOwnerResultSummaryV1;
    }[];
  }>();
  const [sourcePlan, setSourcePlan] = useState<readonly HandoffSourcePlanStep[]>([]);
  const [sourceClaimFailure, setSourceClaimFailure] = useState<HandoffClaimFailureReceiptV1 | null>(
    null
  );
  const [sourceHandoffState, setSourceHandoffState] = useState<HandoffLedgerState>(null);
  const [result, setResult] = useState<ByoaDemoResultV3>();
  const [journey, setJourney] = useState<{
    readonly journeyId: string;
    readonly mode: "continuous" | "regression";
    readonly position: number;
    readonly total: number;
  }>();
  const [journeyResultCount, setJourneyResultCount] = useState(0);
  const [progress, setProgress] = useState("Receiving isolated test");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [existingRegressionCaseDigest, setExistingRegressionCaseDigest] = useState<string | null>(
    null
  );
  const sessionRef = useRef<RemoteByoaSessionV2 | undefined>(undefined);
  const releaseRef = useRef<() => void>(() => undefined);
  const unsubscribeGateRef = useRef<() => void>(() => undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const terminalRef = useRef(false);
  const finalizationClaimedRef = useRef(false);
  const sourceStatusFailureCountRef = useRef(0);
  const armedAtRef = useRef<string | null>(null);
  const environmentRef = useRef<ByoaAgentEnvironmentV2 | undefined>(undefined);

  function freshContextId(): string {
    return readFreshContextForByoaHandoffV2(window.sessionStorage);
  }

  function reportFinalizationFailure(error: unknown): void {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    unsubscribeGateRef.current();
    releaseRef.current();
    setProgress("Evidence finalization stopped safely");
    setError(
      error instanceof Error
        ? `Evidence finalization failed: ${error.message}. No verdict is claimed; return to the owner task and create a fresh run.`
        : "Evidence finalization failed. No verdict is claimed; return to the owner task and create a fresh run."
    );
  }

  function runFinalizer(promise: Promise<void>): void {
    void promise.catch(reportFinalizationFailure);
  }

  function persistSession(session: RemoteByoaSessionV2): void {
    sessionRef.current = session;
    setSessionState(session.state);
    setExistingRegressionCaseDigest(session.regressionLink?.regressionCaseDigest ?? null);
    writeRemoteByoaSessionV2(window.sessionStorage, session);
  }

  function move(
    to: ByoaSessionV2State,
    reasonCode: string,
    options: { readonly explicitStart?: true; readonly resultDigest?: string } = {}
  ): RemoteByoaSessionV2 {
    const current = sessionRef.current;
    if (!current) throw new Error("The isolated BYOA session is not loaded.");
    const next = transitionRemoteByoaSessionV2(current, to, {
      at: nextTimestamp(current.updatedAt),
      reasonCode,
      ...options
    });
    persistSession(next);
    return next;
  }

  async function revealSession(remote: RemoteByoaSessionV2) {
    const response = await fetch("/api/demo/handoff/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff",
        ...byoaHandoffV2ContextHeaders(freshContextId())
      },
      body: JSON.stringify({
        version: BYOA_HANDOFF_REVEAL_V2_VERSION,
        runId: remote.runId,
        contractDigest: remote.contractDigest
      }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error("The hidden contract could not be revealed after the trial.");
    const revealed = byoaHandoffRevealResponseV2Schema.parse(await response.json());
    if (revealed.version !== BYOA_HANDOFF_REVEAL_V2_VERSION) {
      throw new Error("The hidden contract reveal used an unsupported version.");
    }
    return hydrateRemoteByoaSessionV2(remote, revealed.contract);
  }

  async function persistTerminal(
    terminalResult: ByoaDemoResultV3,
    from: RemoteByoaSessionV2
  ): Promise<void> {
    if (terminalRef.current) return;
    terminalRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    unsubscribeGateRef.current();
    environmentRef.current?.gate.deactivate();
    await writeByoaResultV3(window.sessionStorage, terminalResult);
    if (journey !== undefined) {
      let stored: string[] = [];
      try {
        const candidate = JSON.parse(
          window.sessionStorage.getItem(JOURNEY_RESULTS_STORAGE_KEY) ?? "[]"
        ) as unknown;
        if (
          Array.isArray(candidate) &&
          candidate.every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest))
        ) {
          stored = candidate;
        }
      } catch {
        // This convenience index is not evidence authority; rebuild it from this verified result.
      }
      if (!stored.includes(terminalResult.resultDigest)) stored.push(terminalResult.resultDigest);
      window.sessionStorage.setItem(
        JOURNEY_RESULTS_STORAGE_KEY,
        JSON.stringify(stored.slice(-journey.total))
      );
      setJourneyResultCount(Math.min(stored.length, journey.total));
    }
    const terminal = transitionRemoteByoaSessionV2(from, terminalState(terminalResult.verdict), {
      at: terminalResult.completedAt,
      reasonCode: `result_${terminalResult.verdict}`,
      resultDigest: terminalResult.resultDigest
    });
    persistSession(terminal);
    const report = await fetch("/api/demo/handoff/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff",
        ...byoaHandoffV2ContextHeaders(freshContextId())
      },
      body: JSON.stringify({
        version: BYOA_HANDOFF_REPORT_V2_VERSION,
        runId: terminal.runId,
        contractDigest: terminal.contractDigest,
        verdict: terminalResult.verdict,
        resultDigest: terminalResult.resultDigest,
        ownerSummary: ownerSummaryFor(terminalResult)
      }),
      cache: "no-store"
    });
    if (!report.ok) throw new Error("The contract queue could not receive this terminal result.");
    setResult(terminalResult);
    setProgress("Result ready");
    if (
      journey === undefined ||
      journey.position === journey.total ||
      (journey.mode === "continuous" && terminalResult.verdict !== "pass")
    ) {
      const releaseCompletedStep = releaseRef.current;
      setTimeout(releaseCompletedStep, CONSUMER_DELIVERY_GRACE_MS);
    }
  }

  async function finalizeObserved(environment: ByoaAgentEnvironmentV2): Promise<void> {
    if (terminalRef.current) return;
    const current = sessionRef.current;
    if (!current || current.state !== "OBSERVING") return;
    if (finalizationClaimedRef.current) return;
    finalizationClaimedRef.current = true;
    setProgress("Verifying independent state and ledger");
    const evaluating = move("EVALUATING", "native_handler_settled");
    await controlByoaHandoffV2({
      action: "settle",
      runId: evaluating.runId,
      contractDigest: evaluating.contractDigest,
      freshContextId: freshContextId()
    });
    const hydrated = await revealSession(evaluating);
    const completedAt = nextTimestamp(evaluating.updatedAt);
    if (armedAtRef.current === null) {
      throw new Error("An observed invocation cannot be evaluated before the arm boundary.");
    }
    const terminalResult = await evaluateByoaEnvironmentV3({
      session: hydrated,
      environment,
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: armedAtRef.current,
      completedAt,
      previousResultDigest: hydrated.regressionLink?.previousResultDigest ?? null
    });
    await persistTerminal(terminalResult, evaluating);
  }

  async function finalizeNoInvocation(
    environment: ByoaAgentEnvironmentV2,
    verdict: "incomplete" | "unavailable",
    detail: string
  ): Promise<void> {
    if (terminalRef.current) return;
    const current = sessionRef.current;
    if (!current) return;
    if (finalizationClaimedRef.current) return;
    finalizationClaimedRef.current = true;
    await controlByoaHandoffV2({
      action: verdict === "incomplete" ? "timeout" : "unavailable",
      runId: current.runId,
      contractDigest: current.contractDigest,
      freshContextId: freshContextId()
    });
    const hydrated = await revealSession(current);
    const completedAt = nextTimestamp(current.updatedAt);
    const terminalResult = await createNoInvocationResultV3({
      session: hydrated,
      environment,
      verdict,
      detail,
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: armedAtRef.current,
      completedAt,
      previousResultDigest: hydrated.regressionLink?.previousResultDigest ?? null
    });
    await persistTerminal(terminalResult, current);
  }

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const localSession = readByoaAgentSessionV2(window.sessionStorage);
        const localProjection = readAgentVisibleRunProjectionV2(window.sessionStorage);
        const sourceUrl = readByoaHandoffUrl(window.sessionStorage);
        if (
          (window.location.hash === "#handoff-source-v2" ||
            localSession?.state === "HANDOFF_ISSUED") &&
          localSession?.state === "HANDOFF_ISSUED" &&
          localProjection &&
          sourceUrl
        ) {
          const sourceValue = {
            url: sourceUrl,
            request: localProjection.request,
            toolNames: localProjection.descriptors.map(({ name }) => name),
            caseName: localSession.contract.title,
            caseId: localSession.contract.caseId,
            runId: localSession.runId,
            contractDigest: localSession.contractDigest,
            token: new URL(sourceUrl).hash.slice(1)
          } satisfies HandoffSourceV2;
          setProjection(localProjection);
          const queue = readContractRunQueue(window.sessionStorage);
          const restoredSuite = await loadThurstoneContractSuite(window.sessionStorage);
          if (
            queue !== null &&
            restoredSuite.status === "restored" &&
            restoredSuite.suite.suiteId === queue.suiteId
          ) {
            setSourcePlan(
              queue.orderedCaseIds.flatMap((caseId) => {
                const testCase = restoredSuite.suite.cases.find(
                  (candidate) => candidate.caseId === caseId
                );
                return testCase
                  ? [
                      {
                        caseId,
                        name: testCase.name,
                        request: testCase.request,
                        toolName: testCase.expectedTool
                      }
                    ]
                  : [];
              })
            );
          }
          setSource(sourceValue);
          return;
        }

        let remote = readRemoteByoaSessionV2(window.sessionStorage);
        let visible = localProjection;
        const storedResult = await readByoaResultV3(window.sessionStorage);
        if (!remote || !visible || remote.runId !== visible.runId) {
          const response = await fetch("/api/demo/handoff/bootstrap", {
            headers: byoaHandoffV2ContextHeaders(freshContextId()),
            cache: "no-store"
          });
          if (!response.ok) {
            const failure = (await response.json().catch(() => null)) as {
              readonly error?: string;
            } | null;
            if (failure?.error === "handoff_build_mismatch") {
              throw new Error(
                "Thurstone was updated after this handoff was created. Return to the owner tab and create a fresh handoff."
              );
            }
            if (failure?.error === "handoff_state_unavailable") {
              throw new Error(
                "Thurstone could not restore the server-side test state. Return to the owner tab and create a fresh handoff."
              );
            }
            throw new Error("No valid fresh-agent handoff exists in this task.");
          }
          const raw = await response.json();
          if (raw?.version !== BYOA_HANDOFF_BOOTSTRAP_V2_VERSION) {
            throw new Error("This task contains a legacy handoff. Reopen its original link.");
          }
          const bootstrap = byoaHandoffBootstrapResponseV2Schema.parse(raw);
          remote = bootstrap.session;
          visible = bootstrap.projection;
          setJourney(bootstrap.journey);
          if (bootstrap.journey?.position === 1) {
            window.sessionStorage.removeItem(JOURNEY_RESULTS_STORAGE_KEY);
            setJourneyResultCount(0);
          }
          writeRemoteByoaSessionV2(window.sessionStorage, remote);
          writeAgentVisibleRunProjectionV2(window.sessionStorage, visible);
        }
        if (disposed) return;
        sessionRef.current = remote;
        setSessionState(remote.state);
        setExistingRegressionCaseDigest(remote.regressionLink?.regressionCaseDigest ?? null);
        setProjection(visible);
        if (Date.parse(visible.expiresAt) <= Date.now()) {
          throw new Error("This opaque handoff expired. Close this task and create a fresh one.");
        }
        if (["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(remote.state)) {
          if (!storedResult || storedResult.resultDigest !== remote.terminalResultDigest) {
            throw new Error("The terminal result could not be verified after reload.");
          }
          terminalRef.current = true;
          setResult(storedResult);
          setProgress("Result ready");
          return;
        }
        if (remote.state === "RECEIVED") setProgress("Agent-visible test received");
        else if (remote.state === "READY_TO_ARM") setProgress("Ready for explicit start");
        else
          throw new Error(
            "The prior live document ended mid-observation. Open a new handoff for an honest rerun."
          );
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "The isolated test could not load.");
        }
      }
    })();
    return () => {
      disposed = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      unsubscribeGateRef.current();
      releaseRef.current();
    };
  }, []);

  useEffect(() => {
    if (!source || sourceResult) return;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stopAfterRepeatedStatusFailure = (message: string): boolean => {
      sourceStatusFailureCountRef.current += 1;
      if (sourceStatusFailureCountRef.current < 3) return false;
      if (!disposed) setError(message);
      return true;
    };
    const poll = async () => {
      try {
        const queue = readContractRunQueue(window.sessionStorage);
        const batched = (queue?.orderedCaseIds.length ?? 0) > 1;
        const response = await fetch(
          batched ? "/api/demo/journey/status" : "/api/demo/handoff/status",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Thurstone-Request": "byoa-handoff",
              "X-Thurstone-Origin": window.location.origin
            },
            body: JSON.stringify({
              version: batched
                ? BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION
                : BYOA_HANDOFF_STATUS_V2_VERSION,
              runId: source.runId,
              contractDigest: source.contractDigest,
              token: source.token
            }),
            cache: "no-store"
          }
        );
        if (response.ok) {
          sourceStatusFailureCountRef.current = 0;
          const raw = await response.json();
          if (batched) {
            const status = byoaContinuousJourneyStatusResponseSchema.parse(raw);
            if (!disposed) {
              setSourceJourneyStatus(status);
              if (status.claimFailure) setSourceClaimFailure(status.claimFailure);
            }
            const activeClaim =
              status.state !== null &&
              ["CLAIMED", "RECEIVED", "STARTED", "SETTLED"].includes(status.state);
            if (status.complete || (status.claimFailure && !activeClaim)) return;
          } else {
            const status = byoaHandoffStatusResponseV2Schema.parse(raw);
            if (!disposed) setSourceHandoffState(status.state);
            if (status.claimFailure) {
              if (!disposed) setSourceClaimFailure(status.claimFailure);
              const activeClaim =
                status.state !== null &&
                ["CLAIMED", "RECEIVED", "STARTED", "SETTLED"].includes(status.state);
              if (!activeClaim) return;
            }
            if (status.verdict !== null && status.resultDigest !== null) {
              if (!disposed)
                setSourceResult({ verdict: status.verdict, resultDigest: status.resultDigest });
              return;
            }
          }
        } else if (response.status === 404 || response.status >= 500) {
          if (
            stopAfterRepeatedStatusFailure(
              response.status === 404
                ? "Thurstone could not find the durable test state after three attempts. Preserve this page and create a fresh handoff."
                : "Thurstone could not read the durable test state after three attempts. Preserve this page and create a fresh handoff after service recovery."
            )
          )
            return;
        } else {
          if (!disposed) {
            setError(
              "This handoff can no longer be verified. Return to the contract and create a fresh handoff."
            );
          }
          return;
        }
      } catch {
        if (
          stopAfterRepeatedStatusFailure(
            "Thurstone could not reach the durable test state after three attempts. Preserve this page and create a fresh handoff after network recovery."
          )
        )
          return;
      }
      if (!disposed) timeout = setTimeout(() => void poll(), 1_500);
    };
    void poll();
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [source, sourceResult]);

  function markReady() {
    if (sessionRef.current?.state !== "RECEIVED") return;
    move("READY_TO_ARM", "agent_reviewed_visible_test");
    setProgress("Ready for explicit start");
  }

  async function startLiveObservation() {
    if (!projection || sessionRef.current?.state !== "READY_TO_ARM") return;
    setError(undefined);
    try {
      if (Date.parse(projection.expiresAt) <= Date.now()) {
        throw new Error("This handoff expired before explicit start. No tools were registered.");
      }
      const current = sessionRef.current;
      if (!current) throw new Error("The isolated BYOA session is not loaded.");
      await controlByoaHandoffV2({
        action: "start",
        runId: current.runId,
        contractDigest: current.contractDigest,
        freshContextId: freshContextId()
      });
      move("PREPARING", "agent_explicit_start", { explicitStart: true });
      setProgress("Registering the selected native catalog");
      const retainedStep = journey !== undefined && journey.position > 1;
      const priorEnvironment = environmentRef.current;
      if (retainedStep && priorEnvironment === undefined) {
        throw new Error("The prior batched test environment is unavailable.");
      }
      const environment = retainedStep
        ? journey.mode === "continuous" && priorEnvironment !== undefined
          ? await createCarriedByoaAgentEnvironmentV2FromProjection(
              projection,
              APP_COMMIT,
              priorEnvironment
            )
          : await createResetByoaAgentEnvironmentV2FromProjection(
              projection,
              APP_COMMIT,
              priorEnvironment!
            )
        : await createByoaAgentEnvironmentV2FromProjection(projection, APP_COMMIT);
      if (retainedStep) environment.gate.beginNextStep();
      environmentRef.current = environment;
      const capabilities = detectWebMcpCapabilities();
      if (!capabilities.providerRegistration || !document.modelContext) {
        await finalizeNoInvocation(
          environment,
          "unavailable",
          "This browser did not expose the supported native Site Tools provider after explicit start."
        );
        return;
      }
      unsubscribeGateRef.current = environment.gate.subscribe(() => {
        const claim = environment.gate.snapshot().claim;
        const current = sessionRef.current;
        if (!claim || !current || terminalRef.current) return;
        if (claim.disposition === "in-flight" && current.state === "ARMED") {
          setProgress("Native invocation observed");
          move("OBSERVING", "first_native_invocation_claimed");
        }
        if (claim.disposition !== "in-flight") runFinalizer(finalizeObserved(environment));
      });
      let readyHandled = false;
      const armRegisteredStep = () => {
        if (readyHandled) return;
        readyHandled = true;
        const current = sessionRef.current;
        if (!current || current.state !== "PREPARING") return;
        move(
          "PROVIDER_READY",
          retainedStep ? "batched_catalog_retained" : "selected_catalog_registered"
        );
        const armed = move("ARMED", "observation_boundary_armed");
        armedAtRef.current = armed.updatedAt;
        setProgress("Waiting for one native agent invocation");
        timeoutRef.current = setTimeout(() => {
          runFinalizer(
            finalizeNoInvocation(
              environment,
              "incomplete",
              "No native WebMCP invocation was observed before the bounded 120-second timeout."
            )
          );
        }, OBSERVATION_TIMEOUT_MS);
      };
      if (retainedStep) {
        armRegisteredStep();
        return;
      }
      releaseRef.current = webMcpRegistryManager.acquire(
        document.modelContext,
        environment.tools,
        (status: RegistryStatus) => {
          if (terminalRef.current) return;
          if (status.phase === "error") {
            runFinalizer(
              finalizeNoInvocation(
                environment,
                "unavailable",
                status.error ?? "The selected native catalog could not be registered."
              )
            );
            return;
          }
          if (status.phase !== "ready") return;
          armRegisteredStep();
        }
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Live observation could not start.");
    }
  }

  async function copyCommand(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  async function cancelSource() {
    const local = readByoaAgentSessionV2(window.sessionStorage);
    if (local?.state !== "HANDOFF_ISSUED") return;
    const handoffUrl = readByoaHandoffUrl(window.sessionStorage);
    const token = handoffUrl ? new URL(handoffUrl).hash.slice(1) : "";
    const response = await fetch("/api/demo/handoff/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff"
      },
      body: JSON.stringify({ version: BYOA_HANDOFF_REVOKE_V2_VERSION, token }),
      cache: "no-store"
    });
    if (!response.ok) {
      setError("The handoff could not be revoked safely. It was not cleared locally.");
      return;
    }
    clearByoaAgentSessionV2(window.sessionStorage);
    clearAgentVisibleRunProjectionV2(window.sessionStorage);
    clearByoaResultV3(window.sessionStorage);
    clearRemoteByoaSessionV2(window.sessionStorage);
    clearByoaHandoffUrl(window.sessionStorage);
    window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
    window.location.replace("/demo");
  }

  function recoverFromClaimFailure() {
    if (!sourceClaimFailure) return;
    clearByoaAgentSessionV2(window.sessionStorage);
    clearAgentVisibleRunProjectionV2(window.sessionStorage);
    clearByoaResultV3(window.sessionStorage);
    clearRemoteByoaSessionV2(window.sessionStorage);
    clearByoaHandoffUrl(window.sessionStorage);
    window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
    window.location.replace("/demo?contract-run=continue");
  }

  async function continueContinuousJourney() {
    const current = sessionRef.current;
    if (
      !current ||
      !result ||
      journey === undefined ||
      journey.position >= journey.total ||
      (journey.mode === "continuous" && result.verdict !== "pass")
    )
      return;
    setError(undefined);
    setProgress("Preparing the next verified journey step");
    try {
      unsubscribeGateRef.current();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const response = await fetch("/api/demo/journey/advance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff",
          ...byoaHandoffV2ContextHeaders(freshContextId())
        },
        body: JSON.stringify({
          version: BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION,
          runId: current.runId,
          contractDigest: current.contractDigest,
          resultDigest: result.resultDigest
        }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The next continuous journey step could not be admitted.");
      const next = byoaHandoffBootstrapResponseV2Schema.parse(await response.json());
      if (next.journey === undefined || next.journey.journeyId !== journey.journeyId) {
        throw new Error("The continuous journey identity changed unexpectedly.");
      }
      terminalRef.current = false;
      finalizationClaimedRef.current = false;
      armedAtRef.current = null;
      unsubscribeGateRef.current = () => undefined;
      releaseRef.current = () => undefined;
      clearByoaResultV3(window.sessionStorage);
      persistSession(next.session);
      writeAgentVisibleRunProjectionV2(window.sessionStorage, next.projection);
      setProjection(next.projection);
      setJourney(next.journey);
      setResult(undefined);
      setProgress("Next journey request received");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The journey could not continue.");
    }
  }

  async function continueContractRun() {
    if (!source || !sourceResult) return;
    setError(undefined);
    try {
      const queue = readContractRunQueue(window.sessionStorage);
      if (queue === null || queue.currentCaseId !== source.caseId) {
        throw new Error("The contract queue no longer matches this completed request.");
      }
      const nextQueue = recordContractRunResult(queue, {
        caseId: source.caseId,
        verdict: sourceResult.verdict,
        resultDigest: sourceResult.resultDigest
      });
      writeContractRunQueue(window.sessionStorage, nextQueue);
      const restored = await loadThurstoneContractSuite(window.sessionStorage);
      if (restored.status !== "restored" || restored.suite.suiteId !== nextQueue.suiteId) {
        throw new Error("The owner contract could not be restored for its next request.");
      }
      let suite = restored.suite;
      if (nextQueue.currentCaseId !== null) {
        suite = selectContractSuiteCase(suite, nextQueue.currentCaseId, {
          updatedAt: nextTimestamp(suite.updatedAt)
        });
        await saveThurstoneContractSuite(window.sessionStorage, suite);
      }
      clearByoaAgentSessionV2(window.sessionStorage);
      clearAgentVisibleRunProjectionV2(window.sessionStorage);
      clearByoaResultV3(window.sessionStorage);
      clearRemoteByoaSessionV2(window.sessionStorage);
      clearByoaHandoffUrl(window.sessionStorage);
      window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
      window.location.replace(
        nextQueue.currentCaseId === null
          ? "/demo?contract-run=complete"
          : "/demo?contract-run=continue"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contract run could not continue.");
    }
  }

  async function finishContinuousSource() {
    if (!sourceJourneyStatus?.complete) return;
    setError(undefined);
    try {
      let queue = readContractRunQueue(window.sessionStorage);
      if (queue === null || queue.orderedCaseIds.length < 2) {
        throw new Error("The batched contract queue is unavailable.");
      }
      for (const terminal of sourceJourneyStatus.results) {
        queue = recordContractRunResult(queue, {
          caseId: terminal.caseId,
          verdict: terminal.verdict,
          resultDigest: terminal.resultDigest
        });
      }
      await writeOwnerJourneyReport(window.sessionStorage, {
        mode: queue.mode,
        suiteId: queue.suiteId,
        catalogDigest: queue.catalogDigest,
        completedAt: new Date().toISOString(),
        total: sourceJourneyStatus.total,
        results: sourceJourneyStatus.results,
        plannedCases: sourcePlan.map(({ caseId, request, toolName }) => ({
          caseId,
          request,
          expectedTool: toolName
        }))
      });
      clearContractRunQueue(window.sessionStorage);
      clearByoaAgentSessionV2(window.sessionStorage);
      clearAgentVisibleRunProjectionV2(window.sessionStorage);
      clearByoaResultV3(window.sessionStorage);
      clearRemoteByoaSessionV2(window.sessionStorage);
      clearByoaHandoffUrl(window.sessionStorage);
      window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
      window.location.replace("/results?journey=latest");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The journey could not be closed.");
    }
  }

  function returnToStoppedJourney(
    action: "edit" | "rerun",
    terminal: NonNullable<typeof sourceJourneyStatus>["results"][number]
  ) {
    window.sessionStorage.setItem(
      OWNER_JOURNEY_ISSUE_STORAGE_KEY,
      JSON.stringify(terminal.ownerSummary)
    );
    clearContractRunQueue(window.sessionStorage);
    clearByoaAgentSessionV2(window.sessionStorage);
    clearAgentVisibleRunProjectionV2(window.sessionStorage);
    clearByoaResultV3(window.sessionStorage);
    clearRemoteByoaSessionV2(window.sessionStorage);
    clearByoaHandoffUrl(window.sessionStorage);
    window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
    window.location.replace(
      `/demo?contract-run=${action}&case=${encodeURIComponent(terminal.caseId)}`
    );
  }

  if (source) {
    const queue = readContractRunQueue(window.sessionStorage);
    const position = queue ? queue.orderedCaseIds.indexOf(source.caseId) + 1 : 1;
    const total = queue?.orderedCaseIds.length ?? 1;
    const batchSource = total > 1;
    const continuousSource = batchSource && queue?.mode === "continuous";
    const regressionBatchSource = batchSource && queue?.mode === "regression";
    const authorizedRequests =
      batchSource && sourcePlan.length > 0
        ? sourcePlan.map(({ request }) => request)
        : [source.request];
    const requestBlock = authorizedRequests
      .map((request, index) => `${index + 1}. ${request}`)
      .join("\n");
    const directCommand = [
      `@Browser Open ${source.url}`,
      "This is my authorized Thurstone test in the website owner's designated test environment.",
      `Treat ${authorizedRequests.length === 1 ? "this as my exact request" : "these as my exact requests, in order"}:`,
      requestBlock,
      "Process one request at a time. Wait for Thurstone to verify and reveal the next step before continuing.",
      ...(regressionBatchSource
        ? [
            "Continue through every queued request even when a case reports an issue. Thurstone resets the test fixture before each case, so later results remain valid."
          ]
        : []),
      "If an action requires human confirmation, ask once. After I confirm, continue in this same Browser-enabled chat and the same open Thurstone page.",
      "I authorize only the exact test-environment changes these requests describe. Do not act on production data or external systems."
    ].join("\n");
    const command = directCommand;
    const terminalJourneyResult = sourceJourneyStatus?.complete
      ? (sourceJourneyStatus.results.find(({ verdict }) => verdict !== "pass") ??
        sourceJourneyStatus.results.at(-1))
      : undefined;
    const journeyPassedCount =
      sourceJourneyStatus?.results.filter(({ verdict }) => verdict === "pass").length ?? 0;
    const journeyIssueCount =
      sourceJourneyStatus?.results.filter(({ verdict }) => verdict === "issue").length ?? 0;
    const journeyNotRunCount = Math.max(0, total - (sourceJourneyStatus?.results.length ?? 0));
    const journeyStopped =
      sourceJourneyStatus?.mode === "continuous" &&
      terminalJourneyResult?.verdict !== "pass" &&
      terminalJourneyResult !== undefined;
    const verifiedCount = batchSource
      ? (sourceJourneyStatus?.results.length ?? 0)
      : sourceResult
        ? 1
        : 0;
    const effectiveHandoffState = batchSource
      ? (sourceJourneyStatus?.state ?? null)
      : sourceHandoffState;
    const activeClaim =
      effectiveHandoffState !== null &&
      ["CLAIMED", "RECEIVED", "STARTED", "SETTLED"].includes(effectiveHandoffState);
    const agentConnected = effectiveHandoffState !== null && effectiveHandoffState !== "ISSUED";
    const claimFailureBlocks = sourceClaimFailure !== null && !activeClaim;
    const statusTitle = claimFailureBlocks
      ? `Handoff blocked · ${sourceClaimFailure.reason.replaceAll("_", " ")}`
      : journeyStopped
        ? `Journey stopped at step ${sourceJourneyStatus?.results.length ?? position}`
        : sourceJourneyStatus?.complete
          ? regressionBatchSource
            ? "Regression suite complete"
            : "Journey complete"
          : agentConnected
            ? `Agent connected · ${verifiedCount} of ${total} verified`
            : "Ready for your agent";
    return (
      <section
        className="agent-handoff-launch agent-handoff-source"
        data-byoa-v2-state="HANDOFF_SOURCE"
      >
        <header className="handoff-launch-heading">
          <p className="eyebrow">Stage 4 · Agent handoff</p>
          <h1>
            Run your{" "}
            {continuousSource
              ? `${total}-step journey`
              : regressionBatchSource
                ? `${total}-request regression suite`
                : "request"}{" "}
            with your agent.
          </h1>
          <p>
            {continuousSource
              ? "Thurstone sends each request individually and carries verified state forward. It stops at the first issue because an incorrect state would make later verdicts unreliable."
              : regressionBatchSource
                ? "Thurstone runs every request in this same agent chat, resets the test fixture before each case, records every verdict, and continues after failures."
                : "Thurstone sends this request to an independent agent and verifies the resulting action and state."}
          </p>
        </header>

        {error ? (
          <div className="agent-runner-recovery" role="alert">
            <strong>Live status verification stopped.</strong>
            <p>{error}</p>
          </div>
        ) : null}

        <div className="handoff-launch-layout">
          <div className="handoff-launch-main">
            {journeyStopped && terminalJourneyResult ? (
              <section className="handoff-owner-outcome" aria-labelledby="owner-outcome-title">
                <p className="eyebrow">Actionable journey issue</p>
                <h2 id="owner-outcome-title">
                  {terminalJourneyResult.ownerSummary.primaryFindingTitle ??
                    "This request did not match its contract."}
                </h2>
                <p className="handoff-owner-score">
                  {journeyPassedCount} passed · {journeyIssueCount || 1} issue ·{" "}
                  {journeyNotRunCount} not run
                </p>
                <dl>
                  <div>
                    <dt>Shopper request</dt>
                    <dd>{terminalJourneyResult.ownerSummary.request}</dd>
                  </div>
                  <div>
                    <dt>Owner contract expected</dt>
                    <dd>
                      <code>{terminalJourneyResult.ownerSummary.expectedTool}</code>
                      <span>
                        {summarizeArguments(terminalJourneyResult.ownerSummary.expectedArguments)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Agent performed</dt>
                    <dd>
                      <code>{terminalJourneyResult.ownerSummary.observedTool ?? "no tool"}</code>
                      <span>
                        {summarizeArguments(terminalJourneyResult.ownerSummary.actualArguments)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Site verified</dt>
                    <dd>{terminalJourneyResult.ownerSummary.verifiedEffect}</dd>
                  </div>
                </dl>
                {terminalJourneyResult.ownerSummary.recommendedNextStep ? (
                  <div className="handoff-owner-next-step">
                    <strong>Recommended next step</strong>
                    <p>{terminalJourneyResult.ownerSummary.recommendedNextStep}</p>
                  </div>
                ) : null}
                <div className="handoff-owner-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => returnToStoppedJourney("edit", terminalJourneyResult)}
                  >
                    Edit this test
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => returnToStoppedJourney("rerun", terminalJourneyResult)}
                  >
                    Reset journey and rerun
                  </button>
                </div>
                <details className="handoff-owner-technical">
                  <summary>View technical summary</summary>
                  <pre>{JSON.stringify(terminalJourneyResult.ownerSummary, null, 2)}</pre>
                </details>
              </section>
            ) : (
              <ol className="handoff-instructions">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Copy the secure command</strong>
                    <p>The command opens this private, ten-minute test in ChatGPT.</p>
                    <div className="handoff-command-card">
                      <span aria-hidden="true">◇</span>
                      <div>
                        <strong>Secure test command ready</strong>
                        <small>
                          {total} request{total === 1 ? "" : "s"} · expires in ten minutes
                        </small>
                      </div>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => void copyCommand(command)}
                      >
                        {copied ? "Command copied — paste in ChatGPT" : "Copy fresh-chat command"}
                      </button>
                    </div>
                    <label className="handoff-command-value">
                      Exact fresh-agent command
                      <textarea
                        readOnly
                        rows={4}
                        value={command}
                        aria-label="Exact fresh-agent command"
                      />
                    </label>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Open a separate fresh ChatGPT desktop task</strong>
                    <p>Use GPT-5.6 Sol or Terra in a Work or Codex chat.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Paste the command and send</strong>
                    <p>
                      Keep this owner page open. Continue the full{" "}
                      {continuousSource ? "journey" : "suite"} in that same agent task.
                    </p>
                  </div>
                </li>
              </ol>
            )}

            <aside className="handoff-compatibility-note">
              <strong>Use ChatGPT&apos;s built-in Browser.</strong>
              <span>The Chrome side panel does not expose Site Tools.</span>
            </aside>

            <button
              className="text-button handoff-cancel"
              type="button"
              onClick={() => void cancelSource()}
            >
              Cancel unstarted handoff
            </button>
          </div>

          <aside className="handoff-journey-summary">
            <p className="eyebrow">
              {regressionBatchSource ? "Regression summary" : "Journey summary"}
            </p>
            <div className="handoff-summary-count">
              <strong>{total}</strong>
              <span>ordered request{total === 1 ? "" : "s"}</span>
            </div>
            <ul>
              <li>{source.toolNames.length} real WebMCP tools</li>
              <li>{batchSource ? "One agent context" : "One fresh agent context"}</li>
              <li>
                {continuousSource ? "Verified state carried forward" : "Clean state per case"}
              </li>
              <li>
                {continuousSource
                  ? "Stops before unreliable downstream checks"
                  : "Continues after individual failures"}
              </li>
            </ul>

            {sourcePlan.length > 0 ? (
              <details className="handoff-run-order">
                <summary>View {sourcePlan.length}-step run order</summary>
                <ol>
                  {sourcePlan.map((step, index) => (
                    <li key={step.caseId}>
                      <span>{index + 1}</span>
                      <div>
                        <code>{step.toolName}</code>
                        <small>{step.request}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            <div
              className="handoff-live-status"
              data-state={error || claimFailureBlocks ? "blocked" : "active"}
              role="status"
            >
              <span className="handoff-status-pulse" aria-hidden="true" />
              <div>
                <strong>{error ? "Durable status unavailable" : statusTitle}</strong>
                <p>
                  {error
                    ? "Owner-side verification stopped; the progress count is no longer being updated."
                    : claimFailureBlocks
                      ? "The claim stopped before any request, tool, or native invocation was exposed."
                      : journeyStopped
                        ? `${journeyPassedCount} passed, ${journeyIssueCount || 1} issue, and ${journeyNotRunCount} not run.`
                        : agentConnected
                          ? "Keep working in the same agent task while Thurstone verifies each step."
                          : "Waiting for the secure handoff to be opened."}
                </p>
              </div>
              <div
                className="handoff-progress-track"
                role="progressbar"
                aria-label="Verified journey requests"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={verifiedCount}
              >
                <span style={{ width: `${(verifiedCount / total) * 100}%` }} />
              </div>
              {sourceJourneyStatus?.complete && !journeyStopped ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void finishContinuousSource()}
                >
                  View {regressionBatchSource ? "regression" : "journey"} results
                </button>
              ) : claimFailureBlocks ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={recoverFromClaimFailure}
                >
                  Return to contract and create a new handoff
                </button>
              ) : sourceResult && !continuousSource ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void continueContractRun()}
                >
                  {position < total
                    ? `Prepare request ${position + 1} of ${total}`
                    : "Finish contract run"}
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  if (error && !result) {
    return (
      <section className="agent-runner-empty" data-byoa-v2-state="ERROR">
        <p className="eyebrow">Isolated run stopped safely</p>
        <h1>This fresh-agent test cannot continue.</h1>
        <p>{error}</p>
        <p>
          Close this task and return to the owner&apos;s existing Demo task to create a new opaque
          handoff.
        </p>
      </section>
    );
  }

  if (!projection) {
    return (
      <section className="agent-runner-loading" aria-live="polite">
        <p className="eyebrow">Fresh-agent handoff</p>
        <h1>Receiving the answer-free test…</h1>
      </section>
    );
  }

  if (result) {
    return (
      <section className="byoa-terminal-result" data-byoa-v2-state={sessionState}>
        {error ? (
          <div className="agent-runner-recovery" role="alert">
            <strong>The next request was not received.</strong>
            <p>{error}</p>
            <p>Retry below. Thurstone will reuse the same admitted step without duplicating it.</p>
          </div>
        ) : null}
        {journey !== undefined ? (
          <div className="agent-runner-recovery" role="status">
            <strong>
              {journey.mode === "continuous" ? "Continuous journey" : "Regression suite"} · step{" "}
              {journey.position} of {journey.total}
            </strong>
            <p>
              {journey.position < journey.total && journey.mode === "regression"
                ? `This case ${result.verdict === "pass" ? "passed" : `finished as ${result.verdict}`}. Continue to the next request; Thurstone will load a clean fixture and preserve this result.`
                : result.verdict === "pass" && journey.position < journey.total
                  ? "This step passed. Continue here, then send the next displayed request in the same agent chat. The cart and ledger state will carry forward."
                  : result.verdict === "pass"
                    ? `${journey.mode === "continuous" ? "Journey" : "Regression suite"} complete. ${journeyResultCount || journey.total} independently verified results were preserved.`
                    : journey.mode === "regression"
                      ? `Regression suite complete. ${journeyResultCount || journey.total} results were preserved, including this ${result.verdict}.`
                      : "The journey stopped at this issue because downstream state could no longer be trusted. Earlier passes remain preserved; later requests were not exposed or executed."}
            </p>
            {journey.position < journey.total &&
            (journey.mode === "regression" || result.verdict === "pass") ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void continueContinuousJourney()}
              >
                Continue to {journey.mode === "regression" ? "case" : "step"} {journey.position + 1}
              </button>
            ) : null}
          </div>
        ) : null}
        <DiagnosticResultV3
          result={result}
          actions={
            journey === undefined ? (
              <RegressionActionsV3
                result={result}
                existingCaseDigest={existingRegressionCaseDigest}
              />
            ) : undefined
          }
        />
      </section>
    );
  }

  return (
    <section className="agent-runner-grid" data-byoa-v2-state={sessionState}>
      <div className="agent-runner-main">
        <p className="eyebrow">
          Stage 4 of 5 ·{" "}
          {journey
            ? `continuous journey ${journey.position} of ${journey.total}`
            : "isolated fresh-agent test"}
        </p>
        <h1>
          {sessionState === "RECEIVED"
            ? "Review what this agent receives."
            : sessionState === "READY_TO_ARM"
              ? "Start the bounded observation when ready."
              : "Your live test is armed."}
        </h1>
        <blockquote>{projection.request}</blockquote>
        {journey && journey.position > 1 ? (
          <p className="agent-runner-recovery">
            Send this request in the same agent chat. Thurstone retained the verified synthetic
            state from the previous step.
          </p>
        ) : null}
        <h2>Available native tools</h2>
        <ul>
          {projection.descriptors.map((tool) => (
            <li key={tool.name}>
              <strong>{tool.title}</strong> <code>{tool.name}</code>
              <p>{tool.description}</p>
            </li>
          ))}
        </ul>
        {sessionState === "RECEIVED" ? (
          <button className="button button-primary" type="button" onClick={markReady}>
            Continue to readiness
          </button>
        ) : null}
        {sessionState === "READY_TO_ARM" ? (
          <button
            className="button button-primary"
            type="button"
            onClick={() => void startLiveObservation()}
          >
            Start live observation
          </button>
        ) : null}
        {!["RECEIVED", "READY_TO_ARM"].includes(sessionState) ? (
          <p role="status" aria-live="polite">
            {progress}
          </p>
        ) : null}
      </div>
      <aside className="owner-fixture">
        <span className="owner-fixture-summary">Safe synthetic fixture</span>
        <strong>{projection.fixture.fixtureId}</strong>
        <p>{projection.fixture.summary}</p>
        <p>
          {projection.descriptors.length} selected real tool
          {projection.descriptors.length === 1 ? "" : "s"}. This isolated view contains only the
          request, catalog, and fixture.
        </p>
      </aside>
    </section>
  );
}
