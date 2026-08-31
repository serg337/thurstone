import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  createCheckoutFixture
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { ToolProofFallbackLabPageAdapter } from "@/lib/fallback/lab-page-adapter.server";
import {
  createPinnedFallbackLaunchPlan,
  type FallbackBrowserLaunchPlan
} from "@/lib/fallback/pinned-browser-runtime.server";
import { FALLBACK_UPSTREAM_PIN } from "@/lib/fallback/runner-contract";
import { runPinnedFallbackTrial, type FallbackServerAdapter } from "@/lib/fallback/trial-runner";
import {
  createProbeFixtureSynopsis,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import type {
  ProbeBoundaryEvidence,
  ProbeClientCompletionInput,
  ProbeOpaqueClaim,
  ProbePublicClaim
} from "@/lib/probe/client-runner";
import { probeDecisionSchema, type ProbeDecision } from "@/lib/probe/decision";
import { createScoredTrialEnvelope, type ScoredTrialEnvelope } from "@/lib/scored/envelope";
import {
  createScoredNativeAdmission,
  type ScoredNativeAdmission
} from "@/lib/scored/native-admission";
import {
  verifyScoredProviderKnownReceipt,
  type ScoredProviderKnownReceipt
} from "@/lib/scored/openai-provider.server";
import {
  buildGate3ScoredEvidenceRow,
  type Gate3ScoredEvidenceRow
} from "@/lib/semantic/scored-evaluation.server";
import { GATE3_ORDER_SEED, GATE3_SEMANTIC_SUITE } from "@/lib/semantic/checkout-candidate.server";
import { deriveSemanticCaseOrder } from "@/lib/semantic/protocol-freeze.server";
import {
  SUCCESSOR_EVAL_TARGET_CASE_ID,
  successorEvalDecisionResponseSchema,
  successorProtocolHash,
  type SuccessorEvalMode
} from "@/lib/successor-eval/contract";

const DEFAULT_EXECUTABLE = "/var/tmp/toolproof-cft-151.0.7922.47/chrome-linux64/chrome";
const TARGET_ORIGIN = "https://toolproof-rust.vercel.app";

type ResetReceipt = Awaited<
  ReturnType<ToolProofFallbackLabPageAdapter["resetAndVerify"]>
>["resetReceipt"];
type TrialEvidence = Awaited<ReturnType<ToolProofFallbackLabPageAdapter["capture"]>>;

interface LocalAuthorization {
  readonly envelope: ScoredTrialEnvelope;
}

class SuccessorApiError extends Error {
  readonly nativeCallMade = false;

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly inferencePerformed: boolean
  ) {
    super(code);
    this.name = "SuccessorApiError";
  }
}

class SuccessorServerAdapter implements FallbackServerAdapter<
  LocalAuthorization,
  ResetReceipt,
  TrialEvidence,
  Gate3ScoredEvidenceRow
> {
  #envelope: ScoredTrialEnvelope | null = null;
  #providerReceipt: ScoredProviderKnownReceipt | null = null;
  #decision: ProbeDecision | null = null;
  #nativeAdmission: ScoredNativeAdmission | null = null;

  constructor(
    private readonly input: {
      readonly capability: string;
      readonly mode: SuccessorEvalMode;
      readonly appCommit: string;
      readonly runId: string;
      readonly trialId: string;
      readonly runnerCaseId: string;
      readonly ordinal: number;
      readonly request: string;
      readonly launchPlan: FallbackBrowserLaunchPlan;
    }
  ) {}

  async issueOpaqueClaim(input: {
    readonly initialBoundary: ProbeBoundaryEvidence<ResetReceipt>;
    readonly liveManifest: ProbeLiveManifest;
  }): Promise<ProbeOpaqueClaim<LocalAuthorization>> {
    const freezeHash = await successorProtocolHash({
      appCommit: this.input.appCommit,
      liveManifest: input.liveManifest
    });
    const envelope = await createScoredTrialEnvelope({
      purpose: "revised",
      freezeHash,
      buildCommit: this.input.appCommit,
      runId: this.input.runId,
      caseId: this.input.runnerCaseId,
      trialId: this.input.trialId,
      naturalLanguageRequest: this.input.request,
      fixture: createProbeFixtureSynopsis(createCheckoutFixture()),
      liveManifest: input.liveManifest,
      initialBoundary: {
        fixtureId: CHECKOUT_FIXTURE_ID,
        fixtureVersion: CHECKOUT_FIXTURE_VERSION,
        fixtureSeed: CHECKOUT_FIXTURE_SEED,
        stateRevision: 0,
        stateHash: CHECKOUT_FIXTURE_STATE_HASH,
        manifestHash: input.initialBoundary.manifestHash,
        registrationGeneration: input.initialBoundary.registrationGeneration,
        operationLedgerCount: 0,
        currentTrajectoryCount: 0,
        registeredToolNames: input.initialBoundary.registeredToolNames
      }
    });
    this.#envelope = envelope;
    return Object.freeze({
      runId: envelope.runId,
      caseId: envelope.caseId,
      trialId: envelope.trialId,
      authorization: Object.freeze({ envelope })
    });
  }

  async requestFreshDecision(input: { readonly claim: ProbeOpaqueClaim<LocalAuthorization> }) {
    if (
      !this.#envelope ||
      input.claim.authorization.envelope.envelopeHash !== this.#envelope.envelopeHash
    ) {
      throw new Error("successor_eval_local_envelope_mismatch");
    }
    const response = await fetch(`${TARGET_ORIGIN}/api/successor-eval/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: TARGET_ORIGIN,
        Referer: `${TARGET_ORIGIN}/lab`,
        "Sec-Fetch-Site": "same-origin"
      },
      body: JSON.stringify({
        capability: this.input.capability,
        mode: this.input.mode,
        envelope: this.#envelope
      })
    });
    const source = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(source) as unknown;
    } catch {
      throw new SuccessorApiError("successor_eval_response_invalid", response.status, false);
    }
    if (!response.ok) {
      const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      throw new SuccessorApiError(
        typeof record.error === "string" ? record.error : "successor_eval_request_failed",
        response.status,
        record.inferencePerformed === true
      );
    }
    const parsed = successorEvalDecisionResponseSchema.parse(value);
    const receipt = await verifyScoredProviderKnownReceipt({
      receipt: parsed.providerReceipt,
      envelope: this.#envelope
    });
    this.#providerReceipt = receipt;
    this.#decision = receipt.decision === null ? null : probeDecisionSchema.parse(receipt.decision);
    return {
      context: parsed.context,
      rawModelResponse: parsed.rawModelResponse,
      providerReceipt: receipt,
      decision: parsed.decision
    };
  }

  async admitNative(input: {
    readonly claim: ProbePublicClaim;
    readonly toolName: string;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<void> {
    if (!this.#envelope || !this.#decision || this.#decision.kind !== "call") {
      throw new Error("successor_eval_native_without_call");
    }
    const admission = await createScoredNativeAdmission({
      envelope: this.#envelope,
      decision: this.#decision
    });
    if (
      input.claim.runId !== admission.runId ||
      input.claim.caseId !== admission.caseId ||
      input.claim.trialId !== admission.trialId ||
      input.toolName !== admission.toolName ||
      input.manifestHash !== admission.manifestHash ||
      input.registrationGeneration !== admission.registrationGeneration
    ) {
      throw new Error("successor_eval_native_admission_mismatch");
    }
    this.#nativeAdmission = admission;
  }

  async completeAndSeal(
    input: ProbeClientCompletionInput<ResetReceipt, TrialEvidence>
  ): Promise<Gate3ScoredEvidenceRow> {
    if (!this.#envelope || !this.#providerReceipt) {
      throw new Error("successor_eval_completion_missing_receipt");
    }
    return buildGate3ScoredEvidenceRow({
      phase: "revised",
      ordinal: this.input.ordinal,
      attempt: 0,
      runnerCaseId: this.input.runnerCaseId,
      appCommit: this.input.appCommit,
      manifestHash: this.#envelope.liveManifest.manifestHash,
      envelope: this.#envelope,
      providerReceipt: this.#providerReceipt,
      nativeAdmission: this.#nativeAdmission,
      trialEvidence: input.evidence,
      postResetBoundary: input.postResetBoundary
    });
  }
}

async function writeBundle(input: {
  readonly mode: SuccessorEvalMode;
  readonly appCommit: string;
  readonly runId: string;
  readonly rows: readonly Gate3ScoredEvidenceRow[];
}) {
  const payload = {
    version: "thurstone-successor-evaluation-bundle@1.0.0",
    mode: input.mode,
    appCommit: input.appCommit,
    runId: input.runId,
    completedAt: new Date().toISOString(),
    rows: input.rows,
    summary: {
      passed: input.rows.filter(({ evaluation }) => evaluation.passed).length,
      possible: input.rows.length,
      providerCalls: input.rows.length,
      nativeCalls: input.rows.filter(({ nativeAdmission }) => nativeAdmission !== null).length
    }
  } as const;
  const bundle = { ...payload, bundleDigest: await canonicalSha256(payload) };
  const directory = path.resolve(".toolproof-local/evidence/successor-eval");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const filePath = path.join(directory, `thurstone-successor-${input.mode}-${stamp}.json`);
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(bundle)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { filePath, bundle };
}

async function main() {
  const mode = process.argv[2] as SuccessorEvalMode | undefined;
  const appCommit = process.argv[3] ?? "";
  if ((mode !== "targeted" && mode !== "full") || !/^[a-f0-9]{40}$/u.test(appCommit)) {
    throw new Error("usage: successor-eval <targeted|full> <app-commit>");
  }
  const capabilityPath = process.env.THURSTONE_SUCCESSOR_CAPABILITY_FILE?.trim() ?? "";
  const capability = (await readFile(capabilityPath, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) {
    throw new Error("successor_eval_capability_invalid");
  }
  const orderedIds = await deriveSemanticCaseOrder(
    GATE3_ORDER_SEED,
    GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
  );
  const selectedIds = mode === "targeted" ? [SUCCESSOR_EVAL_TARGET_CASE_ID] : [...orderedIds];
  const runSeed = await canonicalSha256({
    version: "thurstone-successor-run@1.0.0",
    mode,
    appCommit,
    capabilityHash: createHash("sha256").update(capability).digest("hex")
  });
  const runId = `run_${runSeed.slice(0, 22)}`;
  const launchPlan = await createPinnedFallbackLaunchPlan({
    executablePath: process.env.TOOLPROOF_FALLBACK_CHROME_PATH?.trim() || DEFAULT_EXECUTABLE,
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    targetOrigin: `${TARGET_ORIGIN}/`
  });
  const rows: Gate3ScoredEvidenceRow[] = [];
  for (const runnerCaseId of selectedIds) {
    const scoredCase = GATE3_SEMANTIC_SUITE.scoredCases.find(
      (value) => value.runnerCaseId === runnerCaseId
    );
    const ordinal = orderedIds.indexOf(runnerCaseId);
    if (!scoredCase || ordinal < 0) throw new Error("successor_eval_case_missing");
    const trialSeed = await canonicalSha256({ runId, runnerCaseId });
    const adapter = new SuccessorServerAdapter({
      capability,
      mode,
      appCommit,
      runId,
      trialId: `trial_${trialSeed.slice(0, 22)}`,
      runnerCaseId,
      ordinal,
      request: scoredCase.naturalLanguageRequest,
      launchPlan
    });
    const result = await runPinnedFallbackTrial({
      launchPlan,
      pageAdapter: new ToolProofFallbackLabPageAdapter(),
      serverAdapter: adapter
    });
    rows.push(result.seal);
    process.stdout.write(
      `${JSON.stringify({
        status: "case-complete",
        mode,
        ordinal,
        runnerCaseId,
        passed: result.seal.evaluation.passed,
        failureCodes: result.seal.evaluation.failureCodes
      })}\n`
    );
    if (mode === "targeted" && !result.seal.evaluation.passed) break;
  }
  const saved = await writeBundle({ mode, appCommit, runId, rows });
  process.stdout.write(
    `${JSON.stringify({
      status: "successor-evaluation-saved",
      mode,
      appCommit,
      runId,
      passed: saved.bundle.summary.passed,
      possible: saved.bundle.summary.possible,
      bundleDigest: saved.bundle.bundleDigest,
      file: saved.filePath
    })}\n`
  );
}

await main();
