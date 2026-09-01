import {
  createByoaAgentEnvironmentV2,
  type ByoaAgentEnvironmentV2
} from "@/lib/demo/agent-environment-v2";
import {
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  type ByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  newThurstoneContractCaseId,
  newThurstoneContractSuiteId,
  selectContractSuiteCase
} from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import { evaluateByoaEnvironmentV3 } from "@/lib/demo/evaluator-v3";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";
import {
  WebMcpRegistryManager,
  webMcpRegistryManager,
  type RegistryStatus
} from "@/lib/webmcp/registry-manager";
import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

export const CONTROLLED_MISMATCH_LABEL = "Controlled example — no model call" as const;
export const CONTROLLED_MISMATCH_REQUEST = "I am ready—request checkout for this cart." as const;
export const CONTROLLED_MISMATCH_EXPECTED_TOOL = "checkout_request" as const;
export const CONTROLLED_MISMATCH_OBSERVED_TOOL = "order_review" as const;

export interface ControlledMismatchRunV3 {
  readonly rawConsumerResult: string | null;
  readonly result: ByoaDemoResultV3;
}

function timestampAfter(value: string, milliseconds = 1): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function advanceSession(
  session: ByoaAgentSessionV2,
  to: Parameters<typeof transitionByoaSessionV2>[1],
  reasonCode: string,
  explicitStart = false
): ByoaAgentSessionV2 {
  return transitionByoaSessionV2(session, to, {
    at: timestampAfter(session.updatedAt),
    reasonCode,
    ...(explicitStart ? { explicitStart: true as const } : {})
  });
}

async function createControlledScenario(
  buildCommit: string,
  startedAt: string
): Promise<{
  readonly environment: ByoaAgentEnvironmentV2;
  readonly session: ByoaAgentSessionV2;
}> {
  if (!/^[a-f0-9]{40}$/u.test(buildCommit) || /^0{40}$/u.test(buildCommit)) {
    throw new Error("The controlled example requires the exact deployed 40-character build SHA.");
  }

  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
    selectedToolNames: [CONTROLLED_MISMATCH_OBSERVED_TOOL, CONTROLLED_MISMATCH_EXPECTED_TOOL]
  });
  let suite = await createThurstoneContractSuite({
    suiteId: newThurstoneContractSuiteId(),
    name: "Controlled checkout-selection mismatch",
    catalogSnapshot,
    createdAt: startedAt
  });
  suite = addContractSuiteCase(
    suite,
    {
      name: "Explicit checkout authorization",
      request: CONTROLLED_MISMATCH_REQUEST,
      expectedTool: CONTROLLED_MISMATCH_EXPECTED_TOOL,
      argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
      allowedEffects: [{ kind: "pending_checkout" }],
      forbiddenEffects: [
        { kind: "cart_mutation" },
        { kind: "duplicate_transition" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "exactly_once",
      approvalClass: "consequential"
    },
    {
      caseId: newThurstoneContractCaseId(),
      updatedAt: timestampAfter(suite.updatedAt)
    }
  );
  suite = selectContractSuiteCase(suite, suite.cases[0]!.caseId, {
    updatedAt: timestampAfter(suite.updatedAt)
  });

  const contractCreatedAt = timestampAfter(suite.updatedAt);
  const lineage = await expectedLineageForThurstoneSuite(suite);
  const contract = await createByoaContractV3({
    contractId: `byoa_${globalThis.crypto.randomUUID()}`,
    suite,
    buildCommit,
    createdAt: contractCreatedAt
  });
  let session = await createCompiledByoaSessionV2({
    runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
    contract,
    lineage,
    createdAt: timestampAfter(contractCreatedAt),
    expiresAt: timestampAfter(contractCreatedAt, 10 * 60 * 1000)
  });
  session = advanceSession(session, "HANDOFF_ISSUED", "controlled_example_compiled");
  session = advanceSession(session, "RECEIVED", "controlled_example_received");
  session = advanceSession(session, "READY_TO_ARM", "controlled_example_reviewed");
  session = advanceSession(session, "PREPARING", "agent_explicit_start", true);

  return Object.freeze({
    environment: await createByoaAgentEnvironmentV2(contract, buildCommit),
    session
  });
}

function waitForReadyCatalog(
  manager: WebMcpRegistryManager,
  context: RuntimeModelContext,
  environment: ByoaAgentEnvironmentV2
): Promise<{ readonly release: () => void; readonly status: RegistryStatus }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let release: () => void = () => undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      release();
      reject(new Error("The controlled WebMCP catalog did not become ready in time."));
    }, 3_000);

    release = manager.acquire(context, environment.tools, (status) => {
      if (settled) return;
      if (status.phase === "error") {
        settled = true;
        clearTimeout(timeout);
        release();
        reject(new Error(status.error ?? "The controlled WebMCP catalog could not be registered."));
        return;
      }
      if (status.phase !== "ready") return;
      settled = true;
      clearTimeout(timeout);
      resolve({ release, status });
    });
  });
}

async function waitForPriorCatalogRetirement(context: RuntimeModelContext): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastNames: readonly string[] = [];
  while (Date.now() < deadline) {
    const tools = await context.getTools();
    lastNames = tools.map(({ name }) => name);
    if (lastNames.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(
    `The preceding live catalog has not retired (${lastNames.join(", ") || "unknown"}). ` +
      "No controlled catalog was registered."
  );
}

/**
 * Runs one deliberately wrong, provider-free native invocation through the public in-page
 * WebMCP consumer. The returned Result v3 is supplemental and is never persisted as the visitor's
 * primary result or included in a reference score.
 */
export async function runControlledMismatchV3(input: {
  readonly context: RuntimeModelContext;
  readonly buildCommit: string;
  readonly startedAt?: string;
  readonly registryManager?: WebMcpRegistryManager;
}): Promise<ControlledMismatchRunV3> {
  const { context } = input;
  if (
    typeof context.registerTool !== "function" ||
    typeof context.getTools !== "function" ||
    typeof context.executeTool !== "function"
  ) {
    throw new Error(
      "This browser does not expose the in-page native WebMCP getTools/executeTool consumer."
    );
  }

  await waitForPriorCatalogRetirement(context);
  // The visitor's live registry has already reached a verified empty boundary. A separate manager
  // owns this supplemental, fresh dynamic environment so its handler identity cannot replace or
  // mutate the primary run's catalog history.
  const manager = input.registryManager ?? webMcpRegistryManager;
  const startedAt = input.startedAt ?? new Date().toISOString();
  const { environment, session: preparingSession } = await createControlledScenario(
    input.buildCommit,
    startedAt
  );
  let ready: Awaited<ReturnType<typeof waitForReadyCatalog>>;
  try {
    ready = await waitForReadyCatalog(manager, context, environment);
  } catch (error) {
    await manager.settled();
    throw error;
  }
  const { release, status } = ready;
  let releaseConsumerCall: () => void = () => undefined;

  try {
    let session = advanceSession(
      preparingSession,
      "PROVIDER_READY",
      "controlled_catalog_registered"
    );
    session = advanceSession(session, "ARMED", "controlled_observation_armed");
    const armedAt = session.updatedAt;

    const discovered = await context.getTools();
    const selected = discovered.find(({ name }) => name === CONTROLLED_MISMATCH_OBSERVED_TOOL);
    if (!selected) {
      throw new Error(
        "The real order_review tool was not present in the exact controlled catalog."
      );
    }
    const generation = status.generation;
    if (generation === undefined) {
      throw new Error("The controlled WebMCP catalog has no verified registry generation.");
    }

    releaseConsumerCall = manager.holdConsumerCall(selected.name, generation);
    const rawConsumerResult = await context.executeTool(selected, JSON.stringify({}), {
      signal: new AbortController().signal
    });
    releaseConsumerCall();
    releaseConsumerCall = () => undefined;

    session = advanceSession(session, "OBSERVING", "controlled_native_invocation_observed");
    session = advanceSession(session, "EVALUATING", "controlled_native_handler_settled");
    const result = await evaluateByoaEnvironmentV3({
      session,
      environment,
      launchMode: "controlled-example",
      evidenceTier: "deterministic-controlled-example",
      armedAt,
      completedAt: timestampAfter(session.updatedAt)
    });
    if (result.verdict !== "issue") {
      throw new Error("The controlled mismatch did not produce the required honest ISSUE verdict.");
    }
    return Object.freeze({ rawConsumerResult, result });
  } finally {
    releaseConsumerCall();
    release();
    await manager.settled();
  }
}
