import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { JUDGE_DEMO_LANE } from "@/lib/judge/contract";
import { JUDGE_DEMO_ENVELOPE_VERSION, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import { z } from "zod";

export const JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION =
  "toolproof-judge-demo-presentation-transition@2.0.0";
// Retained as an import-compatible name for release tooling. The proof is now a
// discriminated transition rather than an unrestricted one-hop collateral proof.
export const JUDGE_DEMO_COLLATERAL_PROOF_VERSION = JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION;

export const JUDGE_DEMO_CI_TIMEOUT_VALIDATION_VERSION =
  "toolproof-judge-demo-ci-timeout-validation@1.0.0";
export const JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_VERSION =
  "toolproof-judge-demo-truth-status-finalization@1.0.0";
export const JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT = "6211ebc63efe1e65992cfd04e36ebc438b545c9a";
export const JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE = "239082df68b195bc6f901e51dfcd90b2dd5bec6b";
export const JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT =
  "4443650f5513840dd1bf64b9378cc984bb5a706b";
export const JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE = "248068b833fcb17cf28d6801553167412bdbe3be";
export const JUDGE_DEMO_CI_TIMEOUT_PATH = "tests/integration/judge-presentation.test.ts" as const;
export const JUDGE_DEMO_CI_TIMEOUT_MS = 20_000 as const;
export const JUDGE_DEMO_CI_TIMEOUT_COUNT = 3 as const;
export const JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE =
  "Its sole provider decision remains sealed on evidence root `e2cf8d47375abfeeb4f32bd6f5973918acf4c091`; recovery and native completion are deployment-bound and recorded by the live receipt and release manifest, not preclaimed by source." as const;
export const JUDGE_DEMO_TRUTH_STATUS_FORBIDDEN_README_PHRASE =
  "while the archive-presentation recovery and a fresh current-build native replay remain required before Gate 7 can be called complete" as const;

export const JUDGE_DEMO_CRITICAL_PATHS = Object.freeze(
  [
    ".env.example",
    ".gitattributes",
    "CHALLENGE.md",
    "HACKATHON_BUILD.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "app/api/judge-demo/route.ts",
    "components/lab/judge-demo-panel.tsx",
    "components/lab/lab-client.tsx",
    "docs/architecture.md",
    "docs/rights-review.md",
    "docs/testing.md",
    "evidence/direct-site-tools-observations.json",
    "evidence/toolproof-reference-evidence.json",
    "evidence/toolproof-reference-evidence.md",
    "lib/domain/checkout-reset.ts",
    "lib/domain/checkout.ts",
    "lib/evidence/digest.ts",
    "lib/fallback/openai-tool-decision.ts",
    "lib/fallback/runner-contract.ts",
    "lib/judge/authorization-anchor.server.ts",
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/collateral-proof.ts",
    "lib/judge/contract.ts",
    "lib/judge/dispatch-recovery.server.ts",
    "lib/judge/envelope.ts",
    "lib/judge/openai-provider.server.ts",
    "lib/judge/presentation-binding.server.ts",
    "lib/judge/provider-decision.ts",
    "lib/judge/service.server.ts",
    "lib/judge/store.server.ts",
    "lib/probe/calibration-envelope.ts",
    "lib/probe/decision.ts",
    "lib/probe/ledger.ts",
    "lib/probe/policy.ts",
    "lib/probe/server-artifact.ts",
    "lib/probe/token.ts",
    "lib/webmcp/cart-get-tool.ts",
    "lib/webmcp/catalog.ts",
    "lib/webmcp/live-manifest.server.ts",
    "lib/webmcp/runtime.ts",
    "package-lock.json",
    "package.json",
    "public/toolproof-results.jpg",
    "scripts/verify-direct-observation-presentation.ts",
    "scripts/verify-direct-site-tools-evidence.ts",
    "scripts/verify-judge-presentation.ts",
    "scripts/verify-publication.mjs",
    "scripts/verify-sample-evidence.ts",
    "scripts/verify-third-party-inventory.mjs",
    "third_party/licenses/nodejs-22.23.2-LICENSE.txt",
    "third_party/licenses/npm/LGPL-3.0-or-later.txt",
    "third_party/licenses/npm/MIT-terms.txt",
    "third_party/licenses/npm/axe-core-4.13.0-MPL-2.0.txt",
    "third_party/licenses/npm/axe-core-4.13.0-THIRD-PARTY.txt",
    "third_party/licenses/npm/caniuse-lite-1.0.30001810-CC-BY-4.0.txt",
    "third_party/licenses/npm/lightningcss-1.33.0-MPL-2.0.txt",
    "third_party/licenses/npm/sharp-0.35.4-Apache-2.0.txt",
    "third_party/licenses/npm/sharp-libvips-linux-x64-1.3.3-NOTICE.md",
    "third_party/licenses/npm/sharp-libvips-linuxmusl-x64-1.3.3-NOTICE.md",
    "third_party/licenses/npm/sharp-wasm32-0.35.4-NOTICE.md",
    "third_party/npm-transitive-inventory.json"
  ].sort()
);

export const JUDGE_DEMO_COLLATERAL_PATHS = Object.freeze([
  "README.md",
  "submission/devpost.md"
] as const);
export type JudgeDemoCollateralPath = (typeof JUDGE_DEMO_COLLATERAL_PATHS)[number];

/** The complete reviewed e2 -> recovery diff boundary. No other tracked path is admissible. */
export const JUDGE_DEMO_RECOVERY_PATHS = Object.freeze(
  [
    ".env.example",
    "HACKATHON_BUILD.md",
    "README.md",
    "SECURITY.md",
    "docs/architecture.md",
    "docs/testing.md",
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/collateral-proof.ts",
    "lib/judge/contract.ts",
    "lib/judge/presentation-binding.server.ts",
    "lib/judge/service.server.ts",
    "lib/judge/store.server.ts",
    "lib/results/presentation-proof.ts",
    "scripts/verify-judge-presentation.ts",
    "submission/devpost.md",
    "tests/integration/judge-presentation.test.ts",
    "tests/integration/judge-service.test.ts",
    "tests/unit/judge-store-reader.test.ts"
  ].sort()
);

/**
 * The bounded provider-free finalization after the reviewed recovery implementation.
 * Every path already belongs to the aggregate e2 -> recovery boundary above.
 */
export const JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS = Object.freeze([
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "lib/judge/presentation-binding.server.ts",
  JUDGE_DEMO_CI_TIMEOUT_PATH
] as const);

export const JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS = Object.freeze([
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "README.md",
  JUDGE_DEMO_CI_TIMEOUT_PATH
] as const);

/** The complete 6211 -> current recovery-finalization boundary. */
export const JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS = Object.freeze([
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "lib/judge/presentation-binding.server.ts",
  "README.md",
  JUDGE_DEMO_CI_TIMEOUT_PATH
] as const);

export const JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES = Object.freeze({
  live_app: "Live app: ",
  public_repository: "Public repository: ",
  release: "Release: ",
  demo_video: "Demo video: "
});

export type JudgeDemoCollateralField = keyof typeof JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES;

export function judgeDemoCollateralPathAllowed(path: string): boolean {
  return JUDGE_DEMO_COLLATERAL_PATHS.includes(path as JudgeDemoCollateralPath);
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const gitOid = z.string().regex(/^[a-f0-9]{40}$/u);
const gitMode = z
  .string()
  .regex(/^[0-7]{6}$/u)
  .nullable();
const recoveryFinalizationPath = z.enum(JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS);
const truthStatusFinalizationPath = z.enum(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS);
const collateralPath = z.enum(JUDGE_DEMO_COLLATERAL_PATHS);
const collateralField = z.enum(
  Object.keys(JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES) as [
    JudgeDemoCollateralField,
    ...JudgeDemoCollateralField[]
  ]
);
const successorUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => value.startsWith("https://"), "Successor collateral must use HTTPS.");

const recoveryFinalizationTreeChangeSchema = z
  .object({
    path: recoveryFinalizationPath,
    status: z.enum(["A", "D", "M", "T"]),
    predecessorMode: gitMode,
    successorMode: gitMode,
    predecessorBlobOid: gitOid.nullable(),
    successorBlobOid: gitOid.nullable()
  })
  .strict();

const truthStatusFinalizationSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_VERSION),
    kind: z.literal("truth-status-finalization"),
    predecessorCommit: commit,
    predecessorTree: gitOid,
    activeCommit: commit,
    activeTree: gitOid,
    changedPaths: z
      .array(truthStatusFinalizationPath)
      .length(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS.length),
    treeChanges: z
      .array(recoveryFinalizationTreeChangeSchema)
      .length(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS.length),
    gitTreeProjectionHash: sha256,
    expectedReadmeSentence: z.literal(JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE),
    forbiddenReadmePhrase: z.literal(JUDGE_DEMO_TRUTH_STATUS_FORBIDDEN_README_PHRASE),
    providerCallsPerformed: z.literal(0),
    storeWritesPerformed: z.literal(0)
  })
  .strict();

const ciTimeoutValidationSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_CI_TIMEOUT_VALIDATION_VERSION),
    kind: z.literal("recovery-finalization"),
    implementationCommit: commit,
    implementationTree: gitOid,
    activeCommit: commit,
    activeTree: gitOid,
    changedPaths: z
      .array(recoveryFinalizationPath)
      .min(JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS.length)
      .max(JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS.length),
    treeChanges: z
      .array(recoveryFinalizationTreeChangeSchema)
      .min(JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS.length)
      .max(JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS.length),
    gitTreeProjectionHash: sha256,
    timeoutPath: z.literal(JUDGE_DEMO_CI_TIMEOUT_PATH),
    timeoutMs: z.literal(JUDGE_DEMO_CI_TIMEOUT_MS),
    timeoutCount: z.literal(JUDGE_DEMO_CI_TIMEOUT_COUNT),
    truthStatusFinalization: truthStatusFinalizationSchema.nullable().optional(),
    providerCallsPerformed: z.literal(0),
    storeWritesPerformed: z.literal(0)
  })
  .strict();

const transitionCommon = {
  version: z.literal(JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION),
  ordinal: z.number().int().min(0).max(1),
  predecessorCommit: commit,
  successorCommit: commit,
  predecessorEnvelopeHash: sha256,
  successorEnvelopeHash: sha256,
  rootEvidenceCommit: commit,
  rootEnvelopeHash: sha256,
  rootReceiptDigest: sha256,
  rootArtifactDigest: sha256,
  rootStoredProjectionDigest: sha256,
  rootCapturedAt: z.string().datetime({ offset: true }),
  immutableProjectionHash: sha256,
  firstParentChainHash: sha256,
  gitTreeProjectionHash: sha256,
  criticalProjectionHash: sha256,
  dependencyProjectionHash: sha256,
  providerCallsPerformed: z.literal(0),
  storeWritesPerformed: z.literal(0),
  replayOnly: z.literal(true),
  proofHash: sha256
} as const;

const recoveryTransitionSchema = z
  .object({
    ...transitionCommon,
    kind: z.literal("sealed-reader-compatibility-recovery"),
    recoveryContract: z
      .object({
        failureMode: z.literal("redis-json-auto-deserialization"),
        acceptedProjectionRepresentations: z.tuple([
          z.literal("json-string"),
          z.literal("preparsed-json-value")
        ]),
        strictSchemaValidationPreserved: z.literal(true),
        projectionDigestValidationPreserved: z.literal(true),
        permanentReceiptMutation: z.literal("none"),
        ciTimeoutValidation: ciTimeoutValidationSchema.nullable().optional()
      })
      .strict()
  })
  .strict();

const collateralTransitionSchema = z
  .object({
    ...transitionCommon,
    kind: z.literal("collateral-links"),
    collateralChanges: z
      .array(
        z
          .object({
            path: collateralPath,
            field: collateralField,
            predecessorValue: z.string().min(1).max(500).nullable(),
            successorValue: successorUrl
          })
          .strict()
      )
      .min(1)
      .max(8),
    collateralChangesHash: sha256
  })
  .strict();

export const judgeDemoPresentationTransitionSchema = z.discriminatedUnion("kind", [
  recoveryTransitionSchema,
  collateralTransitionSchema
]);
export const judgeDemoCollateralProofSchema = judgeDemoPresentationTransitionSchema;

export type JudgeDemoPresentationTransition = z.infer<typeof judgeDemoPresentationTransitionSchema>;
export type JudgeDemoRecoveryTransition = z.infer<typeof recoveryTransitionSchema>;
export type JudgeDemoCollateralTransition = z.infer<typeof collateralTransitionSchema>;
export type JudgeDemoCollateralProof = JudgeDemoPresentationTransition;

export interface JudgeDemoImmutableProjection {
  readonly version: "toolproof-judge-demo-immutable-projection@1.0.0";
  readonly envelopeContract: {
    readonly version: typeof JUDGE_DEMO_ENVELOPE_VERSION;
    readonly lane: typeof JUDGE_DEMO_LANE;
    readonly purpose: "judge";
    readonly sourceFixed: true;
    readonly arbitraryPromptAccepted: false;
    readonly publicCaseId: "judge_multi_quantity_lines_v1";
    readonly naturalLanguageRequest: "Which current cart lines have a quantity greater than one?";
  };
  readonly fixtureHash: string;
  readonly fixture: JudgeDemoEnvelope["fixture"];
  readonly tools: JudgeDemoEnvelope["liveManifest"]["tools"];
  readonly runner: {
    readonly promptVersion: string;
    readonly promptHash: string;
    readonly settingsVersion: string;
    readonly settingsHash: string;
    readonly noCallSchemaHash: string;
    readonly runnerHash: string;
  };
  readonly runtime: {
    readonly targetTool: "cart_get";
    readonly targetArguments: Record<string, never>;
    readonly requiredNativeMethod: "document.modelContext.executeTool";
    readonly requiredCatalog: readonly [
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ];
    readonly requiredStateRevision: 0;
    readonly nativeEvidenceBoundary: "current-browser-local-separate-from-provider-receipt";
    readonly providerCallsOnReplay: 0;
  };
}

export function createJudgeDemoImmutableProjection(
  envelope: JudgeDemoEnvelope
): JudgeDemoImmutableProjection {
  return Object.freeze(
    JSON.parse(
      canonicalJson({
        version: "toolproof-judge-demo-immutable-projection@1.0.0",
        envelopeContract: {
          version: envelope.version,
          lane: envelope.lane,
          purpose: envelope.purpose,
          sourceFixed: envelope.sourceFixed,
          arbitraryPromptAccepted: envelope.arbitraryPromptAccepted,
          publicCaseId: envelope.publicCaseId,
          naturalLanguageRequest: envelope.naturalLanguageRequest
        },
        fixtureHash: envelope.fixtureHash,
        fixture: envelope.fixture,
        tools: envelope.liveManifest.tools,
        runner: {
          promptVersion: envelope.runner.promptVersion,
          promptHash: envelope.runner.promptHash,
          settingsVersion: envelope.runner.settingsVersion,
          settingsHash: envelope.runner.settingsHash,
          noCallSchemaHash: envelope.runner.noCallSchemaHash,
          runnerHash: envelope.runnerHash
        },
        runtime: {
          targetTool: "cart_get",
          targetArguments: {},
          requiredNativeMethod: "document.modelContext.executeTool",
          requiredCatalog: ["cart_get", "cart_update", "checkout_request", "order_review"],
          requiredStateRevision: 0,
          nativeEvidenceBoundary: "current-browser-local-separate-from-provider-receipt",
          providerCallsOnReplay: 0
        }
      })
    ) as JudgeDemoImmutableProjection
  );
}

export function judgeDemoImmutableProjectionHash(envelope: JudgeDemoEnvelope): Promise<string> {
  return canonicalSha256(createJudgeDemoImmutableProjection(envelope));
}

export async function verifyJudgeDemoPresentationTransition(
  value: unknown
): Promise<JudgeDemoPresentationTransition> {
  const proof = judgeDemoPresentationTransitionSchema.parse(value);
  const { proofHash, ...payload } = proof;
  if (
    proof.predecessorCommit === proof.successorCommit ||
    (await canonicalSha256(payload)) !== proofHash
  ) {
    throw new Error("judge_demo_presentation_transition_invalid");
  }

  if (proof.kind === "sealed-reader-compatibility-recovery") {
    const validation = proof.recoveryContract.ciTimeoutValidation ?? null;
    const truthStatus = validation?.truthStatusFinalization ?? null;
    const expectedFinalizationPaths =
      truthStatus === null
        ? JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS
        : JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS;
    if (
      proof.ordinal !== 0 ||
      proof.predecessorCommit !== proof.rootEvidenceCommit ||
      proof.predecessorEnvelopeHash !== proof.rootEnvelopeHash ||
      (validation !== null &&
        (validation.implementationCommit !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT ||
          validation.implementationTree !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE ||
          validation.activeCommit !== proof.successorCommit ||
          canonicalJson(validation.changedPaths) !== canonicalJson(expectedFinalizationPaths) ||
          canonicalJson(validation.treeChanges.map(({ path }) => path)) !==
            canonicalJson(expectedFinalizationPaths) ||
          canonicalJson(validation.treeChanges) !==
            canonicalJson(
              [...validation.treeChanges].sort((left, right) => left.path.localeCompare(right.path))
            ) ||
          (await canonicalSha256(validation.treeChanges)) !== validation.gitTreeProjectionHash ||
          (truthStatus === null
            ? validation.activeCommit !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT ||
              validation.activeTree !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE
            : truthStatus.predecessorCommit !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT ||
              truthStatus.predecessorTree !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE ||
              truthStatus.activeCommit !== validation.activeCommit ||
              truthStatus.activeTree !== validation.activeTree ||
              canonicalJson(truthStatus.changedPaths) !==
                canonicalJson(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS) ||
              canonicalJson(truthStatus.treeChanges.map(({ path }) => path)) !==
                canonicalJson(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS) ||
              canonicalJson(truthStatus.treeChanges) !==
                canonicalJson(
                  [...truthStatus.treeChanges].sort((left, right) =>
                    left.path.localeCompare(right.path)
                  )
                ) ||
              (await canonicalSha256(truthStatus.treeChanges)) !==
                truthStatus.gitTreeProjectionHash)))
    ) {
      throw new Error("judge_demo_recovery_transition_invalid");
    }
  } else {
    const changeKeys = proof.collateralChanges.map(({ path, field }) => `${path}\n${field}`);
    if (
      proof.ordinal !== 1 ||
      new Set(changeKeys).size !== changeKeys.length ||
      proof.collateralChanges.some(
        ({ predecessorValue, successorValue }) => predecessorValue === successorValue
      ) ||
      canonicalJson(proof.collateralChanges) !==
        canonicalJson(
          [...proof.collateralChanges].sort((left, right) =>
            left.path === right.path
              ? left.field.localeCompare(right.field)
              : left.path.localeCompare(right.path)
          )
        ) ||
      (await canonicalSha256(proof.collateralChanges)) !== proof.collateralChangesHash
    ) {
      throw new Error("judge_demo_collateral_transition_invalid");
    }
  }

  return Object.freeze(JSON.parse(canonicalJson(proof)) as JudgeDemoPresentationTransition);
}

export const verifyJudgeDemoCollateralProof = verifyJudgeDemoPresentationTransition;
