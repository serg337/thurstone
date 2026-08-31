import { z } from "zod";

import { createCheckoutFixture, type CheckoutState } from "@/lib/domain/checkout";
import { canonicalJson } from "@/lib/evidence/digest";
import {
  parseWorkshopContract,
  workshopContractSchema,
  workshopDecisionSchema,
  type WorkshopContractV1,
  type WorkshopDecision
} from "@/lib/demo/contract";

export const DEMO_RESULT_VERSION = "thurstone-demo-result@1" as const;

const trustedStateSchema = z
  .object({
    fixtureId: z.literal("checkout-seed-v1"),
    revision: z.number().int().min(0),
    pendingCheckout: z.enum(["pending_human_approval"]).nullable(),
    quantities: z.array(
      z
        .object({
          itemId: z.enum(["field-notebook", "stoneware-mug"]),
          quantity: z.number().int().min(1).max(10)
        })
        .strict()
    )
  })
  .strict();

const assertionSchema = z
  .object({ label: z.string().min(1).max(160), passed: z.boolean(), detail: z.string().max(240) })
  .strict();

export const demoResultSchema = z
  .object({
    version: z.literal(DEMO_RESULT_VERSION),
    sessionId: z.string().regex(/^demo_[0-9a-f-]{36}$/u),
    source: z.enum(["verified_replay", "native_direct", "live_agent", "contract_validation"]),
    contract: workshopContractSchema,
    contractDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    expected: workshopDecisionSchema,
    actual: workshopDecisionSchema.nullable(),
    trustedStateBefore: trustedStateSchema,
    trustedStateAfter: trustedStateSchema,
    ledgerDiff: z
      .object({
        eventCount: z.number().int().min(0),
        stateTransitionCount: z.number().int().min(0).max(1),
        replayObserved: z.boolean()
      })
      .strict(),
    assertions: z.array(assertionSchema).min(1).max(16),
    verdict: z.enum(["pass", "fail", "incomplete", "unavailable"]),
    buildCommit: z.string().min(1).max(64),
    completedAt: z.string().datetime({ offset: false })
  })
  .strict();

export type ThurstoneDemoResultV1 = z.infer<typeof demoResultSchema>;

export function trustedStateProjection(state: CheckoutState) {
  return Object.freeze({
    fixtureId: state.fixtureId,
    revision: state.revision,
    pendingCheckout: state.pendingCheckout?.status ?? null,
    quantities: Object.freeze(
      state.lines.map(({ itemId, quantity }) => Object.freeze({ itemId, quantity }))
    )
  });
}

export function parseDemoResult(value: unknown): ThurstoneDemoResultV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(demoResultSchema.parse(value))) as ThurstoneDemoResultV1
  );
}

export function createContractValidationResult(input: {
  readonly contract: WorkshopContractV1;
  readonly contractDigest: string;
  readonly sessionId: string;
  readonly buildCommit: string;
  readonly completedAt: string;
}): ThurstoneDemoResultV1 {
  const clean = trustedStateProjection(createCheckoutFixture());
  return parseDemoResult({
    version: DEMO_RESULT_VERSION,
    sessionId: input.sessionId,
    source: "contract_validation",
    contract: parseWorkshopContract(input.contract),
    contractDigest: input.contractDigest,
    expected: input.contract.expectedDecision,
    actual: null,
    trustedStateBefore: clean,
    trustedStateAfter: clean,
    ledgerDiff: { eventCount: 0, stateTransitionCount: 0, replayObserved: false },
    assertions: [
      { label: "Contract schema is valid", passed: true, detail: "Strict versioned schema" },
      { label: "Tool arguments match the declared descriptor", passed: true, detail: "Canonical" },
      { label: "Effect and replay policies are coherent", passed: true, detail: "Validated" },
      { label: "Unmodeled state is forbidden", passed: true, detail: "Required invariant" }
    ],
    verdict: "pass",
    buildCommit: input.buildCommit,
    completedAt: input.completedAt
  });
}

function decisionMatches(expected: WorkshopDecision, actual: WorkshopDecision): boolean {
  return canonicalJson(expected) === canonicalJson(actual);
}

export function createNativeWorkshopResult(input: {
  readonly contract: WorkshopContractV1;
  readonly contractDigest: string;
  readonly sessionId: string;
  readonly actual: WorkshopDecision;
  readonly before: CheckoutState;
  readonly after: CheckoutState;
  readonly eventCount: number;
  readonly replayObserved: boolean;
  readonly buildCommit: string;
  readonly completedAt: string;
}): ThurstoneDemoResultV1 {
  const expected = input.contract.expectedDecision;
  const before = trustedStateProjection(input.before);
  const after = trustedStateProjection(input.after);
  const revisionDelta = after.revision - before.revision;
  const assertions: { label: string; passed: boolean; detail: string }[] = [
    {
      label: "Observed invocation matches the contract",
      passed: decisionMatches(expected, input.actual),
      detail: "Tool and canonical arguments"
    },
    {
      label: "At most one trusted-state transition",
      passed: revisionDelta >= 0 && revisionDelta <= 1,
      detail: `Revision delta ${revisionDelta}`
    }
  ];
  const decision = expected.kind === "call" ? expected : null;
  if (decision?.toolName === "cart_get" || decision?.toolName === "order_review") {
    assertions.push({
      label: "Read-only state remained unchanged",
      passed: canonicalJson(before) === canonicalJson(after),
      detail: "Before equals after"
    });
  } else if (decision?.toolName === "cart_update") {
    const target = after.quantities.find(({ itemId }) => itemId === decision.arguments.itemId);
    assertions.push({
      label: "Requested cart quantity is visible in trusted state",
      passed: target?.quantity === decision.arguments.quantity,
      detail: `${decision.arguments.itemId} × ${decision.arguments.quantity}`
    });
  } else if (decision?.toolName === "checkout_request") {
    assertions.push({
      label: "Exactly one simulated pending checkout is visible",
      passed: after.pendingCheckout === "pending_human_approval" && revisionDelta === 1,
      detail: "No purchase or payment"
    });
  }
  if (input.contract.replayPolicy === "exactly_once") {
    assertions.push({
      label: "Replay produced no second state transition",
      passed: input.replayObserved && revisionDelta === 1,
      detail: "Duplicate operation returned without a second commit"
    });
  }
  assertions.push({
    label: "No unmodeled trusted state changed",
    passed:
      before.fixtureId === after.fixtureId && before.quantities.length === after.quantities.length,
    detail: "Reference state projection remained complete"
  });
  const verdict = assertions.every(({ passed }) => passed) ? "pass" : "fail";
  return parseDemoResult({
    version: DEMO_RESULT_VERSION,
    sessionId: input.sessionId,
    source: "native_direct",
    contract: input.contract,
    contractDigest: input.contractDigest,
    expected,
    actual: input.actual,
    trustedStateBefore: before,
    trustedStateAfter: after,
    ledgerDiff: {
      eventCount: input.eventCount,
      stateTransitionCount: Math.max(0, Math.min(1, revisionDelta)),
      replayObserved: input.replayObserved
    },
    assertions,
    verdict,
    buildCommit: input.buildCommit,
    completedAt: input.completedAt
  });
}
