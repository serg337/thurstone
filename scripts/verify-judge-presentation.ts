import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

import { verifyJudgeDemoPresentationCheckout } from "../lib/judge/collateral-checkout-verifier.server";
import { createJudgeDemoEnvelope } from "../lib/judge/envelope";
import {
  JUDGE_DEMO_GIT_PACK_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION,
  JUDGE_DEMO_PRESENTATION_MODE_ENV,
  JUDGE_DEMO_SHARED_GIT_PACK_ENV,
  decodeJudgeDemoPresentationBinding,
  judgeDemoPresentationBindingSchema,
  verifyJudgeDemoPresentationBinding
} from "../lib/judge/presentation-binding.server";

const encoded = process.env[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ?? "";
const bindingHash = process.env[JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]?.trim() ?? "";
const judgePackEncoded = process.env[JUDGE_DEMO_GIT_PACK_ENV]?.trim() ?? "";
const sharedPackEncoded = process.env[JUDGE_DEMO_SHARED_GIT_PACK_ENV]?.trim() ?? "";
if (judgePackEncoded && sharedPackEncoded && judgePackEncoded !== sharedPackEncoded) {
  throw new Error("judge_demo_presentation_git_pack_configuration_ambiguous");
}
const packEncoded = judgePackEncoded || sharedPackEncoded;
const presentationMode = process.env[JUDGE_DEMO_PRESENTATION_MODE_ENV]?.trim() ?? "";
const laneEnabled = process.env.TOOLPROOF_JUDGE_LANE_MODE === "enabled";
const productionBuild = process.env.VERCEL === "1";

if (!laneEnabled && !presentationMode && !encoded && !bindingHash && !judgePackEncoded) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "judge-presentation", status: "not-configured" })}\n`
  );
} else if (
  laneEnabled &&
  presentationMode === "predecessor" &&
  !encoded &&
  !bindingHash &&
  !judgePackEncoded
) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "judge-presentation", status: "verified-predecessor" })}\n`
  );
} else if (laneEnabled && presentationMode === "successor" && encoded && bindingHash) {
  if (productionBuild && (judgePackEncoded || !sharedPackEncoded)) {
    throw new Error("judge_demo_presentation_shared_git_pack_required");
  }
  const parsed = judgeDemoPresentationBindingSchema.parse(
    await decodeJudgeDemoPresentationBinding(encoded)
  );
  const historicalPresentation = parsed.version !== JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION;
  const [rootEnvelope, activeEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(parsed.rootEvidenceCommit, { historicalPresentation }),
    createJudgeDemoEnvelope(parsed.activeCommit, { historicalPresentation })
  ]);
  const binding = await verifyJudgeDemoPresentationBinding({
    value: parsed,
    rootEnvelope,
    activeEnvelope,
    rootReceiptDigest: parsed.rootReceiptDigest,
    rootArtifactDigest: parsed.rootArtifactDigest,
    rootStoredProjectionDigest: parsed.rootStoredProjectionDigest,
    rootCapturedAt: parsed.rootCapturedAt
  });
  const activeCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (
    bindingHash !== binding.bindingHash ||
    process.env.TOOLPROOF_JUDGE_ACTIVE_COMMIT?.trim() !== binding.activeCommit ||
    process.env.TOOLPROOF_COMMIT_SHA?.trim() !== binding.activeCommit ||
    activeCommit !== binding.activeCommit
  ) {
    throw new Error("judge_demo_presentation_build_identity_invalid");
  }

  let gitProofTransport: "verified-judge-pack" | "verified-shared-pack" | "full-local-history";
  if (packEncoded) {
    const pack = Buffer.from(packEncoded, "base64url");
    if (
      pack.length < 1 ||
      pack.toString("base64url") !== packEncoded ||
      createHash("sha256").update(pack).digest("hex") !== binding.gitProofPackSha256
    ) {
      throw new Error("judge_demo_presentation_git_pack_root_invalid");
    }
    execFileSync("git", ["init", "-q"], { cwd: process.cwd() });
    const indexed = spawnSync("git", ["index-pack", "--stdin", "--fix-thin"], {
      cwd: process.cwd(),
      input: pack,
      maxBuffer: 8_388_608
    });
    if (indexed.status !== 0) throw new Error("judge_demo_presentation_git_pack_invalid");
    gitProofTransport = judgePackEncoded ? "verified-judge-pack" : "verified-shared-pack";
  } else {
    const commits = [
      binding.rootEvidenceCommit,
      ...binding.transitions.map(({ successorCommit }) => successorCommit)
    ];
    if (
      commits.some(
        (commit) =>
          spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
            cwd: process.cwd()
          }).status !== 0
      )
    ) {
      throw new Error("judge_demo_presentation_verified_git_objects_missing");
    }
    gitProofTransport = "full-local-history";
  }
  const checkout = await verifyJudgeDemoPresentationCheckout({
    binding,
    cwd: process.cwd()
  });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "judge-presentation",
      status: "verified-provider-free-lineage",
      rootEvidenceCommit: binding.rootEvidenceCommit,
      activeCommit: binding.activeCommit,
      transitionCount: checkout.transitionCount,
      transitionKinds: binding.transitions.map(({ kind }) => kind),
      changedPathCount: checkout.changedPathCount,
      criticalFileCount: checkout.criticalFileCount,
      immutableProjectionHash: binding.immutableProjectionHash,
      lineageHash: binding.lineageHash,
      gitProofTransport,
      providerCallsPerformed: 0,
      storeWritesPerformed: 0
    })}\n`
  );
} else {
  throw new Error("judge_demo_presentation_mode_configuration_invalid");
}
