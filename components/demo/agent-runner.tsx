"use client";

import { useEffect, useState } from "react";

import { FixtureInspector } from "@/components/demo/fixture-inspector";
import {
  clearAgentVisibleRunProjection,
  readAgentVisibleRunProjection,
  type AgentVisibleRunProjection
} from "@/lib/demo/agent-projection";
import { clearByoaAgentSession } from "@/lib/demo/agent-session";

export function AgentRunner() {
  const [projection, setProjection] = useState<AgentVisibleRunProjection>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    try {
      const stored = readAgentVisibleRunProjection(window.sessionStorage);
      if (!stored) throw new Error("No armed test exists in this tab.");
      if (Date.parse(stored.expiresAt) <= Date.now()) {
        throw new Error("This armed test expired. Return to Demo and arm a fresh contract.");
      }
      queueMicrotask(() => setProjection(stored));
    } catch (caught) {
      queueMicrotask(() =>
        setError(caught instanceof Error ? caught.message : "The armed test could not be read.")
      );
    }
  }, []);

  function cancel() {
    clearAgentVisibleRunProjection(window.sessionStorage);
    clearByoaAgentSession(window.sessionStorage);
    window.location.replace("/demo");
  }

  if (error) {
    return (
      <section className="agent-runner-empty" aria-labelledby="agent-runner-empty-title">
        <p className="eyebrow">No active test</p>
        <h1 id="agent-runner-empty-title">Build and arm a contract first.</h1>
        <p>{error}</p>
        <a className="button button-primary" href="/demo">
          Return to Demo
        </a>
      </section>
    );
  }

  if (!projection) {
    return (
      <section className="agent-runner-loading" aria-live="polite">
        <p className="eyebrow">Preparing isolated run</p>
        <h1>Opening your frozen test…</h1>
      </section>
    );
  }

  return (
    <section className="agent-runner-shell" aria-labelledby="agent-runner-title">
      <div className="agent-runner-heading">
        <div>
          <p className="eyebrow">Step 5 of 6 · isolated run document</p>
          <h1 id="agent-runner-title">Your test is prepared.</h1>
          <p>
            This document contains only the safe fixture, request, and frozen agent-visible catalog.
            Native registration begins only after this document completes its own clean preflight.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={cancel}>
          Cancel test
        </button>
      </div>
      <div className="agent-runner-grid">
        <div className="agent-runner-content">
          <section className="agent-request-card" aria-labelledby="agent-request-title">
            <span>Exact synthetic request</span>
            <h2 id="agent-request-title">{projection.request}</h2>
          </section>
          <section className="agent-catalog-preview" aria-labelledby="agent-catalog-title">
            <p className="eyebrow">Frozen two-tool catalog</p>
            <h2 id="agent-catalog-title">What the agent will see</h2>
            <div>
              {projection.descriptors.map((descriptor) => (
                <article key={descriptor.name}>
                  <strong>{descriptor.title}</strong>
                  <code>{descriptor.name}</code>
                  <p>{descriptor.description}</p>
                </article>
              ))}
            </div>
          </section>
          <p className="agent-runner-status" role="status">
            Preparing native registration. No tool has been registered yet.
          </p>
        </div>
        <FixtureInspector />
      </div>
    </section>
  );
}
