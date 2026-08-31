"use client";

import { useEffect, useState } from "react";

import { DemoModeNav, type DemoMode } from "@/components/demo/demo-mode-nav";
import { GuidedDemo } from "@/components/demo/guided-demo";
import { SandboxPreview } from "@/components/demo/sandbox-preview";

function hashMode(hash: string): DemoMode {
  const value = hash.replace(/^#/u, "");
  if (value === "contract-workshop" || value === "open-sandbox") return value;
  return "guided-demo";
}

function WorkshopPreview() {
  return (
    <section
      className="demo-mode-panel workshop-preview"
      id="contract-workshop"
      aria-labelledby="workshop-preview-title"
    >
      <p className="eyebrow">Reference checkout environment</p>
      <h2 id="workshop-preview-title">Turn your expectation into an inspectable contract.</h2>
      <p>
        Describe a synthetic request, declare the intended action and effects, then review the exact
        contract Thurstone will validate. The complete interactive Workshop is the next proven demo
        surface.
      </p>
      <div className="workshop-preview-steps" aria-label="Contract Workshop steps">
        <span>Describe request</span>
        <span>Declare behavior</span>
        <span>Set invariants</span>
        <span>Run and inspect</span>
      </div>
      <a className="button button-secondary" href="/studio">
        Inspect the frozen reference contract
      </a>
    </section>
  );
}

export function DemoClient() {
  const [mode, setMode] = useState<DemoMode>("guided-demo");

  useEffect(() => {
    const sync = () => setMode(hashMode(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function selectMode(nextMode: DemoMode) {
    setMode(nextMode);
    window.history.replaceState(null, "", `#${nextMode}`);
  }

  return (
    <>
      <DemoModeNav selected={mode} onSelect={selectMode} />
      {mode === "guided-demo" ? <GuidedDemo /> : null}
      {mode === "contract-workshop" ? <WorkshopPreview /> : null}
      {mode === "open-sandbox" ? <SandboxPreview /> : null}
    </>
  );
}
