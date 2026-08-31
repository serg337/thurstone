"use client";

import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ZodError } from "zod";

import { ContractPreview } from "@/components/demo/contract-preview";
import { WorkshopResult } from "@/components/demo/workshop-result";
import { RuntimeStatus, type RuntimeStatusState } from "@/components/ui/runtime-status";
import {
  createWorkshopContract,
  mutationOperationId,
  workshopContractDigest,
  type WorkshopContractV1,
  type WorkshopDecision,
  type WorkshopEffectPredicate
} from "@/lib/demo/contract";
import { createContractValidationResult, type ThurstoneDemoResultV1 } from "@/lib/demo/result";
import { clearDemoResult, writeDemoResult } from "@/lib/demo/session-storage";
import {
  createWorkshopEnvironment,
  prepareWorkshopReadiness,
  runNativeWorkshopContract,
  sameWorkshopNames,
  workshopExpectedNames
} from "@/lib/demo/workshop-runner";
import { detectWebMcpCapabilities } from "@/lib/webmcp/capabilities";
import type { RegistryReadinessReceipt } from "@/lib/webmcp/readiness";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";
const initialRegistryStatus: RegistryStatus = { phase: "idle", toolNames: [] };
const initialCapabilities = {
  secureContext: false,
  providerRegistration: false,
  inPageDiscovery: false,
  inPageExecution: false
};
const selectableTools = ["cart_get", "order_review", "cart_update", "checkout_request"] as const;
type SelectableTool = (typeof selectableTools)[number];
type DecisionKind = "call" | "clarify" | "no_action";
type AllowedChange = "none" | "cart_quantity" | "pending_checkout";

function operationPrefix(tool: SelectableTool): string {
  return tool === "cart_update" || tool === "checkout_request" ? tool : "workshop_read";
}

function defaultsFor(kind: DecisionKind, tool: SelectableTool) {
  if (kind !== "call") {
    return { allowedChange: "none" as const, replayPolicy: "not_applicable" as const };
  }
  if (tool === "cart_get" || tool === "order_review") {
    return { allowedChange: "none" as const, replayPolicy: "read_only" as const };
  }
  return {
    allowedChange:
      tool === "cart_update" ? ("cart_quantity" as const) : ("pending_checkout" as const),
    replayPolicy: "exactly_once" as const
  };
}

function downloadResult(result: ThurstoneDemoResultV1): void {
  const bytes = JSON.stringify(result, null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `thurstone-session-${result.sessionId.slice(-12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function workshopErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? fallback;
  return error instanceof Error ? error.message : fallback;
}

export function ContractWorkshop() {
  const [environment] = useState(() => createWorkshopEnvironment(APP_COMMIT));
  const subscribeStore = useCallback(
    (onChange: () => void) =>
      environment.store.subscribe(() => {
        flushSync(onChange);
      }),
    [environment]
  );
  const session = useSyncExternalStore(
    subscribeStore,
    environment.store.getSnapshot,
    environment.store.getSnapshot
  );
  const desiredTools = environment.tools.forState(session.state);
  const desiredNames = workshopExpectedNames(session.state);
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [capabilitiesChecked, setCapabilitiesChecked] = useState(false);
  const [registryStatus, setRegistryStatus] = useState(initialRegistryStatus);
  const [readiness, setReadiness] = useState<RegistryReadinessReceipt>();
  const [runtimeError, setRuntimeError] = useState<string>();
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("Show me the complete order before I decide.");
  const [decisionKind, setDecisionKind] = useState<DecisionKind>("call");
  const [toolName, setToolName] = useState<SelectableTool>("order_review");
  const [itemId, setItemId] = useState<"field-notebook" | "stoneware-mug">("stoneware-mug");
  const [quantity, setQuantity] = useState("3");
  const [operationId, setOperationId] = useState("workshop_operation_0001");
  const [allowedChange, setAllowedChange] = useState<AllowedChange>("none");
  const [replayPolicy, setReplayPolicy] = useState<"not_applicable" | "read_only" | "exactly_once">(
    "read_only"
  );
  const [forbidCartMutation, setForbidCartMutation] = useState(true);
  const [forbidPendingCheckout, setForbidPendingCheckout] = useState(true);
  const [forbidDuplicate, setForbidDuplicate] = useState(true);
  const [compiled, setCompiled] = useState<{
    readonly contract: WorkshopContractV1;
    readonly digest: string;
  }>();
  const [result, setResult] = useState<ThurstoneDemoResultV1>();
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const readinessEpoch = useRef(0);

  useEffect(() => {
    const detected = detectWebMcpCapabilities();
    queueMicrotask(() => {
      setCapabilities(detected);
      setCapabilitiesChecked(true);
    });
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, desiredTools, (status) => {
      setRegistryStatus(status);
      if (status.phase !== "ready") setReadiness(undefined);
    });
  }, [desiredTools]);

  useEffect(() => {
    const context = document.modelContext;
    const generation = registryStatus.generation ?? 0;
    if (
      !context ||
      registryStatus.phase !== "ready" ||
      generation < 1 ||
      !sameWorkshopNames(registryStatus.toolNames, desiredNames)
    ) {
      return;
    }
    const epoch = ++readinessEpoch.current;
    let disposed = false;
    void prepareWorkshopReadiness({ context, environment, appCommit: APP_COMMIT, generation })
      .then((receipt) => {
        if (disposed || epoch !== readinessEpoch.current) return;
        setReadiness(receipt);
        setRuntimeError(undefined);
      })
      .catch((error: unknown) => {
        if (disposed || epoch !== readinessEpoch.current) return;
        setReadiness(undefined);
        setRuntimeError(error instanceof Error ? error.message : "WebMCP readiness failed.");
      });
    return () => {
      disposed = true;
    };
  }, [desiredNames, environment, registryStatus]);

  function applyDefaults(kind: DecisionKind, tool: SelectableTool) {
    const defaults = defaultsFor(kind, tool);
    setAllowedChange(defaults.allowedChange);
    setReplayPolicy(defaults.replayPolicy);
    setForbidCartMutation(tool !== "cart_update");
    setForbidPendingCheckout(tool !== "checkout_request");
    setForbidDuplicate(kind === "call" && tool !== "cart_get" && tool !== "order_review");
    if (kind === "call" && (tool === "cart_update" || tool === "checkout_request")) {
      setOperationId(mutationOperationId(tool));
    }
  }

  function expectedDecision(): WorkshopDecision {
    if (decisionKind === "clarify") return { kind: "clarify" };
    if (decisionKind === "no_action") return { kind: "no_action" };
    if (toolName === "cart_get" || toolName === "order_review") {
      return { kind: "call", toolName, arguments: {} };
    }
    if (toolName === "cart_update") {
      return {
        kind: "call",
        toolName,
        arguments: {
          operationId,
          operation: "set_quantity",
          itemId,
          quantity: Number(quantity)
        }
      };
    }
    return { kind: "call", toolName: "checkout_request", arguments: { operationId } };
  }

  function allowedEffects(): WorkshopEffectPredicate[] {
    if (allowedChange === "cart_quantity") {
      return [{ kind: "cart_quantity", itemId, quantity: Number(quantity) }];
    }
    if (allowedChange === "pending_checkout") return [{ kind: "pending_checkout" }];
    return [];
  }

  function forbiddenEffects(): WorkshopEffectPredicate[] {
    const effects: WorkshopEffectPredicate[] = [{ kind: "unmodeled_state" }];
    if (forbidCartMutation) effects.push({ kind: "cart_mutation" });
    if (forbidPendingCheckout) effects.push({ kind: "pending_checkout" });
    if (forbidDuplicate) effects.push({ kind: "duplicate_transition" });
    return effects;
  }

  async function compileContract(): Promise<{
    readonly contract: WorkshopContractV1;
    readonly digest: string;
  }> {
    const contract = createWorkshopContract(
      {
        title,
        request,
        expectedDecision: expectedDecision(),
        allowedEffects: allowedEffects(),
        forbiddenEffects: forbiddenEffects(),
        replayPolicy
      },
      {
        testId: `workshop_${globalThis.crypto.randomUUID()}`,
        createdAt: new Date().toISOString()
      }
    );
    const digest = await workshopContractDigest(contract);
    const value = Object.freeze({ contract, digest });
    setCompiled(value);
    return value;
  }

  async function validate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    try {
      const value = await compileContract();
      const completedAt = new Date().toISOString();
      const validation = createContractValidationResult({
        contract: value.contract,
        contractDigest: value.digest,
        sessionId: `demo_${globalThis.crypto.randomUUID()}`,
        buildCommit: APP_COMMIT,
        completedAt
      });
      setResult(validation);
      writeDemoResult(window.sessionStorage, validation);
    } catch (error) {
      setCompiled(undefined);
      setResult(undefined);
      setFormError(workshopErrorMessage(error, "The contract is invalid."));
    }
  }

  async function runNative() {
    if (!compiled || busy) return;
    setBusy(true);
    setFormError(undefined);
    try {
      const nativeResult = await runNativeWorkshopContract({
        environment,
        readiness: readiness as RegistryReadinessReceipt,
        contract: compiled.contract,
        contractDigest: compiled.digest,
        sessionId: `demo_${globalThis.crypto.randomUUID()}`,
        buildCommit: APP_COMMIT,
        completedAt: new Date().toISOString()
      });
      setResult(nativeResult);
      writeDemoResult(window.sessionStorage, nativeResult);
    } catch (error) {
      setFormError(workshopErrorMessage(error, "Native Workshop execution failed."));
    } finally {
      setBusy(false);
    }
  }

  async function resetFixture() {
    setBusy(true);
    try {
      await environment.store.hardReset({ source: "ui" });
      setCompiled(undefined);
      setResult(undefined);
      setFormError(undefined);
      setOperationId(`${operationPrefix(toolName)}_${globalThis.crypto.randomUUID()}`);
      clearDemoResult(window.sessionStorage);
    } finally {
      setBusy(false);
    }
  }

  const runtimeState: RuntimeStatusState = !capabilitiesChecked
    ? "checking"
    : readiness?.status === "consumer-ready"
      ? "ready"
      : "blocked";
  const nativeReady =
    capabilities.providerRegistration &&
    capabilities.inPageDiscovery &&
    capabilities.inPageExecution &&
    compiled?.contract.expectedDecision.kind === "call" &&
    readiness?.status === "consumer-ready" &&
    readiness.fixtureRevision === session.state.revision &&
    session.state.revision === 0 &&
    session.state.pendingCheckout === null &&
    !busy;

  return (
    <section
      className="demo-mode-panel contract-workshop"
      id="contract-workshop"
      aria-labelledby="contract-workshop-title"
    >
      <div className="workshop-heading">
        <div>
          <p className="eyebrow">Reference checkout environment</p>
          <h2 id="contract-workshop-title">Define what should happen—and what must not.</h2>
          <p>
            Describe a request, choose the permitted decision and state changes, then check the
            contract or run the call through WebMCP.
          </p>
        </div>
        <RuntimeStatus state={runtimeState}>
          {runtimeState === "ready"
            ? "WebMCP ready"
            : runtimeState === "checking"
              ? "Checking WebMCP"
              : "Native execution unavailable"}
        </RuntimeStatus>
      </div>

      <div className="workshop-layout">
        <form className="workshop-form" onSubmit={validate} noValidate>
          <fieldset disabled={busy}>
            <legend>1. Request</legend>
            <label>
              <span>
                Test name <small>optional</small>
              </span>
              <input
                maxLength={60}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>
                User request <small>synthetic data only · 280 characters maximum</small>
              </span>
              <textarea
                required
                maxLength={280}
                rows={3}
                value={request}
                aria-describedby="workshop-request-note"
                onChange={(event) => setRequest(event.target.value)}
              />
            </label>
            <p id="workshop-request-note">
              Do not enter personal, credential, payment, or customer data.
            </p>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>2. Expected behavior</legend>
            <div className="workshop-two-fields">
              <label>
                <span>Expected decision</span>
                <select
                  value={decisionKind}
                  onChange={(event) => {
                    const kind = event.target.value as DecisionKind;
                    setDecisionKind(kind);
                    applyDefaults(kind, toolName);
                  }}
                >
                  <option value="call">Call a tool</option>
                  <option value="clarify">Ask for clarification</option>
                  <option value="no_action">Take no action</option>
                </select>
              </label>
              {decisionKind === "call" ? (
                <label>
                  <span>Expected tool</span>
                  <select
                    value={toolName}
                    onChange={(event) => {
                      const tool = event.target.value as SelectableTool;
                      setToolName(tool);
                      applyDefaults(decisionKind, tool);
                    }}
                  >
                    {selectableTools.map((tool) => (
                      <option value={tool} key={tool}>
                        {tool}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {decisionKind === "call" && toolName === "cart_update" ? (
              <div className="workshop-two-fields">
                <label>
                  <span>Item</span>
                  <select
                    value={itemId}
                    onChange={(event) => setItemId(event.target.value as typeof itemId)}
                  >
                    <option value="field-notebook">Field notebook</option>
                    <option value="stoneware-mug">Stoneware mug</option>
                  </select>
                </label>
                <label>
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {decisionKind === "call" &&
            (toolName === "cart_update" || toolName === "checkout_request") ? (
              <label>
                <span>Generated operation ID</span>
                <div className="operation-id-field">
                  <input value={operationId} readOnly />
                  <button
                    className="button button-secondary button-compact"
                    type="button"
                    onClick={() => setOperationId(mutationOperationId(toolName))}
                  >
                    New ID
                  </button>
                </div>
              </label>
            ) : null}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>3. Allowed and forbidden effects</legend>
            <div className="workshop-two-fields">
              <label>
                <span>Allowed state change</span>
                <select
                  value={allowedChange}
                  onChange={(event) => setAllowedChange(event.target.value as AllowedChange)}
                >
                  <option value="none">No state change</option>
                  <option value="cart_quantity">One cart quantity</option>
                  <option value="pending_checkout">Pending checkout</option>
                </select>
              </label>
              <label>
                <span>Replay policy</span>
                <select
                  value={replayPolicy}
                  onChange={(event) => setReplayPolicy(event.target.value as typeof replayPolicy)}
                >
                  <option value="not_applicable">Not applicable</option>
                  <option value="read_only">Read only</option>
                  <option value="exactly_once">Exactly once</option>
                </select>
              </label>
            </div>
            <div className="workshop-checks" aria-label="Forbidden effects">
              <label>
                <input
                  type="checkbox"
                  checked={forbidCartMutation}
                  onChange={(event) => setForbidCartMutation(event.target.checked)}
                />
                Forbid undeclared cart mutation
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={forbidPendingCheckout}
                  onChange={(event) => setForbidPendingCheckout(event.target.checked)}
                />
                Forbid undeclared pending checkout
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={forbidDuplicate}
                  onChange={(event) => setForbidDuplicate(event.target.checked)}
                />
                Forbid duplicate state transition
              </label>
              <label>
                <input type="checkbox" checked readOnly disabled />
                Always forbid unmodeled state
              </label>
            </div>
            <p className="trusted-state-source">
              Trusted state source <strong>Thurstone reference checkout ledger</strong>
            </p>
          </fieldset>

          {formError ? (
            <p className="workshop-error" role="alert" aria-live="assertive">
              {formError}
              {runtimeError ? ` ${runtimeError}` : ""}
            </p>
          ) : null}

          <div className="workshop-actions">
            <button className="button button-primary" type="submit">
              Check contract
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={!nativeReady}
              onClick={() => void runNative()}
            >
              {busy ? "Running through WebMCP…" : "Run through WebMCP"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void resetFixture()}
            >
              Reset
            </button>
          </div>
          <p className="workshop-scope">
            Contract checking uses no model. Native execution tests the declared call and state
            effect; it does not score model selection.
          </p>
        </form>

        <aside className="workshop-output" aria-live="polite">
          {compiled ? (
            <ContractPreview contract={compiled.contract} digest={compiled.digest} />
          ) : (
            <div className="workshop-empty">
              <p className="eyebrow">Compiled contract</p>
              <h3>Your contract will appear here.</h3>
              <p>Expected behavior remains separate from observed evidence.</p>
            </div>
          )}
          {result ? <WorkshopResult result={result} /> : null}
          {result ? (
            <div className="button-row workshop-downloads">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => downloadResult(result)}
              >
                Download result JSON
              </button>
              <a className="button button-secondary" href="/results?session=current">
                Open Results
              </a>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
