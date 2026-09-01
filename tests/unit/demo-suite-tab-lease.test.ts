import { describe, expect, it } from "vitest";

import {
  THURSTONE_SUITE_TAB_LOCK_PREFIX,
  acquireThurstoneSuiteTabLease,
  type LockManagerLike
} from "@/lib/demo/suite-tab-lease";

class FakeLockManager implements LockManagerLike {
  private readonly held = new Set<string>();

  async request<T>(
    name: string,
    _options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: { readonly name: string } | null) => Promise<T> | T
  ): Promise<T> {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

const suiteId = "suite_11111111-1111-4111-8111-111111111111";

describe("contract-suite tab lease", () => {
  it("admits one live owner tab and rejects a concurrently cloned tab", async () => {
    const locks = new FakeLockManager();
    const owner = await acquireThurstoneSuiteTabLease(locks, suiteId);
    expect(owner).toMatchObject({
      status: "acquired",
      lockName: `${THURSTONE_SUITE_TAB_LOCK_PREFIX}${suiteId}`
    });

    await expect(acquireThurstoneSuiteTabLease(locks, suiteId)).resolves.toEqual({
      status: "conflict",
      recovery: "return_to_original_tab_or_close_it"
    });

    if (owner.status !== "acquired") throw new Error("Expected the owner lease.");
    owner.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const successor = await acquireThurstoneSuiteTabLease(locks, suiteId);
    expect(successor.status).toBe("acquired");
    if (successor.status === "acquired") successor.release();
  });

  it("fails closed when Web Locks are unavailable", async () => {
    await expect(acquireThurstoneSuiteTabLease(undefined, suiteId)).resolves.toEqual({
      status: "unavailable",
      recovery: "use_supported_browser_or_clear_cloned_suite"
    });
  });

  it("rejects an invalid suite identity before requesting a lock", async () => {
    await expect(
      acquireThurstoneSuiteTabLease(new FakeLockManager(), "suite_invalid")
    ).rejects.toThrow(/invalid/iu);
  });
});
