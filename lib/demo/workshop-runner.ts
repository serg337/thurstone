import { cartGet, type CheckoutState } from "@/lib/domain/checkout";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { type WorkshopContractV1 } from "@/lib/demo/contract";
import { createNativeWorkshopResult, type ThurstoneDemoResultV1 } from "@/lib/demo/result";
import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  CheckoutTraceLedger,
  type CheckoutTraceLedgerSnapshot
} from "@/lib/evidence/checkout-trace-ledger";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import { INITIAL_CHECKOUT_TOOL_NAMES, PENDING_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";
import { createCheckoutTools, type CheckoutToolSet } from "@/lib/webmcp/checkout-tools";
import {
  createRegistryReadinessReceipt,
  type RegistryReadinessReceipt
} from "@/lib/webmcp/readiness";
import { webMcpRegistryManager } from "@/lib/webmcp/registry-manager";
import {
  webMcpRuntime,
  type ExecuteTraceObservation,
  type RuntimeModelContext,
  type RuntimeObservation
} from "@/lib/webmcp/runtime";

export interface WorkshopEnvironment {
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly tools: CheckoutToolSet;
  readonly getRegistryHash: () => string;
  readonly setRegistryHash: (value: string) => void;
}

function latestTrace(snapshot: CheckoutTraceLedgerSnapshot): OperationTrace | null {
  return snapshot.current.at(-1) ?? snapshot.resetTraces.at(-1) ?? null;
}

export function createWorkshopEnvironment(appCommit: string): WorkshopEnvironment {
  let registryHash = "registry-unverified";
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => webMcpRuntime.argumentMode ?? "unverified",
    appCommit
  });
  const store = new CheckoutSessionStore({ traceSink: ledger });
  return Object.freeze({
    store,
    ledger,
    tools: createCheckoutTools(store),
    getRegistryHash: () => registryHash,
    setRegistryHash: (value: string) => {
      registryHash = value;
    }
  });
}

export function workshopExpectedNames(state: CheckoutState): readonly string[] {
  return state.pendingCheckout ? PENDING_CHECKOUT_TOOL_NAMES : INITIAL_CHECKOUT_TOOL_NAMES;
}

export function sameWorkshopNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

async function executionObservation(
  environment: WorkshopEnvironment
): Promise<ExecuteTraceObservation> {
  const snapshot = environment.ledger.snapshot();
  const trace = latestTrace(snapshot);
  return {
    stateHash: await canonicalSha256(environment.store.getSnapshot().state),
    handlerTraceCount: snapshot.totalTraceCount,
    lastTrace: trace
      ? {
          eventId: trace.eventId,
          source: trace.source,
          toolName: trace.toolName,
          status: trace.status,
          registryHash: trace.registryHash,
          resultDigest: trace.canonicalResult?.sha256 ?? null,
          effectDigest: await canonicalSha256(trace.effect),
          stateBeforeDigest: trace.stateBefore.sha256,
          stateAfterDigest: trace.stateAfter.sha256
        }
      : null
  };
}

export async function prepareWorkshopReadiness(input: {
  readonly context: WebMCP.ModelContext;
  readonly environment: WorkshopEnvironment;
  readonly appCommit: string;
  readonly generation: number;
}): Promise<RegistryReadinessReceipt> {
  const state = input.environment.store.getSnapshot().state;
  let receipt = await createRegistryReadinessReceipt(input.context, {
    state,
    appCommit: input.appCommit,
    registrationGeneration: input.generation,
    ...(webMcpRuntime.compatibilityReceipt
      ? { compatibilityReceipt: webMcpRuntime.compatibilityReceipt }
      : {})
  });
  input.environment.setRegistryHash(receipt.manifestHash);
  const consumer = input.context as RuntimeModelContext;
  if (
    !webMcpRuntime.compatibilityReceipt &&
    receipt.status === "consumer-discovered" &&
    receipt.runtimeCatalog &&
    typeof consumer.executeTool === "function"
  ) {
    const cartTool = receipt.runtimeCatalog.tools.find(({ name }) => name === "cart_get");
    if (!cartTool) throw new Error("The Workshop catalog has no cart_get compatibility tool.");
    const observe = async (): Promise<RuntimeObservation> => {
      const stateNow = input.environment.store.getSnapshot().state;
      const live = await createRegistryReadinessReceipt(input.context, {
        state: stateNow,
        appCommit: input.appCommit,
        registrationGeneration: input.generation
      });
      const traceSnapshot = input.environment.ledger.snapshot();
      const trace = latestTrace(traceSnapshot);
      const effectDigest = trace ? await canonicalSha256(trace.effect) : undefined;
      return {
        stateHash: await canonicalSha256(stateNow),
        manifestHash: live.manifestHash,
        handlerTraceCount: traceSnapshot.totalTraceCount,
        ...(trace ? { lastHandlerTraceId: trace.eventId } : {}),
        ...(effectDigest ? { lastEffectDigest: effectDigest } : {}),
        ...(trace
          ? {
              lastTrace: {
                eventId: trace.eventId,
                source: trace.source,
                toolName: trace.toolName,
                status: trace.status,
                registryHash: trace.registryHash,
                resultDigest: trace.canonicalResult?.sha256 ?? null,
                effectDigest: effectDigest as string,
                stateBeforeDigest: trace.stateBefore.sha256,
                stateAfterDigest: trace.stateAfter.sha256
              }
            }
          : {})
      };
    };
    const compatibility = await webMcpRuntime.initializeWithCartGet({
      context: consumer,
      catalog: receipt.runtimeCatalog,
      cartTool,
      expectedCartResult: cartGet(state),
      observe
    });
    receipt = await createRegistryReadinessReceipt(input.context, {
      state: input.environment.store.getSnapshot().state,
      appCommit: input.appCommit,
      registrationGeneration: input.generation,
      compatibilityReceipt: compatibility
    });
  }
  if (
    receipt.runtimeCatalog &&
    receipt.compatibilityBinding === "verified" &&
    webMcpRuntime.compatibilityReceipt
  ) {
    webMcpRuntime.verifyRegistry(receipt.runtimeCatalog);
  }
  input.environment.setRegistryHash(receipt.manifestHash);
  return receipt;
}

export async function runNativeWorkshopContract(input: {
  readonly environment: WorkshopEnvironment;
  readonly readiness: RegistryReadinessReceipt;
  readonly contract: WorkshopContractV1;
  readonly contractDigest: string;
  readonly sessionId: string;
  readonly buildCommit: string;
  readonly completedAt: string;
}): Promise<ThurstoneDemoResultV1> {
  const decision = input.contract.expectedDecision;
  if (decision.kind !== "call") throw new Error("Native execution requires a call contract.");
  if (
    input.readiness.status !== "consumer-ready" ||
    !input.readiness.runtimeCatalog ||
    input.readiness.compatibilityBinding !== "verified"
  ) {
    throw new Error("Native WebMCP is not consumer-ready for this Workshop document.");
  }
  const tool = input.readiness.runtimeCatalog.tools.find(({ name }) => name === decision.toolName);
  if (!tool)
    throw new Error(`${decision.toolName} is not present in the verified Workshop catalog.`);
  const before = input.environment.store.getSnapshot().state;
  const traceCountBefore = input.environment.ledger.snapshot().totalTraceCount;
  const release = webMcpRegistryManager.holdConsumerCall(
    decision.toolName,
    input.readiness.runtimeCatalog.generation
  );
  let replayObserved = false;
  try {
    await webMcpRuntime.executeOnce({
      executionId: `workshop_${globalThis.crypto.randomUUID()}`,
      manifestHash: input.readiness.manifestHash,
      tool,
      input: decision.arguments,
      observe: () => executionObservation(input.environment)
    });
    if (input.contract.replayPolicy === "exactly_once") {
      const replay = await webMcpRuntime.executeOnce({
        executionId: `workshop_replay_${globalThis.crypto.randomUUID()}`,
        manifestHash: input.readiness.manifestHash,
        tool,
        input: decision.arguments,
        observe: () => executionObservation(input.environment)
      });
      replayObserved =
        typeof replay.canonicalResult === "object" &&
        replay.canonicalResult !== null &&
        (replay.canonicalResult as Record<string, unknown>).replayed === true;
    }
  } finally {
    release();
  }
  const after = input.environment.store.getSnapshot().state;
  const eventCount = input.environment.ledger.snapshot().totalTraceCount - traceCountBefore;
  return createNativeWorkshopResult({
    contract: input.contract,
    contractDigest: input.contractDigest,
    sessionId: input.sessionId,
    actual: decision,
    before,
    after,
    eventCount,
    replayObserved,
    buildCommit: input.buildCommit,
    completedAt: input.completedAt
  });
}
