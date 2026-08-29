import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { verifyJudgeDemoCollateralCheckout } from "@/lib/judge/collateral-checkout-verifier.server";
import {
  JUDGE_DEMO_COLLATERAL_PROOF_VERSION,
  JUDGE_DEMO_CRITICAL_PATHS,
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoCollateralProof
} from "@/lib/judge/collateral-proof";
import { createJudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_VERSION
} from "@/lib/judge/presentation-binding.server";
import { dependencyProjectionHash } from "@/lib/results/presentation-proof";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=ToolProof Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  ).trim();
}

async function write(cwd: string, path: string, contents: string): Promise<void> {
  const target = join(cwd, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function fixture(nonLinkChange = false) {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-judge-presentation-"));
  temporaryRoots.push(cwd);
  git(cwd, ["init", "-q"]);
  for (const [index, path] of JUDGE_DEMO_CRITICAL_PATHS.entries()) {
    await write(cwd, path, `critical:${index}:${path}\n`);
  }
  const packageProjection = {
    dependencies: { zod: "4.4.3" },
    devDependencies: { typescript: "6.0.3" },
    engines: { node: "22.x" }
  };
  await write(cwd, "package.json", `${JSON.stringify(packageProjection)}\n`);
  await write(cwd, "README.md", "ToolProof\nLive app: pending\n");
  git(cwd, ["add", "--", "."]);
  git(cwd, ["commit", "-q", "-m", "judge evidence build"]);
  const predecessorCommit = git(cwd, ["rev-parse", "HEAD"]);
  await write(
    cwd,
    "README.md",
    `${nonLinkChange ? "ToolProof changed" : "ToolProof"}\nLive app: https://toolproof.example\n`
  );
  git(cwd, ["add", "--", "README.md"]);
  git(cwd, ["commit", "-q", "-m", "release collateral"]);
  const successorCommit = git(cwd, ["rev-parse", "HEAD"]);
  const [predecessorEnvelope, successorEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(predecessorCommit),
    createJudgeDemoEnvelope(successorCommit)
  ]);
  const criticalFiles = await Promise.all(
    JUDGE_DEMO_CRITICAL_PATHS.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(cwd, path)))
        .digest("hex")
    }))
  );
  const collateralChanges = [
    {
      path: "README.md" as const,
      field: "live_app" as const,
      predecessorValue: "pending",
      successorValue: "https://toolproof.example"
    }
  ];
  const payload = {
    version: JUDGE_DEMO_COLLATERAL_PROOF_VERSION,
    predecessorCommit,
    successorCommit,
    changedPaths: ["README.md"],
    collateralChanges,
    collateralChangesHash: await canonicalSha256(collateralChanges),
    criticalFiles,
    criticalProjectionHash: await canonicalSha256(criticalFiles),
    dependencyProjectionHash: await dependencyProjectionHash(packageProjection),
    gitProofPackSha256: "a".repeat(64),
    predecessorEnvelopeHash: predecessorEnvelope.envelopeHash,
    successorEnvelopeHash: successorEnvelope.envelopeHash,
    predecessorReceiptDigest: "b".repeat(64),
    immutableProjectionHash: await judgeDemoImmutableProjectionHash(predecessorEnvelope),
    providerCallsPerformed: 0 as const,
    replayOnly: true as const
  };
  const proof = await verifyJudgeDemoCollateralProof({
    ...payload,
    proofHash: await canonicalSha256(payload)
  });
  return { cwd, proof, predecessorEnvelope, successorEnvelope };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("judge collateral checkout verification", () => {
  it("verifies actual ancestry, exact diff, critical bytes, and dependency projection", async () => {
    const { cwd, proof, predecessorEnvelope, successorEnvelope } = await fixture();
    await expect(verifyJudgeDemoCollateralCheckout({ cwd, proof })).resolves.toEqual({
      changedPathCount: 1,
      criticalFileCount: JUDGE_DEMO_CRITICAL_PATHS.length,
      dependencyProjectionHash: proof.dependencyProjectionHash
    });

    const bindingPayload = {
      version: JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
      predecessorCommit: proof.predecessorCommit,
      successorCommit: proof.successorCommit,
      predecessorEnvelopeHash: predecessorEnvelope.envelopeHash,
      successorEnvelopeHash: successorEnvelope.envelopeHash,
      predecessorReceiptDigest: proof.predecessorReceiptDigest,
      immutableProjectionHash: proof.immutableProjectionHash,
      collateralProof: proof,
      collateralProofHash: proof.proofHash,
      providerCallsPerformed: 0 as const,
      replayOnly: true as const
    };
    const binding = {
      ...bindingPayload,
      bindingHash: await canonicalSha256(bindingPayload)
    };
    const script = spawnSync(
      resolve("node_modules/.bin/tsx"),
      [
        "--tsconfig",
        resolve("tsconfig.operator.json"),
        resolve("scripts/verify-judge-presentation.ts")
      ],
      {
        cwd,
        env: {
          ...process.env,
          TOOLPROOF_JUDGE_LANE_MODE: "enabled",
          TOOLPROOF_JUDGE_PRESENTATION_MODE: "successor",
          TOOLPROOF_JUDGE_ACTIVE_COMMIT: proof.successorCommit,
          TOOLPROOF_COMMIT_SHA: proof.successorCommit,
          VERCEL_GIT_COMMIT_SHA: proof.successorCommit,
          [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: gzipSync(
            Buffer.from(canonicalJson(binding))
          ).toString("base64url"),
          [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: binding.bindingHash
        },
        encoding: "utf8",
        maxBuffer: 1_048_576
      }
    );
    expect(script.status, script.stderr).toBe(0);
    expect(script.stdout).toContain('"gitProofTransport":"full-local-history"');

    await write(cwd, "lib/judge/service.server.ts", "tampered after approved release\n");
    await expect(verifyJudgeDemoCollateralCheckout({ cwd, proof })).rejects.toThrow(
      /judge_demo_presentation_critical_file_mismatch/u
    );
  });

  it("rejects unallowlisted claims and a claimed diff that differs from Git", async () => {
    const { cwd, proof } = await fixture();
    const base = { ...proof };
    delete (base as Partial<typeof proof>).proofHash;
    const forbiddenPayload = { ...base, changedPaths: ["lib/judge/service.server.ts"] };
    await expect(
      verifyJudgeDemoCollateralProof({
        ...forbiddenPayload,
        proofHash: await canonicalSha256(forbiddenPayload)
      })
    ).rejects.toThrow(/judge_demo_collateral_proof_invalid/u);

    const wrongCollateralChanges = [
      {
        path: "submission/devpost.md" as const,
        field: "release" as const,
        predecessorValue: "pending",
        successorValue: "https://devpost.example/submission"
      }
    ];
    const wrongDiffPayload = {
      ...base,
      changedPaths: ["submission/devpost.md"],
      collateralChanges: wrongCollateralChanges,
      collateralChangesHash: await canonicalSha256(wrongCollateralChanges)
    };
    const wrongDiff = await verifyJudgeDemoCollateralProof({
      ...wrongDiffPayload,
      proofHash: await canonicalSha256(wrongDiffPayload)
    });
    await expect(verifyJudgeDemoCollateralCheckout({ cwd, proof: wrongDiff })).rejects.toThrow(
      /judge_demo_presentation_actual_diff_mismatch/u
    );

    const nonLink = await fixture(true);
    await expect(
      verifyJudgeDemoCollateralCheckout({ cwd: nonLink.cwd, proof: nonLink.proof })
    ).rejects.toThrow(/judge_demo_presentation_non_link_change/u);
  });

  it("requires explicit predecessor/successor mode only when the judge lane is enabled", () => {
    const baseEnvironment = { ...process.env };
    for (const name of [
      "TOOLPROOF_JUDGE_LANE_MODE",
      "TOOLPROOF_JUDGE_PRESENTATION_MODE",
      "TOOLPROOF_JUDGE_PRESENTATION_BINDING_B64",
      "TOOLPROOF_JUDGE_PRESENTATION_BINDING_HASH",
      "TOOLPROOF_JUDGE_GIT_PACK_B64"
    ]) {
      delete baseEnvironment[name];
    }
    const run = (environment: NodeJS.ProcessEnv) =>
      spawnSync(
        "npx",
        ["tsx", "--tsconfig", "tsconfig.operator.json", "scripts/verify-judge-presentation.ts"],
        { cwd: process.cwd(), env: environment, encoding: "utf8", maxBuffer: 1_048_576 }
      );
    const ordinary = run(baseEnvironment);
    expect(ordinary.status).toBe(0);
    expect(ordinary.stdout).toContain('"status":"not-configured"');

    const predecessor = run({
      ...baseEnvironment,
      TOOLPROOF_JUDGE_LANE_MODE: "enabled",
      TOOLPROOF_JUDGE_PRESENTATION_MODE: "predecessor"
    });
    expect(predecessor.status).toBe(0);
    expect(predecessor.stdout).toContain('"status":"verified-predecessor"');

    const missingMode = run({ ...baseEnvironment, TOOLPROOF_JUDGE_LANE_MODE: "enabled" });
    expect(missingMode.status).not.toBe(0);
    expect(missingMode.stderr).toContain("judge_demo_presentation_mode_configuration_invalid");
  });
});
