export const PROBE_CLIENT_RUNNER_VERSION = "toolproof-probe-client-runner@1.0.0";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,96}$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 10_000;
const MAX_JSON_STRING_CHARACTERS = 100_000;
const MAX_DECISION_TEXT_CHARACTERS = 800;

export type ProbeClientJsonPrimitive = null | boolean | number | string;
export type ProbeClientJsonValue =
  | ProbeClientJsonPrimitive
  | readonly ProbeClientJsonValue[]
  | { readonly [key: string]: ProbeClientJsonValue };

export type ProbeClientDecision =
  | {
      readonly kind: "call";
      readonly tool: string;
      readonly arguments: Readonly<Record<string, ProbeClientJsonValue>>;
    }
  | { readonly kind: "clarify"; readonly text: string }
  | { readonly kind: "abstain"; readonly reason: string };

export type ProbeClientTerminalStatus =
  | "call_completed"
  | "call_failed"
  | "clarified"
  | "abstained"
  | "unregistered_tool"
  | "malformed_decision"
  | "provider_failure"
  | "boundary_drift";

export type ProbeClientRunnerStage =
  | "initial_boundary"
  | "claim"
  | "decision"
  | "live_reverification"
  | "native_execution"
  | "capture"
  | "post_reset"
  | "completion";

export interface ProbeClientErrorEvidence {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly nativeCallMade?: boolean;
  readonly rawResult?: string | null;
  readonly inferencePerformed?: boolean;
  readonly httpStatus?: number;
}

export class ProbeClientRunnerError extends Error {
  constructor(
    readonly stage: ProbeClientRunnerStage,
    readonly code: string
  ) {
    super(`${stage}:${code}`);
    this.name = "ProbeClientRunnerError";
  }
}

export interface ProbeNamedRegisteredTool {
  readonly name: string;
}

export interface ProbeInitialBoundaryBinding {
  readonly status: "verified";
  readonly catalogState: "initial";
  readonly fixtureId: string;
  readonly fixtureSeed: string;
  readonly stateRevision: 0;
  readonly stateHash: string;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly operationLedgerCount: 0;
  readonly currentTrajectoryCount: 0;
}

export interface ProbeVerifiedInitialBoundary<
  TTool extends ProbeNamedRegisteredTool,
  TResetReceipt
> extends ProbeInitialBoundaryBinding {
  readonly resetId: string;
  readonly resetReceipt: TResetReceipt;
  /** Exact RegisteredTool identities returned by the verified live consumer catalog. */
  readonly tools: readonly TTool[];
}

export interface ProbeLiveInitialBoundary<
  TTool extends ProbeNamedRegisteredTool
> extends ProbeInitialBoundaryBinding {
  /** Exact RegisteredTool identities returned by the live re-verification. */
  readonly tools: readonly TTool[];
}

export interface ProbeOpaqueClaim<TAuthorization> {
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
  /** Transient signed authorization. It is never included in capture or return values. */
  readonly authorization: TAuthorization;
}

export interface ProbePublicClaim {
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
}

export interface ProbeFreshDecisionContextReceipt {
  readonly kind: "fresh-stateless";
  readonly previousResponseId: null;
  readonly providerRequestCount: 1;
}

export interface ProbeFreshDecisionReceipt {
  readonly context: ProbeFreshDecisionContextReceipt;
  readonly rawModelResponse: string;
  readonly providerReceipt: ProbeClientJsonValue;
  readonly decision: unknown;
}

export interface ProbeBoundaryEvidence<TResetReceipt> extends ProbeInitialBoundaryBinding {
  readonly resetId: string;
  readonly resetReceipt: TResetReceipt;
  readonly registeredToolNames: readonly string[];
}

export interface ProbeLiveBoundaryEvidence extends ProbeInitialBoundaryBinding {
  readonly registeredToolNames: readonly string[];
}

export interface ProbeClientTrialTimings {
  readonly startedAtMs: number;
  readonly initialBoundaryVerifiedAtMs: number;
  readonly claimIssuedAtMs: number;
  readonly decisionCompletedAtMs: number;
  readonly liveReverifiedAtMs: number;
  readonly nativeCompletedAtMs: number | null;
  readonly captureStartedAtMs: number;
}

export interface ProbeClientTrialCapture<TResetReceipt, TExecutionResult> {
  readonly runnerVersion: typeof PROBE_CLIENT_RUNNER_VERSION;
  readonly claim: ProbePublicClaim;
  readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
  readonly liveBoundary: ProbeLiveBoundaryEvidence | null;
  readonly decisionRequestCount: 1;
  readonly rawDecisionEnvelope: ProbeClientJsonValue | null;
  readonly rawModelResponse: string | null;
  readonly providerReceipt: ProbeClientJsonValue | null;
  readonly decision: ProbeClientDecision | null;
  readonly selectedToolName: string | null;
  readonly rawArguments: Readonly<Record<string, ProbeClientJsonValue>> | null;
  readonly nativeAllowanceConsumed: boolean;
  readonly nativeDispatchCount: 0 | 1;
  readonly executionResult: TExecutionResult | null;
  readonly terminalStatus: ProbeClientTerminalStatus;
  readonly errors: {
    readonly provider: ProbeClientErrorEvidence | null;
    readonly decision: ProbeClientErrorEvidence | null;
    readonly liveBoundary: ProbeClientErrorEvidence | null;
    readonly execution: ProbeClientErrorEvidence | null;
  };
  readonly timings: ProbeClientTrialTimings;
}

export interface ProbeClientCompletionInput<TResetReceipt, TEvidence> {
  readonly runnerVersion: typeof PROBE_CLIENT_RUNNER_VERSION;
  readonly claim: ProbePublicClaim;
  readonly terminalStatus: ProbeClientTerminalStatus;
  readonly nativeDispatchCount: 0 | 1;
  readonly evidence: TEvidence;
  readonly postResetBoundary: ProbeBoundaryEvidence<TResetReceipt>;
}

export interface ProbeClientTrialResult<TSeal> {
  readonly status: "sealed";
  readonly terminalStatus: ProbeClientTerminalStatus;
  readonly nativeDispatchCount: 0 | 1;
  readonly seal: TSeal;
}

export interface ProbeClientRunnerDependencies<
  TTool extends ProbeNamedRegisteredTool,
  TAuthorization,
  TResetReceipt,
  TExecutionResult,
  TEvidence,
  TSeal
> {
  waitAndVerifyCleanInitial(input: {
    readonly stage: "before" | "after";
  }): Promise<ProbeVerifiedInitialBoundary<TTool, TResetReceipt>>;
  issueOpaqueClaim(input: {
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
  }): Promise<ProbeOpaqueClaim<TAuthorization>>;
  requestFreshDecision(input: {
    readonly claim: ProbeOpaqueClaim<TAuthorization>;
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
  }): Promise<unknown>;
  reverifyLiveInitial(input: {
    readonly claim: ProbePublicClaim;
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
  }): Promise<ProbeLiveInitialBoundary<TTool>>;
  executeOnce(input: {
    readonly claim: ProbePublicClaim;
    readonly tool: TTool;
    readonly arguments: Readonly<Record<string, ProbeClientJsonValue>>;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<TExecutionResult>;
  captureCurrentTrialEvidence(
    input: ProbeClientTrialCapture<TResetReceipt, TExecutionResult>
  ): Promise<TEvidence>;
  completeAndSeal(input: ProbeClientCompletionInput<TResetReceipt, TEvidence>): Promise<TSeal>;
  /** Optional hook for clearing adapter-owned transient caches after local references are dropped. */
  discardTransientReferences?(): void;
  nowMs?(): number;
}

class JsonSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonSnapshotError";
  }
}

interface JsonSnapshotState {
  nodes: number;
}

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freezeDeep(nested);
  }
  return value;
}

function snapshotJson(
  value: unknown,
  state: JsonSnapshotState = { nodes: 0 },
  depth = 0
): ProbeClientJsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) throw new JsonSnapshotError("JSON value has too many nodes.");
  if (depth > MAX_JSON_DEPTH) throw new JsonSnapshotError("JSON value is too deeply nested.");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_CHARACTERS) {
      throw new JsonSnapshotError("JSON string is too large.");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new JsonSnapshotError("JSON number must be finite.");
    return value;
  }
  if (typeof value !== "object") throw new JsonSnapshotError("Value is not JSON-safe.");

  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.some(
        (key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))
      )
    ) {
      throw new JsonSnapshotError("JSON array has unsupported properties.");
    }
    const entries: ProbeClientJsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new JsonSnapshotError("JSON arrays must be dense data arrays.");
      }
      entries.push(snapshotJson(descriptor.value, state, depth + 1));
    }
    return Object.freeze(entries);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new JsonSnapshotError("JSON objects must have an ordinary or null prototype.");
  }
  const output: Record<string, ProbeClientJsonValue> = Object.create(null) as Record<
    string,
    ProbeClientJsonValue
  >;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || keys.some((key) => typeof key !== "string")) {
    throw new JsonSnapshotError("JSON object has unsupported properties.");
  }
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new JsonSnapshotError("JSON objects must contain enumerable data properties only.");
    }
    output[key] = snapshotJson(descriptor.value, state, depth + 1);
  }
  return freezeDeep(output);
}

function isJsonObject(
  value: ProbeClientJsonValue
): value is { readonly [key: string]: ProbeClientJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: { readonly [key: string]: unknown },
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonBlankDecisionText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DECISION_TEXT_CHARACTERS &&
    value.trim().length > 0
  );
}

function parseDecision(value: ProbeClientJsonValue): ProbeClientDecision {
  if (!isJsonObject(value) || typeof value.kind !== "string") {
    throw new JsonSnapshotError("Decision must be one object with a recognized kind.");
  }

  if (value.kind === "call") {
    const tool = value.tool;
    const argumentsValue = value.arguments;
    if (
      !hasExactKeys(value, ["arguments", "kind", "tool"]) ||
      typeof tool !== "string" ||
      !TOOL_NAME_PATTERN.test(tool) ||
      argumentsValue === undefined ||
      !isJsonObject(argumentsValue)
    ) {
      throw new JsonSnapshotError("Call decision is malformed.");
    }
    return freezeDeep({
      kind: "call" as const,
      tool,
      arguments: argumentsValue
    });
  }

  if (value.kind === "clarify") {
    if (!hasExactKeys(value, ["kind", "text"]) || !nonBlankDecisionText(value.text)) {
      throw new JsonSnapshotError("Clarification decision is malformed.");
    }
    return Object.freeze({ kind: "clarify" as const, text: value.text });
  }

  if (value.kind === "abstain") {
    if (!hasExactKeys(value, ["kind", "reason"]) || !nonBlankDecisionText(value.reason)) {
      throw new JsonSnapshotError("Abstention decision is malformed.");
    }
    return Object.freeze({ kind: "abstain" as const, reason: value.reason });
  }

  throw new JsonSnapshotError("Decision kind is unsupported.");
}

function parseFreshDecisionReceipt(value: unknown): {
  readonly envelope: ProbeClientJsonValue;
  readonly receipt: ProbeFreshDecisionReceipt;
} {
  const envelope = snapshotJson(value);
  if (
    !isJsonObject(envelope) ||
    !hasExactKeys(envelope, ["context", "decision", "providerReceipt", "rawModelResponse"])
  ) {
    throw new JsonSnapshotError("Fresh decision receipt is malformed.");
  }
  const context = envelope.context;
  const decisionValue = envelope.decision;
  const providerReceipt = envelope.providerReceipt;
  const rawModelResponse = envelope.rawModelResponse;
  if (
    context === undefined ||
    !isJsonObject(context) ||
    !hasExactKeys(context, ["kind", "previousResponseId", "providerRequestCount"]) ||
    context.kind !== "fresh-stateless" ||
    context.previousResponseId !== null ||
    context.providerRequestCount !== 1 ||
    decisionValue === undefined ||
    providerReceipt === undefined ||
    typeof rawModelResponse !== "string" ||
    rawModelResponse.length === 0
  ) {
    throw new JsonSnapshotError("Fresh decision receipt is malformed.");
  }
  return Object.freeze({
    envelope,
    receipt: Object.freeze({
      context: Object.freeze({
        kind: "fresh-stateless" as const,
        previousResponseId: null,
        providerRequestCount: 1 as const
      }),
      rawModelResponse,
      providerReceipt,
      decision: decisionValue
    })
  });
}

function safeErrorEvidence(error: unknown): ProbeClientErrorEvidence {
  if (error instanceof Error) {
    const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
    const nativeDescriptor = Object.getOwnPropertyDescriptor(error, "nativeCallMade");
    const rawResultDescriptor = Object.getOwnPropertyDescriptor(error, "rawResult");
    const inferenceDescriptor = Object.getOwnPropertyDescriptor(error, "inferencePerformed");
    const httpStatusDescriptor = Object.getOwnPropertyDescriptor(error, "httpStatus");
    return Object.freeze({
      name: error.name || "Error",
      message: error.message || "Operation failed.",
      ...(typeof codeDescriptor?.value === "string" ? { code: codeDescriptor.value } : {}),
      ...(typeof nativeDescriptor?.value === "boolean"
        ? { nativeCallMade: nativeDescriptor.value }
        : {}),
      ...(typeof rawResultDescriptor?.value === "string" || rawResultDescriptor?.value === null
        ? { rawResult: rawResultDescriptor.value as string | null }
        : {}),
      ...(typeof inferenceDescriptor?.value === "boolean"
        ? { inferencePerformed: inferenceDescriptor.value }
        : {}),
      ...(typeof httpStatusDescriptor?.value === "number"
        ? { httpStatus: httpStatusDescriptor.value }
        : {})
    });
  }
  return Object.freeze({ name: "Error", message: "Unknown operation failure." });
}

function requireNonBlank(value: string, stage: ProbeClientRunnerStage, code: string): void {
  if (value.trim().length === 0 || value.length > 256) {
    throw new ProbeClientRunnerError(stage, code);
  }
}

function sortedToolNames<TTool extends ProbeNamedRegisteredTool>(
  tools: readonly TTool[]
): string[] {
  const names = tools.map(({ name }) => name);
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some((name) => !TOOL_NAME_PATTERN.test(name))
  ) {
    throw new ProbeClientRunnerError("live_reverification", "invalid_registered_catalog");
  }
  return names.sort((left, right) => left.localeCompare(right));
}

function validateBoundaryCore(
  value: ProbeInitialBoundaryBinding,
  stage: ProbeClientRunnerStage
): void {
  if (
    value.status !== "verified" ||
    value.catalogState !== "initial" ||
    value.stateRevision !== 0 ||
    value.operationLedgerCount !== 0 ||
    value.currentTrajectoryCount !== 0 ||
    !SHA256_PATTERN.test(value.stateHash) ||
    !SHA256_PATTERN.test(value.manifestHash) ||
    !Number.isSafeInteger(value.registrationGeneration) ||
    value.registrationGeneration < 1
  ) {
    throw new ProbeClientRunnerError(stage, "invalid_initial_boundary");
  }
  requireNonBlank(value.fixtureId, stage, "invalid_fixture_id");
  requireNonBlank(value.fixtureSeed, stage, "invalid_fixture_seed");
}

function validateVerifiedBoundary<TTool extends ProbeNamedRegisteredTool, TResetReceipt>(
  value: ProbeVerifiedInitialBoundary<TTool, TResetReceipt>,
  stage: "initial_boundary" | "post_reset"
): void {
  validateBoundaryCore(value, stage);
  if (!OPAQUE_ID_PATTERN.test(value.resetId)) {
    throw new ProbeClientRunnerError(stage, "invalid_reset_id");
  }
  sortedToolNames(value.tools);
}

function validateLiveBoundary<TTool extends ProbeNamedRegisteredTool>(
  value: ProbeLiveInitialBoundary<TTool>
): void {
  validateBoundaryCore(value, "live_reverification");
  sortedToolNames(value.tools);
}

function boundaryEvidence<TTool extends ProbeNamedRegisteredTool, TResetReceipt>(
  value: ProbeVerifiedInitialBoundary<TTool, TResetReceipt>
): ProbeBoundaryEvidence<TResetReceipt> {
  return Object.freeze({
    status: "verified" as const,
    catalogState: "initial" as const,
    fixtureId: value.fixtureId,
    fixtureSeed: value.fixtureSeed,
    stateRevision: 0 as const,
    stateHash: value.stateHash,
    manifestHash: value.manifestHash,
    registrationGeneration: value.registrationGeneration,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    resetId: value.resetId,
    resetReceipt: value.resetReceipt,
    registeredToolNames: Object.freeze(sortedToolNames(value.tools))
  });
}

function liveBoundaryEvidence<TTool extends ProbeNamedRegisteredTool>(
  value: ProbeLiveInitialBoundary<TTool>
): ProbeLiveBoundaryEvidence {
  return Object.freeze({
    status: "verified" as const,
    catalogState: "initial" as const,
    fixtureId: value.fixtureId,
    fixtureSeed: value.fixtureSeed,
    stateRevision: 0 as const,
    stateHash: value.stateHash,
    manifestHash: value.manifestHash,
    registrationGeneration: value.registrationGeneration,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    registeredToolNames: Object.freeze(sortedToolNames(value.tools))
  });
}

function publicClaim<TAuthorization>(claim: ProbeOpaqueClaim<TAuthorization>): ProbePublicClaim {
  for (const [field, value] of [
    ["run_id", claim.runId],
    ["case_id", claim.caseId],
    ["trial_id", claim.trialId]
  ] as const) {
    if (!OPAQUE_ID_PATTERN.test(value)) {
      throw new ProbeClientRunnerError("claim", `invalid_${field}`);
    }
  }
  return Object.freeze({ runId: claim.runId, caseId: claim.caseId, trialId: claim.trialId });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertUnchangedLiveBoundary<TTool extends ProbeNamedRegisteredTool, TResetReceipt>(
  initial: ProbeVerifiedInitialBoundary<TTool, TResetReceipt>,
  live: ProbeLiveInitialBoundary<TTool>
): void {
  if (
    initial.fixtureId !== live.fixtureId ||
    initial.fixtureSeed !== live.fixtureSeed ||
    initial.stateHash !== live.stateHash ||
    initial.manifestHash !== live.manifestHash ||
    initial.registrationGeneration !== live.registrationGeneration ||
    !sameStrings(sortedToolNames(initial.tools), sortedToolNames(live.tools))
  ) {
    throw new ProbeClientRunnerError("live_reverification", "boundary_changed");
  }
}

function assertPostResetRestored<TTool extends ProbeNamedRegisteredTool, TResetReceipt>(
  initial: ProbeVerifiedInitialBoundary<TTool, TResetReceipt>,
  post: ProbeVerifiedInitialBoundary<TTool, TResetReceipt>
): void {
  if (
    initial.resetId === post.resetId ||
    initial.fixtureId !== post.fixtureId ||
    initial.fixtureSeed !== post.fixtureSeed ||
    initial.stateHash !== post.stateHash ||
    initial.manifestHash !== post.manifestHash ||
    post.registrationGeneration < initial.registrationGeneration ||
    !sameStrings(sortedToolNames(initial.tools), sortedToolNames(post.tools))
  ) {
    throw new ProbeClientRunnerError("post_reset", "fixture_not_restored");
  }
}

/**
 * Runs exactly one client-side Probe trial. The caller owns network, native WebMCP, evidence,
 * reset, and sealing implementations; this state machine only admits their strict ordering.
 */
export async function runProbeClientTrial<
  TTool extends ProbeNamedRegisteredTool,
  TAuthorization,
  TResetReceipt,
  TExecutionResult,
  TEvidence,
  TSeal
>(
  dependencies: ProbeClientRunnerDependencies<
    TTool,
    TAuthorization,
    TResetReceipt,
    TExecutionResult,
    TEvidence,
    TSeal
  >
): Promise<ProbeClientTrialResult<TSeal>> {
  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  let initial: ProbeVerifiedInitialBoundary<TTool, TResetReceipt> | undefined;
  let initialEvidence: ProbeBoundaryEvidence<TResetReceipt> | undefined;
  let claim: ProbeOpaqueClaim<TAuthorization> | undefined;
  let visibleClaim: ProbePublicClaim | undefined;
  let rawDecisionEnvelope: ProbeClientJsonValue | undefined;
  let freshReceipt: ProbeFreshDecisionReceipt | undefined;
  let decision: ProbeClientDecision | undefined;
  let live: ProbeLiveInitialBoundary<TTool> | undefined;
  let liveEvidence: ProbeLiveBoundaryEvidence | undefined;
  let executionResult: TExecutionResult | undefined;
  let evidence: TEvidence | undefined;

  try {
    initial = await dependencies.waitAndVerifyCleanInitial({ stage: "before" });
    validateVerifiedBoundary(initial, "initial_boundary");
    initialEvidence = boundaryEvidence(initial);
    const initialBoundaryVerifiedAtMs = nowMs();

    claim = await dependencies.issueOpaqueClaim({ initialBoundary: initialEvidence });
    visibleClaim = publicClaim(claim);
    const claimIssuedAtMs = nowMs();

    let providerError: ProbeClientErrorEvidence | null = null;
    let decisionError: ProbeClientErrorEvidence | null = null;
    let liveBoundaryError: ProbeClientErrorEvidence | null = null;
    let executionError: ProbeClientErrorEvidence | null = null;
    let terminalStatus: ProbeClientTerminalStatus = "provider_failure";

    let rawResponse: unknown;
    try {
      rawResponse = await dependencies.requestFreshDecision({
        claim,
        initialBoundary: initialEvidence
      });
    } catch (error) {
      providerError = safeErrorEvidence(error);
    }

    if (providerError === null) {
      try {
        const parsed = parseFreshDecisionReceipt(rawResponse);
        rawDecisionEnvelope = parsed.envelope;
        freshReceipt = parsed.receipt;
        try {
          decision = parseDecision(parsed.receipt.decision as ProbeClientJsonValue);
        } catch (error) {
          decisionError = safeErrorEvidence(error);
          terminalStatus = "malformed_decision";
        }
      } catch (error) {
        try {
          rawDecisionEnvelope = snapshotJson(rawResponse);
        } catch {
          rawDecisionEnvelope = undefined;
        }
        decisionError = safeErrorEvidence(error);
        terminalStatus = "malformed_decision";
      }
    }
    const decisionCompletedAtMs = nowMs();

    try {
      live = await dependencies.reverifyLiveInitial({
        claim: visibleClaim,
        initialBoundary: initialEvidence
      });
      validateLiveBoundary(live);
      assertUnchangedLiveBoundary(initial, live);
      liveEvidence = liveBoundaryEvidence(live);
    } catch (error) {
      liveBoundaryError = safeErrorEvidence(error);
      terminalStatus = "boundary_drift";
    }
    const liveReverifiedAtMs = nowMs();

    let selectedToolName: string | null = null;
    let rawArguments: Readonly<Record<string, ProbeClientJsonValue>> | null = null;
    let nativeDispatchCount: 0 | 1 = 0;
    let nativeCompletedAtMs: number | null = null;

    if (
      liveBoundaryError === null &&
      providerError === null &&
      decisionError === null &&
      decision &&
      live
    ) {
      if (decision.kind === "clarify") {
        terminalStatus = "clarified";
      } else if (decision.kind === "abstain") {
        terminalStatus = "abstained";
      } else {
        const callDecision = decision;
        selectedToolName = callDecision.tool;
        rawArguments = callDecision.arguments;
        const selected = live.tools.find((tool) => tool.name === callDecision.tool);
        if (!selected) {
          terminalStatus = "unregistered_tool";
          decisionError = Object.freeze({
            name: "ProbeDecisionError",
            message: "The selected tool is not in the reverified live catalog.",
            code: "tool_not_in_live_catalog"
          });
        } else {
          // Consume the whole trial allowance before crossing the executeOnce boundary.
          nativeDispatchCount = 1;
          try {
            executionResult = await dependencies.executeOnce({
              claim: visibleClaim,
              tool: selected,
              arguments: callDecision.arguments,
              manifestHash: live.manifestHash,
              registrationGeneration: live.registrationGeneration
            });
            terminalStatus = "call_completed";
          } catch (error) {
            executionError = safeErrorEvidence(error);
            terminalStatus = "call_failed";
          }
          nativeCompletedAtMs = nowMs();
        }
      }
    }

    const captureStartedAtMs = nowMs();
    const capture: ProbeClientTrialCapture<TResetReceipt, TExecutionResult> = Object.freeze({
      runnerVersion: PROBE_CLIENT_RUNNER_VERSION,
      claim: visibleClaim,
      initialBoundary: initialEvidence,
      liveBoundary: liveEvidence ?? null,
      decisionRequestCount: 1 as const,
      rawDecisionEnvelope: rawDecisionEnvelope ?? null,
      rawModelResponse: freshReceipt?.rawModelResponse ?? null,
      providerReceipt: freshReceipt?.providerReceipt ?? null,
      decision: decision ?? null,
      selectedToolName,
      rawArguments,
      nativeAllowanceConsumed: nativeDispatchCount === 1,
      nativeDispatchCount,
      executionResult: executionResult ?? null,
      terminalStatus,
      errors: Object.freeze({
        provider: providerError,
        decision: decisionError,
        liveBoundary: liveBoundaryError,
        execution: executionError
      }),
      timings: Object.freeze({
        startedAtMs,
        initialBoundaryVerifiedAtMs,
        claimIssuedAtMs,
        decisionCompletedAtMs,
        liveReverifiedAtMs,
        nativeCompletedAtMs,
        captureStartedAtMs
      })
    });

    let captureFailure: unknown;
    try {
      evidence = await dependencies.captureCurrentTrialEvidence(capture);
    } catch (error) {
      captureFailure = error;
    }

    let postReset: ProbeVerifiedInitialBoundary<TTool, TResetReceipt> | undefined;
    let postResetFailure: unknown;
    try {
      postReset = await dependencies.waitAndVerifyCleanInitial({ stage: "after" });
      validateVerifiedBoundary(postReset, "post_reset");
      assertPostResetRestored(initial, postReset);
    } catch (error) {
      postResetFailure = error;
    }

    if (captureFailure !== undefined) {
      throw new ProbeClientRunnerError("capture", "capture_failed");
    }
    if (postResetFailure !== undefined || !postReset) {
      throw new ProbeClientRunnerError("post_reset", "post_reset_failed");
    }
    if (evidence === undefined) {
      throw new ProbeClientRunnerError("capture", "missing_evidence");
    }
    if (providerError !== null && freshReceipt === undefined) {
      throw new ProbeClientRunnerError("completion", "provider_receipt_missing");
    }

    let seal: TSeal;
    try {
      seal = await dependencies.completeAndSeal({
        runnerVersion: PROBE_CLIENT_RUNNER_VERSION,
        claim: visibleClaim,
        terminalStatus,
        nativeDispatchCount,
        evidence,
        postResetBoundary: boundaryEvidence(postReset)
      });
    } catch {
      throw new ProbeClientRunnerError("completion", "completion_failed");
    }

    return Object.freeze({
      status: "sealed" as const,
      terminalStatus,
      nativeDispatchCount,
      seal
    });
  } finally {
    // Drop every current-trial capability and payload reference before allowing another trial.
    initial = undefined;
    initialEvidence = undefined;
    claim = undefined;
    visibleClaim = undefined;
    rawDecisionEnvelope = undefined;
    freshReceipt = undefined;
    decision = undefined;
    live = undefined;
    liveEvidence = undefined;
    executionResult = undefined;
    evidence = undefined;
    try {
      dependencies.discardTransientReferences?.();
    } catch {
      // Adapter cleanup cannot rewrite a terminal result or retain references held by this runner.
    }
  }
}
