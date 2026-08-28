import { canonicalSha256 } from "@/lib/evidence/digest";
import { buildGate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_FREEZE_STORE_SCRIPTS,
  createGate3FreezeKeyspace,
  putGate3Freeze,
  readGate3Freeze,
  verifyStoredGate3FreezePayload,
  type Gate3FreezeRedisClient
} from "@/lib/semantic/freeze-store.server";
import {
  GATE3_AUTHORING_TERMINATION_VERSION,
  GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
  finalizeGate3HumanFreeze
} from "@/lib/semantic/human-freeze.server";
import { describe, expect, it } from "vitest";

const SECRET = Buffer.alloc(32, 23).toString("base64url");
const KEYSPACE = createGate3FreezeKeyspace("tp:{webmcp26}:semantic-freeze:gate3:unit");

class MemoryFreezeRedis implements Gate3FreezeRedisClient {
  readonly record: Record<string, string> = {};

  async eval(script: string, _keys: string[], args: string[]): Promise<unknown> {
    if (script !== GATE3_FREEZE_STORE_SCRIPTS.put) throw new Error("unexpected write");
    if (this.record.version) {
      return this.record.review_package_hash === args[1] &&
        this.record.frozen_protocol_hash === args[2] &&
        this.record.payload_digest === args[3]
        ? [2, "EXISTING", this.record.stored_at_ms]
        : [0, "GATE3_FREEZE_CONFLICT"];
    }
    Object.assign(this.record, {
      version: args[0],
      status: "frozen",
      review_package_hash: args[1],
      frozen_protocol_hash: args[2],
      payload_digest: args[3],
      token: args[4],
      stored_at_ms: "1787950000000"
    });
    return [1, "STORED", this.record.stored_at_ms];
  }

  async evalRo(script: string, _keys: string[], args: string[]): Promise<unknown> {
    if (script !== GATE3_FREEZE_STORE_SCRIPTS.read) throw new Error("unexpected read");
    if (!this.record.version) return [2, "MISSING"];
    if (this.record.frozen_protocol_hash !== args[1]) return [0, "GATE3_FREEZE_MISMATCH"];
    return [
      1,
      "FOUND",
      this.record.review_package_hash,
      this.record.payload_digest,
      this.record.token,
      this.record.stored_at_ms
    ];
  }
}

async function artifacts() {
  const review = await buildGate3HumanReviewPackage({
    source: {
      repositoryCommit: "a".repeat(40),
      contractSourceSha256: "1".repeat(64),
      casesSourceSha256: "2".repeat(64),
      fixtureSourceSha256: "3".repeat(64),
      manifestSourceSha256: "4".repeat(64),
      runnerSourceSha256: "5".repeat(64),
      evaluatorSourceSha256: "6".repeat(64)
    },
    canonicalizerSourceSha256: "7".repeat(64)
  });
  const humanReviewReceipt = {
    version: GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
    receiptId: `review_${"r".repeat(22)}`,
    reviewer: "Sergio Valencia",
    authority: "human-semantic-authority",
    decision: "approved",
    channel: "sergio-explicit-user-message",
    reviewPackageHash: review.packageHash,
    freezeHash: review.freezeHash,
    reviewedAt: "2026-08-28T22:00:00.000Z",
    approvalText: "Synthetic unit-test approval only.",
    notes: "Not a real approval."
  };
  const authoringTermination = {
    version: GATE3_AUTHORING_TERMINATION_VERSION,
    contextId: "/root/gate3_authoring_builder",
    status: "terminated",
    reviewPackageHash: review.packageHash,
    completedBeforeApproval: true,
    contextCannotResumeForRepair: true,
    holdoutSeenDuringAuthoring: true,
    terminatedAt: "2026-08-28T21:00:00.000Z",
    evidenceNote: "Synthetic unit-test termination only."
  };
  return {
    review,
    frozen: await finalizeGate3HumanFreeze({
      reviewPackage: review,
      humanReviewReceipt,
      authoringTermination
    })
  };
}

describe("permanent Gate 3 freeze store", () => {
  it("encrypts, idempotently stores, and reconstructs the exact reviewed freeze", async () => {
    const redis = new MemoryFreezeRedis();
    const { review, frozen } = await artifacts();
    const first = await putGate3Freeze(
      redis,
      { reviewPackage: review, frozenProtocol: frozen, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(first.disposition).toBe("new");
    await expect(
      verifyStoredGate3FreezePayload({ reviewPackage: review, frozenProtocol: frozen })
    ).resolves.toMatchObject({
      reviewPackage: { packageHash: review.packageHash },
      frozenProtocol: { frozenProtocolHash: frozen.frozenProtocolHash }
    });
    await expect(
      verifyStoredGate3FreezePayload({
        reviewPackage: { ...review, status: "tampered" },
        frozenProtocol: frozen
      })
    ).rejects.toThrow(/GATE3_STORED_REVIEW_MISMATCH/u);
    const rehashedDriftPayload = {
      ...review,
      contract: { ...review.contract, taskBoundary: `${review.contract.taskBoundary} drift` }
    };
    const { packageHash: _ignored, ...rehashedDriftWithoutHash } = rehashedDriftPayload;
    void _ignored;
    await expect(
      verifyStoredGate3FreezePayload({
        reviewPackage: {
          ...rehashedDriftWithoutHash,
          packageHash: await canonicalSha256(rehashedDriftWithoutHash)
        },
        frozenProtocol: frozen
      })
    ).rejects.toThrow(/GATE3_STORED_REVIEW_MISMATCH/u);
    expect(redis.record.token).not.toContain(review.suite.scoredCases[0]!.naturalLanguageRequest);
    expect(
      (
        await putGate3Freeze(
          redis,
          { reviewPackage: review, frozenProtocol: frozen, artifactSecret: SECRET },
          KEYSPACE
        )
      ).disposition
    ).toBe("existing");
    const recovered = await readGate3Freeze(
      redis,
      { frozenProtocolHash: frozen.frozenProtocolHash, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(recovered?.reviewPackage.packageHash).toBe(review.packageHash);
    expect(recovered?.frozenProtocol.frozenProtocolHash).toBe(frozen.frozenProtocolHash);

    redis.record.token = `${redis.record.token}tamper`;
    await expect(
      readGate3Freeze(
        redis,
        { frozenProtocolHash: frozen.frozenProtocolHash, artifactSecret: SECRET },
        KEYSPACE
      )
    ).rejects.toThrow(/GATE3_FREEZE_ARTIFACT_INVALID/u);
  });
});
