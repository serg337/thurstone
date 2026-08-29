import type { JudgeDemoInvocationIntegrityTransition } from "@/lib/judge/collateral-proof";
import { verifyDirectObservationCriticalBlob } from "@/scripts/verify-direct-observation-presentation";
import { describe, expect, it } from "vitest";

const OBSERVATION_BLOB = "a".repeat(40);
const ACTIVE_BLOB = "b".repeat(40);

function transition(
  path: string,
  predecessorBlobOid = OBSERVATION_BLOB,
  successorBlobOid = ACTIVE_BLOB
): JudgeDemoInvocationIntegrityTransition {
  return {
    implementation: {
      treeChanges: [
        {
          path,
          status: "M",
          predecessorMode: "100644",
          successorMode: "100644",
          predecessorBlobOid,
          successorBlobOid
        }
      ]
    }
  } as unknown as JudgeDemoInvocationIntegrityTransition;
}

describe("Direct observation presentation critical blobs", () => {
  it("keeps historical equality strict when no verified v4 transition is supplied", () => {
    expect(
      verifyDirectObservationCriticalBlob({
        path: "lib/domain/checkout.ts",
        checkedOutBlobOid: OBSERVATION_BLOB,
        observationBlobOid: OBSERVATION_BLOB,
        activeBlobOid: OBSERVATION_BLOB,
        invocationIntegrityTransition: null
      })
    ).toBe("unchanged-observation-blob");
    expect(() =>
      verifyDirectObservationCriticalBlob({
        path: "lib/domain/checkout.ts",
        checkedOutBlobOid: ACTIVE_BLOB,
        observationBlobOid: OBSERVATION_BLOB,
        activeBlobOid: ACTIVE_BLOB,
        invocationIntegrityTransition: null
      })
    ).toThrow("direct_observation_critical_git_blob_mismatch:lib/domain/checkout.ts");
  });

  it.each(["lib/domain/checkout-schemas.ts", "lib/domain/checkout.ts"])(
    "accepts only an exact verified invocation-integrity blob transition for %s",
    (path) => {
      expect(
        verifyDirectObservationCriticalBlob({
          path,
          checkedOutBlobOid: ACTIVE_BLOB,
          observationBlobOid: OBSERVATION_BLOB,
          activeBlobOid: ACTIVE_BLOB,
          invocationIntegrityTransition: transition(path)
        })
      ).toBe("verified-invocation-integrity-transition");
      expect(() =>
        verifyDirectObservationCriticalBlob({
          path,
          checkedOutBlobOid: ACTIVE_BLOB,
          observationBlobOid: OBSERVATION_BLOB,
          activeBlobOid: ACTIVE_BLOB,
          invocationIntegrityTransition: transition(path, "c".repeat(40), ACTIVE_BLOB)
        })
      ).toThrow(`direct_observation_critical_git_blob_mismatch:${path}`);
    }
  );

  it("does not extend the exception to another critical file or a dirty worktree", () => {
    const path = "lib/domain/checkout-session.ts";
    expect(() =>
      verifyDirectObservationCriticalBlob({
        path,
        checkedOutBlobOid: ACTIVE_BLOB,
        observationBlobOid: OBSERVATION_BLOB,
        activeBlobOid: ACTIVE_BLOB,
        invocationIntegrityTransition: transition(path)
      })
    ).toThrow(`direct_observation_critical_git_blob_mismatch:${path}`);
    expect(() =>
      verifyDirectObservationCriticalBlob({
        path: "lib/domain/checkout.ts",
        checkedOutBlobOid: "c".repeat(40),
        observationBlobOid: OBSERVATION_BLOB,
        activeBlobOid: ACTIVE_BLOB,
        invocationIntegrityTransition: transition("lib/domain/checkout.ts")
      })
    ).toThrow("direct_observation_critical_git_blob_mismatch:lib/domain/checkout.ts");
  });
});
