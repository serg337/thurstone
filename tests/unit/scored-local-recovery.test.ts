import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SCORED_LOCAL_RECOVERY_VERSION,
  deleteScoredLocalRecovery,
  loadScoredLocalRecovery,
  saveScoredLocalRecovery,
  type ScoredLocalRecoveryState
} from "@/lib/scored/local-recovery";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function state(): ScoredLocalRecoveryState {
  return {
    version: SCORED_LOCAL_RECOVERY_VERSION,
    phase: "baseline",
    launchId: `launch_${"l".repeat(22)}`,
    documentId: `document_${"d".repeat(22)}`,
    capability: "c".repeat(43),
    recoveryCookie: null,
    buildCommit: null,
    frozenProtocolHash: null,
    reviewPackageHash: null
  };
}

describe("scored local process-restart recovery", () => {
  it("encrypts pre-start capability state, survives restart, rotates to recovery cookie, and deletes only after ACK", async () => {
    const root = await mkdtemp(`${tmpdir()}/toolproof-scored-recovery-`);
    roots.push(root);
    const initial = state();
    await saveScoredLocalRecovery(initial, root);
    const artifactPath = path.join(root, ".toolproof-local/recovery/scored-baseline.json.enc");
    const encrypted = await readFile(artifactPath, "utf8");
    expect(encrypted).not.toContain(initial.capability!);
    expect(await loadScoredLocalRecovery("baseline", root)).toEqual(initial);

    const recovered: ScoredLocalRecoveryState = {
      ...initial,
      capability: null,
      recoveryCookie: "recovery-cookie-private",
      buildCommit: "a".repeat(40),
      frozenProtocolHash: "b".repeat(64),
      reviewPackageHash: "c".repeat(64)
    };
    await saveScoredLocalRecovery(recovered, root);
    expect(await loadScoredLocalRecovery("baseline", root)).toEqual(recovered);
    expect(await readFile(artifactPath, "utf8")).not.toContain("recovery-cookie-private");

    await deleteScoredLocalRecovery("baseline", root);
    expect(await loadScoredLocalRecovery("baseline", root)).toBeNull();
  });

  it("fails closed on ciphertext tampering", async () => {
    const root = await mkdtemp(`${tmpdir()}/toolproof-scored-recovery-`);
    roots.push(root);
    await saveScoredLocalRecovery(state(), root);
    const artifactPath = path.join(root, ".toolproof-local/recovery/scored-baseline.json.enc");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
      ciphertext: string;
    };
    await writeFile(
      artifactPath,
      JSON.stringify({ ...artifact, ciphertext: `${artifact.ciphertext}A` })
    );
    await expect(loadScoredLocalRecovery("baseline", root)).rejects.toThrow(
      /scored_recovery_artifact_invalid/u
    );
  });
});
