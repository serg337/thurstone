import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { JUDGE_DEMO_LANE } from "@/lib/judge/contract";
import { JUDGE_DEMO_ENVELOPE_VERSION, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import { z } from "zod";

export const JUDGE_DEMO_COLLATERAL_PROOF_VERSION = "toolproof-judge-demo-collateral-proof@1.0.0";

export const JUDGE_DEMO_CRITICAL_PATHS = Object.freeze(
  [
    "app/api/judge-demo/route.ts",
    "components/lab/judge-demo-panel.tsx",
    "components/lab/lab-client.tsx",
    "lib/domain/checkout-reset.ts",
    "lib/domain/checkout.ts",
    "lib/evidence/digest.ts",
    "lib/fallback/openai-tool-decision.ts",
    "lib/fallback/runner-contract.ts",
    "lib/judge/collateral-proof.ts",
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/authorization-anchor.server.ts",
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
    "scripts/verify-judge-presentation.ts",
    "scripts/verify-sample-evidence.ts"
  ].sort()
);

export const JUDGE_DEMO_COLLATERAL_PATHS = Object.freeze([
  "README.md",
  "submission/devpost.md"
] as const);
export type JudgeDemoCollateralPath = (typeof JUDGE_DEMO_COLLATERAL_PATHS)[number];

export const JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES = Object.freeze({
  live_app: "Live app: ",
  public_repository: "Public repository: ",
  release: "Release: ",
  demo_video: "Demo video: ",
  devpost_submission: "Devpost submission: "
});

export type JudgeDemoCollateralField = keyof typeof JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES;

export function judgeDemoCollateralPathAllowed(path: string): boolean {
  return JUDGE_DEMO_COLLATERAL_PATHS.includes(path as (typeof JUDGE_DEMO_COLLATERAL_PATHS)[number]);
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const sourcePath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u);
const criticalPath = z.enum(JUDGE_DEMO_CRITICAL_PATHS as [string, ...string[]]);
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

export const judgeDemoCollateralProofSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_COLLATERAL_PROOF_VERSION),
    predecessorCommit: commit,
    successorCommit: commit,
    changedPaths: z.array(sourcePath).min(1).max(100),
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
    collateralChangesHash: sha256,
    criticalFiles: z
      .array(z.object({ path: criticalPath, sha256 }).strict())
      .length(JUDGE_DEMO_CRITICAL_PATHS.length),
    criticalProjectionHash: sha256,
    dependencyProjectionHash: sha256,
    gitProofPackSha256: sha256,
    predecessorEnvelopeHash: sha256,
    successorEnvelopeHash: sha256,
    predecessorReceiptDigest: sha256,
    immutableProjectionHash: sha256,
    providerCallsPerformed: z.literal(0),
    replayOnly: z.literal(true),
    proofHash: sha256
  })
  .strict();

export type JudgeDemoCollateralProof = z.infer<typeof judgeDemoCollateralProofSchema>;

export interface JudgeDemoImmutableProjection {
  readonly version: "toolproof-judge-demo-immutable-projection@1.0.0";
  readonly envelopeContract: {
    readonly version: typeof JUDGE_DEMO_ENVELOPE_VERSION;
    readonly lane: typeof JUDGE_DEMO_LANE;
    readonly purpose: "judge";
    readonly sourceFixed: true;
    readonly arbitraryPromptAccepted: false;
    readonly publicCaseId: "judge_cart_inventory_v1";
    readonly naturalLanguageRequest: "Before discussing checkout, produce a two-column inventory of the simulated cart: product name and unit count only.";
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

export async function verifyJudgeDemoCollateralProof(
  value: unknown
): Promise<JudgeDemoCollateralProof> {
  const proof = judgeDemoCollateralProofSchema.parse(value);
  const { proofHash, ...payload } = proof;
  const changeKeys = proof.collateralChanges.map(({ path, field }) => `${path}\n${field}`);
  const changedPaths = [...new Set(proof.collateralChanges.map(({ path }) => path))].sort();
  if (
    proof.predecessorCommit === proof.successorCommit ||
    new Set(proof.changedPaths).size !== proof.changedPaths.length ||
    canonicalJson(proof.changedPaths) !== canonicalJson([...proof.changedPaths].sort()) ||
    proof.changedPaths.some((path) => !judgeDemoCollateralPathAllowed(path)) ||
    canonicalJson(proof.changedPaths) !== canonicalJson(changedPaths) ||
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
    (await canonicalSha256(proof.collateralChanges)) !== proof.collateralChangesHash ||
    canonicalJson(proof.criticalFiles.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_CRITICAL_PATHS) ||
    (await canonicalSha256(proof.criticalFiles)) !== proof.criticalProjectionHash ||
    (await canonicalSha256(payload)) !== proofHash
  ) {
    throw new Error("judge_demo_collateral_proof_invalid");
  }
  return Object.freeze(JSON.parse(canonicalJson(proof)) as JudgeDemoCollateralProof);
}
