import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_DOMAIN_VERSION,
  cartGet,
  createCheckoutFixture,
  type CheckoutState
} from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { checkoutEffectDiff } from "@/lib/evidence/operation-trace";
import {
  CHECKOUT_TOOLSET_VERSION,
  checkoutToolContractSnapshot,
  type CheckoutCatalogState,
  type CheckoutToolName,
  type SerializableToolMetadata
} from "@/lib/webmcp/catalog";
import type {
  ExecuteArgumentMode,
  RuntimeCatalogSnapshot,
  RuntimeCompatibilityReceipt
} from "@/lib/webmcp/runtime";

export type RegistryReadinessStatus =
  "provider-ready" | "consumer-discovered" | "consumer-ready" | "consumer-mismatch";

export type RegistryMismatchCode =
  | "discovery_failed"
  | "owner_unavailable"
  | "foreign_descriptor"
  | "duplicate_tool"
  | "missing_tool"
  | "extra_tool"
  | "stale_descriptor"
  | "compatibility_mismatch";

export interface RegistryMismatch {
  readonly code: RegistryMismatchCode;
  readonly toolName?: string;
  readonly field?:
    "window" | "origin" | "title" | "description" | "inputSchema" | "annotations" | "receipt";
}

export interface NormalizedToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
}

export interface CanonicalToolManifestEntry {
  readonly name: CheckoutToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: NormalizedToolAnnotations;
  readonly handlerVersion: string;
}

export interface CanonicalCheckoutManifest {
  readonly catalogState: CheckoutCatalogState;
  readonly toolsetVersion: typeof CHECKOUT_TOOLSET_VERSION;
  readonly domainVersion: typeof CHECKOUT_DOMAIN_VERSION;
  readonly appCommit: string;
  readonly tools: readonly CanonicalToolManifestEntry[];
}

export interface RegistryReadinessReceipt {
  readonly status: RegistryReadinessStatus;
  readonly providerRegistration: "ready";
  readonly consumerDiscovery: "unavailable" | "verified" | "mismatch";
  readonly consumerExecution: "unverified" | "verified";
  readonly compatibilityBinding: "unverified" | "verified" | "mismatch";
  readonly registeredToolNames: readonly CheckoutToolName[];
  readonly visibleToolNames: readonly string[];
  readonly rejectedToolNames: readonly string[];
  readonly manifest: CanonicalCheckoutManifest;
  readonly manifestHash: string;
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly fixtureRevision: number;
  readonly stateHash: string;
  readonly argumentMode: "unverified" | ExecuteArgumentMode;
  readonly compatibilityReceipt: RuntimeCompatibilityReceipt | null;
  readonly runtimeCatalog: RuntimeCatalogSnapshot | null;
  readonly mismatches: readonly RegistryMismatch[];
  readonly checkedAt: string;
}

export interface CreateRegistryReadinessOptions {
  readonly state: CheckoutState;
  readonly appCommit: string;
  readonly registrationGeneration: number;
  readonly compatibilityReceipt?: RuntimeCompatibilityReceipt;
  readonly checkedAt?: string;
}

interface DiscoveryResult {
  readonly available: boolean;
  readonly matchingTools: readonly WebMCP.RegisteredTool[];
  readonly rejectedTools: readonly WebMCP.RegisteredTool[];
  readonly mismatches: readonly RegistryMismatch[];
}

interface CompatibilityBaseline {
  readonly manifestHash: string;
  readonly stateHash: string;
  readonly canonicalResult: unknown;
  readonly resultDigest: string;
  readonly effectDigest: string;
}

function normalizedAnnotations(
  annotations: Readonly<WebMCP.ToolAnnotations> | undefined
): NormalizedToolAnnotations {
  return Object.freeze({
    readOnlyHint: annotations?.readOnlyHint ?? false,
    untrustedContentHint: annotations?.untrustedContentHint ?? false
  });
}

function mismatch(
  code: RegistryMismatchCode,
  toolName?: string,
  field?: RegistryMismatch["field"]
): RegistryMismatch {
  return Object.freeze({
    code,
    ...(toolName === undefined ? {} : { toolName }),
    ...(field === undefined ? {} : { field })
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function assertRegistrationGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Registration generation must be a positive safe integer.");
  }
}

async function createCanonicalManifest(
  state: CheckoutState,
  appCommit: string
): Promise<CanonicalCheckoutManifest> {
  const contract = checkoutToolContractSnapshot(state);
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map((tool) => {
      const handlerVersion = versions.get(tool.name);
      if (!handlerVersion) {
        throw new TypeError(`Missing handler version for ${tool.name}.`);
      }
      return Object.freeze({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: JSON.parse(canonicalJson(tool.inputSchema)) as object,
        annotations: normalizedAnnotations(tool.annotations),
        handlerVersion
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return deepFreeze({
    catalogState: contract.catalogState,
    toolsetVersion: contract.toolsetVersion,
    domainVersion: contract.domainVersion,
    appCommit,
    tools
  });
}

function descriptorMismatches(
  actual: WebMCP.RegisteredTool,
  expected: SerializableToolMetadata
): readonly RegistryMismatch[] {
  const mismatches: RegistryMismatch[] = [];
  if (actual.title !== expected.title) {
    mismatches.push(mismatch("stale_descriptor", expected.name, "title"));
  }
  if (actual.description !== expected.description) {
    mismatches.push(mismatch("stale_descriptor", expected.name, "description"));
  }
  if (canonicalJson(actual.inputSchema ?? null) !== canonicalJson(expected.inputSchema)) {
    mismatches.push(mismatch("stale_descriptor", expected.name, "inputSchema"));
  }
  if (
    canonicalJson(normalizedAnnotations(actual.annotations)) !==
    canonicalJson(normalizedAnnotations(expected.annotations))
  ) {
    mismatches.push(mismatch("stale_descriptor", expected.name, "annotations"));
  }
  return mismatches;
}

function compareCatalog(
  actual: readonly WebMCP.RegisteredTool[],
  expected: readonly SerializableToolMetadata[],
  expectedWindow: Window | undefined,
  expectedOrigin: string | undefined
): Omit<DiscoveryResult, "available"> {
  const mismatches: RegistryMismatch[] = [];
  const matchingTools: WebMCP.RegisteredTool[] = [];
  const rejectedTools: WebMCP.RegisteredTool[] = [];

  if (!expectedWindow || !expectedOrigin) {
    return {
      matchingTools,
      rejectedTools: [...actual],
      mismatches: [mismatch("owner_unavailable")]
    };
  }

  for (const tool of actual) {
    if (tool.window !== expectedWindow) {
      rejectedTools.push(tool);
      mismatches.push(mismatch("foreign_descriptor", tool.name, "window"));
      continue;
    }
    if (tool.origin !== expectedOrigin) {
      rejectedTools.push(tool);
      mismatches.push(mismatch("foreign_descriptor", tool.name, "origin"));
      continue;
    }
    matchingTools.push(tool);
  }

  const counts = new Map<string, number>();
  for (const tool of matchingTools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  for (const [toolName, count] of counts) {
    if (count > 1) mismatches.push(mismatch("duplicate_tool", toolName));
  }

  const expectedByName = new Map(expected.map((tool) => [tool.name, tool]));
  for (const expectedTool of expected) {
    const matches = matchingTools.filter(({ name }) => name === expectedTool.name);
    if (matches.length === 0) {
      mismatches.push(mismatch("missing_tool", expectedTool.name));
    } else if (matches.length === 1) {
      mismatches.push(...descriptorMismatches(matches[0] as WebMCP.RegisteredTool, expectedTool));
    }
  }
  for (const toolName of counts.keys()) {
    if (!expectedByName.has(toolName as CheckoutToolName)) {
      mismatches.push(mismatch("extra_tool", toolName));
    }
  }

  return { matchingTools, rejectedTools, mismatches };
}

async function discoverCatalog(
  context: WebMCP.ModelContext,
  expected: readonly SerializableToolMetadata[],
  expectedWindow: Window | undefined,
  expectedOrigin: string | undefined
): Promise<DiscoveryResult> {
  if (typeof context.getTools !== "function") {
    return {
      available: false,
      matchingTools: [],
      rejectedTools: [],
      mismatches: []
    };
  }

  try {
    const tools = await context.getTools(
      expectedOrigin ? { fromOrigins: [expectedOrigin] } : undefined
    );
    if (!Array.isArray(tools)) throw new TypeError("Consumer discovery returned a non-array.");
    const comparison = compareCatalog(tools, expected, expectedWindow, expectedOrigin);
    return { available: true, ...comparison };
  } catch {
    return {
      available: true,
      matchingTools: [],
      rejectedTools: [],
      mismatches: [mismatch("discovery_failed")]
    };
  }
}

async function compatibilityMismatches(
  receipt: RuntimeCompatibilityReceipt,
  baseline: CompatibilityBaseline,
  currentRegistrationGeneration: number
): Promise<readonly RegistryMismatch[]> {
  try {
    if (
      typeof receipt.rawResult !== "string" ||
      (receipt.argumentMode !== "object" && receipt.argumentMode !== "json-string") ||
      typeof receipt.handlerTraceId !== "string"
    ) {
      throw new TypeError("Malformed compatibility receipt.");
    }
    const rawCanonicalResult = JSON.parse(receipt.rawResult) as unknown;
    const expectedCoercionCount = receipt.argumentMode === "json-string" ? 1 : 0;
    const isExact =
      receipt.status === "compatibility-verified" &&
      receipt.toolName === "cart_get" &&
      receipt.nativeCallCount === 1 &&
      receipt.coercionCount === expectedCoercionCount &&
      canonicalJson(rawCanonicalResult) === canonicalJson(baseline.canonicalResult) &&
      canonicalJson(receipt.canonicalResult) === canonicalJson(baseline.canonicalResult) &&
      receipt.resultDigest === baseline.resultDigest &&
      receipt.handlerTraceId.length > 0 &&
      receipt.effectDigest === baseline.effectDigest &&
      receipt.stateBeforeDigest === baseline.stateHash &&
      receipt.stateAfterDigest === baseline.stateHash &&
      receipt.manifestHashBefore === baseline.manifestHash &&
      receipt.manifestHashAfter === baseline.manifestHash &&
      Number.isSafeInteger(receipt.registrationGeneration) &&
      receipt.registrationGeneration >= 1 &&
      receipt.registrationGeneration <= currentRegistrationGeneration;

    return isExact ? [] : [mismatch("compatibility_mismatch", receipt.toolName, "receipt")];
  } catch {
    return [mismatch("compatibility_mismatch", receipt.toolName, "receipt")];
  }
}

/**
 * Produce an evidence receipt only after the provider's registration promise has resolved.
 * Consumer discovery and native execution stay independent, fail-closed claims.
 */
export async function createRegistryReadinessReceipt(
  context: WebMCP.ModelContext,
  options: CreateRegistryReadinessOptions
): Promise<RegistryReadinessReceipt> {
  const state = options.state;
  const appCommit = options.appCommit.trim();
  if (appCommit.length === 0) throw new TypeError("App commit must not be empty.");
  const registrationGeneration = options.registrationGeneration;
  assertRegistrationGeneration(registrationGeneration);

  const manifest = await createCanonicalManifest(state, appCommit);
  const manifestHash = await canonicalSha256(manifest);
  const stateHash = await canonicalSha256(state);
  const expectedWindow = globalThis.window;
  const expectedOrigin = expectedWindow?.location.origin;
  const expectedContract = checkoutToolContractSnapshot(state);
  const discovery = await discoverCatalog(
    context,
    expectedContract.manifest,
    expectedWindow,
    expectedOrigin
  );
  const discoveryVerified = discovery.available && discovery.mismatches.length === 0;
  const sortedMatchingTools = [...discovery.matchingTools].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const runtimeCatalog: RuntimeCatalogSnapshot | null = discoveryVerified
    ? Object.freeze({
        generation: registrationGeneration,
        manifestHash,
        tools: Object.freeze(sortedMatchingTools)
      })
    : null;

  let compatibilityBinding: RegistryReadinessReceipt["compatibilityBinding"] = "unverified";
  let compatibilityReceipt: RuntimeCompatibilityReceipt | null = null;
  const compatibilityIssues: RegistryMismatch[] = [];
  if (options.compatibilityReceipt) {
    if (!discoveryVerified) {
      compatibilityBinding = "mismatch";
      compatibilityIssues.push(
        mismatch("compatibility_mismatch", options.compatibilityReceipt.toolName, "receipt")
      );
    } else {
      const calibrationState = createCheckoutFixture();
      const calibrationManifest = await createCanonicalManifest(calibrationState, appCommit);
      const canonicalResult = cartGet(calibrationState);
      const baseline: CompatibilityBaseline = {
        manifestHash: await canonicalSha256(calibrationManifest),
        stateHash: await canonicalSha256(calibrationState),
        canonicalResult,
        resultDigest: await canonicalSha256(canonicalResult),
        effectDigest: await canonicalSha256(checkoutEffectDiff(calibrationState, calibrationState))
      };
      const issues = await compatibilityMismatches(
        options.compatibilityReceipt,
        baseline,
        registrationGeneration
      );
      compatibilityIssues.push(...issues);
      if (issues.length === 0) {
        compatibilityBinding = "verified";
        compatibilityReceipt = options.compatibilityReceipt;
      } else {
        compatibilityBinding = "mismatch";
      }
    }
  }

  const allMismatches = Object.freeze([...discovery.mismatches, ...compatibilityIssues]);
  const consumerExecution = compatibilityBinding === "verified" ? "verified" : "unverified";
  const status: RegistryReadinessStatus = !discovery.available
    ? "provider-ready"
    : !discoveryVerified || compatibilityBinding === "mismatch"
      ? "consumer-mismatch"
      : consumerExecution === "verified"
        ? "consumer-ready"
        : "consumer-discovered";

  return Object.freeze({
    status,
    providerRegistration: "ready" as const,
    consumerDiscovery: !discovery.available
      ? ("unavailable" as const)
      : discoveryVerified
        ? ("verified" as const)
        : ("mismatch" as const),
    consumerExecution,
    compatibilityBinding,
    registeredToolNames: Object.freeze(manifest.tools.map(({ name }) => name)),
    visibleToolNames: Object.freeze(sortedMatchingTools.map(({ name }) => name)),
    rejectedToolNames: Object.freeze(discovery.rejectedTools.map(({ name }) => name).sort()),
    manifest,
    manifestHash,
    fixtureId: state.fixtureId,
    fixtureRevision: state.revision,
    stateHash,
    argumentMode:
      compatibilityReceipt === null ? ("unverified" as const) : compatibilityReceipt.argumentMode,
    compatibilityReceipt,
    runtimeCatalog,
    mismatches: allMismatches,
    checkedAt: options.checkedAt ?? new Date().toISOString()
  });
}
