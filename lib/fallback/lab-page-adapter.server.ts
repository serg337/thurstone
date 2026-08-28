import "server-only";

import { CHECKOUT_FIXTURE_STATE_HASH, verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  FALLBACK_LAB_PAGE_ADAPTER_VERSION,
  FALLBACK_TRIAL_EVIDENCE_VERSION
} from "@/lib/fallback/implementation-contract";
import type { FallbackNativeExecutionReceipt } from "@/lib/fallback/native-webmcp-bridge";
import type {
  FallbackBoundarySource,
  FallbackLiveBoundarySource,
  FallbackPageAdapter
} from "@/lib/fallback/trial-runner";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  probeLiveManifestSchema,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import type { ProbeClientJsonValue, ProbeClientTrialCapture } from "@/lib/probe/client-runner";
import { normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";
import type { Page } from "puppeteer-core";

export {
  FALLBACK_LAB_PAGE_ADAPTER_VERSION,
  FALLBACK_TRIAL_EVIDENCE_VERSION
} from "@/lib/fallback/implementation-contract";

const INITIAL_TOOL_NAMES = Object.freeze([
  "cart_get",
  "cart_update",
  "checkout_request",
  "order_review"
]);
const PENDING_TOOL_NAMES = Object.freeze([
  "cart_get",
  "cart_update",
  "checkout_cancel",
  "checkout_request",
  "order_review"
]);
const RESET_TIMEOUT_MS = 15_000;

interface ProjectedReadinessTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
}

export interface ProjectedReadiness {
  readonly status: string;
  readonly fixtureId: string;
  readonly fixtureRevision: number;
  readonly stateHash: string;
  readonly manifestHash: string;
  readonly registeredToolNames: readonly string[];
  readonly manifest: {
    readonly appCommit: string;
    readonly catalogState: string;
    readonly tools: readonly ProjectedReadinessTool[];
  };
  readonly runtimeCatalog: {
    readonly generation: number;
    readonly manifestHash: string;
  } | null;
}

interface LabJournalEntry {
  readonly sequence: number;
  readonly kind: string;
  readonly payload: unknown;
}

interface LabDocumentSnapshot {
  readonly session: {
    readonly state: {
      readonly fixtureId: string;
      readonly seed: string;
      readonly revision: number;
      readonly pendingCheckout: unknown;
    };
  };
  readonly inspection: {
    readonly currentOperationCount: number;
  };
  readonly domainArchives: readonly unknown[];
  readonly traceLedger: {
    readonly current: readonly unknown[];
  };
  readonly journal: {
    readonly entries: readonly LabJournalEntry[];
    readonly eventCount: number;
    readonly overflowed: boolean;
    readonly fault: string | null;
  };
  readonly origin: string;
  readonly userAgent: string;
}

export interface FallbackResetEvidence {
  readonly verification: ProbeClientJsonValue;
  readonly domainReceipt: ProbeClientJsonValue;
  readonly inspection: ProbeClientJsonValue;
  readonly domainArchives: ProbeClientJsonValue;
  readonly traceLedger: ProbeClientJsonValue;
}

export interface FallbackTrialEvidence {
  readonly version: typeof FALLBACK_TRIAL_EVIDENCE_VERSION;
  readonly adapterVersion: typeof FALLBACK_LAB_PAGE_ADAPTER_VERSION;
  readonly appCommit: string;
  readonly origin: string;
  readonly userAgent: string;
  readonly capturedAt: string;
  readonly capture: ProbeClientJsonValue;
  readonly currentState: ProbeClientJsonValue;
  readonly currentInspection: ProbeClientJsonValue;
  readonly currentTraces: ProbeClientJsonValue;
  readonly fallback: ProbeClientJsonValue;
  readonly captureDigest: string;
}

type ResetSource = FallbackBoundarySource<FallbackResetEvidence>;

function jsonSnapshot(value: unknown): ProbeClientJsonValue {
  return JSON.parse(canonicalJson(value)) as ProbeClientJsonValue;
}

function exactNames(value: readonly string[], expected: readonly string[]): boolean {
  return value.length === expected.length && value.every((name, index) => name === expected[index]);
}

function exactInitialNames(value: readonly string[]): boolean {
  return exactNames(value, INITIAL_TOOL_NAMES);
}

function latestReadiness(
  snapshot: LabDocumentSnapshot,
  afterSequence = 0
): ProjectedReadiness | null {
  const entry = [...snapshot.journal.entries]
    .reverse()
    .find(({ sequence, kind }) => sequence > afterSequence && kind === "readiness_receipt");
  if (!entry || !entry.payload || typeof entry.payload !== "object") return null;
  return entry.payload as ProjectedReadiness;
}

export function createFallbackLiveManifestFromReadiness(
  readiness: ProjectedReadiness
): ProbeLiveManifest {
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: readiness.manifestHash,
    tools: [...readiness.manifest.tools]
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: normalizeInputSchema(tool.inputSchema),
        annotations: {
          readOnlyHint: tool.annotations.readOnlyHint === true,
          untrustedContentHint: tool.annotations.untrustedContentHint === true
        }
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  });
}

function exactReadiness(
  snapshot: LabDocumentSnapshot,
  readiness: ProjectedReadiness | null
): readiness is ProjectedReadiness {
  return Boolean(
    readiness &&
    readiness.status === "consumer-ready" &&
    readiness.fixtureId === "checkout-seed-v1" &&
    readiness.fixtureRevision === 0 &&
    readiness.stateHash === CHECKOUT_FIXTURE_STATE_HASH &&
    readiness.manifest.catalogState === "initial" &&
    readiness.runtimeCatalog &&
    readiness.runtimeCatalog.generation >= 1 &&
    readiness.runtimeCatalog.manifestHash === readiness.manifestHash &&
    exactInitialNames(readiness.registeredToolNames) &&
    snapshot.session.state.fixtureId === "checkout-seed-v1" &&
    snapshot.session.state.seed === "toolproof-checkout-seed-001" &&
    snapshot.session.state.revision === 0 &&
    snapshot.session.state.pendingCheckout === null &&
    snapshot.inspection.currentOperationCount === 0 &&
    snapshot.traceLedger.current.length === 0 &&
    !snapshot.journal.overflowed &&
    snapshot.journal.fault === null
  );
}

async function healthyStableReadiness(
  snapshot: LabDocumentSnapshot,
  readiness: ProjectedReadiness | null
): Promise<boolean> {
  if (!readiness || readiness.status !== "consumer-ready") return false;
  const catalogState = snapshot.session.state.pendingCheckout === null ? "initial" : "pending";
  const expectedNames = catalogState === "initial" ? INITIAL_TOOL_NAMES : PENDING_TOOL_NAMES;
  return Boolean(
    readiness.fixtureId === "checkout-seed-v1" &&
    snapshot.session.state.fixtureId === "checkout-seed-v1" &&
    snapshot.session.state.seed === "toolproof-checkout-seed-001" &&
    readiness.fixtureRevision === snapshot.session.state.revision &&
    readiness.stateHash === (await canonicalSha256(snapshot.session.state)) &&
    readiness.manifest.catalogState === catalogState &&
    (await canonicalSha256(readiness.manifest)) === readiness.manifestHash &&
    readiness.runtimeCatalog &&
    readiness.runtimeCatalog.generation >= 1 &&
    readiness.runtimeCatalog.manifestHash === readiness.manifestHash &&
    exactNames(readiness.registeredToolNames, expectedNames) &&
    exactNames(
      readiness.manifest.tools.map(({ name }) => name),
      expectedNames
    ) &&
    !snapshot.journal.overflowed &&
    snapshot.journal.fault === null
  );
}

async function pageSnapshot(page: Page): Promise<LabDocumentSnapshot> {
  return page.evaluate(() => {
    type Environment = {
      readonly store: {
        getSnapshot(): unknown;
        inspect(): unknown;
        archivedTrajectories(): unknown;
      };
      readonly ledger: { snapshot(): unknown };
      readonly proofJournal: { snapshot(): unknown };
    };
    const owner = window as typeof window & { __toolProofLabEnvironment?: Environment };
    const environment = owner.__toolProofLabEnvironment;
    if (!environment) throw new Error("fallback_lab_environment_missing");
    return {
      session: environment.store.getSnapshot(),
      inspection: environment.store.inspect(),
      domainArchives: environment.store.archivedTrajectories(),
      traceLedger: environment.ledger.snapshot(),
      journal: environment.proofJournal.snapshot(),
      origin: globalThis.location.origin,
      userAgent: globalThis.navigator.userAgent
    };
  }) as Promise<LabDocumentSnapshot>;
}

async function waitForFreshReadiness(
  page: Page,
  afterSequence: number,
  timeoutMs = RESET_TIMEOUT_MS
): Promise<{ readonly snapshot: LabDocumentSnapshot; readonly readiness: ProjectedReadiness }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await pageSnapshot(page).catch(() => null);
    if (!snapshot) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      continue;
    }
    const readiness = latestReadiness(snapshot, afterSequence);
    if (exactReadiness(snapshot, readiness)) return { snapshot, readiness };
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("fallback_reset_readiness_timeout");
}

async function waitForResetAdmission(
  page: Page,
  stage: "before" | "after",
  timeoutMs = RESET_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await pageSnapshot(page).catch(() => null);
    const readiness = snapshot ? latestReadiness(snapshot) : null;
    if (
      snapshot &&
      (stage === "before"
        ? exactReadiness(snapshot, readiness)
        : await healthyStableReadiness(snapshot, readiness))
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("fallback_lab_boot_timeout");
}

async function resetDocument(page: Page) {
  return page.evaluate(async () => {
    type Environment = {
      readonly store: {
        hardReset(input: {
          readonly source: "ui";
          readonly holdForVerification: true;
        }): Promise<unknown>;
      };
      readonly proofJournal: { snapshot(): { readonly eventCount: number } };
    };
    const owner = window as typeof window & { __toolProofLabEnvironment?: Environment };
    const environment = owner.__toolProofLabEnvironment;
    if (!environment) throw new Error("fallback_lab_environment_missing");
    const beforeEventCount = environment.proofJournal.snapshot().eventCount;
    const domainReceipt = await environment.store.hardReset({
      source: "ui",
      holdForVerification: true
    });
    return { beforeEventCount, domainReceipt };
  }) as Promise<{ readonly beforeEventCount: number; readonly domainReceipt: unknown }>;
}

async function releaseReset(page: Page, resetId: string): Promise<boolean> {
  return page.evaluate((id) => {
    type Environment = {
      readonly store: { releaseResetAdmission(value: string): boolean };
    };
    const owner = window as typeof window & { __toolProofLabEnvironment?: Environment };
    const environment = owner.__toolProofLabEnvironment;
    if (!environment) throw new Error("fallback_lab_environment_missing");
    return environment.store.releaseResetAdmission(id);
  }, resetId);
}

async function verifiedBoundary(page: Page, stage: "before" | "after"): Promise<ResetSource> {
  await waitForResetAdmission(page, stage);
  const reset = await resetDocument(page);
  const { snapshot, readiness } = await waitForFreshReadiness(page, reset.beforeEventCount);
  if ((await canonicalSha256(readiness.manifest)) !== readiness.manifestHash) {
    throw new Error("fallback_readiness_manifest_hash_mismatch");
  }
  const verification = await verifyCheckoutReset({
    domainReceipt: reset.domainReceipt as Parameters<
      typeof verifyCheckoutReset
    >[0]["domainReceipt"],
    inspection: snapshot.inspection as Parameters<typeof verifyCheckoutReset>[0]["inspection"],
    archives: snapshot.domainArchives as Parameters<typeof verifyCheckoutReset>[0]["archives"],
    traceLedger: snapshot.traceLedger as Parameters<typeof verifyCheckoutReset>[0]["traceLedger"],
    registry: {
      verified: true,
      registryHash: readiness.manifestHash,
      registeredToolNames: readiness.registeredToolNames
    },
    checkedAt: new Date().toISOString()
  });
  if (verification.status !== "verified" || !(await releaseReset(page, verification.resetId))) {
    throw new Error("fallback_reset_verification_failed");
  }
  const expectedManifest = createFallbackLiveManifestFromReadiness(readiness);
  return Object.freeze({
    status: "verified" as const,
    catalogState: "initial" as const,
    fixtureId: verification.fixtureId,
    fixtureSeed: verification.seed,
    stateRevision: 0 as const,
    stateHash: verification.stateHash,
    manifestHash: verification.registryHash,
    registrationGeneration: readiness.runtimeCatalog!.generation,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    resetId: verification.resetId,
    resetReceipt: Object.freeze({
      verification: jsonSnapshot(verification),
      domainReceipt: jsonSnapshot(reset.domainReceipt),
      inspection: jsonSnapshot(snapshot.inspection),
      domainArchives: jsonSnapshot(snapshot.domainArchives),
      traceLedger: jsonSnapshot(snapshot.traceLedger)
    }),
    expectedManifest
  });
}

async function liveBoundary(page: Page): Promise<FallbackLiveBoundarySource> {
  const snapshot = await pageSnapshot(page);
  const readiness = latestReadiness(snapshot);
  if (!exactReadiness(snapshot, readiness)) throw new Error("fallback_live_boundary_unavailable");
  if ((await canonicalSha256(readiness.manifest)) !== readiness.manifestHash) {
    throw new Error("fallback_readiness_manifest_hash_mismatch");
  }
  return Object.freeze({
    status: "verified" as const,
    catalogState: "initial" as const,
    fixtureId: readiness.fixtureId,
    fixtureSeed: snapshot.session.state.seed,
    stateRevision: 0 as const,
    stateHash: readiness.stateHash,
    manifestHash: readiness.manifestHash,
    registrationGeneration: readiness.runtimeCatalog!.generation,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    expectedManifest: createFallbackLiveManifestFromReadiness(readiness)
  });
}

export class ToolProofFallbackLabPageAdapter implements FallbackPageAdapter<
  FallbackResetEvidence,
  FallbackTrialEvidence
> {
  resetAndVerify(input: { readonly page: Page; readonly stage: "before" | "after" }) {
    return verifiedBoundary(input.page, input.stage);
  }

  async reverifyLive(input: { readonly page: Page }): Promise<FallbackLiveBoundarySource> {
    return liveBoundary(input.page);
  }

  async holdConsumerCall(input: {
    readonly page: Page;
    readonly toolName: string;
    readonly registrationGeneration: number;
  }): Promise<() => Promise<void>> {
    const holdId = await input.page.evaluate(
      ({ toolName, registrationGeneration }) => {
        type Environment = {
          readonly nativeConsumerHolds: {
            acquire(name: string, generation: number): string;
          };
        };
        const owner = window as typeof window & { __toolProofLabEnvironment?: Environment };
        const environment = owner.__toolProofLabEnvironment;
        if (!environment) throw new Error("fallback_lab_environment_missing");
        return environment.nativeConsumerHolds.acquire(toolName, registrationGeneration);
      },
      {
        toolName: input.toolName,
        registrationGeneration: input.registrationGeneration
      }
    );
    if (
      typeof holdId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(holdId)
    ) {
      throw new Error("fallback_consumer_hold_invalid");
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const didRelease = await input.page.evaluate((id) => {
        type Environment = {
          readonly nativeConsumerHolds: { release(value: string): boolean };
        };
        const owner = window as typeof window & { __toolProofLabEnvironment?: Environment };
        const environment = owner.__toolProofLabEnvironment;
        if (!environment) throw new Error("fallback_lab_environment_missing");
        return environment.nativeConsumerHolds.release(id);
      }, holdId);
      if (!didRelease) throw new Error("fallback_consumer_hold_release_failed");
    };
  }

  async capture(input: {
    readonly page: Page;
    readonly capture: ProbeClientTrialCapture<
      FallbackResetEvidence,
      FallbackNativeExecutionReceipt
    >;
    readonly nativeReceipt: FallbackNativeExecutionReceipt | null;
    readonly catalog: unknown;
    readonly runtime: unknown;
  }): Promise<FallbackTrialEvidence> {
    const snapshot = await pageSnapshot(input.page);
    if (snapshot.traceLedger.current.length > 1) {
      throw new Error("fallback_trial_trace_count_mismatch");
    }
    if (
      (input.nativeReceipt === null && snapshot.traceLedger.current.length !== 0) ||
      (input.nativeReceipt !== null && snapshot.traceLedger.current.length !== 1)
    ) {
      throw new Error("fallback_native_trace_binding_missing");
    }
    const readiness = latestReadiness(snapshot);
    if (!readiness || readiness.manifest.appCommit.length !== 40) {
      throw new Error("fallback_capture_provenance_missing");
    }
    const { rawDecisionEnvelope, rawModelResponse, providerReceipt, ...captureCore } =
      input.capture;
    const capture = jsonSnapshot({
      ...captureCore,
      rawDecisionEnvelopeHash: await canonicalSha256(rawDecisionEnvelope),
      rawModelResponseHash: rawModelResponse === null ? null : await sha256Hex(rawModelResponse),
      providerReceiptHash: await canonicalSha256(providerReceipt)
    });
    const currentState = jsonSnapshot(snapshot.session.state);
    const currentInspection = jsonSnapshot(snapshot.inspection);
    const currentTraces = jsonSnapshot(snapshot.traceLedger.current);
    const fallback = jsonSnapshot({
      catalog: input.catalog,
      runtime: input.runtime,
      nativeReceipt: input.nativeReceipt
    });
    const evidenceCore = {
      version: FALLBACK_TRIAL_EVIDENCE_VERSION,
      adapterVersion: FALLBACK_LAB_PAGE_ADAPTER_VERSION,
      appCommit: readiness.manifest.appCommit,
      origin: snapshot.origin,
      userAgent: snapshot.userAgent,
      capturedAt: new Date().toISOString(),
      capture,
      currentState,
      currentInspection,
      currentTraces,
      fallback
    } as const;
    return Object.freeze({
      ...evidenceCore,
      captureDigest: await canonicalSha256(capture)
    });
  }
}
