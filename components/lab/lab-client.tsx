"use client";

import { useEffect, useRef, useState } from "react";

import {
  cartGet,
  cartSubtotalCents,
  createCheckoutFixture,
  type CartGetResult,
  type CheckoutState
} from "@/lib/domain/checkout";
import { createCartGetTool } from "@/lib/webmcp/cart-get-tool";
import { detectWebMcpCapabilities, type WebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";
import {
  createRegistryReadinessReceipt,
  type RegistryReadinessReceipt
} from "@/lib/webmcp/readiness";

const initialRegistryStatus: RegistryStatus = { phase: "idle", toolNames: [] };
const initialCapabilities: WebMcpCapabilities = {
  secureContext: false,
  providerRegistration: false,
  inPageDiscovery: false,
  inPageExecution: false
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function capabilityLabel(value: boolean, ready: string, unavailable: string): string {
  return value ? ready : unavailable;
}

export function LabClient() {
  const [state, setState] = useState<CheckoutState>(() => createCheckoutFixture());
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [registryStatus, setRegistryStatus] = useState(initialRegistryStatus);
  const [readiness, setReadiness] = useState<RegistryReadinessReceipt>();
  const [uiReceipt, setUiReceipt] = useState<CartGetResult>();
  const [toolReceipt, setToolReceipt] = useState<CartGetResult>();
  const [resetAt, setResetAt] = useState("initial-load");
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const detected = detectWebMcpCapabilities();
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setCapabilities(detected);
    });

    const context = document.modelContext;
    if (!context || !detected.providerRegistration) {
      return () => {
        disposed = true;
      };
    }

    const release = webMcpRegistryManager.acquire(
      context,
      [
        createCartGetTool({
          getState: () => stateRef.current,
          onExecuted: (result) => {
            if (!disposed) setToolReceipt(result);
          }
        })
      ],
      (status) => {
        if (disposed) return;
        setRegistryStatus(status);

        if (status.phase === "ready") {
          void createRegistryReadinessReceipt(context)
            .then((receipt) => {
              if (!disposed) setReadiness(receipt);
            })
            .catch(() => {
              if (!disposed) setReadiness(undefined);
            });
        }
      }
    );

    return () => {
      disposed = true;
      release();
    };
  }, []);

  function resetFixture() {
    const next = createCheckoutFixture();
    setState(next);
    setUiReceipt(undefined);
    setToolReceipt(undefined);
    setResetAt(new Date().toISOString());
  }

  return (
    <div className="lab-layout">
      <section className="panel cart-panel" aria-labelledby="cart-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Declared fixture</span>
            <h2 id="cart-title">Seeded checkout sandbox</h2>
          </div>
          <span className="fixture-id">{state.fixtureId}</span>
        </div>

        <ul className="cart-lines" aria-label="Cart items">
          {state.lines.map((line) => (
            <li key={line.itemId}>
              <div>
                <strong>{line.name}</strong>
                <span>{line.itemId}</span>
              </div>
              <div className="line-numbers">
                <span aria-label={`Quantity ${line.quantity}`}>× {line.quantity}</span>
                <strong>{formatCurrency(line.unitPriceCents * line.quantity)}</strong>
              </div>
            </li>
          ))}
        </ul>

        <div className="cart-summary">
          <span>Sandbox subtotal</span>
          <strong>{formatCurrency(cartSubtotalCents(state))}</strong>
        </div>

        <div className="button-row">
          <button className="button button-primary" onClick={() => setUiReceipt(cartGet(state))}>
            Read cart in UI
          </button>
          <button className="button button-secondary" onClick={resetFixture}>
            Hard reset fixture
          </button>
        </div>

        <p className="receipt-line" aria-live="polite">
          Reset receipt: {state.fixtureId} · revision {state.revision} · {resetAt}
        </p>
      </section>

      <section className="panel capability-panel" aria-labelledby="capability-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Runtime truth</span>
            <h2 id="capability-title">WebMCP capability matrix</h2>
          </div>
        </div>

        <dl className="capability-list">
          <div>
            <dt>Secure context</dt>
            <dd>{capabilityLabel(capabilities.secureContext, "Ready", "Required")}</dd>
          </div>
          <div>
            <dt>Site Tools provider · registerTool()</dt>
            <dd>
              {capabilityLabel(capabilities.providerRegistration, "Available", "Unavailable")}
            </dd>
          </div>
          <div>
            <dt>In-page discovery · getTools()</dt>
            <dd>{capabilityLabel(capabilities.inPageDiscovery, "Available", "Unavailable")}</dd>
          </div>
          <div>
            <dt>In-page execution · executeTool()</dt>
            <dd>{capabilityLabel(capabilities.inPageExecution, "Available", "Unavailable")}</dd>
          </div>
          <div>
            <dt>Direct ChatGPT path</dt>
            <dd>
              {capabilities.providerRegistration ? "Provider-ready; proof pending" : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Chrome model-selection path</dt>
            <dd>
              {capabilities.inPageDiscovery && capabilities.inPageExecution
                ? "Consumer-ready; proof pending"
                : "Fallback may be required"}
            </dd>
          </div>
        </dl>

        <div className="runtime-receipt" aria-live="polite">
          <span>Registry</span>
          <strong>{registryStatus.phase}</strong>
          <small>{registryStatus.toolNames.join(", ") || "No active native tools detected."}</small>
          {registryStatus.error ? (
            <small className="error-text">{registryStatus.error}</small>
          ) : null}
        </div>

        {readiness ? (
          <div className="runtime-receipt">
            <span>Readiness receipt</span>
            <strong>{readiness.status}</strong>
            <small>Manifest {readiness.manifestHash.slice(0, 16)}…</small>
            <small>Discovery: {readiness.consumerDiscovery}</small>
            <small>Execution: {readiness.consumerExecution}</small>
            <small>Argument mode: {readiness.argumentMode}</small>
          </div>
        ) : null}
      </section>

      <section className="panel trace-panel" aria-labelledby="trace-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Shared domain proof</span>
            <h2 id="trace-title">Latest read receipts</h2>
          </div>
        </div>

        <div className="receipt-grid">
          <article>
            <h3>Normal UI</h3>
            {uiReceipt ? <pre>{JSON.stringify(uiReceipt, null, 2)}</pre> : <p>No UI read yet.</p>}
          </article>
          <article>
            <h3>Native WebMCP handler</h3>
            {toolReceipt ? (
              <pre>{JSON.stringify(toolReceipt, null, 2)}</pre>
            ) : (
              <p>No native invocation yet. Source or mock execution is not counted as proof.</p>
            )}
          </article>
        </div>

        <p className="trace-note">
          Both paths call the same <code>cartGet()</code> domain function. Only an observed call in
          a supported WebMCP runtime can satisfy the native proof gate.
        </p>
      </section>
    </div>
  );
}
