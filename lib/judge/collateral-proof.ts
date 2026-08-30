import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { JUDGE_DEMO_LANE } from "@/lib/judge/contract";
import { JUDGE_DEMO_ENVELOPE_VERSION, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import { z } from "zod";

export const JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION =
  "toolproof-judge-demo-presentation-transition@2.0.0";
export const JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION =
  "toolproof-judge-demo-presentation-transition@3.0.0";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION =
  "toolproof-judge-demo-presentation-transition@4.0.0";
export const JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_VERSION =
  "thurstone-judge-demo-gate9-protocol-finalization@1.0.0";
export const JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_VERSION =
  "thurstone-judge-demo-gate9-collateral-preparation@1.0.0";
export const JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT = "brotli-wrapped-git-pack@1.0.0" as const;
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

export const JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT = "768af2539ca20c29928a897644ad22ba897c580d";
export const JUDGE_DEMO_REBRAND_PREDECESSOR_TREE = "9a3d7f59cae2f4632ad891d65ab38179e486b129";
export const JUDGE_DEMO_REBRAND_PREDECESSOR_ENVELOPE_HASH =
  "85cebeb51f69c754c10d4f0f0e71772a0d1885f2a1d9f5809947cc228f7a8fd6";
export const JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH =
  "973aad5bab10fc9bb4edef64af4faea64a664151dbfe8ae3e0d29d469dd875c0";
/**
 * Raw SHA-256 of the canonical, non-secret build768 binding JSON. The ignored lineage generator
 * must hash and verify the locally retained reviewed artifact before constructing v3; the digest
 * is an identity anchor, not independent attestation and not a substitute for that byte check.
 */
export const JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256 =
  "d757c83b49eb67e1150db39496e1b52fa13f6764b1dcf88609d7d1204293e682";
export const JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH =
  "b76c5769d511dd57ff713385143fa81421f5f7280f8f4df55452702aefe1bc6e";

export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT =
  "ca18dd438c5499107bbf9937460cc2faaab14ade";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE =
  "581c4a88e75fddb3cd4175496611e2a5b572b9ce";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH =
  "1744a3835aa7f401ac27fb8598b5c247b5dd6bb725e37b910b5d040dc8f75b4f";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH =
  "bdaef9a5cf45c8fb944750d3bcac0dd9b30bfca0a6fa520fbd5229f7b7987799";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256 =
  "f6c534a75f66d44ddfa6c810f5ceb5c55f1cc2ebe04348594818ccdfcdbe885a";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_REBRAND_PROOF_HASH =
  "c29e0c9b4e99fe1f49c4c6652734cb80bd764462bfd04d1442f1eda472db8660";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT =
  "feef201241db3d1f4da437bfa3d66a55ca34d178";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE =
  "8d46e0a10d969a328632ca9e9ac6f93f4dda94d9";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH =
  "Thurstone_Brief_v2.1_Invocation_Integrity_Amendment.md" as const;
export const JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256 =
  "118ab0c19d6be6d82ef631308cff25c0855e41e08ec58aa49bd860d217d0c8c9";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD =
  "768af2539ca20c29928a897644ad22ba897c580d";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST =
  "a449db4b1faacdbaab58777923d2ddbde75396b70fa4744b29d0eb8e97089a46";
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PRIOR_PROTOCOL_COMMITS = Object.freeze([
  Object.freeze({
    commit: "fd0f1c42da8b349415f7081267f9de537ea26c1b",
    tree: "c3eee5c3b75a79a45e1f2091eaf1df606bd63e5c"
  }),
  Object.freeze({
    commit: "573ed41616b139d8331ccf34d705541a887e6b67",
    tree: "575e837eaac2a36bfa623ec6342c0855f2eece46"
  }),
  Object.freeze({
    commit: "7d0c9ac588aa2c7aa39e73c2ddf924bce8eadd6f",
    tree: "4fbaa59720cb4dbc43d4bd2d6360374f0cb01e57"
  })
]);

/** Exact prospective A -> P proof-protocol boundary. */
export const JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS = Object.freeze(
  [
    "evidence/judge-root-envelope.json",
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/collateral-proof.ts",
    "lib/judge/contract.ts",
    "lib/judge/envelope.ts",
    "lib/judge/presentation-binding.server.ts",
    "lib/results/presentation-proof.ts",
    "scripts/verify-direct-observation-presentation.ts",
    "scripts/verify-judge-presentation.ts",
    "tests/integration/judge-presentation.test.ts",
    "tests/integration/judge-service.test.ts",
    "tests/unit/judge-envelope.test.ts",
    "tests/unit/direct-observation-presentation.test.ts",
    "tests/unit/results-presentation-proof.test.ts"
  ].sort()
);

/** Bounded P -> I application/result delta. Required paths are enforced separately below. */
export const JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS = Object.freeze(
  [
    ".github/workflows/ci.yml",
    "PLAN.md",
    "app/api/evidence/invocation-integrity/markdown/route.ts",
    "app/api/evidence/invocation-integrity/route.ts",
    "app/api/invocation-integrity/failure/route.ts",
    "app/api/invocation-integrity/verify/route.ts",
    "app/globals.css",
    "app/invocation-integrity/page.tsx",
    "app/results/page.tsx",
    "components/invocation-integrity/invocation-integrity-client.tsx",
    "components/results/invocation-integrity-results.tsx",
    "components/site-header.tsx",
    "lib/domain/checkout-schemas.ts",
    "lib/domain/checkout-session.ts",
    "lib/domain/checkout.ts",
    "lib/invocation-integrity/contract.ts",
    "lib/invocation-integrity/trusted-ledger.server.ts",
    "lib/invocation-integrity/verifier.server.ts",
    "lib/results/invocation-integrity-evidence.ts",
    "lib/results/invocation-integrity-measured.ts",
    "lib/results/invocation-integrity-results.server.ts",
    "package.json",
    "scripts/verify-semantic-record-preservation.ts",
    "tests/browser/invocation-integrity-results.spec.ts",
    "tests/browser/lab-sandbox.spec.ts",
    "tests/browser/shell.spec.ts",
    "tests/unit/checkout-schemas.test.ts",
    "tests/unit/checkout-session.test.ts",
    "tests/unit/checkout.test.ts",
    "tests/unit/invocation-integrity-evidence.test.ts",
    "tests/unit/invocation-integrity.test.ts"
  ].sort()
);
export const JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS = Object.freeze(
  [
    "app/api/invocation-integrity/verify/route.ts",
    "app/invocation-integrity/page.tsx",
    "components/invocation-integrity/invocation-integrity-client.tsx",
    "components/results/invocation-integrity-results.tsx",
    "lib/domain/checkout-schemas.ts",
    "lib/domain/checkout.ts",
    "lib/invocation-integrity/contract.ts",
    "lib/invocation-integrity/trusted-ledger.server.ts",
    "lib/invocation-integrity/verifier.server.ts",
    "lib/results/invocation-integrity-evidence.ts",
    "lib/results/invocation-integrity-measured.ts",
    "lib/results/invocation-integrity-results.server.ts",
    "scripts/verify-semantic-record-preservation.ts",
    "tests/unit/invocation-integrity.test.ts"
  ].sort()
);

/** Locale-independent ordering used only by the prospective I -> P -> E evidence transition. */
export function judgeDemoInvocationIntegrityEvidencePathCompare(
  left: string,
  right: string
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Exact prospective I -> P evidence-transport protocol boundary. */
export const JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS = Object.freeze(
  [
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/collateral-proof.ts",
    "tests/integration/judge-presentation.test.ts"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
);

/** Strict P -> E supplemental-evidence/Gate-9-preparation boundary. */
export const JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS = Object.freeze(
  [
    "CHALLENGE.md",
    "HACKATHON_BUILD.md",
    "PLAN.md",
    "README.md",
    "SECURITY.md",
    "docs/OFFICIAL_SOURCE_CHECK.md",
    "docs/architecture.md",
    "docs/demo-script.md",
    "docs/methodology.md",
    "docs/rights-review.md",
    "docs/testing.md",
    "evidence/thurstone-invocation-integrity.json",
    "evidence/thurstone-invocation-integrity.md",
    "lib/results/invocation-integrity-measured.ts",
    "scripts/verify-invocation-integrity-evidence.ts",
    "submission/devpost.md",
    "tests/browser/results.spec.ts",
    "tests/unit/invocation-integrity-evidence.test.ts"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
);
export const JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS = Object.freeze(
  [
    "evidence/thurstone-invocation-integrity.json",
    "evidence/thurstone-invocation-integrity.md",
    "lib/results/invocation-integrity-measured.ts"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
);
export const JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT =
  "2e52711e4ac0f91c88df118d22d2db52842aadb1" as const;
export const JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE =
  "e5aea740554404d53e916df9fb35d2f5abf68dc9" as const;
export const JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH =
  "3a7efb6563cd75bd61393abfa45c9c74bb3f45346b0547a61d61d345d1c07541" as const;
export const JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH =
  "67a9105367acd6cbc2f9e04c6763ee9c3b93a2c3c2a9f6d3df4ddf1b5505bc67" as const;

/** Exact E -> F build-proof repair required before the final Gate 9 collateral preparation. */
export const JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS = Object.freeze(
  [
    "lib/judge/collateral-checkout-verifier.server.ts",
    "lib/judge/collateral-proof.ts",
    "lib/results/presentation-proof.ts",
    "scripts/verify-gate6-presentation.ts",
    "scripts/verify-judge-presentation.ts",
    "tests/integration/judge-presentation.test.ts"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
);

/** Exact F -> C public collateral preparation; link placeholder replacement remains C -> R only. */
export const JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS = Object.freeze(
  [
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/demo-script.md",
    "docs/rights-review.md",
    "public/thurstone-devpost-thumbnail.jpg",
    "submission/devpost.md"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
);

export const JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS = Object.freeze([
  Object.freeze({
    path: "evidence/sample-report.md" as const,
    sha256: "d627627b464e64a46c8809fbb6d76be883b269aca181417b2337ddd8cfd74abe" as const
  }),
  Object.freeze({
    path: "evidence/sample-run.json" as const,
    sha256: "6d2835c5bfa580a4a8fdb79d4dfe6ee74b3eaf48dc11a8f4f5cfe86573e954ee" as const
  }),
  Object.freeze({
    path: "evidence/toolproof-reference-evidence.json" as const,
    sha256: "fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26" as const
  }),
  Object.freeze({
    path: "evidence/toolproof-reference-evidence.md" as const,
    sha256: "8301efa790f193060296d68a78b0553cf30d0c207b15864cf13609c65f2931fa" as const
  })
]);

export const JUDGE_DEMO_REBRAND_PROTOCOL_PATHS = Object.freeze([
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "lib/judge/presentation-binding.server.ts",
  "lib/results/presentation-proof.ts",
  "lib/semantic/revision-config.server.ts",
  "tests/integration/judge-presentation.test.ts",
  "tests/integration/judge-service.test.ts",
  "tests/unit/gate5-revision-freeze.test.ts",
  "tests/unit/results-presentation-proof.test.ts"
] as const);

export const JUDGE_DEMO_REBRAND_BRANDING_PATHS = Object.freeze([
  ".env.example",
  ".vercelignore",
  "AGENTS.md",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/page.tsx",
  "app/studio/page.tsx",
  "CHALLENGE.md",
  "components/lab/judge-demo-panel.tsx",
  "components/site-header.tsx",
  "CONTRIBUTING.md",
  "docs/architecture.md",
  "docs/demo-script.md",
  "docs/methodology.md",
  "docs/OFFICIAL_SOURCE_CHECK.md",
  "docs/rights-review.md",
  "docs/testing.md",
  "HACKATHON_BUILD.md",
  "lib/brand.ts",
  "PLAN.md",
  "public/thurstone-results.jpg",
  "README.md",
  "SECURITY.md",
  "submission/devpost.md",
  "THIRD_PARTY_NOTICES.md"
] as const);

export const JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS = Object.freeze([
  Object.freeze({
    path: "evidence/toolproof-reference-evidence.json" as const,
    sha256: "fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26" as const
  }),
  Object.freeze({
    path: "evidence/toolproof-reference-evidence.md" as const,
    sha256: "8301efa790f193060296d68a78b0553cf30d0c207b15864cf13609c65f2931fa" as const
  }),
  Object.freeze({
    path: "public/toolproof-results.jpg" as const,
    sha256: "16d414589500895629ab72bbbe8603439b7372a1dfd43db36ead5736de0bf93c" as const
  }),
  Object.freeze({
    path: "evidence/direct-site-tools-observations.json" as const,
    sha256: "63ad854753f59440b11d00d327e6ce135cf5cb84c38d7b6906f2e6719e48bf41" as const
  })
] as const);

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

export const JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE =
  "reserved for the verified Gate 9 link-only release commit" as const;
export const JUDGE_DEMO_GATE9_PUBLIC_REPOSITORY_URL =
  "https://github.com/serg337/toolproof" as const;
export const JUDGE_DEMO_GATE9_RELEASE_URL =
  "https://github.com/serg337/toolproof/releases/tag/challenge-submission-v1.0.0" as const;
export const JUDGE_DEMO_GATE9_RELEASE_FIELDS = Object.freeze([
  "demo_video",
  "public_repository",
  "release"
] as const);

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
const rebrandProtocolPath = z.enum(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS);
const rebrandBrandingPath = z.enum(JUDGE_DEMO_REBRAND_BRANDING_PATHS);
const invocationIntegrityProtocolPath = z.enum(
  JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS as unknown as [string, ...string[]]
);
const invocationIntegrityImplementationPath = z.enum(
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS as unknown as [string, ...string[]]
);
const invocationIntegrityEvidenceProtocolPath = z.enum(
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS as unknown as [string, ...string[]]
);
const invocationIntegrityEvidencePath = z.enum(
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS as unknown as [string, ...string[]]
);
const gate9ProtocolFinalizationPath = z.enum(
  JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS as unknown as [string, ...string[]]
);
const gate9CollateralPreparationPath = z.enum(
  JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS as unknown as [string, ...string[]]
);
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

const transitionTreeChangeShape = {
  status: z.enum(["A", "D", "M", "T"]),
  predecessorMode: gitMode,
  successorMode: gitMode,
  predecessorBlobOid: gitOid.nullable(),
  successorBlobOid: gitOid.nullable()
} as const;

const rebrandProtocolTreeChangeSchema = z
  .object({ path: rebrandProtocolPath, ...transitionTreeChangeShape })
  .strict();
const rebrandBrandingTreeChangeSchema = z
  .object({ path: rebrandBrandingPath, ...transitionTreeChangeShape })
  .strict();
const invocationIntegrityProtocolTreeChangeSchema = z
  .object({ path: invocationIntegrityProtocolPath, ...transitionTreeChangeShape })
  .strict();
const invocationIntegrityImplementationTreeChangeSchema = z
  .object({ path: invocationIntegrityImplementationPath, ...transitionTreeChangeShape })
  .strict();
const invocationIntegrityEvidenceProtocolTreeChangeSchema = z
  .object({ path: invocationIntegrityEvidenceProtocolPath, ...transitionTreeChangeShape })
  .strict();
const invocationIntegrityEvidenceTreeChangeSchema = z
  .object({ path: invocationIntegrityEvidencePath, ...transitionTreeChangeShape })
  .strict();
const gate9ProtocolFinalizationTreeChangeSchema = z
  .object({ path: gate9ProtocolFinalizationPath, ...transitionTreeChangeShape })
  .strict();
const gate9CollateralPreparationTreeChangeSchema = z
  .object({ path: gate9CollateralPreparationPath, ...transitionTreeChangeShape })
  .strict();
const invocationIntegrityAmendmentTreeChangeSchema = z
  .object({
    path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH),
    ...transitionTreeChangeShape
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
  ordinal: z.number().int().min(0).max(4),
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
    version: z.literal(JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION),
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
    version: z.enum([
      JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION,
      JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION,
      JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION
    ]),
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

const rebrandTransitionSchema = z
  .object({
    ...transitionCommon,
    version: z.literal(JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION),
    kind: z.literal("presentation-rebrand"),
    predecessorBinding: z
      .object({
        activeCommit: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT),
        activeTree: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_TREE),
        activeEnvelopeHash: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_ENVELOPE_HASH),
        bindingHash: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH),
        reviewedArtifactSha256: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256),
        recoveryTransitionProofHash: z.literal(JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH)
      })
      .strict(),
    protocolExtension: z
      .object({
        commit,
        tree: gitOid,
        changedPaths: z.array(rebrandProtocolPath).length(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS.length),
        treeChanges: z
          .array(rebrandProtocolTreeChangeSchema)
          .length(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS.length),
        gitTreeProjectionHash: sha256
      })
      .strict(),
    branding: z
      .object({
        productNameBefore: z.literal("ToolProof"),
        productNameAfter: z.literal("Thurstone"),
        adoptedAt: z.literal("2026-08-29"),
        legacyProtocolNamespace: z.literal("toolproof"),
        packageName: z.literal("toolproof"),
        productionOrigin: z.literal("https://toolproof-rust.vercel.app"),
        repositorySlug: z.literal("serg337/toolproof"),
        tree: gitOid,
        changedPaths: z.array(rebrandBrandingPath).length(JUDGE_DEMO_REBRAND_BRANDING_PATHS.length),
        treeChanges: z
          .array(rebrandBrandingTreeChangeSchema)
          .length(JUDGE_DEMO_REBRAND_BRANDING_PATHS.length),
        gitTreeProjectionHash: sha256,
        files: z
          .array(z.object({ path: rebrandBrandingPath, sha256 }).strict())
          .length(JUDGE_DEMO_REBRAND_BRANDING_PATHS.length),
        filesProjectionHash: sha256
      })
      .strict(),
    preservedArtifacts: z.tuple([
      z
        .object({
          path: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[0].path),
          sha256: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[0].sha256)
        })
        .strict(),
      z
        .object({
          path: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[1].path),
          sha256: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[1].sha256)
        })
        .strict(),
      z
        .object({
          path: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[2].path),
          sha256: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[2].sha256)
        })
        .strict(),
      z
        .object({
          path: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[3].path),
          sha256: z.literal(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS[3].sha256)
        })
        .strict()
    ]),
    preservedArtifactsHash: sha256,
    gate6PresentationProofHash: sha256,
    gate6CriticalProjectionHash: sha256,
    baselineRawSha256: z.literal(
      "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb"
    ),
    revisedRawSha256: z.literal("26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa"),
    scoredCallsPerformed: z.literal(0)
  })
  .strict();

const invocationIntegritySemanticArtifactsSchema = z.tuple([
  z
    .object({
      path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[0]!.path),
      sha256: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[0]!.sha256)
    })
    .strict(),
  z
    .object({
      path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[1]!.path),
      sha256: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[1]!.sha256)
    })
    .strict(),
  z
    .object({
      path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[2]!.path),
      sha256: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[2]!.sha256)
    })
    .strict(),
  z
    .object({
      path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[3]!.path),
      sha256: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS[3]!.sha256)
    })
    .strict()
]);

const invocationIntegrityTransitionSchema = z
  .object({
    ...transitionCommon,
    version: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION),
    kind: z.literal("invocation-integrity"),
    predecessorBinding: z
      .object({
        activeCommit: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT),
        activeTree: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE),
        activeEnvelopeHash: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH),
        bindingHash: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH),
        reviewedArtifactSha256: z.literal(
          JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256
        )
      })
      .strict(),
    amendment: z
      .object({
        commit: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT),
        tree: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE),
        path: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH),
        fileSha256: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256),
        treeChange: invocationIntegrityAmendmentTreeChangeSchema,
        gitTreeProjectionHash: sha256
      })
      .strict(),
    protocolExtension: z
      .object({
        commit,
        commitCount: z.number().int().min(1).max(4),
        tree: gitOid,
        changedPaths: z
          .array(invocationIntegrityProtocolPath)
          .length(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS.length),
        treeChanges: z
          .array(invocationIntegrityProtocolTreeChangeSchema)
          .length(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS.length),
        gitTreeProjectionHash: sha256
      })
      .strict(),
    implementation: z
      .object({
        tree: gitOid,
        changedPaths: z
          .array(invocationIntegrityImplementationPath)
          .min(JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS.length)
          .max(JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS.length),
        treeChanges: z
          .array(invocationIntegrityImplementationTreeChangeSchema)
          .min(JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS.length)
          .max(JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS.length),
        requiredPathsHash: sha256,
        gitTreeProjectionHash: sha256
      })
      .strict(),
    invocationContract: z
      .object({
        amendmentStatus: z.literal("prospective-frozen-supplement"),
        caseIds: z.tuple([z.literal("II-01"), z.literal("II-02"), z.literal("II-03")]),
        invocationCount: z.literal(4),
        scoreDenominator: z.literal(3),
        itemIdPattern: z.literal("^[a-z0-9]+(?:-[a-z0-9]+)*$"),
        itemIdMinLength: z.literal(1),
        itemIdMaxLength: z.literal(64),
        fixtureMembership: z.literal("server-authoritative"),
        successfulItemIdentity: z.literal("trusted-fixture-CartItemId"),
        contractSourceSha256: sha256
      })
      .strict(),
    immutableProjectionDelta: z
      .object({
        predecessorProjectionHash: sha256,
        successorProjectionHash: sha256,
        changedTool: z.literal("cart_update"),
        changedField: z.literal("inputSchema.properties.itemId"),
        judgeTargetTool: z.literal("cart_get"),
        judgeTargetContractChanged: z.literal(false),
        semanticMeaningMatrixChanged: z.literal(false)
      })
      .strict(),
    semanticEvidence: z
      .object({
        sealedEvidenceBuildCommit: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD),
        packageDigest: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST),
        baselinePassed: z.literal(23),
        revisedPassed: z.literal(23),
        possible: z.literal(24),
        noMeasuredImprovement: z.literal(true),
        meaningMatrixCaseCount: z.literal(24),
        meaningMatrixModified: z.literal(false),
        artifacts: invocationIntegritySemanticArtifactsSchema,
        artifactsProjectionHash: sha256
      })
      .strict(),
    gate6PresentationProofHash: sha256,
    gate6CriticalProjectionHash: sha256,
    modelCallsPerformed: z.literal(0),
    scoredCallsPerformed: z.literal(0)
  })
  .strict();

const gate9TerminalFinalizationSchema = z
  .object({
    predecessorBinding: z
      .object({
        activeCommit: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT),
        activeTree: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE),
        bindingHash: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH),
        evidenceTransitionProofHash: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH)
      })
      .strict(),
    evidenceMaterialCommit: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT),
    evidenceMaterialTree: z.literal(JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE),
    protocolFinalization: z
      .object({
        version: z.literal(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_VERSION),
        predecessorCommit: commit,
        successorCommit: commit,
        successorTree: gitOid,
        changedPaths: z
          .array(gate9ProtocolFinalizationPath)
          .length(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS.length),
        treeChanges: z
          .array(gate9ProtocolFinalizationTreeChangeSchema)
          .length(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS.length),
        gitTreeProjectionHash: sha256,
        gitPackTransport: z.literal(JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT),
        providerCallsPerformed: z.literal(0),
        modelCallsPerformed: z.literal(0),
        scoredCallsPerformed: z.literal(0),
        storeWritesPerformed: z.literal(0)
      })
      .strict(),
    collateralPreparation: z
      .object({
        version: z.literal(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_VERSION),
        predecessorCommit: commit,
        successorCommit: commit,
        successorTree: gitOid,
        changedPaths: z
          .array(gate9CollateralPreparationPath)
          .length(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS.length),
        treeChanges: z
          .array(gate9CollateralPreparationTreeChangeSchema)
          .length(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS.length),
        gitTreeProjectionHash: sha256,
        linkFieldsStatus: z.literal("reserved-for-final-link-only-release"),
        providerCallsPerformed: z.literal(0),
        modelCallsPerformed: z.literal(0),
        scoredCallsPerformed: z.literal(0),
        storeWritesPerformed: z.literal(0)
      })
      .strict()
  })
  .strict();

const invocationIntegrityEvidenceTransitionSchema = z
  .object({
    ...transitionCommon,
    version: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION),
    kind: z.literal("invocation-integrity-evidence"),
    protocolExtension: z
      .object({
        commit,
        tree: gitOid,
        changedPaths: z
          .array(invocationIntegrityEvidenceProtocolPath)
          .length(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS.length),
        treeChanges: z
          .array(invocationIntegrityEvidenceProtocolTreeChangeSchema)
          .length(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS.length),
        gitTreeProjectionHash: sha256
      })
      .strict(),
    evidence: z
      .object({
        executionBuildCommit: commit,
        tree: gitOid,
        changedPaths: z
          .array(invocationIntegrityEvidencePath)
          .min(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS.length)
          .max(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS.length),
        treeChanges: z
          .array(invocationIntegrityEvidenceTreeChangeSchema)
          .min(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS.length)
          .max(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS.length),
        requiredPathsHash: sha256,
        gitTreeProjectionHash: sha256,
        supplementalPackageDigest: sha256,
        jsonExportSha256: sha256,
        markdownExportSha256: sha256,
        measuredSourceSha256: sha256,
        scoreEarned: z.literal(3),
        scorePossible: z.literal(3),
        modelCallCount: z.literal(0),
        includedInSemanticDenominator: z.literal(false),
        semanticEvidenceBuildCommit: z.literal(
          JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD
        ),
        semanticPackageDigest: z.literal(JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST),
        semanticBaselinePassed: z.literal(23),
        semanticRevisedPassed: z.literal(23),
        semanticPossible: z.literal(24),
        semanticNoMeasuredImprovement: z.literal(true),
        immutableProjectionHash: sha256
      })
      .strict(),
    terminalFinalization: gate9TerminalFinalizationSchema.optional(),
    gate6PresentationProofHash: sha256,
    gate6CriticalProjectionHash: sha256,
    modelCallsPerformed: z.literal(0),
    scoredCallsPerformed: z.literal(0)
  })
  .strict();

export const judgeDemoPresentationTransitionSchema = z.discriminatedUnion("kind", [
  recoveryTransitionSchema,
  rebrandTransitionSchema,
  invocationIntegrityTransitionSchema,
  invocationIntegrityEvidenceTransitionSchema,
  collateralTransitionSchema
]);
export const judgeDemoCollateralProofSchema = judgeDemoPresentationTransitionSchema;

export type JudgeDemoPresentationTransition = z.infer<typeof judgeDemoPresentationTransitionSchema>;
export type JudgeDemoRecoveryTransition = z.infer<typeof recoveryTransitionSchema>;
export type JudgeDemoRebrandTransition = z.infer<typeof rebrandTransitionSchema>;
export type JudgeDemoInvocationIntegrityTransition = z.infer<
  typeof invocationIntegrityTransitionSchema
>;
export type JudgeDemoInvocationIntegrityEvidenceTransition = z.infer<
  typeof invocationIntegrityEvidenceTransitionSchema
>;
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
  } else if (proof.kind === "presentation-rebrand") {
    const protocolPaths = proof.protocolExtension.treeChanges.map(({ path }) => path);
    const brandingPaths = proof.branding.treeChanges.map(({ path }) => path);
    const brandingFilePaths = proof.branding.files.map(({ path }) => path);
    if (
      proof.ordinal !== 1 ||
      proof.predecessorCommit !== JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT ||
      proof.predecessorEnvelopeHash !== JUDGE_DEMO_REBRAND_PREDECESSOR_ENVELOPE_HASH ||
      proof.protocolExtension.commit === proof.predecessorCommit ||
      proof.protocolExtension.commit === proof.successorCommit ||
      canonicalJson(proof.protocolExtension.changedPaths) !==
        canonicalJson(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS) ||
      canonicalJson(protocolPaths) !== canonicalJson(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS) ||
      canonicalJson(proof.protocolExtension.treeChanges) !==
        canonicalJson(
          [...proof.protocolExtension.treeChanges].sort((left, right) =>
            left.path.localeCompare(right.path)
          )
        ) ||
      (await canonicalSha256(proof.protocolExtension.treeChanges)) !==
        proof.protocolExtension.gitTreeProjectionHash ||
      canonicalJson(proof.branding.changedPaths) !==
        canonicalJson(JUDGE_DEMO_REBRAND_BRANDING_PATHS) ||
      canonicalJson(brandingPaths) !== canonicalJson(JUDGE_DEMO_REBRAND_BRANDING_PATHS) ||
      canonicalJson(proof.branding.treeChanges) !==
        canonicalJson(
          [...proof.branding.treeChanges].sort((left, right) => left.path.localeCompare(right.path))
        ) ||
      (await canonicalSha256(proof.branding.treeChanges)) !==
        proof.branding.gitTreeProjectionHash ||
      canonicalJson(brandingFilePaths) !== canonicalJson(JUDGE_DEMO_REBRAND_BRANDING_PATHS) ||
      canonicalJson(proof.branding.files) !==
        canonicalJson(
          [...proof.branding.files].sort((left, right) => left.path.localeCompare(right.path))
        ) ||
      (await canonicalSha256(proof.branding.files)) !== proof.branding.filesProjectionHash ||
      canonicalJson(proof.preservedArtifacts) !==
        canonicalJson(JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS) ||
      (await canonicalSha256(proof.preservedArtifacts)) !== proof.preservedArtifactsHash
    ) {
      throw new Error("judge_demo_rebrand_transition_invalid");
    }
  } else if (proof.kind === "invocation-integrity") {
    const protocolPaths = proof.protocolExtension.treeChanges.map(({ path }) => path);
    const implementationPaths = proof.implementation.treeChanges.map(({ path }) => path);
    if (
      proof.ordinal !== 2 ||
      proof.predecessorCommit !== JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT ||
      proof.predecessorEnvelopeHash !== JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH ||
      proof.protocolExtension.commit === proof.predecessorCommit ||
      proof.protocolExtension.commit === JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT ||
      proof.protocolExtension.commit === proof.successorCommit ||
      proof.protocolExtension.commitCount < 1 ||
      canonicalJson(proof.protocolExtension.changedPaths) !==
        canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS) ||
      canonicalJson(protocolPaths) !==
        canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS) ||
      canonicalJson(proof.protocolExtension.treeChanges) !==
        canonicalJson(
          [...proof.protocolExtension.treeChanges].sort((left, right) =>
            left.path.localeCompare(right.path)
          )
        ) ||
      (await canonicalSha256(proof.protocolExtension.treeChanges)) !==
        proof.protocolExtension.gitTreeProjectionHash ||
      canonicalJson(proof.implementation.changedPaths) !== canonicalJson(implementationPaths) ||
      canonicalJson(proof.implementation.treeChanges) !==
        canonicalJson(
          [...proof.implementation.treeChanges].sort((left, right) =>
            left.path.localeCompare(right.path)
          )
        ) ||
      new Set(implementationPaths).size !== implementationPaths.length ||
      JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS.some(
        (path) => !implementationPaths.includes(path)
      ) ||
      (await canonicalSha256(JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS)) !==
        proof.implementation.requiredPathsHash ||
      (await canonicalSha256(proof.implementation.treeChanges)) !==
        proof.implementation.gitTreeProjectionHash ||
      proof.amendment.treeChange.path !== JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH ||
      proof.amendment.treeChange.status !== "A" ||
      proof.amendment.treeChange.predecessorMode !== null ||
      proof.amendment.treeChange.predecessorBlobOid !== null ||
      proof.amendment.treeChange.successorMode !== "100644" ||
      proof.amendment.treeChange.successorBlobOid === null ||
      (await canonicalSha256([proof.amendment.treeChange])) !==
        proof.amendment.gitTreeProjectionHash ||
      canonicalJson(proof.semanticEvidence.artifacts) !==
        canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS) ||
      (await canonicalSha256(proof.semanticEvidence.artifacts)) !==
        proof.semanticEvidence.artifactsProjectionHash ||
      proof.immutableProjectionDelta.predecessorProjectionHash !== proof.immutableProjectionHash ||
      proof.immutableProjectionDelta.predecessorProjectionHash ===
        proof.immutableProjectionDelta.successorProjectionHash
    ) {
      throw new Error("judge_demo_invocation_integrity_transition_invalid");
    }
  } else if (proof.kind === "invocation-integrity-evidence") {
    const protocolPaths = proof.protocolExtension.treeChanges.map(({ path }) => path);
    const evidencePaths = proof.evidence.treeChanges.map(({ path }) => path);
    const terminal = proof.terminalFinalization ?? null;
    const finalizationPaths =
      terminal?.protocolFinalization.treeChanges.map(({ path }) => path) ?? [];
    const preparationPaths =
      terminal?.collateralPreparation.treeChanges.map(({ path }) => path) ?? [];
    const expectedFirstParentChain =
      terminal === null
        ? [proof.predecessorCommit, proof.protocolExtension.commit, proof.successorCommit]
        : [
            proof.predecessorCommit,
            proof.protocolExtension.commit,
            terminal.evidenceMaterialCommit,
            terminal.protocolFinalization.successorCommit,
            terminal.collateralPreparation.successorCommit
          ];
    const finalizationValid =
      terminal === null ||
      (terminal.evidenceMaterialCommit !== proof.predecessorCommit &&
        terminal.evidenceMaterialCommit !== proof.protocolExtension.commit &&
        terminal.evidenceMaterialTree === proof.evidence.tree &&
        terminal.protocolFinalization.predecessorCommit === terminal.evidenceMaterialCommit &&
        terminal.protocolFinalization.successorCommit !== terminal.evidenceMaterialCommit &&
        terminal.collateralPreparation.predecessorCommit ===
          terminal.protocolFinalization.successorCommit &&
        terminal.collateralPreparation.successorCommit === proof.successorCommit &&
        canonicalJson(terminal.protocolFinalization.changedPaths) ===
          canonicalJson(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS) &&
        canonicalJson(finalizationPaths) ===
          canonicalJson(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS) &&
        canonicalJson(terminal.protocolFinalization.treeChanges) ===
          canonicalJson(
            [...terminal.protocolFinalization.treeChanges].sort((left, right) =>
              judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
            )
          ) &&
        terminal.protocolFinalization.treeChanges.every(
          (change) =>
            change.status === "M" &&
            change.predecessorMode === "100644" &&
            change.successorMode === "100644" &&
            change.predecessorBlobOid !== null &&
            change.successorBlobOid !== null &&
            change.predecessorBlobOid !== change.successorBlobOid
        ) &&
        (await canonicalSha256(terminal.protocolFinalization.treeChanges)) ===
          terminal.protocolFinalization.gitTreeProjectionHash &&
        canonicalJson(terminal.collateralPreparation.changedPaths) ===
          canonicalJson(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS) &&
        canonicalJson(preparationPaths) ===
          canonicalJson(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS) &&
        canonicalJson(terminal.collateralPreparation.treeChanges) ===
          canonicalJson(
            [...terminal.collateralPreparation.treeChanges].sort((left, right) =>
              judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
            )
          ) &&
        terminal.collateralPreparation.treeChanges.every((change) =>
          change.path === "public/thurstone-devpost-thumbnail.jpg"
            ? change.status === "A" &&
              change.predecessorMode === null &&
              change.successorMode === "100644" &&
              change.predecessorBlobOid === null &&
              change.successorBlobOid !== null
            : change.status === "M" &&
              change.predecessorMode === "100644" &&
              change.successorMode === "100644" &&
              change.predecessorBlobOid !== null &&
              change.successorBlobOid !== null &&
              change.predecessorBlobOid !== change.successorBlobOid
        ) &&
        (await canonicalSha256(terminal.collateralPreparation.treeChanges)) ===
          terminal.collateralPreparation.gitTreeProjectionHash);
    if (
      proof.ordinal !== 3 ||
      proof.evidence.executionBuildCommit !== proof.predecessorCommit ||
      proof.protocolExtension.commit === proof.predecessorCommit ||
      proof.protocolExtension.commit === proof.successorCommit ||
      canonicalJson(proof.protocolExtension.changedPaths) !==
        canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS) ||
      canonicalJson(protocolPaths) !==
        canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS) ||
      canonicalJson(proof.protocolExtension.treeChanges) !==
        canonicalJson(
          [...proof.protocolExtension.treeChanges].sort((left, right) =>
            judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
          )
        ) ||
      (await canonicalSha256(proof.protocolExtension.treeChanges)) !==
        proof.protocolExtension.gitTreeProjectionHash ||
      canonicalJson(proof.evidence.changedPaths) !== canonicalJson(evidencePaths) ||
      canonicalJson(proof.evidence.treeChanges) !==
        canonicalJson(
          [...proof.evidence.treeChanges].sort((left, right) =>
            judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
          )
        ) ||
      new Set(evidencePaths).size !== evidencePaths.length ||
      JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS.some(
        (path) => !evidencePaths.includes(path)
      ) ||
      (await canonicalSha256(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS)) !==
        proof.evidence.requiredPathsHash ||
      (await canonicalSha256(proof.evidence.treeChanges)) !==
        proof.evidence.gitTreeProjectionHash ||
      !finalizationValid ||
      (await canonicalSha256(expectedFirstParentChain)) !== proof.firstParentChainHash
    ) {
      throw new Error("judge_demo_invocation_integrity_evidence_transition_invalid");
    }
  } else {
    const changeKeys = proof.collateralChanges.map(({ path, field }) => `${path}\n${field}`);
    const ordinalValid =
      proof.version === JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION
        ? proof.ordinal === 1
        : proof.version === JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
          ? proof.ordinal === 2
          : proof.ordinal === 3 || proof.ordinal === 4;
    const gate9ExpectedKeys = JUDGE_DEMO_COLLATERAL_PATHS.flatMap((path) =>
      JUDGE_DEMO_GATE9_RELEASE_FIELDS.map((field) => `${path}\n${field}`)
    ).sort();
    const gate9ReleaseValid =
      proof.version !== JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION || proof.ordinal !== 4
        ? true
        : proof.collateralChanges.length === gate9ExpectedKeys.length &&
          canonicalJson(changeKeys) === canonicalJson(gate9ExpectedKeys) &&
          proof.collateralChanges.every(({ field, predecessorValue, successorValue }) => {
            if (predecessorValue !== JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE) return false;
            if (field === "public_repository") {
              return successorValue === JUDGE_DEMO_GATE9_PUBLIC_REPOSITORY_URL;
            }
            if (field === "release") return successorValue === JUDGE_DEMO_GATE9_RELEASE_URL;
            if (field !== "demo_video") return false;
            const parsed = new URL(successorValue);
            return (
              (parsed.hostname === "youtu.be" && parsed.pathname.length > 1) ||
              ((parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube.com") &&
                parsed.pathname === "/watch" &&
                parsed.searchParams.get("v") !== null)
            );
          });
    if (
      !ordinalValid ||
      !gate9ReleaseValid ||
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
