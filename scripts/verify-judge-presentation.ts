import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

import { verifyJudgeDemoCollateralCheckout } from "../lib/judge/collateral-checkout-verifier.server";
import { createJudgeDemoEnvelope } from "../lib/judge/envelope";
import {
  JUDGE_DEMO_GIT_PACK_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_MODE_ENV,
  decodeJudgeDemoPresentationBinding,
  judgeDemoPresentationBindingSchema,
  verifyJudgeDemoPresentationBinding
} from "../lib/judge/presentation-binding.server";

const encoded = process.env[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ?? "";
const bindingHash = process.env[JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]?.trim() ?? "";
const packEncoded = process.env[JUDGE_DEMO_GIT_PACK_ENV]?.trim() ?? "";
const presentationMode = process.env[JUDGE_DEMO_PRESENTATION_MODE_ENV]?.trim() ?? "";
const laneEnabled = process.env.TOOLPROOF_JUDGE_LANE_MODE === "enabled";

if (!laneEnabled && !presentationMode && !encoded && !bindingHash && !packEncoded) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "judge-presentation", status: "not-configured" })}\n`
  );
} else if (
  laneEnabled &&
  presentationMode === "predecessor" &&
  !encoded &&
  !bindingHash &&
  !packEncoded
) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "judge-presentation", status: "verified-predecessor" })}\n`
  );
} else if (laneEnabled && presentationMode === "successor" && encoded && bindingHash) {
  const parsed = judgeDemoPresentationBindingSchema.parse(
    await decodeJudgeDemoPresentationBinding(encoded)
  );
  const [predecessorEnvelope, successorEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(parsed.predecessorCommit),
    createJudgeDemoEnvelope(parsed.successorCommit)
  ]);
  const binding = await verifyJudgeDemoPresentationBinding({
    value: parsed,
    predecessorEnvelope,
    successorEnvelope,
    predecessorReceiptDigest: parsed.predecessorReceiptDigest
  });
  const proof = binding.collateralProof;
  const activeCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (
    bindingHash !== binding.bindingHash ||
    process.env.TOOLPROOF_JUDGE_ACTIVE_COMMIT?.trim() !== binding.successorCommit ||
    process.env.TOOLPROOF_COMMIT_SHA?.trim() !== binding.successorCommit ||
    activeCommit !== binding.successorCommit
  ) {
    throw new Error("judge_demo_presentation_build_identity_invalid");
  }

  let gitProofTransport: "verified-pack" | "full-local-history";
  if (packEncoded) {
    const pack = Buffer.from(packEncoded, "base64url");
    if (
      pack.length < 1 ||
      pack.toString("base64url") !== packEncoded ||
      createHash("sha256").update(pack).digest("hex") !== proof.gitProofPackSha256
    ) {
      throw new Error("judge_demo_presentation_git_pack_root_invalid");
    }
    execFileSync("git", ["init", "-q"], { cwd: process.cwd() });
    const indexed = spawnSync("git", ["index-pack", "--stdin", "--fix-thin"], {
      cwd: process.cwd(),
      input: pack,
      maxBuffer: 1_048_576
    });
    if (indexed.status !== 0) throw new Error("judge_demo_presentation_git_pack_invalid");
    gitProofTransport = "verified-pack";
  } else {
    const predecessorAvailable = spawnSync(
      "git",
      ["cat-file", "-e", `${binding.predecessorCommit}^{commit}`],
      { cwd: process.cwd() }
    ).status;
    const successorAvailable = spawnSync(
      "git",
      ["cat-file", "-e", `${binding.successorCommit}^{commit}`],
      { cwd: process.cwd() }
    ).status;
    if (predecessorAvailable !== 0 || successorAvailable !== 0) {
      throw new Error("judge_demo_presentation_verified_git_objects_missing");
    }
    gitProofTransport = "full-local-history";
  }
  const checkout = await verifyJudgeDemoCollateralCheckout({ proof, cwd: process.cwd() });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "judge-presentation",
      status: "verified-collateral-only-successor",
      predecessorCommit: binding.predecessorCommit,
      successorCommit: binding.successorCommit,
      changedPathCount: checkout.changedPathCount,
      criticalFileCount: checkout.criticalFileCount,
      immutableProjectionHash: binding.immutableProjectionHash,
      collateralProofHash: binding.collateralProofHash,
      bindingHash: binding.bindingHash,
      gitProofTransport,
      providerCallsPerformed: 0
    })}\n`
  );
} else {
  throw new Error("judge_demo_presentation_mode_configuration_invalid");
}
