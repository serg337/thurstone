import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";

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

const MAX_GIT_PACK_TRANSPORT_CHARACTERS = 60_000;
const MAX_EXPANDED_GIT_PACK_BYTES = 65_536;

function decodeGitProofPack(
  encoded: string,
  expectedSha256: string
): { readonly bytes: Buffer; readonly encoding: "raw" | "brotli" } {
  if (
    encoded.length < 1 ||
    encoded.length > MAX_GIT_PACK_TRANSPORT_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new Error("judge_demo_presentation_git_pack_encoding_invalid");
  }
  const transported = Buffer.from(encoded, "base64url");
  if (transported.toString("base64url") !== encoded) {
    throw new Error("judge_demo_presentation_git_pack_encoding_invalid");
  }
  const raw = transported.subarray(0, 4).toString("ascii") === "PACK";
  let bytes: Buffer;
  try {
    bytes = raw
      ? transported
      : brotliDecompressSync(transported, { maxOutputLength: MAX_EXPANDED_GIT_PACK_BYTES });
  } catch {
    throw new Error("judge_demo_presentation_git_pack_encoding_invalid");
  }
  if (
    bytes.length < 12 ||
    bytes.length > MAX_EXPANDED_GIT_PACK_BYTES ||
    bytes.subarray(0, 4).toString("ascii") !== "PACK" ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  ) {
    throw new Error("judge_demo_presentation_git_pack_root_invalid");
  }
  return Object.freeze({ bytes, encoding: raw ? "raw" : "brotli" });
}

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
  let gitProofPackEncoding: "raw" | "brotli" | null = null;
  if (packEncoded) {
    const pack = decodeGitProofPack(packEncoded, binding.gitProofPackSha256);
    const wrappedPackRequired = binding.transitions.some(
      (transition) =>
        transition.kind === "invocation-integrity-evidence" &&
        transition.terminalFinalization !== undefined
    );
    if (wrappedPackRequired && pack.encoding !== "brotli") {
      throw new Error("judge_demo_presentation_brotli_pack_required");
    }
    execFileSync("git", ["init", "-q"], { cwd: process.cwd() });
    const indexed = spawnSync("git", ["index-pack", "--stdin", "--fix-thin"], {
      cwd: process.cwd(),
      input: pack.bytes,
      maxBuffer: 8_388_608
    });
    if (indexed.status !== 0) throw new Error("judge_demo_presentation_git_pack_invalid");
    gitProofTransport = judgePackEncoded ? "verified-judge-pack" : "verified-shared-pack";
    gitProofPackEncoding = pack.encoding;
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
      gitProofPackEncoding,
      providerCallsPerformed: 0,
      storeWritesPerformed: 0
    })}\n`
  );
} else {
  throw new Error("judge_demo_presentation_mode_configuration_invalid");
}
