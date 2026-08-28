import "server-only";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson } from "@/lib/evidence/digest";
import {
  assertNoProbeExpectationLeakage,
  createProbeFixtureSynopsis,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import {
  createScoredTrialEnvelope,
  type ScoredBoundaryInput,
  type ScoredPurpose,
  type ScoredTrialEnvelope
} from "@/lib/scored/envelope";
import { GATE3_SEMANTIC_SUITE } from "@/lib/semantic/checkout-candidate.server";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";

export const GATE3_EXPECTATION_FREE_CASE_SOURCE_VERSION =
  "toolproof-gate3-expectation-free-case-source@1.0.0";

export interface Gate3ExpectationFreeCase {
  readonly version: typeof GATE3_EXPECTATION_FREE_CASE_SOURCE_VERSION;
  readonly runnerCaseId: string;
  readonly naturalLanguageRequest: string;
  readonly fixtureId: "checkout-seed-v1";
}

export interface CreateGate3ScoredEnvelopeInput {
  readonly purpose: ScoredPurpose;
  readonly freezeHash: string;
  readonly buildCommit: string;
  readonly runId: string;
  readonly runnerCaseId: string;
  readonly trialId: string;
  readonly liveManifest: ProbeLiveManifest;
  readonly initialBoundary: ScoredBoundaryInput;
}

export class Gate3ScoredCaseSourceError extends Error {
  constructor(readonly code: "unknown_scored_runner_case" | "scored_boundary_mismatch") {
    super(code);
    this.name = "Gate3ScoredCaseSourceError";
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function expectationFreeProjection(runnerCaseId: string): Gate3ExpectationFreeCase {
  const candidate = GATE3_SEMANTIC_SUITE.scoredCases.find(
    (scoredCase) => scoredCase.runnerCaseId === runnerCaseId
  );
  if (!candidate) throw new Gate3ScoredCaseSourceError("unknown_scored_runner_case");
  const projection: Gate3ExpectationFreeCase = {
    version: GATE3_EXPECTATION_FREE_CASE_SOURCE_VERSION,
    runnerCaseId: candidate.runnerCaseId,
    naturalLanguageRequest: candidate.naturalLanguageRequest,
    fixtureId: candidate.fixtureId as "checkout-seed-v1"
  };
  assertNoProbeExpectationLeakage(projection);
  return deepFreeze(JSON.parse(canonicalJson(projection)) as Gate3ExpectationFreeCase);
}

/**
 * Resolves exactly one approved candidate request by opaque runner ID. Family, subset, semantic
 * identity, relationships, labels, expectations, and evaluator rules never leave this module.
 */
export function getGate3ExpectationFreeCase(runnerCaseId: string): Gate3ExpectationFreeCase {
  return expectationFreeProjection(runnerCaseId);
}

export async function createGate3ScoredTrialEnvelope(
  input: CreateGate3ScoredEnvelopeInput
): Promise<ScoredTrialEnvelope> {
  const candidate = expectationFreeProjection(input.runnerCaseId);
  const fixture = createCheckoutFixture();
  const expectedNames = [...INITIAL_CHECKOUT_TOOL_NAMES].sort();
  if (
    input.initialBoundary.fixtureId !== fixture.fixtureId ||
    input.initialBoundary.fixtureVersion !== fixture.fixtureVersion ||
    input.initialBoundary.fixtureSeed !== fixture.seed ||
    input.initialBoundary.stateRevision !== 0 ||
    input.initialBoundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    input.initialBoundary.manifestHash !== input.liveManifest.manifestHash ||
    input.initialBoundary.operationLedgerCount !== 0 ||
    input.initialBoundary.currentTrajectoryCount !== 0 ||
    canonicalJson([...input.initialBoundary.registeredToolNames].sort()) !==
      canonicalJson(expectedNames)
  ) {
    throw new Gate3ScoredCaseSourceError("scored_boundary_mismatch");
  }
  return createScoredTrialEnvelope({
    purpose: input.purpose,
    freezeHash: input.freezeHash,
    buildCommit: input.buildCommit,
    runId: input.runId,
    caseId: candidate.runnerCaseId,
    trialId: input.trialId,
    naturalLanguageRequest: candidate.naturalLanguageRequest,
    fixture: createProbeFixtureSynopsis(fixture),
    liveManifest: input.liveManifest,
    initialBoundary: input.initialBoundary
  });
}

export function gate3ScoredRunnerCaseIds(): readonly string[] {
  return Object.freeze(GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId));
}
