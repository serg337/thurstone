import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  assertNoProbeExpectationLeakage,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema,
  probeTransportBindingSchema
} from "@/lib/probe/calibration-envelope";
import { z } from "zod";

export const GATE2_FALLBACK_CALIBRATION_BUNDLE_V1_VERSION =
  "toolproof-gate2-googlechromelabs-fallback-evidence@1.0.0";
export const GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION =
  "toolproof-gate2-googlechromelabs-fallback-evidence@2.0.0";

export const GATE2_FALLBACK_V1_PROTOCOL_VERSION =
  "toolproof-pinned-googlechromelabs-fallback-calibration@1.0.0";
export const GATE2_FALLBACK_V2_PROTOCOL_VERSION =
  "toolproof-pinned-googlechromelabs-fallback-calibration@2.0.0";
export const GATE2_FALLBACK_CALIBRATION_LANE =
  "pinned-googlechromelabs-webmcp-fallback-calibration";

export const GATE2_FALLBACK_V1_BASE_CALLS = 9;
export const GATE2_FALLBACK_V1_TERMINAL_CALLS = 13;
export const GATE2_FALLBACK_V2_BASE_CALLS = 13;
export const GATE2_FALLBACK_V2_TERMINAL_CALLS = 17;
export const GATE2_FALLBACK_CASE_COUNT = 4;

export const GATE2_FALLBACK_V1_FROZEN_IDENTITIES = Object.freeze({
  policyHash: "4c70f123b0e3bc9b31477e976e51604e570e1475ef1d315a21615553e0be2b77",
  ledgerScriptHash: "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779",
  runnerContractHash: "ccdb4f578a37cf0b774c195a855c3d2fa3352fbd5ccdbee3b89eb1c5d5185ecc",
  continuationScriptHash: "f3b6402b933da2372dda644ebb82e2b600c6b5b62b5e2f3615e642be30310f05",
  browserRuntimeHash: "73ccb7b971d66b204088b256ee2a81798c686712e3ead8a58daf976808fba09f",
  promptHash: "ef2fdb41bc196bdf07f2c5253e5b9b134073c3fd21ceafa7b06c0225602038ac",
  settingsHash: "5ce5e19631ecb10a01a64ca6a1b4ef842de85ea6b722401d33f6b050e96199c1",
  envelopeVersion: "toolproof-fallback-calibration-envelope@1.0.0",
  trialEvidenceVersion: "toolproof-fallback-trial-evidence@1.0.0",
  implementation: "googlechromelabs-webmcp-tools-adapter@1.0.0",
  promptVersion: "toolproof-fallback-runner-prompt@1.0.0",
  settingsVersion: "toolproof-fallback-runner-settings@1.0.0",
  bundleRawSha256: "cbc359472f18f8c240480562905507806ea2db45d84ba8f247714a097d05814c",
  bundleEvidenceDigest: "43bf61e6bceccdf80e561da3a596ce758016ec6a4b2ed53502136a6a6303c3fb"
});

export const GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY = Object.freeze({
  guardInstanceId: "guard_3323051706a8384028e97a60f0c0b868",
  initializedCommit: "86584fe4fa308980bfb7d60f9722cc8b49b78644"
});

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = {
  buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
  caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
  trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u)
} as const;

const fallbackV1EnvelopeSchema = z
  .object({
    version: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.envelopeVersion),
    purpose: z.literal("calibration"),
    ...identity,
    naturalLanguageRequest: z.string().min(1).max(2_000),
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema,
    runner: z
      .object({
        implementation: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.implementation),
        upstreamCommit: z.literal("bcb6e93939d7fcf05747ccde913ed77a688e3b94"),
        upstreamSubtree: z.literal("b3329060567a1358b45490874a8d4eb0183d5731"),
        promptVersion: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.promptVersion),
        promptHash: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.promptHash),
        settingsVersion: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.settingsVersion),
        settingsHash: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.settingsHash),
        browserRuntimeHash: z.literal(GATE2_FALLBACK_V1_FROZEN_IDENTITIES.browserRuntimeHash),
        toolDefinitionsHash: sha256,
        noCallSchemaHash: sha256,
        transport: probeTransportBindingSchema
      })
      .strict()
  })
  .strict();

export function fallbackV1CalibrationEnvelopeHash(value: unknown): Promise<string> {
  assertNoProbeExpectationLeakage(value);
  const parsed = fallbackV1EnvelopeSchema.parse(value);
  return canonicalSha256(JSON.parse(canonicalJson(parsed)) as unknown);
}
