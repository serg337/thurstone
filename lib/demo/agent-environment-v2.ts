import {
  CHECKOUT_DOMAIN_VERSION,
  createCheckoutFixture,
  type CheckoutState
} from "@/lib/domain/checkout";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import {
  createThurstoneDemoCatalogSnapshot,
  parseThurstoneDemoCatalogSnapshot,
  thurstoneDemoCatalogDigest,
  type ThurstoneDemoCatalogSnapshotV1
} from "@/lib/demo/catalog-snapshot";
import {
  parseAgentVisibleRunProjectionV2,
  type AgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  BYOA_DEMO_TOOLSET_V2_VERSION,
  parseByoaContractV3,
  type ByoaContractV3
} from "@/lib/demo/contract-v3";
import {
  THURSTONE_DEMO_TOOLSET_VERSION,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  CheckoutTraceLedger,
  type CheckoutTraceLedgerSnapshot
} from "@/lib/evidence/checkout-trace-ledger";
import { createCheckoutTools } from "@/lib/webmcp/checkout-tools";
import { webMcpRuntime } from "@/lib/webmcp/runtime";

export type ByoaInvocationDispositionV2 = "in-flight" | "fulfilled" | "rejected";

export interface ByoaInvocationClaimV2 {
  readonly claimId: string;
  readonly toolName: ThurstoneDemoSelectableToolName;
  readonly rawInput: unknown;
  readonly claimedAt: string;
  readonly disposition: ByoaInvocationDispositionV2;
  readonly settledAt: string | null;
  readonly error: { readonly name: string; readonly message: string } | null;
}

export interface ByoaAdmissionSnapshotV2 {
  readonly claim: ByoaInvocationClaimV2 | null;
  readonly rejectedAdditionalAttempts: number;
}

function thrownSummary(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return Object.freeze({ name: error.name, message: error.message });
  }
  return Object.freeze({ name: "Error", message: "Unknown native handler error." });
}

/** A synchronous, catalog-wide admission gate for the selected live case. */
export class ByoaInvocationGateV2 {
  private claim: ByoaInvocationClaimV2 | null = null;
  private rejectedAdditionalAttempts = 0;
  private active = true;
  private readonly listeners = new Set<() => void>();

  snapshot = (): ByoaAdmissionSnapshotV2 =>
    Object.freeze({
      claim: this.claim,
      rejectedAdditionalAttempts: this.rejectedAdditionalAttempts
    });

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  claimFirst(toolName: ThurstoneDemoSelectableToolName, rawInput: unknown): ByoaInvocationClaimV2 {
    if (!this.active) {
      throw new DOMException(
        "This Thurstone journey is between verified steps.",
        "InvalidStateError"
      );
    }
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

  deactivate(): void {
    this.active = false;
  }

  beginNextStep(): void {
    if (this.active || this.claim?.disposition === "in-flight") {
      throw new Error("The prior journey step has not reached a terminal boundary.");
    }
    this.claim = null;
    this.rejectedAdditionalAttempts = 0;
    this.active = true;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface ByoaAgentEnvironmentManifestV2 {
  readonly version: "thurstone-byoa-agent-environment-manifest@2";
  readonly toolsetVersion: typeof BYOA_DEMO_TOOLSET_V2_VERSION;
  readonly catalogToolsetVersion: typeof THURSTONE_DEMO_TOOLSET_VERSION;
  readonly domainVersion: typeof CHECKOUT_DOMAIN_VERSION;
  readonly appCommit: string;
  readonly catalogDigest: string;
  readonly fixtureId: ThurstoneDemoCatalogSnapshotV1["fixtureId"];
  readonly trustedStateSource: ThurstoneDemoCatalogSnapshotV1["trustedStateSource"];
  readonly tools: ThurstoneDemoCatalogSnapshotV1["tools"];
  readonly handlerVersions: readonly {
    readonly name: ThurstoneDemoSelectableToolName;
    readonly version: string;
  }[];
}

export interface ByoaAgentEnvironmentV2 {
  readonly appCommit: string;
  readonly contract: ByoaContractV3 | null;
  readonly projection: AgentVisibleRunProjectionV2 | null;
  readonly catalogSnapshot: ThurstoneDemoCatalogSnapshotV1;
  readonly catalogDigest: string;
  readonly manifest: ByoaAgentEnvironmentManifestV2;
  readonly manifestHash: string;
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly gate: ByoaInvocationGateV2;
  readonly tools: readonly WebMCP.ModelContextTool[];
  readonly initialState: CheckoutState;
  readonly initialLedger: CheckoutTraceLedgerSnapshot;
  readonly initialOperationCount: number;
}

function assertBuildCommit(appCommit: string, frozenBuildCommit: string): void {
  if (!/^[a-f0-9]{40}$/u.test(appCommit) || appCommit !== frozenBuildCommit) {
    throw new Error("The BYOA environment build must match the frozen 40-character commit.");
  }
}

function assertCanonicalSource(
  source: WebMCP.ModelContextTool,
  descriptor: ThurstoneDemoCatalogSnapshotV1["tools"][number]
): void {
  if (
    source.name !== descriptor.name ||
    canonicalJson(source.inputSchema) !== canonicalJson(descriptor.inputSchema) ||
    canonicalJson(source.annotations) !== canonicalJson(descriptor.annotations)
  ) {
    throw new Error(
      `The selected ${descriptor.name} tool does not match its real handler contract.`
    );
  }
}

async function createEnvironment(
  catalogValue: unknown,
  expectedCatalogDigest: string,
  appCommit: string,
  contract: ByoaContractV3 | null,
  projection: AgentVisibleRunProjectionV2 | null,
  carried?: Pick<ByoaAgentEnvironmentV2, "store" | "ledger">
): Promise<ByoaAgentEnvironmentV2> {
  const catalogSnapshot = parseThurstoneDemoCatalogSnapshot(catalogValue);
  const catalogDigest = await thurstoneDemoCatalogDigest(catalogSnapshot);
  if (catalogDigest !== expectedCatalogDigest) {
    throw new Error("The BYOA environment catalog digest does not match its frozen snapshot.");
  }

  const manifest = Object.freeze({
    version: "thurstone-byoa-agent-environment-manifest@2" as const,
    toolsetVersion: BYOA_DEMO_TOOLSET_V2_VERSION,
    catalogToolsetVersion: THURSTONE_DEMO_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    appCommit,
    catalogDigest,
    fixtureId: catalogSnapshot.fixtureId,
    trustedStateSource: catalogSnapshot.trustedStateSource,
    tools: catalogSnapshot.tools,
    handlerVersions: Object.freeze(
      catalogSnapshot.tools.map(({ name, handlerVersion }) =>
        Object.freeze({ name, version: handlerVersion })
      )
    )
  }) satisfies ByoaAgentEnvironmentManifestV2;
  const manifestHash = await canonicalSha256(manifest);
  const ledger =
    carried?.ledger ??
    new CheckoutTraceLedger({
      getRegistryHash: () => manifestHash,
      getArgumentMode: () => webMcpRuntime.argumentMode ?? "unverified",
      appCommit,
      toolsetVersion: BYOA_DEMO_TOOLSET_V2_VERSION
    });
  const store = carried?.store ?? new CheckoutSessionStore({ traceSink: ledger });
  const canonical = createCheckoutTools(store);
  const gate = new ByoaInvocationGateV2();
  const tools = Object.freeze(
    catalogSnapshot.tools.map((descriptor) => {
      const source = canonical.byName[descriptor.name];
      assertCanonicalSource(source, descriptor);
      return Object.freeze({
        ...source,
        title: descriptor.title,
        description: descriptor.description,
        execute: async (
          input: Record<string, unknown>,
          context?: { readonly signal?: AbortSignal }
        ) => {
          const claim = gate.claimFirst(descriptor.name, input);
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
    projection,
    catalogSnapshot,
    catalogDigest,
    manifest,
    manifestHash,
    store,
    ledger,
    gate,
    tools,
    initialState: store.getSnapshot().state,
    initialLedger: ledger.snapshot(),
    initialOperationCount: store.inspect().currentOperationCount
  });
}

export async function createByoaAgentEnvironmentV2(
  value: unknown,
  appCommit: string
): Promise<ByoaAgentEnvironmentV2> {
  const contract = parseByoaContractV3(value);
  assertBuildCommit(appCommit, contract.buildCommit);
  return createEnvironment(
    contract.catalogSnapshot,
    contract.catalogDigest,
    appCommit,
    contract,
    null
  );
}

export async function createByoaAgentEnvironmentV2FromProjection(
  value: unknown,
  appCommit: string
): Promise<ByoaAgentEnvironmentV2> {
  const projection = parseAgentVisibleRunProjectionV2(value);
  assertBuildCommit(appCommit, projection.buildCommit);
  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
    selectedToolNames: projection.descriptors.map(({ name }) => name),
    descriptorOverrides: Object.fromEntries(
      projection.descriptors.map(({ name, title, description }) => [name, { title, description }])
    )
  });
  return createEnvironment(catalogSnapshot, projection.catalogDigest, appCommit, null, projection);
}

export async function createCarriedByoaAgentEnvironmentV2FromProjection(
  value: unknown,
  appCommit: string,
  prior: ByoaAgentEnvironmentV2
): Promise<ByoaAgentEnvironmentV2> {
  const projection = parseAgentVisibleRunProjectionV2(value);
  assertBuildCommit(appCommit, projection.buildCommit);
  if (prior.appCommit !== appCommit || prior.catalogDigest !== projection.catalogDigest) {
    throw new Error("A continuous journey cannot change build or catalog between steps.");
  }
  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
    selectedToolNames: projection.descriptors.map(({ name }) => name),
    descriptorOverrides: Object.fromEntries(
      projection.descriptors.map(({ name, title, description }) => [name, { title, description }])
    )
  });
  if (canonicalJson(catalogSnapshot.tools) !== canonicalJson(prior.catalogSnapshot.tools)) {
    throw new Error("A continuous journey cannot replace its live tool descriptors.");
  }
  return Object.freeze({
    ...prior,
    projection,
    initialState: prior.store.getSnapshot().state,
    initialLedger: prior.ledger.snapshot(),
    initialOperationCount: prior.store.inspect().currentOperationCount
  });
}

export async function createResetByoaAgentEnvironmentV2FromProjection(
  value: unknown,
  appCommit: string,
  prior: ByoaAgentEnvironmentV2
): Promise<ByoaAgentEnvironmentV2> {
  const compatible = await createCarriedByoaAgentEnvironmentV2FromProjection(
    value,
    appCommit,
    prior
  );
  await prior.store.hardReset();
  const state = prior.store.getSnapshot().state;
  if (canonicalJson(state) !== canonicalJson(createCheckoutFixture())) {
    throw new Error("A regression case could not restore the exact clean fixture.");
  }
  return Object.freeze({
    ...compatible,
    initialState: state,
    initialLedger: prior.ledger.snapshot(),
    initialOperationCount: prior.store.inspect().currentOperationCount
  });
}
