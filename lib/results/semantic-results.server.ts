import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { probeLiveManifestSchema, type ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import { createProbeRedis } from "@/lib/probe/ledger";
import {
  buildGate6EvidencePackage,
  createGate6EvidenceExports,
  type Gate6EvidenceExports,
  type Gate6EvidencePackage,
  type Gate6TraceRecord
} from "@/lib/results/evidence-package";
import {
  BASELINE_EVIDENCE_DIGEST_ENV,
  BASELINE_RUN_ID_ENV,
  REVISED_EVIDENCE_DIGEST_ENV,
  REVISED_RUN_ID_ENV
} from "@/lib/results/config";
import { readPermanentScoredRunById, type ScoredRunSnapshot } from "@/lib/scored/run-store.server";
import { configuredGate3FrozenProtocol } from "@/lib/semantic/frozen-config.server";
import { configuredGate5Revision } from "@/lib/semantic/revision-config.server";
import type { Gate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  semanticMeaningForCase,
  type SemanticContract,
  type SemanticScoredCase
} from "@/lib/semantic/contract";
import type { Gate3ScoredEvidenceRow } from "@/lib/semantic/scored-evaluation.server";

export {
  BASELINE_EVIDENCE_DIGEST_ENV,
  BASELINE_RUN_ID_ENV,
  REVISED_EVIDENCE_DIGEST_ENV,
  REVISED_RUN_ID_ENV
} from "@/lib/results/config";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface SemanticSupersededProtocolEvidence {
  readonly disposition: "superseded-protocol";
  readonly predecessorReviewPackageHash: string;
  readonly predecessorFrozenProtocolHash: string;
  readonly predecessorFreezeCandidateHash: string;
  readonly predecessorRunId: string;
  readonly predecessorEvidenceDigest: string;
  readonly predecessorCompletedCaseCount: 24;
  readonly predecessorProviderCallCount: 24;
  readonly priorRepairReceiptHash: string;
  readonly priorRepairProviderCallCount: 1;
  readonly successorOffsets: {
    readonly baseline: 24;
    readonly repair: 1;
    readonly revised: 0;
  };
  readonly retained: true;
  readonly mergedIntoCurrentMatrix: false;
}

export interface SemanticDevelopmentResultRow {
  readonly ordinal: number;
  readonly caseId: string;
  readonly runnerCaseId: string;
  readonly family: string;
  readonly request: string;
  readonly expectedAction: string;
  readonly observedAction: string;
  readonly passed: boolean;
  readonly score: 0 | 1;
  readonly failureCodes: readonly string[];
  readonly traceEventId: string | null;
  readonly stateChanged: boolean;
}

export interface SemanticDevelopmentRepairRow {
  readonly ordinal: number;
  readonly runnerCaseId: string;
  readonly meaningId: string;
  readonly request: string;
  readonly expected: {
    readonly approvedMeaning: string;
    readonly approvalClass: string;
    readonly actionClass: string;
    readonly tool: string | null;
    readonly arguments: unknown;
    readonly stateChange: string;
    readonly allowedEffects: readonly string[];
    readonly forbiddenEffects: readonly string[];
  };
  readonly observed: {
    readonly actionClass: string;
    readonly decision: Gate3ScoredEvidenceRow["providerReceipt"]["decision"];
    readonly decisionError: string | null;
    readonly refusal: string | null;
    readonly passed: boolean;
    readonly score: 0 | 1;
    readonly failureCodes: readonly string[];
  };
  readonly trace: {
    readonly eventId: string;
    readonly toolName: string;
    readonly status: string;
    readonly commitDisposition: string;
    readonly canonicalArguments: unknown;
    readonly canonicalResultSha256: string;
    readonly stateBeforeSha256: string;
    readonly stateAfterSha256: string;
    readonly effect: {
      readonly stateChanged: boolean;
      readonly revisionDelta: number;
      readonly changedQuantities: readonly {
        readonly itemId: string;
        readonly delta: number;
      }[];
      readonly pendingCheckoutChanged: boolean;
      readonly unmodeledStateChanged: boolean;
    };
  } | null;
}

export type SemanticResultsState =
  | {
      readonly status: "no-scored-run";
      readonly disclosure: "No run yet";
      readonly supersededEvidence: SemanticSupersededProtocolEvidence | null;
    }
  | {
      readonly status: "baseline-development-only";
      readonly disclosure: "one-trial demonstration snapshot";
      readonly baselineRunId: string;
      readonly baselineEvidenceDigest: string;
      readonly baselineAppCommit: string;
      readonly taskBoundary: string;
      readonly currentDescription: string;
      readonly reviewPackageHash: string;
      readonly frozenProtocolHash: string;
      readonly liveManifest: ProbeLiveManifest;
      readonly supersededEvidence: SemanticSupersededProtocolEvidence | null;
      readonly rows: readonly SemanticDevelopmentResultRow[];
      readonly repairRows: readonly SemanticDevelopmentRepairRow[];
      readonly development: {
        readonly earned: number;
        readonly possible: 12;
      };
      readonly holdout: {
        readonly status: "sealed";
        readonly caseCount: 12;
        readonly attemptCount: number;
        readonly commitmentDigest: string;
        readonly revealRule: "after-v2-freeze-and-revised-terminal";
      };
    }
  | {
      readonly status: "paired-comparison";
      readonly disclosure: "one-trial demonstration snapshot";
      readonly baselineRunId: string;
      readonly baselineEvidenceDigest: string;
      readonly revisedRunId: string;
      readonly revisedEvidenceDigest: string;
      readonly revisionFreezeHash: string;
      readonly supersededEvidence: SemanticSupersededProtocolEvidence | null;
      readonly rows: readonly {
        readonly caseId: string;
        readonly runnerCaseId: string;
        readonly subset: "development" | "builder-blinded-holdout";
        readonly family: string;
        readonly request: string;
        readonly expectedAction: string;
        readonly baselineObservedAction: string;
        readonly revisedObservedAction: string;
        readonly baselinePassed: boolean;
        readonly revisedPassed: boolean;
      }[];
      readonly development: {
        readonly baselineEarned: number;
        readonly revisedEarned: number;
        readonly possible: 12;
      };
      readonly holdout: {
        readonly baselineEarned: number;
        readonly revisedEarned: number;
        readonly possible: 12;
      };
      readonly evidencePackage: Gate6EvidencePackage;
      readonly evidenceExports: Gate6EvidenceExports;
      readonly presentation: {
        readonly commit: string;
        readonly deploymentIdentity: string;
      };
    };

function action(value: Gate3ScoredEvidenceRow["evaluation"], expected: boolean): string {
  const kind = expected ? value.expectedActionClass : value.observedActionClass;
  if (kind !== "call") return kind;
  const trace = value.checks.find(
    ({ code }) => code === (expected ? "decision_tool" : "executed_tool")
  );
  const resolved = expected ? trace?.expected : trace?.actual;
  return typeof resolved === "string" ? `call:${resolved}` : "call";
}

function scoredRows(
  snapshot: ScoredRunSnapshot,
  scoredCases: readonly SemanticScoredCase[]
): readonly SemanticDevelopmentResultRow[] {
  const rows: SemanticDevelopmentResultRow[] = [];
  for (const attempt of snapshot.attempts) {
    if (attempt.disposition !== "scored") continue;
    const evidence = attempt.evidence as Record<string, unknown>;
    const row = evidence.row as Gate3ScoredEvidenceRow;
    const definition = scoredCases.find(
      ({ runnerCaseId }) => runnerCaseId === attempt.runnerCaseId
    );
    if (!definition || row.evaluation.score === null) {
      throw new Error("semantic_results_row_invalid");
    }
    const trace = Array.isArray(row.trialEvidence.currentTraces)
      ? (row.trialEvidence.currentTraces[0] as { readonly eventId?: unknown } | undefined)
      : undefined;
    rows.push(
      Object.freeze({
        ordinal: attempt.ordinal,
        caseId: definition.caseId,
        runnerCaseId: definition.runnerCaseId,
        family: definition.family,
        request: definition.naturalLanguageRequest,
        expectedAction: action(row.evaluation, true),
        observedAction: action(row.evaluation, false),
        passed: row.evaluation.passed,
        score: row.evaluation.score,
        failureCodes: row.evaluation.failureCodes,
        traceEventId: typeof trace?.eventId === "string" ? trace.eventId : null,
        stateChanged: Boolean(
          row.evaluation.checks.find(({ code }) => code === "state_change")?.actual
        )
      })
    );
  }
  rows.sort((left, right) => left.ordinal - right.ordinal);
  return Object.freeze(rows);
}

function repairRows(
  snapshot: ScoredRunSnapshot,
  developmentCases: readonly SemanticScoredCase[],
  contract: SemanticContract
): readonly SemanticDevelopmentRepairRow[] {
  const developmentIds = new Set(developmentCases.map(({ runnerCaseId }) => runnerCaseId));
  const rows: SemanticDevelopmentRepairRow[] = [];
  for (const attempt of snapshot.attempts) {
    if (attempt.disposition !== "scored" || !developmentIds.has(attempt.runnerCaseId)) continue;
    const evidence = attempt.evidence as Record<string, unknown>;
    const row = evidence.row as Gate3ScoredEvidenceRow;
    const definition = developmentCases.find(
      ({ runnerCaseId }) => runnerCaseId === attempt.runnerCaseId
    );
    if (!definition || row.evaluation.score === null) {
      throw new Error("semantic_repair_row_invalid");
    }
    const approved = semanticMeaningForCase(contract, definition);
    const expectation = approved.expectation;
    const trace = Array.isArray(row.trialEvidence.currentTraces)
      ? (row.trialEvidence.currentTraces[0] as
          | {
              readonly eventId?: unknown;
              readonly toolName?: unknown;
              readonly status?: unknown;
              readonly commitDisposition?: unknown;
              readonly canonicalArguments?: { readonly value?: unknown };
              readonly canonicalResult?: { readonly sha256?: unknown };
              readonly stateBefore?: { readonly sha256?: unknown };
              readonly stateAfter?: { readonly sha256?: unknown };
              readonly effect?: unknown;
            }
          | undefined)
      : undefined;
    const projectedTrace = trace
      ? {
          eventId: String(trace.eventId ?? ""),
          toolName: String(trace.toolName ?? ""),
          status: String(trace.status ?? ""),
          commitDisposition: String(trace.commitDisposition ?? ""),
          canonicalArguments: trace.canonicalArguments?.value ?? null,
          canonicalResultSha256: String(trace.canonicalResult?.sha256 ?? ""),
          stateBeforeSha256: String(trace.stateBefore?.sha256 ?? ""),
          stateAfterSha256: String(trace.stateAfter?.sha256 ?? ""),
          effect: (() => {
            const effect = trace.effect as {
              readonly stateChanged?: unknown;
              readonly revision?: { readonly delta?: unknown };
              readonly quantities?: readonly {
                readonly itemId?: unknown;
                readonly delta?: unknown;
                readonly changed?: unknown;
              }[];
              readonly pendingCheckout?: { readonly changed?: unknown };
              readonly unmodeledStateChanged?: unknown;
            };
            return {
              stateChanged: effect.stateChanged === true,
              revisionDelta: Number(effect.revision?.delta ?? 0),
              changedQuantities: (effect.quantities ?? [])
                .filter(({ changed }) => changed === true)
                .map(({ itemId, delta }) => ({
                  itemId: String(itemId ?? ""),
                  delta: Number(delta)
                })),
              pendingCheckoutChanged: effect.pendingCheckout?.changed === true,
              unmodeledStateChanged: effect.unmodeledStateChanged === true
            };
          })()
        }
      : null;
    rows.push(
      Object.freeze({
        ordinal: attempt.ordinal,
        runnerCaseId: definition.runnerCaseId,
        meaningId: definition.meaningId,
        request: definition.naturalLanguageRequest,
        expected: Object.freeze({
          approvedMeaning: approved.approvedMeaning,
          approvalClass: approved.approvalClass,
          actionClass: expectation.kind,
          tool: expectation.kind === "call" ? expectation.tool : null,
          arguments: expectation.kind === "call" ? expectation.arguments : null,
          stateChange: expectation.stateChange,
          allowedEffects: approved.allowedEffects,
          forbiddenEffects: approved.forbiddenEffects
        }),
        observed: Object.freeze({
          actionClass: row.evaluation.observedActionClass,
          decision: row.providerReceipt.decision,
          decisionError: row.providerReceipt.decisionError,
          refusal: row.providerReceipt.refusal,
          passed: row.evaluation.passed,
          score: row.evaluation.score,
          failureCodes: row.evaluation.failureCodes
        }),
        trace: projectedTrace ? Object.freeze(projectedTrace) : null
      })
    );
  }
  rows.sort((left, right) => left.ordinal - right.ordinal);
  if (rows.length !== 12) throw new Error("semantic_repair_denominator_invalid");
  return Object.freeze(rows);
}

function baselineLiveManifest(snapshot: ScoredRunSnapshot): ProbeLiveManifest {
  let selected: ProbeLiveManifest | null = null;
  for (const attempt of snapshot.attempts) {
    if (attempt.disposition !== "scored") continue;
    const evidence = attempt.evidence as Record<string, unknown>;
    const row = evidence.row as Gate3ScoredEvidenceRow;
    const envelope = row.envelope as { readonly liveManifest?: unknown };
    const manifest = probeLiveManifestSchema.parse(envelope.liveManifest);
    if (selected && canonicalJson(selected) !== canonicalJson(manifest)) {
      throw new Error("baseline_results_manifest_drift");
    }
    selected = manifest;
  }
  if (!selected) {
    throw new Error("baseline_results_manifest_missing");
  }
  return selected;
}

function normalizedDecisionSignature(
  decision: Gate3ScoredEvidenceRow["providerReceipt"]["decision"]
): string {
  if (!decision) return "no_action";
  if (decision.kind !== "call") return decision.kind === "abstain" ? "no_action" : decision.kind;
  const normalizedArguments = Object.fromEntries(
    Object.entries(decision.arguments).map(([key, value]) => [
      key,
      key === "operationId" ? "<runner-owned>" : value
    ])
  );
  return `call:${decision.tool}:${canonicalJson(normalizedArguments)}`;
}

function traceErrorClass(
  attempt: ScoredRunSnapshot["attempts"][number],
  failureCodes: readonly string[],
  argumentPassed: boolean,
  effectPassed: boolean
): Gate6TraceRecord["errorClass"] {
  if (attempt.disposition === "infrastructure-invalid") return "infrastructure";
  if (failureCodes.length === 0) return "none";
  if (
    failureCodes.some((code) =>
      ["decision_action_class", "decision_tool", "executed_tool"].includes(code)
    )
  )
    return "semantic-action";
  if (!argumentPassed) return "semantic-argument";
  if (!effectPassed) return "semantic-effect";
  return "semantic-action";
}

function noChangeEffect(state: unknown): unknown {
  const record = state as {
    readonly revision?: unknown;
    readonly lines?: readonly { readonly itemId?: unknown; readonly quantity?: unknown }[];
    readonly pendingCheckout?: unknown;
  };
  const revision = Number(record.revision ?? 0);
  return Object.freeze({
    stateChanged: false,
    revision: { before: revision, after: revision, delta: 0, changed: false },
    quantities: (record.lines ?? []).map(({ itemId, quantity }) => ({
      itemId: String(itemId ?? ""),
      beforeQuantity: Number(quantity ?? 0),
      afterQuantity: Number(quantity ?? 0),
      delta: 0,
      changed: false
    })),
    pendingCheckout: {
      before: record.pendingCheckout ?? null,
      after: record.pendingCheckout ?? null,
      changed: false
    },
    unmodeledStateChanged: false
  });
}

function gate6TraceRecords(
  snapshot: ScoredRunSnapshot,
  scoredCases: readonly SemanticScoredCase[],
  contract: SemanticContract,
  version: "baseline" | "revised"
): readonly Gate6TraceRecord[] {
  const records: Gate6TraceRecord[] = [];
  for (const attempt of snapshot.attempts) {
    if (attempt.disposition !== "scored") continue;
    const definition = scoredCases.find(
      ({ runnerCaseId }) => runnerCaseId === attempt.runnerCaseId
    );
    if (!definition) throw new Error("gate6_trace_case_missing");
    const evidence = attempt.evidence as Record<string, unknown>;
    const row = evidence.row as Gate3ScoredEvidenceRow;
    const evaluation = row.evaluation;
    if (evaluation.score === null) throw new Error("gate6_trace_score_missing");
    const approved = semanticMeaningForCase(contract, definition);
    const expected = approved.expectation;
    const trial = row.trialEvidence as unknown as {
      readonly adapterVersion?: unknown;
      readonly captureDigest?: unknown;
      readonly currentState?: unknown;
      readonly currentTraces?: readonly unknown[];
      readonly origin?: unknown;
      readonly fallback?: {
        readonly catalog?: {
          readonly manifestHash?: unknown;
          readonly toolNames?: readonly unknown[];
          readonly registrationGeneration?: unknown;
        };
        readonly runtime?: {
          readonly browserVersion?: unknown;
          readonly chromeForTesting?: unknown;
          readonly runtimeContractHash?: unknown;
        };
      };
      readonly capture?: { readonly providerReceiptHash?: unknown };
    };
    const trace = trial.currentTraces?.[0] as
      | {
          readonly eventId?: unknown;
          readonly status?: unknown;
          readonly canonicalArguments?: { readonly value?: unknown; readonly sha256?: unknown };
          readonly canonicalResult?: { readonly value?: unknown; readonly sha256?: unknown };
          readonly stateBefore?: { readonly value?: unknown; readonly sha256?: unknown };
          readonly stateAfter?: { readonly value?: unknown; readonly sha256?: unknown };
          readonly effect?: unknown;
          readonly runtime?: { readonly argumentMode?: unknown };
        }
      | undefined;
    const provider = row.providerReceipt;
    const decision = provider.decision;
    const envelope = row.envelope as unknown as {
      readonly liveManifest: unknown;
      readonly envelopeHash: string;
    };
    const manifest = probeLiveManifestSchema.parse(envelope.liveManifest);
    const checks = evaluation.checks;
    const argumentStart = checks.findIndex(({ code }) => code === "decision_execution_arguments");
    const argumentChecks =
      expected.kind === "call" && argumentStart >= 0
        ? [
            checks[argumentStart]!,
            ...checks.slice(
              argumentStart + 1,
              argumentStart + 1 + expected.arguments.predicates.length
            ),
            ...checks.filter(({ code }) => code === "no_additional_arguments")
          ]
        : [];
    const stateChangeIndex = checks.findIndex(({ code }) => code === "state_change");
    const stateAndEffectPredicateCount =
      expected.stateBefore.length + expected.stateAfter.length + expected.effect.length;
    const effectChecks = [
      ...checks.filter(({ code }) =>
        [
          "effect_surfaces_allowed",
          "forbidden_effect_surfaces_absent",
          "trace_effect_link"
        ].includes(code)
      ),
      ...(stateChangeIndex >= 0
        ? checks.slice(stateChangeIndex, stateChangeIndex + 1 + stateAndEffectPredicateCount)
        : [])
    ];
    const expectedTool = expected.kind === "call" ? expected.tool : null;
    const observedTool = decision?.kind === "call" ? decision.tool : null;
    const consequentialOverAction =
      (expected.kind !== "call" || expectedTool === "order_review") &&
      decision?.kind === "call" &&
      observedTool !== "order_review" &&
      observedTool !== "cart_get";
    const relationship =
      definition.relationship.kind === "equivalent_realization"
        ? {
            kind: "equivalent_realization" as const,
            id: definition.relationship.groupId,
            side: null
          }
        : {
            kind: "matched_boundary" as const,
            id: definition.relationship.pairId,
            side: definition.relationship.side
          };
    const providerRecord = provider as unknown as Record<string, unknown>;
    const fallbackRuntime = trial.fallback?.runtime;
    const fallbackCatalog = trial.fallback?.catalog;
    const state = trial.currentState ?? null;
    const argumentPassed =
      expected.kind !== "call" ||
      (argumentChecks.length === expected.arguments.predicates.length + 2 &&
        argumentChecks.every(({ passed }) => passed));
    const effectPassed =
      effectChecks.length >= stateAndEffectPredicateCount + 3 &&
      effectChecks.every(({ passed }) => passed);
    records.push(
      Object.freeze({
        version,
        ordinal: attempt.ordinal,
        caseId: definition.caseId,
        runnerCaseId: definition.runnerCaseId,
        subset: definition.subset,
        family: definition.family,
        relationship,
        request: definition.naturalLanguageRequest,
        expectedAction: action(evaluation, true),
        observedAction: action(evaluation, false),
        observedSignature: normalizedDecisionSignature(decision),
        expectedKind: expected.kind,
        expectedTool,
        passed: evaluation.passed,
        score: evaluation.score,
        failureCodes: evaluation.failureCodes,
        errorClass: traceErrorClass(attempt, evaluation.failureCodes, argumentPassed, effectPassed),
        argumentPassed,
        effectPassed,
        consequentialOverAction,
        clarification: Object.freeze({
          expected: expected.kind === "clarify",
          observed: decision?.kind === "clarify",
          text: decision?.kind === "clarify" ? decision.text : null
        }),
        liveCatalog: Object.freeze({
          manifestHash: String(fallbackCatalog?.manifestHash ?? manifest.manifestHash),
          toolNames: Object.freeze(
            (fallbackCatalog?.toolNames ?? manifest.tools.map(({ name }) => name)).map(String)
          ),
          registrationGeneration: Number(fallbackCatalog?.registrationGeneration ?? 0)
        }),
        model: Object.freeze({
          provider: provider.provider,
          model: provider.model,
          decision,
          refusal: provider.refusal,
          decisionError: provider.decisionError,
          promptHash: provider.promptHash,
          settingsHash: provider.settingsHash,
          rawResponseHash: provider.rawResponseHash,
          dispatchedAt: provider.dispatchedAt,
          completedAt: provider.completedAt,
          durationMs: provider.durationMs
        }),
        execution: Object.freeze({
          canonicalArguments: trace?.canonicalArguments?.value ?? null,
          nativeResult: trace?.canonicalResult?.value ?? null,
          stateBefore: trace?.stateBefore?.value ?? state,
          stateAfter: trace?.stateAfter?.value ?? state,
          effect: trace?.effect ?? noChangeEffect(state),
          traceEventId: typeof trace?.eventId === "string" ? trace.eventId : null,
          traceStatus: typeof trace?.status === "string" ? trace.status : null
        }),
        runtime: Object.freeze({
          browserVersion: String(fallbackRuntime?.browserVersion ?? "unknown"),
          chromeForTesting: String(fallbackRuntime?.chromeForTesting ?? "unknown"),
          runtimeContractHash: String(fallbackRuntime?.runtimeContractHash ?? ""),
          adapterVersion: String(trial.adapterVersion ?? ""),
          origin: String(trial.origin ?? ""),
          argumentMode:
            typeof trace?.runtime?.argumentMode === "string" ? trace.runtime.argumentMode : null
        }),
        hashes: Object.freeze({
          rowDigest: row.rowDigest,
          envelopeHash: envelope.envelopeHash,
          captureDigest: String(trial.captureDigest ?? ""),
          providerReceiptHash: String(
            trial.capture?.providerReceiptHash ?? providerRecord.rawResponseHash ?? ""
          ),
          traceArgumentsHash:
            typeof trace?.canonicalArguments?.sha256 === "string"
              ? trace.canonicalArguments.sha256
              : null,
          traceResultHash:
            typeof trace?.canonicalResult?.sha256 === "string"
              ? trace.canonicalResult.sha256
              : null,
          stateBeforeHash:
            typeof trace?.stateBefore?.sha256 === "string" ? trace.stateBefore.sha256 : null,
          stateAfterHash:
            typeof trace?.stateAfter?.sha256 === "string" ? trace.stateAfter.sha256 : null
        })
      })
    );
  }
  records.sort((left, right) => left.ordinal - right.ordinal);
  if (records.length !== 24) throw new Error("gate6_trace_denominator_invalid");
  return Object.freeze(records);
}

function supersededEvidence(
  reviewPackage: Gate3HumanReviewPackage | null
): SemanticSupersededProtocolEvidence | null {
  const lineage = reviewPackage?.successorLineage;
  if (!lineage) return null;
  return Object.freeze({
    disposition: lineage.disposition,
    predecessorReviewPackageHash: lineage.predecessor.reviewPackageHash,
    predecessorFrozenProtocolHash: lineage.predecessor.frozenProtocolHash,
    predecessorFreezeCandidateHash: lineage.predecessor.freezeCandidateHash,
    predecessorRunId: lineage.predecessor.runId,
    predecessorEvidenceDigest: lineage.predecessor.evidenceDigest,
    predecessorCompletedCaseCount: lineage.predecessor.completedCaseCount,
    predecessorProviderCallCount: lineage.predecessor.providerCallCount,
    priorRepairReceiptHash: lineage.priorRepair.repairBuilderReceiptHash,
    priorRepairProviderCallCount: lineage.priorRepair.providerCallCount,
    successorOffsets: lineage.phaseCallOffsets,
    retained: true as const,
    mergedIntoCurrentMatrix: false as const
  });
}

export async function readSemanticResults(
  environment: EnvironmentLike = process.env
): Promise<SemanticResultsState> {
  const runId = environment[BASELINE_RUN_ID_ENV]?.trim();
  const evidenceDigest = environment[BASELINE_EVIDENCE_DIGEST_ENV]?.trim();
  if (!runId && !evidenceDigest) {
    return Object.freeze({
      status: "no-scored-run",
      disclosure: "No run yet",
      supersededEvidence: null
    });
  }
  if (
    !/^run_[A-Za-z0-9_-]{22}$/u.test(runId ?? "") ||
    !/^[a-f0-9]{64}$/u.test(evidenceDigest ?? "")
  ) {
    throw new Error("baseline_results_configuration_invalid");
  }
  const frozen = await configuredGate3FrozenProtocol(environment);
  if (frozen.status !== "frozen" || !frozen.protocol || !frozen.reviewPackage) {
    throw new Error("baseline_results_freeze_missing");
  }
  const artifactSecret = environment.TOOLPROOF_SIGNING_SECRET?.trim();
  if (!artifactSecret) throw new Error("baseline_results_secret_missing");
  const snapshot = await readPermanentScoredRunById(
    createProbeRedis(environment as NodeJS.ProcessEnv),
    {
      phase: "baseline",
      frozenProtocolHash: frozen.protocol.frozenProtocolHash,
      runId: runId!,
      artifactSecret
    }
  );
  if (
    !snapshot ||
    snapshot.status !== "acknowledged" ||
    snapshot.evidenceDigest !== evidenceDigest
  ) {
    throw new Error("baseline_results_evidence_mismatch");
  }
  const frozenSuite = frozen.reviewPackage.suite;
  const baselineRows = scoredRows(snapshot, frozenSuite.scoredCases);
  if (baselineRows.length !== 24) throw new Error("baseline_results_denominator_invalid");
  const developmentCases = frozenSuite.scoredCases.filter(({ subset }) => subset === "development");
  const developmentIds = new Set(developmentCases.map(({ runnerCaseId }) => runnerCaseId));
  const rows = baselineRows.filter(({ runnerCaseId }) => developmentIds.has(runnerCaseId));
  const developmentRepairRows = repairRows(
    snapshot,
    developmentCases,
    frozen.reviewPackage.contract
  );
  const liveManifest = baselineLiveManifest(snapshot);
  if (
    canonicalJson(liveManifest) !==
    canonicalJson(frozen.reviewPackage.targetContract.initialManifest)
  ) {
    throw new Error("baseline_results_frozen_manifest_mismatch");
  }
  const checkoutRequest = liveManifest.tools.find(({ name }) => name === "checkout_request");
  if (!checkoutRequest) throw new Error("baseline_results_checkout_request_missing");
  const holdoutAttempts = snapshot.attempts.filter(
    ({ runnerCaseId }) => !developmentIds.has(runnerCaseId)
  );
  if (rows.length !== 12) throw new Error("baseline_development_denominator_invalid");
  const revisedRunId = environment[REVISED_RUN_ID_ENV]?.trim();
  const revisedEvidenceDigest = environment[REVISED_EVIDENCE_DIGEST_ENV]?.trim();
  if (revisedRunId || revisedEvidenceDigest) {
    if (
      !/^run_[A-Za-z0-9_-]{22}$/u.test(revisedRunId ?? "") ||
      !/^[a-f0-9]{64}$/u.test(revisedEvidenceDigest ?? "")
    ) {
      throw new Error("revised_results_configuration_invalid");
    }
    const revision = await configuredGate5Revision(environment);
    if (revision.status !== "ready" || !revision.revision) {
      throw new Error("revised_results_freeze_missing");
    }
    const revisedSnapshot = await readPermanentScoredRunById(
      createProbeRedis(environment as NodeJS.ProcessEnv),
      {
        phase: "revised",
        frozenProtocolHash: revision.revision.revisionFreezeHash,
        runId: revisedRunId!,
        artifactSecret
      }
    );
    if (
      !revisedSnapshot ||
      revisedSnapshot.status !== "acknowledged" ||
      revisedSnapshot.evidenceDigest !== revisedEvidenceDigest
    ) {
      throw new Error("revised_results_evidence_mismatch");
    }
    const revisedRows = scoredRows(revisedSnapshot, frozenSuite.scoredCases);
    if (revisedRows.length !== 24) throw new Error("revised_results_denominator_invalid");
    const revisedByCase = new Map(revisedRows.map((row) => [row.caseId, row]));
    const comparison = baselineRows.map((baseline) => {
      const revised = revisedByCase.get(baseline.caseId);
      const definition = frozenSuite.scoredCases.find(({ caseId }) => caseId === baseline.caseId);
      if (!revised || !definition) throw new Error("paired_results_case_mismatch");
      return Object.freeze({
        caseId: baseline.caseId,
        runnerCaseId: baseline.runnerCaseId,
        subset: definition.subset,
        family: baseline.family,
        request: baseline.request,
        expectedAction: baseline.expectedAction,
        baselineObservedAction: baseline.observedAction,
        revisedObservedAction: revised.observedAction,
        baselinePassed: baseline.passed,
        revisedPassed: revised.passed
      });
    });
    const developmentComparison = comparison.filter(({ subset }) => subset === "development");
    const holdoutComparison = comparison.filter(
      ({ subset }) => subset === "builder-blinded-holdout"
    );
    const baselineTraceRecords = gate6TraceRecords(
      snapshot,
      frozenSuite.scoredCases,
      frozen.reviewPackage.contract,
      "baseline"
    );
    const revisedTraceRecords = gate6TraceRecords(
      revisedSnapshot,
      frozenSuite.scoredCases,
      frozen.reviewPackage.contract,
      "revised"
    );
    const allTraceRecords = Object.freeze([...baselineTraceRecords, ...revisedTraceRecords]);
    const baselineStartTimes = baselineTraceRecords.map(({ model }) => model.dispatchedAt).sort();
    const baselineCompleteTimes = baselineTraceRecords.map(({ model }) => model.completedAt).sort();
    const revisedStartTimes = revisedTraceRecords.map(({ model }) => model.dispatchedAt).sort();
    const revisedCompleteTimes = revisedTraceRecords.map(({ model }) => model.completedAt).sort();
    const firstBaseline = baselineTraceRecords[0]!;
    const firstRevised = revisedTraceRecords[0]!;
    const evidencePackage = await buildGate6EvidencePackage({
      evidenceLabel: "authentic Custom Probe reference · one-trial demonstration snapshot",
      repetitionCount: 1,
      infrastructure: Object.freeze({
        baseline: Object.freeze({
          logicalCases: 24,
          attempts: snapshot.attemptCount,
          scoredOutcomes: snapshot.completedCount,
          transportFailures: snapshot.transportFailureCount,
          retries: snapshot.attemptCount - snapshot.completedCount,
          incomplete:
            snapshot.terminalStatus === "terminal-complete" ? 0 : 24 - snapshot.completedCount,
          indeterminate: snapshot.terminalStatus === "terminal-invalid" ? 1 : 0
        }),
        revised: Object.freeze({
          logicalCases: 24,
          attempts: revisedSnapshot.attemptCount,
          scoredOutcomes: revisedSnapshot.completedCount,
          transportFailures: revisedSnapshot.transportFailureCount,
          retries: revisedSnapshot.attemptCount - revisedSnapshot.completedCount,
          incomplete:
            revisedSnapshot.terminalStatus === "terminal-complete"
              ? 0
              : 24 - revisedSnapshot.completedCount,
          indeterminate: revisedSnapshot.terminalStatus === "terminal-invalid" ? 1 : 0
        })
      }),
      contractDiff: Object.freeze({
        changedField: "checkout_request.description",
        path: "lib/webmcp/checkout-request-tool.ts",
        oldDescription: revision.revision.oldDescription,
        newDescription: revision.revision.newDescription,
        sourceDiffProofHash: revision.revision.sourceDiffProof.proofHash,
        revisionFreezeHash: revision.revision.revisionFreezeHash,
        hunkCount: 1,
        removedLineCount: 1,
        addedLineCount: 1
      }),
      provenance: Object.freeze({
        baselineRunId: runId!,
        baselineEvidenceDigest: evidenceDigest!,
        baselineAppCommit: snapshot.identity.appCommit,
        revisedRunId: revisedRunId!,
        revisedEvidenceDigest: revisedEvidenceDigest!,
        revisedAppCommit: revisedSnapshot.identity.appCommit,
        reviewPackageHash: frozen.reviewPackage.packageHash,
        gate3FrozenProtocolHash: frozen.protocol.frozenProtocolHash,
        revisionFreezeHash: revision.revision.revisionFreezeHash,
        provider: firstRevised.model.provider,
        model: firstRevised.model.model,
        baselineManifestHash: firstBaseline.liveCatalog.manifestHash,
        revisedManifestHash: firstRevised.liveCatalog.manifestHash,
        fixtureId: frozen.reviewPackage.fixture.fixtureId,
        fixtureVersion: frozen.reviewPackage.fixture.fixtureVersion,
        evaluatorVersion: frozen.reviewPackage.evaluator.version,
        runnerHash: revision.revision.unchangedProtocolBindings.runnerHash,
        promptHash: firstRevised.model.promptHash,
        settingsHash: firstRevised.model.settingsHash,
        retryPolicyHash: revision.revision.unchangedProtocolBindings.retryPolicyHash,
        baselineStartedAt: baselineStartTimes[0]!,
        baselineCompletedAt: baselineCompleteTimes.at(-1)!,
        revisedStartedAt: revisedStartTimes[0]!,
        revisedCompletedAt: revisedCompleteTimes.at(-1)!,
        measuredV2Commit: revision.revision.v2AppCommit,
        postEvidenceTestCommit: "b5ab0f812b0c0fd39f5372603ff80ac1a4f341a1",
        testOnlyProjectionHash: "fbd48a1ad44f665e831020ca6608e084cb08aba1cd81cc91a4d3409915f55ddd",
        targetOrigin: firstRevised.runtime.origin
      }),
      namespaces: Object.freeze([
        Object.freeze({
          id: "custom-probe" as const,
          status: "primary authentic reference: baseline and revised terminal",
          includedInPrimaryDenominator: true
        }),
        Object.freeze({
          id: "direct-chatgpt" as const,
          status: "four authentic fresh-context Codex Site Tools observations retained separately",
          includedInPrimaryDenominator: false
        }),
        Object.freeze({
          id: "calibration" as const,
          status: "four non-scored cases retained separately",
          includedInPrimaryDenominator: false
        }),
        Object.freeze({
          id: "native-plumbing" as const,
          status: "deterministic WebMCP plumbing proof retained separately",
          includedInPrimaryDenominator: false
        }),
        Object.freeze({
          id: "exploratory" as const,
          status: "judge-started exploration cannot overwrite reference evidence",
          includedInPrimaryDenominator: false
        })
      ]),
      limitations: Object.freeze([
        "One trial per case and version is a demonstration snapshot, not a stability estimate.",
        "One provider model and one synthetic checkout domain do not establish generality.",
        "The description revision produced 23/24 before and after: no measured improvement.",
        "The same tentative-checkout holdout abstained instead of clarifying in both versions.",
        "Repair received zero holdout prompts or results; blinding is operational, not cryptographic.",
        "Custom Probe evidence is not a measurement of Direct ChatGPT behavior.",
        "The result is not safety certification or proof of model understanding.",
        "Clarification usefulness awaits Sergio's final human claims review.",
        "Hashes establish internal consistency, not independent attestation."
      ]),
      records: allTraceRecords
    });
    const evidenceExports = await createGate6EvidenceExports(evidencePackage);
    return Object.freeze({
      status: "paired-comparison",
      disclosure: "one-trial demonstration snapshot",
      baselineRunId: runId!,
      baselineEvidenceDigest: evidenceDigest!,
      revisedRunId: revisedRunId!,
      revisedEvidenceDigest: revisedEvidenceDigest!,
      revisionFreezeHash: revision.revision.revisionFreezeHash,
      supersededEvidence: supersededEvidence(frozen.reviewPackage),
      rows: Object.freeze(comparison),
      development: Object.freeze({
        baselineEarned: developmentComparison.filter(({ baselinePassed }) => baselinePassed).length,
        revisedEarned: developmentComparison.filter(({ revisedPassed }) => revisedPassed).length,
        possible: 12 as const
      }),
      holdout: Object.freeze({
        baselineEarned: holdoutComparison.filter(({ baselinePassed }) => baselinePassed).length,
        revisedEarned: holdoutComparison.filter(({ revisedPassed }) => revisedPassed).length,
        possible: 12 as const
      }),
      evidencePackage,
      evidenceExports,
      presentation: Object.freeze({
        commit:
          environment.VERCEL_GIT_COMMIT_SHA?.trim() ??
          environment.TOOLPROOF_COMMIT_SHA?.trim() ??
          "unversioned",
        deploymentIdentity:
          environment.VERCEL_DEPLOYMENT_ID?.trim() ??
          environment.VERCEL_URL?.trim() ??
          "local-unavailable"
      })
    });
  }
  return Object.freeze({
    status: "baseline-development-only",
    disclosure: "one-trial demonstration snapshot",
    baselineRunId: runId!,
    baselineEvidenceDigest: evidenceDigest!,
    baselineAppCommit: snapshot.identity.appCommit,
    taskBoundary: frozen.reviewPackage.contract.taskBoundary,
    currentDescription: checkoutRequest.description,
    reviewPackageHash: frozen.protocol.reviewPackageHash,
    frozenProtocolHash: frozen.protocol.frozenProtocolHash,
    liveManifest,
    supersededEvidence: supersededEvidence(frozen.reviewPackage),
    rows: Object.freeze(rows),
    repairRows: developmentRepairRows,
    development: Object.freeze({
      earned: rows.filter(({ passed }) => passed).length,
      possible: 12 as const
    }),
    holdout: Object.freeze({
      status: "sealed" as const,
      caseCount: 12 as const,
      attemptCount: holdoutAttempts.length,
      commitmentDigest: await canonicalSha256(holdoutAttempts),
      revealRule: "after-v2-freeze-and-revised-terminal" as const
    })
  });
}
