export const THURSTONE_SUITE_TAB_LOCK_PREFIX = "thurstone:contract-suite-tab@1:" as const;

interface LockHandleLike {
  readonly name: string;
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: LockHandleLike | null) => Promise<T> | T
  ): Promise<T>;
}

export type ThurstoneSuiteTabLeaseResult =
  | Readonly<{
      status: "acquired";
      lockName: string;
      release: () => void;
    }>
  | Readonly<{
      status: "conflict";
      recovery: "return_to_original_tab_or_close_it";
    }>
  | Readonly<{
      status: "unavailable";
      recovery: "use_supported_browser_or_clear_cloned_suite";
    }>;

const suiteIdPattern =
  /^suite_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Claims one live tab as the owner of a browser-local contract suite.
 *
 * `sessionStorage` can be cloned by browser tab-duplication or an opener. A held Web Lock is
 * origin-wide and cannot be cloned, so a second live tab fails closed before it may edit, arm, or
 * export the inherited suite. The owner page must hold the returned lease until it unloads or
 * intentionally releases the suite. Fresh-agent links must additionally use `noopener` and never
 * read the owner-suite storage key.
 */
export async function acquireThurstoneSuiteTabLease(
  lockManager: LockManagerLike | null | undefined,
  suiteId: string
): Promise<ThurstoneSuiteTabLeaseResult> {
  if (!suiteIdPattern.test(suiteId)) throw new Error("Invalid Thurstone contract-suite identity.");
  if (lockManager === null || lockManager === undefined) {
    return Object.freeze({
      status: "unavailable" as const,
      recovery: "use_supported_browser_or_clear_cloned_suite" as const
    });
  }

  const lockName = `${THURSTONE_SUITE_TAB_LOCK_PREFIX}${suiteId}`;
  let releaseHold: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  let settleDecision: ((result: ThurstoneSuiteTabLeaseResult) => void) | undefined;
  let rejectDecision: ((error: unknown) => void) | undefined;
  const decision = new Promise<ThurstoneSuiteTabLeaseResult>((resolve, reject) => {
    settleDecision = resolve;
    rejectDecision = reject;
  });

  void lockManager
    .request(lockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (lock === null) {
        settleDecision?.(
          Object.freeze({
            status: "conflict" as const,
            recovery: "return_to_original_tab_or_close_it" as const
          })
        );
        return;
      }
      let released = false;
      settleDecision?.(
        Object.freeze({
          status: "acquired" as const,
          lockName,
          release: () => {
            if (released) return;
            released = true;
            releaseHold?.();
          }
        })
      );
      await hold;
    })
    .catch((error: unknown) => rejectDecision?.(error));

  return decision;
}
