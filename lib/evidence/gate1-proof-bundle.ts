import type {
  CheckoutResetReceipt as DomainResetReceipt,
  CheckoutSessionInspection,
  CheckoutSessionSnapshot,
  CheckoutTrajectoryArchive
} from "@/lib/domain/checkout-session";
import type { CheckoutState } from "@/lib/domain/checkout";
import {
  CHECKOUT_FIXTURE_STATE_HASH,
  type CheckoutResetReceipt as VerifiedResetReceipt
} from "@/lib/domain/checkout-reset";
import { canonicalJson, sha256Hex } from "@/lib/evidence/digest";
import type { CheckoutTraceLedgerSnapshot } from "@/lib/evidence/checkout-trace-ledger";
import {
  checkoutEffectDiff,
  type CanonicalEvidence,
  type OperationTrace
} from "@/lib/evidence/operation-trace";
import type { WebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";
import type { RegistryReadinessReceipt } from "@/lib/webmcp/readiness";
import type { RegistryStatus } from "@/lib/webmcp/registry-manager";
import type {
  ExecuteOnceResult,
  ExecuteTraceObservation,
  RuntimeCompatibilityReceipt
} from "@/lib/webmcp/runtime";

export const GATE1_PROOF_BUNDLE_VERSION = "toolproof-gate1-native-proof@1";
export const GATE1_PROOF_MAX_JOURNAL_EVENTS = 4_096;
export const GATE1_PROOF_MAX_JSON_BYTES = 5_000_000;

const JOURNAL_HASH_DOMAIN = "toolproof-gate1-journal-event@1\n";
const EVIDENCE_HASH_DOMAIN = "toolproof-gate1-evidence@1\n";
const BUNDLE_HASH_DOMAIN = "toolproof-gate1-bundle@1\n";

export type Gate1JournalKind =
  | "capabilities"
  | "registry_status"
  | "readiness_receipt"
  | "readiness_error"
  | "native_attempt_started"
  | "native_attempt_finished"
  | "native_control_error"
  | "domain_reset_receipt"
  | "reset_verification_receipt"
  | "reset_error";

export interface Gate1JournalEntry {
  readonly sequence: number;
  readonly recordedAt: string;
  readonly kind: Gate1JournalKind;
  readonly payload: unknown;
}

export interface Gate1JournalSnapshot {
  readonly entries: readonly Gate1JournalEntry[];
  readonly eventCount: number;
  readonly openNativeAttemptIds: readonly string[];
  readonly overflowed: boolean;
  readonly fault: string | null;
}

export interface Gate1NativeAttemptStart {
  readonly executionId: string;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly catalogState: "initial" | "pending";
  readonly fixtureRevision: number;
  readonly stateHash: string;
  readonly traceCount: number;
}

export type Gate1NativeAttemptFinish =
  | {
      readonly executionId: string;
      readonly toolName: string;
      readonly outcome: "receipt";
      readonly receipt: ExecuteOnceResult;
    }
  | {
      readonly executionId: string;
      readonly toolName: string;
      readonly outcome: "error";
      readonly error: Readonly<Record<string, unknown>>;
      readonly traceObservation: ExecuteTraceObservation | null;
      readonly observationError: Readonly<Record<string, unknown>> | null;
    };

interface Gate1EvidenceJournalOptions {
  readonly clock?: () => string;
  readonly maxEvents?: number;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function canonicalSnapshot<T = unknown>(value: unknown): T {
  const bytes = canonicalJson(value);
  if (typeof bytes !== "string") throw new TypeError("Evidence payload is not canonical JSON.");
  return deepFreeze(JSON.parse(bytes) as T);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function exactIsoUtc(value: unknown, label: string): string {
  const timestamp = nonEmptyString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp) ||
    new Date(timestamp).toISOString() !== timestamp
  ) {
    throw new TypeError(`${label} must be an exact millisecond ISO-8601 UTC timestamp.`);
  }
  return timestamp;
}

function attemptId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("Native attempt evidence must be an object.");
  }
  return nonEmptyString((payload as { readonly executionId?: unknown }).executionId, "executionId");
}

export class Gate1EvidenceJournal {
  private entries: readonly Gate1JournalEntry[] = Object.freeze([]);
  private readonly openNativeAttemptIds = new Set<string>();
  private readonly clock: () => string;
  private readonly maxEvents: number;
  private overflowed = false;
  private fault: string | null = null;

  constructor(options: Gate1EvidenceJournalOptions = {}) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.maxEvents = options.maxEvents ?? GATE1_PROOF_MAX_JOURNAL_EVENTS;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1) {
      throw new RangeError("Gate 1 journal maxEvents must be a positive safe integer.");
    }
  }

  recordCapabilities(value: WebMcpCapabilities): void {
    this.record("capabilities", value);
  }

  recordRegistryStatus(value: RegistryStatus): void {
    this.record("registry_status", projectRegistryStatus(value));
  }

  recordReadinessReceipt(
    value: RegistryReadinessReceipt,
    ownerWindow: Window | undefined,
    currentOrigin: string | undefined
  ): void {
    this.record("readiness_receipt", projectReadinessReceipt(value, ownerWindow, currentOrigin));
  }

  recordReadinessError(value: Readonly<Record<string, unknown>>): void {
    this.record("readiness_error", value);
  }

  recordNativeAttemptStarted(value: Gate1NativeAttemptStart): void {
    this.record("native_attempt_started", value);
  }

  recordNativeAttemptFinished(value: Gate1NativeAttemptFinish): void {
    this.record("native_attempt_finished", value);
  }

  recordNativeControlError(value: Readonly<Record<string, unknown>>): void {
    this.record("native_control_error", value);
  }

  recordDomainResetReceipt(value: DomainResetReceipt): void {
    this.record("domain_reset_receipt", value);
  }

  recordResetVerificationReceipt(value: VerifiedResetReceipt): void {
    this.record("reset_verification_receipt", value);
  }

  recordResetError(value: Readonly<Record<string, unknown>>): void {
    this.record("reset_error", value);
  }

  snapshot = (): Gate1JournalSnapshot =>
    deepFreeze({
      entries: this.entries,
      eventCount: this.entries.length,
      openNativeAttemptIds: Object.freeze([...this.openNativeAttemptIds].sort()),
      overflowed: this.overflowed,
      fault: this.fault
    });

  private record(kind: Gate1JournalKind, payload: unknown): void {
    if (this.fault !== null || this.overflowed) return;
    if (this.entries.length >= this.maxEvents) {
      this.overflowed = true;
      return;
    }

    try {
      const snapshot = canonicalSnapshot(payload);
      if (kind === "native_attempt_started") {
        const executionId = attemptId(snapshot);
        if (this.openNativeAttemptIds.has(executionId)) {
          throw new Error(`Native attempt ${executionId} is already open.`);
        }
        this.openNativeAttemptIds.add(executionId);
      } else if (kind === "native_attempt_finished") {
        const executionId = attemptId(snapshot);
        if (!this.openNativeAttemptIds.delete(executionId)) {
          throw new Error(`Native attempt ${executionId} has no matching start event.`);
        }
      }

      const recordedAt = exactIsoUtc(this.clock(), "recordedAt");
      const entry = deepFreeze({
        sequence: this.entries.length + 1,
        recordedAt,
        kind,
        payload: snapshot
      });
      this.entries = Object.freeze([...this.entries, entry]);
    } catch (error) {
      this.fault = error instanceof Error ? error.message : "Unknown evidence journal failure.";
    }
  }
}

export function projectRegistryStatus(value: RegistryStatus): unknown {
  return canonicalSnapshot({
    phase: value.phase,
    toolNames: [...value.toolNames],
    generation: value.generation ?? null,
    desiredToolNames: value.desiredToolNames ? [...value.desiredToolNames] : [],
    verifiedManifestNames: value.verifiedManifestNames ? [...value.verifiedManifestNames] : [],
    error: value.error ?? null
  });
}

export function projectReadinessReceipt(
  value: RegistryReadinessReceipt,
  ownerWindow: Window | undefined,
  currentOrigin: string | undefined
): unknown {
  const runtimeCatalog = value.runtimeCatalog;
  return canonicalSnapshot({
    status: value.status,
    providerRegistration: value.providerRegistration,
    consumerDiscovery: value.consumerDiscovery,
    consumerExecution: value.consumerExecution,
    compatibilityBinding: value.compatibilityBinding,
    registeredToolNames: [...value.registeredToolNames],
    visibleToolNames: [...value.visibleToolNames],
    rejectedToolNames: [...value.rejectedToolNames],
    manifest: value.manifest,
    manifestHash: value.manifestHash,
    fixtureId: value.fixtureId,
    fixtureRevision: value.fixtureRevision,
    stateHash: value.stateHash,
    argumentMode: value.argumentMode,
    compatibilityReceipt: value.compatibilityReceipt,
    mismatches: value.mismatches,
    checkedAt: value.checkedAt,
    runtimeCatalog:
      runtimeCatalog === null
        ? null
        : {
            generation: runtimeCatalog.generation,
            manifestHash: runtimeCatalog.manifestHash,
            tools: runtimeCatalog.tools.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchemaRepresentation:
                tool.inputSchema === undefined || tool.inputSchema === null
                  ? "absent"
                  : typeof tool.inputSchema === "string"
                    ? "json-string"
                    : "object",
              inputSchema: normalizeInputSchema(tool.inputSchema),
              annotations: {
                readOnlyHint: tool.annotations?.readOnlyHint ?? false,
                untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
              },
              origin: tool.origin,
              ownerMatchesCurrentDocument: ownerWindow !== undefined && tool.window === ownerWindow,
              originMatchesCurrentDocument:
                currentOrigin !== undefined && tool.origin === currentOrigin
            }))
          }
  });
}

export interface Gate1ProofCurrentReceipts {
  readonly uiReceipt: unknown | null;
  readonly uiError: Readonly<Record<string, unknown>> | null;
  readonly nativeReceipt: ExecuteOnceResult | null;
  readonly nativeError: Readonly<Record<string, unknown>> | null;
  readonly verifiedReset: VerifiedResetReceipt | null;
  readonly pendingDomainReset: DomainResetReceipt | null;
  readonly lastNativeMutation: {
    readonly toolName: string;
    readonly input: Readonly<Record<string, unknown>>;
  } | null;
}

export interface CreateGate1ProofBundleInput {
  readonly exportedAt: string;
  readonly appCommit: string;
  readonly origin: string;
  readonly userAgent: string;
  readonly capabilities: WebMcpCapabilities;
  readonly registryStatus: RegistryStatus;
  readonly readiness: RegistryReadinessReceipt | null;
  readonly readinessError: Readonly<Record<string, unknown>> | null;
  readonly ownerWindow: Window | undefined;
  readonly session: CheckoutSessionSnapshot;
  readonly inspection: CheckoutSessionInspection;
  readonly domainArchives: readonly CheckoutTrajectoryArchive[];
  readonly traceLedger: CheckoutTraceLedgerSnapshot;
  readonly journal: Gate1JournalSnapshot;
  readonly currentReceipts: Gate1ProofCurrentReceipts;
}

export interface Gate1ProofBundle {
  readonly bundleVersion: typeof GATE1_PROOF_BUNDLE_VERSION;
  readonly exportedAt: string;
  readonly hashAlgorithm: "SHA-256";
  readonly canonicalization: "RFC8785/json-canonicalize";
  readonly evidenceDigest: string;
  readonly bundleDigest: string;
  readonly evidence: {
    readonly provenance: {
      readonly appCommit: string;
      readonly commitBound: boolean;
      readonly origin: string;
      readonly userAgent: string;
      readonly sessionId: string;
      readonly trajectoryId: string;
    };
    readonly classification: {
      readonly evidenceClass: "native-plumbing";
      readonly modelSelectionEvidence: false;
      readonly semanticScoringEvidence: false;
      readonly directChatGPTEvidence: false;
      readonly gate1CompletionClaim: false;
      readonly externalAttestation: false;
      readonly applicationPayloadsSyntheticOnly: true;
      readonly fullReloadStartsNewDocument: true;
      readonly limitation: string;
    };
    readonly journal: {
      readonly eventCount: number;
      readonly headHash: string | null;
      readonly events: readonly unknown[];
    };
    readonly capabilities: unknown;
    readonly registryStatus: unknown;
    readonly readiness: unknown | null;
    readonly readinessError: unknown | null;
    readonly session: CheckoutSessionSnapshot;
    readonly inspection: CheckoutSessionInspection;
    readonly domainArchives: readonly CheckoutTrajectoryArchive[];
    readonly traceLedger: CheckoutTraceLedgerSnapshot;
    readonly currentReceipts: Gate1ProofCurrentReceipts;
  };
}

export interface Gate1ProofVerification {
  readonly status: "internally-consistent";
  readonly journalEventCount: number;
  readonly traceCount: number;
  readonly nativeAttemptCount: number;
  readonly evidenceDigest: string;
  readonly bundleDigest: string;
}

async function hashJournal(snapshot: Gate1JournalSnapshot): Promise<{
  readonly eventCount: number;
  readonly headHash: string | null;
  readonly events: readonly unknown[];
}> {
  if (snapshot.fault !== null) throw new Error(`Evidence journal fault: ${snapshot.fault}`);
  if (snapshot.overflowed) throw new Error("Evidence journal exceeded its bounded event capacity.");
  if (snapshot.openNativeAttemptIds.length > 0) {
    throw new Error(
      `Evidence journal has unfinished native attempts: ${snapshot.openNativeAttemptIds.join(", ")}`
    );
  }

  let previousEventHash: string | null = null;
  const events: unknown[] = [];
  for (const [index, entry] of snapshot.entries.entries()) {
    if (entry.sequence !== index + 1)
      throw new Error("Evidence journal sequence is not contiguous.");
    const content = canonicalSnapshot({
      sequence: entry.sequence,
      recordedAt: entry.recordedAt,
      kind: entry.kind,
      previousEventHash,
      payload: entry.payload
    });
    const eventHash = await sha256Hex(`${JOURNAL_HASH_DOMAIN}${canonicalJson(content)}`);
    events.push(canonicalSnapshot({ ...(content as object), eventHash }));
    previousEventHash = eventHash;
  }

  return deepFreeze({
    eventCount: events.length,
    headHash: previousEventHash,
    events: Object.freeze(events)
  });
}

export async function createGate1ProofBundle(
  input: CreateGate1ProofBundleInput
): Promise<Gate1ProofBundle> {
  const exportedAt = exactIsoUtc(input.exportedAt, "exportedAt");
  const appCommit = nonEmptyString(input.appCommit, "appCommit");
  const origin = nonEmptyString(input.origin, "origin");
  const userAgent = nonEmptyString(input.userAgent, "userAgent");
  const journal = await hashJournal(input.journal);

  const evidence = canonicalSnapshot<Gate1ProofBundle["evidence"]>({
    provenance: {
      appCommit,
      commitBound: /^[a-f0-9]{40}$/u.test(appCommit),
      origin,
      userAgent,
      sessionId: input.session.sessionId,
      trajectoryId: input.session.trajectoryId
    },
    classification: {
      evidenceClass: "native-plumbing",
      modelSelectionEvidence: false,
      semanticScoringEvidence: false,
      directChatGPTEvidence: false,
      gate1CompletionClaim: false,
      externalAttestation: false,
      applicationPayloadsSyntheticOnly: true,
      fullReloadStartsNewDocument: true,
      limitation:
        "Application payloads are synthetic; exact origin and raw browser user agent are runtime provenance. Hashes prove internal consistency only, not external attestation or model-selection evidence."
    },
    journal,
    capabilities: input.capabilities,
    registryStatus: projectRegistryStatus(input.registryStatus),
    readiness:
      input.readiness === null
        ? null
        : projectReadinessReceipt(input.readiness, input.ownerWindow, origin),
    readinessError: input.readinessError,
    session: input.session,
    inspection: input.inspection,
    domainArchives: input.domainArchives,
    traceLedger: input.traceLedger,
    currentReceipts: input.currentReceipts
  });
  const evidenceDigest = await sha256Hex(`${EVIDENCE_HASH_DOMAIN}${canonicalJson(evidence)}`);
  const unsignedBundle = canonicalSnapshot({
    bundleVersion: GATE1_PROOF_BUNDLE_VERSION,
    exportedAt,
    hashAlgorithm: "SHA-256",
    canonicalization: "RFC8785/json-canonicalize",
    evidenceDigest,
    evidence
  });
  const bundleDigest = await sha256Hex(`${BUNDLE_HASH_DOMAIN}${canonicalJson(unsignedBundle)}`);

  const bundle = canonicalSnapshot<Gate1ProofBundle>({
    ...(unsignedBundle as object),
    bundleDigest
  });
  await verifyGate1ProofBundle(bundle);
  return bundle;
}

async function verifyCanonicalEvidence(value: CanonicalEvidence): Promise<void> {
  if (value.bytes !== canonicalJson(value.value)) {
    throw new Error("Canonical evidence bytes do not match their value.");
  }
  if (value.sha256 !== (await sha256Hex(value.bytes))) {
    throw new Error("Canonical evidence SHA-256 does not match its bytes.");
  }
}

function traceList(value: unknown): readonly OperationTrace[] {
  const ledger = value as CheckoutTraceLedgerSnapshot;
  if (
    !ledger ||
    !Array.isArray(ledger.current) ||
    !Array.isArray(ledger.archives) ||
    !Array.isArray(ledger.resetTraces)
  ) {
    throw new Error("Gate 1 trace ledger is malformed.");
  }
  const traces = [
    ...ledger.archives.flatMap(({ traces: archived }) => archived),
    ...ledger.resetTraces,
    ...ledger.current
  ].sort((left, right) => left.sequence - right.sequence);
  if (traces.length !== ledger.totalTraceCount) {
    throw new Error("Gate 1 trace ledger count does not match its traces.");
  }
  return traces;
}

export async function verifyGate1ProofBundle(
  bundle: Gate1ProofBundle
): Promise<Gate1ProofVerification> {
  if (bundle.bundleVersion !== GATE1_PROOF_BUNDLE_VERSION) {
    throw new Error("Unsupported Gate 1 proof bundle version.");
  }
  if (bundle.hashAlgorithm !== "SHA-256") throw new Error("Unsupported proof hash algorithm.");
  if (bundle.canonicalization !== "RFC8785/json-canonicalize") {
    throw new Error("Unsupported proof canonicalization.");
  }
  exactIsoUtc(bundle.exportedAt, "exportedAt");
  if (
    bundle.evidence.classification.evidenceClass !== "native-plumbing" ||
    bundle.evidence.classification.modelSelectionEvidence !== false ||
    bundle.evidence.classification.semanticScoringEvidence !== false ||
    bundle.evidence.classification.directChatGPTEvidence !== false ||
    bundle.evidence.classification.gate1CompletionClaim !== false ||
    bundle.evidence.classification.externalAttestation !== false ||
    bundle.evidence.classification.applicationPayloadsSyntheticOnly !== true ||
    bundle.evidence.classification.fullReloadStartsNewDocument !== true
  ) {
    throw new Error("Gate 1 proof classification boundary mismatch.");
  }
  if (
    bundle.evidence.provenance.commitBound !==
    /^[a-f0-9]{40}$/u.test(bundle.evidence.provenance.appCommit)
  ) {
    throw new Error("Gate 1 commit-bound provenance flag mismatch.");
  }

  const expectedEvidenceDigest = await sha256Hex(
    `${EVIDENCE_HASH_DOMAIN}${canonicalJson(bundle.evidence)}`
  );
  if (bundle.evidenceDigest !== expectedEvidenceDigest) {
    throw new Error("Gate 1 evidence digest mismatch.");
  }
  const { bundleDigest, ...unsignedBundle } = bundle;
  const expectedBundleDigest = await sha256Hex(
    `${BUNDLE_HASH_DOMAIN}${canonicalJson(unsignedBundle)}`
  );
  if (bundleDigest !== expectedBundleDigest) throw new Error("Gate 1 bundle digest mismatch.");

  const journal = bundle.evidence.journal;
  if (journal.eventCount !== journal.events.length) {
    throw new Error("Gate 1 journal event count mismatch.");
  }
  let previousEventHash: string | null = null;
  const attemptStarts = new Map<string, Readonly<Record<string, unknown>>>();
  let nativeAttemptCount = 0;
  let latestReadiness: Readonly<Record<string, unknown>> | null = null;
  for (const [index, eventValue] of journal.events.entries()) {
    const event = eventValue as Gate1JournalEntry & {
      readonly previousEventHash: string | null;
      readonly eventHash: string;
    };
    if (event.sequence !== index + 1 || event.previousEventHash !== previousEventHash) {
      throw new Error("Gate 1 journal sequence/hash lineage mismatch.");
    }
    exactIsoUtc(event.recordedAt, "journal recordedAt");
    const { eventHash, ...content } = event;
    const expectedEventHash = await sha256Hex(`${JOURNAL_HASH_DOMAIN}${canonicalJson(content)}`);
    if (eventHash !== expectedEventHash) throw new Error("Gate 1 journal event hash mismatch.");
    previousEventHash = eventHash;

    if (event.kind === "readiness_receipt") {
      latestReadiness = event.payload as Readonly<Record<string, unknown>>;
    } else if (event.kind === "native_attempt_started") {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const executionId = nonEmptyString(payload.executionId, "executionId");
      if (attemptStarts.has(executionId)) throw new Error("Duplicate native attempt start.");
      const runtimeCatalog = latestReadiness?.runtimeCatalog as
        { readonly generation?: unknown; readonly manifestHash?: unknown } | null | undefined;
      const manifest = latestReadiness?.manifest as
        { readonly catalogState?: unknown } | null | undefined;
      if (
        latestReadiness?.status !== "consumer-ready" ||
        runtimeCatalog?.generation !== payload.registrationGeneration ||
        runtimeCatalog?.manifestHash !== payload.manifestHash ||
        manifest?.catalogState !== payload.catalogState ||
        latestReadiness.fixtureRevision !== payload.fixtureRevision ||
        latestReadiness.stateHash !== payload.stateHash
      ) {
        throw new Error("Native attempt start does not bind the current consumer-ready catalog.");
      }
      attemptStarts.set(executionId, payload);
      nativeAttemptCount += 1;
    }
  }
  if (journal.headHash !== previousEventHash) throw new Error("Gate 1 journal head mismatch.");

  const traces = traceList(bundle.evidence.traceLedger);
  const currentSession = bundle.evidence.session as CheckoutSessionSnapshot;
  if (
    currentSession.sessionId !== bundle.evidence.provenance.sessionId ||
    currentSession.trajectoryId !== bundle.evidence.provenance.trajectoryId
  ) {
    throw new Error("Gate 1 current session/provenance binding mismatch.");
  }
  const inspection = bundle.evidence.inspection;
  if (
    inspection.sessionId !== currentSession.sessionId ||
    inspection.trajectoryId !== currentSession.trajectoryId ||
    canonicalJson(inspection.state) !== canonicalJson(currentSession.state) ||
    canonicalJson(inspection.haltedReason) !== canonicalJson(currentSession.haltedReason) ||
    inspection.currentTraceCount !== bundle.evidence.traceLedger.current.length ||
    inspection.archivedTrajectoryCount !== bundle.evidence.domainArchives.length ||
    inspection.archivedTrajectoryCount !== bundle.evidence.traceLedger.archives.length ||
    (inspection.lastResetTrace?.eventId ?? null) !==
      (bundle.evidence.traceLedger.lastResetTrace?.eventId ?? null)
  ) {
    throw new Error("Gate 1 current session/inspection/ledger binding mismatch.");
  }
  if (
    canonicalJson(bundle.evidence.traceLedger.lastResetTrace) !==
    canonicalJson(bundle.evidence.traceLedger.resetTraces.at(-1) ?? null)
  ) {
    throw new Error("Gate 1 reset-trace tail identity mismatch.");
  }
  for (const domainArchive of bundle.evidence.domainArchives) {
    const ledgerArchive = bundle.evidence.traceLedger.archives.find(
      ({ archivedByResetId }) => archivedByResetId === domainArchive.archivedByResetId
    );
    if (
      !ledgerArchive ||
      ledgerArchive.trajectoryId !== domainArchive.trajectoryId ||
      ledgerArchive.archivedAt !== domainArchive.archivedAt ||
      ledgerArchive.traces.length !== domainArchive.eventCount ||
      canonicalJson(ledgerArchive.traces.map(({ eventId }) => eventId)) !==
        canonicalJson(domainArchive.entries.map(({ eventId }) => eventId))
    ) {
      throw new Error("Gate 1 domain/full archive binding mismatch.");
    }
  }
  const traceById = new Map<string, OperationTrace>();
  let fixtureVersion: string | undefined;
  let fixtureSeed: string | undefined;
  let domainVersion: string | undefined;
  let toolsetVersion: string | undefined;
  for (const [index, trace] of traces.entries()) {
    if (traceById.has(trace.eventId)) throw new Error("Duplicate operation trace event ID.");
    if (
      trace.sequence !== index + 1 ||
      trace.parentEventId !== (index === 0 ? null : traces[index - 1]!.eventId)
    ) {
      throw new Error("Operation trace sequence/parent lineage mismatch.");
    }
    if (
      trace.sessionId !== bundle.evidence.provenance.sessionId ||
      trace.appCommit !== bundle.evidence.provenance.appCommit ||
      trace.runtime.origin !== bundle.evidence.provenance.origin ||
      trace.runtime.userAgent !== bundle.evidence.provenance.userAgent ||
      trace.fixture.fixtureId !== currentSession.state.fixtureId
    ) {
      throw new Error("Operation trace document/build/runtime provenance mismatch.");
    }
    fixtureVersion ??= trace.fixture.fixtureVersion;
    fixtureSeed ??= trace.fixture.fixtureSeed;
    domainVersion ??= trace.domainVersion;
    toolsetVersion ??= trace.toolsetVersion;
    if (
      trace.fixture.fixtureVersion !== fixtureVersion ||
      trace.fixture.fixtureSeed !== fixtureSeed ||
      trace.domainVersion !== domainVersion ||
      trace.toolsetVersion !== toolsetVersion
    ) {
      throw new Error("Operation trace fixture/domain/toolset version drift.");
    }
    traceById.set(trace.eventId, trace);
    for (const evidence of [
      trace.rawArguments,
      trace.canonicalArguments,
      trace.rawResult,
      trace.canonicalResult,
      trace.error,
      trace.stateBefore,
      trace.stateAfter
    ]) {
      if (evidence !== null) await verifyCanonicalEvidence(evidence);
    }
    const recomputedEffect = checkoutEffectDiff(
      trace.stateBefore.value as unknown as CheckoutState,
      trace.stateAfter.value as unknown as CheckoutState
    );
    if (canonicalJson(trace.effect) !== canonicalJson(recomputedEffect)) {
      throw new Error("Operation trace effect does not match before/after state.");
    }
    if (trace.effect.stateChanged !== (trace.stateBefore.sha256 !== trace.stateAfter.sha256)) {
      throw new Error("Operation trace state-change flag/hash mismatch.");
    }
    if (
      (trace.status === "duplicate") !== (trace.commitDisposition === "replayed") ||
      (trace.status === "duplicate" && trace.effect.stateChanged) ||
      ((trace.status === "validation_error" || trace.status === "expected_error") &&
        (trace.commitDisposition !== "none" || trace.effect.stateChanged)) ||
      (trace.commitDisposition === "none" && trace.effect.stateChanged) ||
      (trace.cancellationObservedAfterCommit &&
        (!trace.cancellationObservedAfterCompletion || !trace.effect.stateChanged))
    ) {
      throw new Error("Operation trace status/commit/cancellation semantics mismatch.");
    }
  }

  const finishedAttempts = new Set<string>();
  const receiptTraceIds = new Set<string>();
  for (const eventValue of journal.events) {
    const event = eventValue as Gate1JournalEntry;
    if (event.kind !== "native_attempt_finished") continue;
    const payload = event.payload as Readonly<Record<string, unknown>>;
    const executionId = nonEmptyString(payload.executionId, "executionId");
    const started = attemptStarts.get(executionId);
    if (!started || finishedAttempts.has(executionId)) {
      throw new Error("Native attempt finish does not bind exactly one start.");
    }
    finishedAttempts.add(executionId);
    if (payload.toolName !== started.toolName)
      throw new Error("Native attempt tool binding mismatch.");
    if (payload.outcome === "error") {
      const observation = payload.traceObservation as ExecuteTraceObservation | null;
      if (observation !== null) {
        const initialTraceCount = started.traceCount;
        if (typeof initialTraceCount !== "number") {
          throw new Error("Native attempt start is missing its trace boundary.");
        }
        const traceDelta = observation.handlerTraceCount - initialTraceCount;
        if (traceDelta !== 0 && traceDelta !== 1) {
          throw new Error("Native error produced an invalid handler-trace count.");
        }
        if (traceDelta === 1) {
          const observedTrace = observation.lastTrace;
          const trace = observedTrace ? traceById.get(observedTrace.eventId) : undefined;
          if (
            !observedTrace ||
            !trace ||
            receiptTraceIds.has(trace.eventId) ||
            trace.source !== "native" ||
            trace.toolName !== payload.toolName ||
            trace.registryHash !== started.manifestHash ||
            trace.stateBefore.sha256 !== started.stateHash ||
            trace.stateAfter.sha256 !== observation.stateHash ||
            typeof started.traceCount !== "number" ||
            trace.sequence !== started.traceCount + 1 ||
            canonicalJson(started.input) !== canonicalJson(trace.rawArguments.value) ||
            observedTrace.status !== trace.status ||
            observedTrace.resultDigest !== trace.canonicalResult?.sha256 ||
            observedTrace.stateBeforeDigest !== trace.stateBefore.sha256 ||
            observedTrace.stateAfterDigest !== trace.stateAfter.sha256
          ) {
            throw new Error("Native error trace observation does not bind the attempted call.");
          }
          receiptTraceIds.add(trace.eventId);
          const effectDigest = await sha256Hex(canonicalJson(trace.effect));
          if (observedTrace.effectDigest !== effectDigest) {
            throw new Error("Native error trace effect binding mismatch.");
          }
        }
        const error = payload.error as {
          readonly code?: unknown;
          readonly nativeCallMade?: unknown;
        };
        if (traceDelta === 1 && error.nativeCallMade !== true) {
          throw new Error("Native error reached a handler trace without a native-call receipt.");
        }
        if (error.code === "execution_canceled") {
          if (error.nativeCallMade !== true || observation.stateHash !== started.stateHash) {
            throw new Error("Cancellation probe did not preserve its native/state boundary.");
          }
          if (traceDelta === 1) {
            const canceledTrace = observation.lastTrace
              ? traceById.get(observation.lastTrace.eventId)
              : undefined;
            if (
              !canceledTrace ||
              canceledTrace.toolName !== "cart_get" ||
              canceledTrace.status !== "canceled" ||
              canceledTrace.commitDisposition !== "none" ||
              canceledTrace.effect.stateChanged
            ) {
              throw new Error("Reached cancellation trace is not a harmless canceled cart_get.");
            }
          }
        }
      } else if (payload.observationError === null) {
        throw new Error("Native error has neither a trace observation nor observation failure.");
      }
      continue;
    }
    if (payload.outcome !== "receipt") throw new Error("Unknown native attempt outcome.");

    const receipt = payload.receipt as ExecuteOnceResult;
    const trace = traceById.get(receipt.handlerTraceId);
    if (!trace || trace.source !== "native" || receiptTraceIds.has(receipt.handlerTraceId)) {
      throw new Error("Native adapter receipt does not bind one native handler trace.");
    }
    receiptTraceIds.add(receipt.handlerTraceId);
    let parsedRawResult: unknown;
    try {
      parsedRawResult = JSON.parse(receipt.rawResult) as unknown;
    } catch {
      throw new Error("Native adapter raw result is not valid JSON.");
    }
    const expectedResultDigest = await sha256Hex(canonicalJson(receipt.canonicalResult));
    if (
      receipt.executionId !== executionId ||
      receipt.toolName !== started.toolName ||
      receipt.toolName !== trace.toolName ||
      receipt.handlerTraceStatus !== trace.status ||
      receipt.argumentMode !== trace.runtime.argumentMode ||
      receipt.manifestHash !== started.manifestHash ||
      receipt.manifestHash !== trace.registryHash ||
      started.stateHash !== trace.stateBefore.sha256 ||
      typeof started.traceCount !== "number" ||
      trace.sequence !== started.traceCount + 1 ||
      canonicalJson(started.input) !== canonicalJson(trace.rawArguments.value) ||
      canonicalJson(parsedRawResult) !== canonicalJson(receipt.canonicalResult) ||
      canonicalJson(receipt.canonicalResult) !== canonicalJson(trace.canonicalResult?.value) ||
      receipt.resultDigest !== expectedResultDigest ||
      receipt.resultDigest !== trace.canonicalResult?.sha256 ||
      receipt.stateBeforeDigest !== trace.stateBefore.sha256 ||
      receipt.stateAfterDigest !== trace.stateAfter.sha256 ||
      receipt.nativeCallCount !== 1
    ) {
      throw new Error("Native adapter receipt/trace binding mismatch.");
    }
    const effectDigest = await sha256Hex(canonicalJson(trace.effect));
    if (receipt.effectDigest !== effectDigest) {
      throw new Error("Native adapter effect digest mismatch.");
    }
  }
  if (finishedAttempts.size !== attemptStarts.size) {
    throw new Error("Gate 1 proof contains unfinished native attempts.");
  }

  const initialNames = ["cart_get", "cart_update", "checkout_request", "order_review"];
  const pendingNames = [
    "cart_get",
    "cart_update",
    "checkout_cancel",
    "checkout_request",
    "order_review"
  ];
  const compatibilityByTraceId = new Map<string, RuntimeCompatibilityReceipt>();
  const compatibilityCatalogGeneration = new Map<string, number>();
  const readinessManifestHashes = new Set<string>();
  const initialReadinessManifestHashes = new Set<string>();
  for (const eventValue of journal.events) {
    const event = eventValue as Gate1JournalEntry;
    if (event.kind !== "readiness_receipt") continue;
    const receipt = event.payload as {
      readonly status: string;
      readonly registeredToolNames: readonly string[];
      readonly visibleToolNames: readonly string[];
      readonly rejectedToolNames: readonly string[];
      readonly manifest: {
        readonly catalogState: "initial" | "pending";
        readonly appCommit: string;
        readonly tools: readonly {
          readonly name: string;
          readonly title: string;
          readonly description: string;
          readonly inputSchema: object;
          readonly annotations: object;
        }[];
      };
      readonly runtimeCatalog: {
        readonly generation: number;
        readonly manifestHash: string;
        readonly tools: readonly {
          readonly name: string;
          readonly title: string;
          readonly description: string;
          readonly inputSchemaRepresentation: "absent" | "json-string" | "object";
          readonly inputSchema: object;
          readonly annotations: object;
          readonly origin: string;
          readonly ownerMatchesCurrentDocument: boolean;
          readonly originMatchesCurrentDocument: boolean;
        }[];
      } | null;
      readonly manifestHash: string;
      readonly argumentMode: string;
      readonly compatibilityReceipt: RuntimeCompatibilityReceipt | null;
    };
    const expectedNames = receipt.manifest.catalogState === "pending" ? pendingNames : initialNames;
    readinessManifestHashes.add(receipt.manifestHash);
    if (receipt.manifest.catalogState === "initial") {
      initialReadinessManifestHashes.add(receipt.manifestHash);
    }
    if (canonicalJson(receipt.registeredToolNames) !== canonicalJson(expectedNames)) {
      throw new Error("Readiness receipt contains the wrong state-appropriate tool catalog.");
    }
    if (
      receipt.manifest.appCommit !== bundle.evidence.provenance.appCommit ||
      receipt.manifestHash !== (await sha256Hex(canonicalJson(receipt.manifest)))
    ) {
      throw new Error("Readiness receipt manifest commit/hash binding mismatch.");
    }
    if (receipt.status === "consumer-ready" || receipt.status === "consumer-discovered") {
      if (
        receipt.runtimeCatalog === null ||
        receipt.runtimeCatalog.manifestHash !== receipt.manifestHash ||
        canonicalJson(receipt.visibleToolNames) !== canonicalJson(expectedNames) ||
        receipt.rejectedToolNames.length !== 0 ||
        receipt.runtimeCatalog.tools.some(
          (tool) =>
            !tool.ownerMatchesCurrentDocument ||
            !tool.originMatchesCurrentDocument ||
            tool.origin !== bundle.evidence.provenance.origin ||
            tool.inputSchemaRepresentation === "absent"
        )
      ) {
        throw new Error("Readiness receipt runtime catalog ownership binding mismatch.");
      }
      const discovered = receipt.runtimeCatalog.tools.map(
        ({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations
        })
      );
      const declared = receipt.manifest.tools.map(
        ({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations
        })
      );
      if (
        canonicalJson(discovered) !== canonicalJson(declared) ||
        canonicalJson(discovered.map(({ name }) => name)) !== canonicalJson(expectedNames)
      ) {
        throw new Error("Readiness discovered descriptors do not match the declared manifest.");
      }
    }
    if (receipt.compatibilityReceipt) {
      const prior = compatibilityByTraceId.get(receipt.compatibilityReceipt.handlerTraceId);
      if (prior && canonicalJson(prior) !== canonicalJson(receipt.compatibilityReceipt)) {
        throw new Error("Compatibility receipt changed across Readiness history.");
      }
      if (receipt.argumentMode !== receipt.compatibilityReceipt.argumentMode) {
        throw new Error("Readiness/compatibility argument-mode mismatch.");
      }
      compatibilityByTraceId.set(
        receipt.compatibilityReceipt.handlerTraceId,
        receipt.compatibilityReceipt
      );
      compatibilityCatalogGeneration.set(
        receipt.compatibilityReceipt.handlerTraceId,
        Math.max(
          compatibilityCatalogGeneration.get(receipt.compatibilityReceipt.handlerTraceId) ?? 0,
          receipt.runtimeCatalog?.generation ?? 0
        )
      );
    }
  }

  for (const trace of traces) {
    if (!readinessManifestHashes.has(trace.registryHash)) {
      throw new Error("Operation trace registry hash is absent from Readiness history.");
    }
  }

  for (const compatibility of compatibilityByTraceId.values()) {
    const trace = traceById.get(compatibility.handlerTraceId);
    let parsedRawResult: unknown;
    try {
      parsedRawResult = JSON.parse(compatibility.rawResult) as unknown;
    } catch {
      throw new Error("Compatibility raw result is not valid JSON.");
    }
    if (
      !trace ||
      trace.source !== "native" ||
      trace.toolName !== "cart_get" ||
      trace.status !== "completed" ||
      trace.commitDisposition !== "none" ||
      trace.effect.stateChanged ||
      compatibility.status !== "compatibility-verified" ||
      compatibility.toolName !== "cart_get" ||
      compatibility.nativeCallCount !== 1 ||
      compatibility.coercionCount !== (compatibility.argumentMode === "json-string" ? 1 : 0) ||
      !Number.isSafeInteger(compatibility.registrationGeneration) ||
      compatibility.registrationGeneration < 1 ||
      compatibility.registrationGeneration >
        (compatibilityCatalogGeneration.get(compatibility.handlerTraceId) ?? 0) ||
      canonicalJson(parsedRawResult) !== canonicalJson(compatibility.canonicalResult) ||
      compatibility.resultDigest !== trace.canonicalResult?.sha256 ||
      compatibility.resultDigest !==
        (await sha256Hex(canonicalJson(compatibility.canonicalResult))) ||
      compatibility.stateBeforeDigest !== trace.stateBefore.sha256 ||
      compatibility.stateAfterDigest !== trace.stateAfter.sha256 ||
      compatibility.manifestHashBefore !== trace.registryHash ||
      compatibility.manifestHashAfter !== trace.registryHash ||
      compatibility.effectDigest !== (await sha256Hex(canonicalJson(trace.effect)))
    ) {
      throw new Error("Compatibility receipt does not bind its harmless native trace.");
    }
    if (receiptTraceIds.has(trace.eventId)) {
      throw new Error("Compatibility trace is already bound to another native attempt.");
    }
    receiptTraceIds.add(trace.eventId);
  }
  for (const trace of traces) {
    if (trace.source === "native" && !receiptTraceIds.has(trace.eventId)) {
      throw new Error("Native handler trace is absent from compatibility/attempt history.");
    }
  }

  const domainResets = new Map<string, DomainResetReceipt>();
  const terminalResets = new Map<string, VerifiedResetReceipt>();
  const resetErrorIds = new Set<string>();
  for (const eventValue of journal.events) {
    const event = eventValue as Gate1JournalEntry;
    if (event.kind === "domain_reset_receipt") {
      const receipt = event.payload as DomainResetReceipt;
      if (domainResets.has(receipt.resetId)) throw new Error("Duplicate domain reset receipt.");
      domainResets.set(receipt.resetId, receipt);
    } else if (event.kind === "reset_verification_receipt") {
      const receipt = event.payload as VerifiedResetReceipt;
      if (terminalResets.has(receipt.resetId)) {
        throw new Error("Duplicate terminal reset verification receipt.");
      }
      terminalResets.set(receipt.resetId, receipt);
    } else if (event.kind === "reset_error") {
      const resetId = (event.payload as { readonly resetId?: unknown }).resetId;
      if (typeof resetId === "string" && resetId.length > 0) resetErrorIds.add(resetId);
    }
  }
  for (const domainReset of domainResets.values()) {
    if (
      domainReset.coreHash !== (await sha256Hex(canonicalJson(domainReset.core))) ||
      domainReset.core.fixtureId !== "checkout-seed-v1" ||
      domainReset.core.fixtureVersion !== "checkout-fixture@1.0.0" ||
      domainReset.core.fixtureSeed !== "toolproof-checkout-seed-001" ||
      domainReset.core.stateRevision !== 0 ||
      domainReset.core.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
      domainReset.core.pendingCheckout !== null ||
      domainReset.core.currentOperationCount !== 0 ||
      canonicalJson(domainReset.core.lines) !==
        canonicalJson([
          { itemId: "field-notebook", quantity: 1 },
          { itemId: "stoneware-mug", quantity: 2 }
        ])
    ) {
      throw new Error("Domain reset core hash mismatch.");
    }
    const resetTrace = traces.find(({ eventId }) => eventId === domainReset.resetEventId);
    const ledgerArchive = bundle.evidence.traceLedger.archives.find(
      ({ archivedByResetId }) => archivedByResetId === domainReset.resetId
    );
    const domainArchive = bundle.evidence.domainArchives.find(
      ({ archivedByResetId }) => archivedByResetId === domainReset.resetId
    );
    if (
      !resetTrace ||
      resetTrace.toolName !== "fixture_reset" ||
      resetTrace.runId !== domainReset.trajectoryId ||
      resetTrace.status !== "completed" ||
      resetTrace.commitDisposition !== "committed" ||
      resetTrace.cancellationObservedAfterCommit ||
      resetTrace.cancellationObservedAfterCompletion ||
      resetTrace.stateAfter.sha256 !== domainReset.core.stateHash ||
      canonicalJson(resetTrace.canonicalResult?.value) !== canonicalJson(domainReset) ||
      !ledgerArchive ||
      ledgerArchive.trajectoryId !== domainReset.archivedTrajectoryId ||
      ledgerArchive.archivedAt !== domainReset.resetAt ||
      ledgerArchive.traces.length !== domainReset.archivedEventCount ||
      !domainArchive ||
      domainArchive.trajectoryId !== domainReset.archivedTrajectoryId ||
      domainArchive.archivedAt !== domainReset.resetAt ||
      domainArchive.eventCount !== domainReset.archivedEventCount ||
      canonicalJson(ledgerArchive.traces.map(({ eventId }) => eventId)) !==
        canonicalJson(domainArchive.entries.map(({ eventId }) => eventId))
    ) {
      throw new Error("Domain reset trace/archive binding mismatch.");
    }

    const terminal = terminalResets.get(domainReset.resetId);
    if (!terminal) {
      if (!resetErrorIds.has(domainReset.resetId)) {
        throw new Error("Domain reset has neither terminal verification nor bound error.");
      }
      continue;
    }
    if (
      terminal.status === "verified" &&
      (terminal.receiptVersion !== "checkout-reset@1" ||
        terminal.stateHash !== domainReset.core.stateHash ||
        terminal.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
        terminal.expectedStateHash !== domainReset.core.stateHash ||
        terminal.fixtureId !== domainReset.core.fixtureId ||
        terminal.fixtureVersion !== "checkout-fixture@1.0.0" ||
        terminal.seed !== "toolproof-checkout-seed-001" ||
        terminal.stateRevision !== 0 ||
        terminal.operationLedgerCount !== 0 ||
        terminal.currentTrajectoryCount !== 0 ||
        canonicalJson(terminal.registeredToolNames) !== canonicalJson(initialNames) ||
        !initialReadinessManifestHashes.has(terminal.registryHash))
    ) {
      throw new Error("Verified reset receipt does not bind domain/registry state.");
    }
  }
  for (const resetId of terminalResets.keys()) {
    if (!domainResets.has(resetId)) throw new Error("Terminal reset has no domain reset receipt.");
  }
  if (bundle.evidence.currentReceipts.verifiedReset) {
    const current = bundle.evidence.currentReceipts.verifiedReset;
    const journaled = terminalResets.get(current.resetId);
    if (!journaled || canonicalJson(journaled) !== canonicalJson(current)) {
      throw new Error("Current verified reset receipt is absent from the journal.");
    }
  }
  if (bundle.evidence.currentReceipts.pendingDomainReset) {
    const current = bundle.evidence.currentReceipts.pendingDomainReset;
    const journaled = domainResets.get(current.resetId);
    if (!journaled || canonicalJson(journaled) !== canonicalJson(current)) {
      throw new Error("Current domain reset receipt is absent from the journal.");
    }
  }

  if (bundle.evidence.readiness) {
    const currentReadiness = bundle.evidence.readiness as {
      readonly stateHash: string;
      readonly fixtureRevision: number;
      readonly manifestHash: string;
      readonly manifest: {
        readonly catalogState: "initial" | "pending";
        readonly appCommit: string;
      };
      readonly runtimeCatalog: {
        readonly generation: number;
        readonly manifestHash: string;
      } | null;
    };
    const currentRegistry = bundle.evidence.registryStatus as {
      readonly phase: string;
      readonly generation: number | null;
      readonly toolNames: readonly string[];
    };
    const expectedCatalogState = currentSession.state.pendingCheckout ? "pending" : "initial";
    const expectedNames = expectedCatalogState === "pending" ? pendingNames : initialNames;
    if (
      currentReadiness.stateHash !== (await sha256Hex(canonicalJson(currentSession.state))) ||
      currentReadiness.fixtureRevision !== currentSession.state.revision ||
      currentReadiness.manifest.catalogState !== expectedCatalogState ||
      currentReadiness.manifest.appCommit !== bundle.evidence.provenance.appCommit ||
      currentRegistry.phase !== "ready" ||
      canonicalJson(currentRegistry.toolNames) !== canonicalJson(expectedNames) ||
      currentReadiness.runtimeCatalog === null ||
      currentReadiness.runtimeCatalog.generation !== currentRegistry.generation ||
      currentReadiness.runtimeCatalog.manifestHash !== currentReadiness.manifestHash
    ) {
      throw new Error("Current state/Registry/Readiness snapshot binding mismatch.");
    }
  }

  return deepFreeze({
    status: "internally-consistent" as const,
    journalEventCount: journal.eventCount,
    traceCount: traces.length,
    nativeAttemptCount,
    evidenceDigest: bundle.evidenceDigest,
    bundleDigest: bundle.bundleDigest
  });
}

export function serializeGate1ProofBundle(bundle: Gate1ProofBundle): string {
  const value = `${JSON.stringify(bundle, null, 2)}\n`;
  if (new TextEncoder().encode(value).byteLength > GATE1_PROOF_MAX_JSON_BYTES) {
    throw new Error("Gate 1 proof bundle exceeds the bounded 5 MB export size.");
  }
  assertSafeGate1ProofJson(value);
  return value;
}

export function gate1ProofFilename(bundle: Gate1ProofBundle): string {
  const commit = bundle.evidence.provenance.appCommit.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 12);
  const timestamp = exactIsoUtc(bundle.exportedAt, "exportedAt")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/[-:]/gu, "");
  return `toolproof-gate1-native-${commit}-${timestamp}.json`;
}

export function assertSafeGate1ProofJson(value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("unsafe_export_content: Gate 1 proof is not valid JSON.");
  }
  const sensitiveKey = (key: string): boolean => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    return ["authorization", "cookie", "apikey", "token", "secret", "password", "credential"].some(
      (marker) => normalized.includes(marker)
    );
  };
  const nonEmpty = (entry: unknown): boolean =>
    entry !== null && entry !== undefined && entry !== "" && entry !== false;
  const decodedStrings: string[] = [];
  const inspectKeys = (entry: unknown): boolean => {
    if (typeof entry === "string") {
      decodedStrings.push(entry);
      return false;
    }
    if (Array.isArray(entry)) return entry.some(inspectKeys);
    if (!entry || typeof entry !== "object") return false;
    return Object.entries(entry).some(
      ([key, nested]) => (sensitiveKey(key) && nonEmpty(nested)) || inspectKeys(nested)
    );
  };
  const forbidden = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bAuthorization\s*[:=]\s*[^",\s]+/iu,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/u,
    /\b(?:api[_-]?key|access[_-]?token|cookie)\s*[:=]\s*[^",\s]+/iu,
    /"(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)"\s*:\s*"[^"]+"/iu,
    /\bBasic\s+[A-Za-z0-9+/=]{8,}/u,
    /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/u,
    /[?&](?:api[_-]?key|access[_-]?token|token|secret|password)=[^&#"\s]+/iu,
    /(?:\/Users\/|\/home\/|\/mnt\/|\/Volumes\/)[^"\s]*/u,
    /\b[A-Z]:\\Users\\[^"\r\n]*/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
  ];
  if (
    inspectKeys(parsed) ||
    forbidden.some((pattern) => [value, ...decodedStrings].some((entry) => pattern.test(entry)))
  ) {
    throw new Error("unsafe_export_content: Gate 1 proof contains prohibited sensitive material.");
  }
}

export function downloadGate1ProofBundle(bundle: Gate1ProofBundle): string {
  if (typeof document === "undefined") throw new Error("Gate 1 proof download requires a browser.");
  const filename = gate1ProofFilename(bundle);
  const blob = new Blob([serializeGate1ProofBundle(bundle)], {
    type: "application/json;charset=utf-8"
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return filename;
}
