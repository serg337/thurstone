import { resolveDeploymentCommit } from "@/lib/deployment/commit";
import { describe, expect, it } from "vitest";

describe("deployment commit identity", () => {
  it("prefers the immutable host SHA over a stale configured fallback", () => {
    expect(
      resolveDeploymentCommit({
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        TOOLPROOF_COMMIT_SHA: "b".repeat(40)
      })
    ).toBe("a".repeat(40));
  });

  it("uses a valid configured SHA only outside a host-bound deployment", () => {
    expect(resolveDeploymentCommit({ TOOLPROOF_COMMIT_SHA: "b".repeat(40) })).toBe("b".repeat(40));
    expect(resolveDeploymentCommit({ VERCEL_GIT_COMMIT_SHA: "invalid" })).toBe("unversioned");
  });
});
