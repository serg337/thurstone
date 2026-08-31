import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";
import {
  SUCCESSOR_EVAL_TARGET_CASE_ID,
  successorProtocolHash,
  successorScoredCase
} from "@/lib/successor-eval/contract";
import {
  decideSuccessorEvaluation,
  SuccessorEvalServiceError
} from "@/lib/successor-eval/service.server";
import {
  putSuccessorProviderReceipt,
  readSuccessorProviderReceipt
} from "@/lib/successor-eval/store.server";
import type { ScoredProviderKnownReceipt } from "@/lib/scored/openai-provider.server";

class StoreRedis {
  stored: string[] | null = null;

  async eval(_script: string, _keys: string[], args: string[]): Promise<unknown> {
    this.stored = [...args];
    return [1, "STORED"];
  }

  async evalRo(): Promise<unknown> {
    if (!this.stored) return [2, "MISSING"];
    return [1, "FOUND", this.stored[2], this.stored[3]];
  }
}

describe("successor evaluation boundary", () => {
  it("binds the exact residual case and current live manifest", async () => {
    const scoredCase = successorScoredCase(SUCCESSOR_EVAL_TARGET_CASE_ID);
    expect(scoredCase?.caseId).toBe("commitment_holdout_anchor");
    expect(scoredCase?.naturalLanguageRequest).toBe(
      "I’m still considering whether to move this cart to checkout."
    );
    const commit = "a".repeat(40);
    const manifest = await createCheckoutLiveManifest(createCheckoutFixture(), commit);
    await expect(
      successorProtocolHash({ appCommit: commit, liveManifest: manifest })
    ).resolves.toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.tools.find(({ name }) => name === "checkout_request")?.description).toMatch(
      /ask whether they want to proceed/iu
    );
  });

  it("fails closed while the operator lane is disabled or the capability is wrong", async () => {
    await expect(decideSuccessorEvaluation({})).rejects.toMatchObject({
      code: "successor_eval_disabled",
      status: 404
    });
    const capability = "A".repeat(43);
    await expect(
      decideSuccessorEvaluation(
        { capability, mode: "targeted", envelope: {} },
        {
          THURSTONE_SUCCESSOR_EVAL_MODE: "enabled",
          THURSTONE_SUCCESSOR_EVAL_CAPABILITY_HASH: createHash("sha256")
            .update("different")
            .digest("hex")
        }
      )
    ).rejects.toBeInstanceOf(SuccessorEvalServiceError);
  });

  it("stores provider material only as an encrypted permanent artifact", async () => {
    const redis = new StoreRedis();
    const artifactSecret = Buffer.alloc(32, 37).toString("base64url");
    const receipt = {
      version: "test",
      rawResponseBytes: "synthetic-provider-material"
    } as unknown as ScoredProviderKnownReceipt;
    const receiptKey = "b".repeat(64);
    await expect(
      putSuccessorProviderReceipt(redis, { receiptKey, receipt, artifactSecret })
    ).resolves.toBe("new");
    expect(redis.stored?.join(" ")).not.toContain("synthetic-provider-material");
    await expect(
      readSuccessorProviderReceipt(redis, { receiptKey, artifactSecret })
    ).resolves.toEqual(receipt);
  });
});
