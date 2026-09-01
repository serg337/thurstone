import { CHECKOUT_DOMAIN_VERSION, type CheckoutState } from "@/lib/domain/checkout";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import {
  BYOA_DEMO_TOOLSET_VERSION,
  BYOA_TOOL_NAMES,
  type ByoaContractV2,
  type ByoaToolDescriptorV1,
  type ByoaToolName
} from "@/lib/demo/contract-v2";
import type { AgentVisibleRunProjection } from "@/lib/demo/agent-projection";
import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  CheckoutTraceLedger,
  type CheckoutTraceLedgerSnapshot
} from "@/lib/evidence/checkout-trace-ledger";
import { createCheckoutTools } from "@/lib/webmcp/checkout-tools";
import { CHECKOUT_REQUEST_HANDLER_VERSION } from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_HANDLER_VERSION } from "@/lib/webmcp/order-review-tool";
import { webMcpRuntime } from "@/lib/webmcp/runtime";

export type ByoaInvocationDisposition = "in-flight" | "fulfilled" | "rejected";

export interface ByoaInvocationClaim {
  readonly claimId: string;
  readonly toolName: ByoaToolName;
  readonly rawInput: unknown;
  readonly claimedAt: string;
  readonly disposition: ByoaInvocationDisposition;
  readonly settledAt: string | null;
  readonly error: { readonly name: string; readonly message: string } | null;
}

export interface ByoaAdmissionSnapshot {
  readonly claim: ByoaInvocationClaim | null;
  readonly rejectedAdditionalAttempts: number;
}

function thrownSummary(error: unknown) {
  return error instanceof Error
    ? Object.freeze({ name: error.name, message: error.message })
    : Object.freeze({ name: "Error", message: "Unknown native handler error." });
}

export class ByoaInvocationGate {
  private claim: ByoaInvocationClaim | null = null;
  private rejectedAdditionalAttempts = 0;
  private readonly listeners = new Set<() => void>();

  snapshot = (): ByoaAdmissionSnapshot =>
    Object.freeze({
      claim: this.claim,
      rejectedAdditionalAttempts: this.rejectedAdditionalAttempts
    });

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  claimFirst(toolName: ByoaToolName, rawInput: unknown): ByoaInvocationClaim {
    if (this.claim) {
      this.rejectedAdditionalAttempts += 1;
      this.publish();
      throw new DOMException(
        "This Thurstone test already admitted its single native invocation.",
        "InvalidStateError"
      );
    }
    const claim = Object.freeze({
      claimId: `claim_${globalThis.crypto.randomUUID()}`,
      toolName,
      rawInput,
      claimedAt: new Date().toISOString(),
      disposition: "in-flight" as const,
      settledAt: null,
      error: null
    });
    this.claim = claim;
    this.publish();
    return claim;
  }

  settle(claimId: string, error?: unknown): void {
    if (!this.claim || this.claim.claimId !== claimId || this.claim.disposition !== "in-flight") {
      throw new Error("BYOA invocation settlement does not match the admitted first call.");
    }
    this.claim = Object.freeze({
      ...this.claim,
      disposition: error === undefined ? "fulfilled" : "rejected",
      settledAt: new Date().toISOString(),
      error: error === undefined ? null : thrownSummary(error)
    });
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface ByoaAgentEnvironment {
  readonly appCommit: string;
  readonly contract: ByoaContractV2 | null;
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly gate: ByoaInvocationGate;
  readonly tools: readonly WebMCP.ModelContextTool[];
  readonly initialState: CheckoutState;
  readonly initialLedger: CheckoutTraceLedgerSnapshot;
  readonly manifestHash: string;
}

function handlerVersion(name: ByoaToolName): string {
  return name === "order_review" ? ORDER_REVIEW_HANDLER_VERSION : CHECKOUT_REQUEST_HANDLER_VERSION;
}

function descriptorByName(
  descriptors: readonly ByoaToolDescriptorV1[],
  name: ByoaToolName
): ByoaToolDescriptorV1 {
  const descriptor = descriptors.find((candidate) => candidate.name === name);
  if (!descriptor) throw new Error(`Missing frozen BYOA descriptor: ${name}`);
  return descriptor;
}

export async function createByoaAgentEnvironment(
  contract: ByoaContractV2,
  appCommit: string
): Promise<ByoaAgentEnvironment> {
  return createByoaAgentEnvironmentFromDescriptors(contract.descriptors, appCommit, contract);
}

async function createByoaAgentEnvironmentFromDescriptors(
  descriptors: readonly ByoaToolDescriptorV1[],
  appCommit: string,
  contract: ByoaContractV2 | null
): Promise<ByoaAgentEnvironment> {
  const manifestHash = await canonicalSha256({
    toolsetVersion: BYOA_DEMO_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    appCommit,
    descriptors,
    handlerVersions: BYOA_TOOL_NAMES.map((name) => ({ name, version: handlerVersion(name) }))
  });
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => manifestHash,
    getArgumentMode: () => webMcpRuntime.argumentMode ?? "unverified",
    appCommit,
    toolsetVersion: BYOA_DEMO_TOOLSET_VERSION
  });
  const store = new CheckoutSessionStore({ traceSink: ledger });
  const canonical = createCheckoutTools(store);
  const gate = new ByoaInvocationGate();
  const tools = Object.freeze(
    BYOA_TOOL_NAMES.map((name) => {
      const descriptor = descriptorByName(descriptors, name);
      const source = canonical.byName[name];
      return Object.freeze({
        ...source,
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        annotations: {
          readOnlyHint: descriptor.annotations.readOnlyHint,
          ...(descriptor.annotations.untrustedContentHint === undefined
            ? {}
            : { untrustedContentHint: descriptor.annotations.untrustedContentHint })
        },
        execute: async (
          input: Record<string, unknown>,
          context?: { readonly signal?: AbortSignal }
        ) => {
          const claim = gate.claimFirst(name, input);
          try {
            const result = await source.execute(input, {
              signal: context?.signal ?? new AbortController().signal
            });
            gate.settle(claim.claimId);
            return result;
          } catch (error) {
            gate.settle(claim.claimId, error);
            throw error;
          }
        }
      } satisfies WebMCP.ModelContextTool);
    })
  );
  return Object.freeze({
    appCommit,
    contract,
    store,
    ledger,
    gate,
    tools,
    initialState: store.getSnapshot().state,
    initialLedger: ledger.snapshot(),
    manifestHash
  });
}

export async function createByoaAgentEnvironmentFromProjection(
  projection: AgentVisibleRunProjection,
  appCommit: string
): Promise<ByoaAgentEnvironment> {
  return createByoaAgentEnvironmentFromDescriptors(projection.descriptors, appCommit, null);
}
