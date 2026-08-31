import {
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
  type JudgeDemoInvocationIntegrityEvidenceTransition,
  type JudgeDemoInvocationIntegrityTransition
} from "@/lib/judge/collateral-proof";
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

function impactExecutionFinalization(withRepair = false, withAlias = false) {
  const value = {
    protocol: {
      predecessorCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
      successorCommit: "c".repeat(40),
      successorTree: "d".repeat(40)
    },
    presentation: {
      predecessorCommit: "c".repeat(40),
      predecessorTree: "d".repeat(40),
      successorCommit: withRepair
        ? JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT
        : "e".repeat(40),
      successorTree: withRepair
        ? JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE
        : "f".repeat(40),
      frozenLabClientPath: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
      frozenLabClientBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
      frozenLabClientSha256: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256
    },
    ...(withRepair
      ? {
          ciTimeoutRepair: {
            successorCommit: "1".repeat(40)
          }
        }
      : {}),
    ...(withAlias
      ? {
          originAliasCommits: ["2".repeat(40), "3".repeat(40)]
        }
      : {})
  } as unknown as NonNullable<
    NonNullable<
      JudgeDemoInvocationIntegrityEvidenceTransition["terminalFinalization"]
    >["impactExecutionFinalization"]
  >;
  return value;
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

  it("accepts only the exact Lab-client delta bound by Impact/Execution finalization", () => {
    expect(
      verifyDirectObservationCriticalBlob({
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "e".repeat(40),
        checkedOutBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        observationBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        invocationIntegrityTransition: null,
        impactExecutionFinalization: impactExecutionFinalization()
      })
    ).toBe("verified-impact-execution-transition");

    expect(
      verifyDirectObservationCriticalBlob({
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "2".repeat(40),
        checkedOutBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        observationBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        invocationIntegrityTransition: null,
        impactExecutionFinalization: impactExecutionFinalization(true, true)
      })
    ).toBe("verified-impact-execution-transition");

    expect(
      verifyDirectObservationCriticalBlob({
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "1".repeat(40),
        checkedOutBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        observationBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        invocationIntegrityTransition: null,
        impactExecutionFinalization: impactExecutionFinalization(true)
      })
    ).toBe("verified-impact-execution-transition");

    const wrongRepair = structuredClone(impactExecutionFinalization(true));
    if (!wrongRepair.ciTimeoutRepair) throw new Error("test_ci_timeout_repair_missing");
    wrongRepair.ciTimeoutRepair.successorCommit = "0".repeat(40) as never;
    expect(() =>
      verifyDirectObservationCriticalBlob({
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "1".repeat(40),
        checkedOutBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        observationBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        invocationIntegrityTransition: null,
        impactExecutionFinalization: wrongRepair
      })
    ).toThrow(
      `direct_observation_critical_git_blob_mismatch:${JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH}`
    );

    const wrongFrozenPath = structuredClone(impactExecutionFinalization());
    wrongFrozenPath.presentation.frozenLabClientPath = "components/lab/other.tsx" as never;
    const wrongPredecessor = structuredClone(impactExecutionFinalization());
    wrongPredecessor.protocol.predecessorCommit = "0".repeat(40) as never;
    for (const candidate of [
      {
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "e".repeat(40),
        activeBlobOid: "f".repeat(40),
        impactExecutionFinalization: impactExecutionFinalization()
      },
      {
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "e".repeat(40),
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        impactExecutionFinalization: null
      },
      {
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "0".repeat(40),
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        impactExecutionFinalization: impactExecutionFinalization()
      },
      {
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "e".repeat(40),
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        impactExecutionFinalization: wrongFrozenPath
      },
      {
        path: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        activeCommit: "e".repeat(40),
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        impactExecutionFinalization: wrongPredecessor
      },
      {
        path: "lib/domain/checkout-session.ts",
        activeCommit: "e".repeat(40),
        activeBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
        impactExecutionFinalization: impactExecutionFinalization()
      }
    ]) {
      expect(() =>
        verifyDirectObservationCriticalBlob({
          path: candidate.path,
          activeCommit: candidate.activeCommit,
          checkedOutBlobOid: candidate.activeBlobOid,
          observationBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
          activeBlobOid: candidate.activeBlobOid,
          invocationIntegrityTransition: null,
          impactExecutionFinalization: candidate.impactExecutionFinalization
        })
      ).toThrow(`direct_observation_critical_git_blob_mismatch:${candidate.path}`);
    }
  });
});
