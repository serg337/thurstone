"use client";

import { useEffect, useState } from "react";

import { ContractWorkshop } from "@/components/demo/contract-workshop";
import { DemoModeNav, type DemoMode } from "@/components/demo/demo-mode-nav";
import { GuidedDemo } from "@/components/demo/guided-demo";
import { SandboxPreview } from "@/components/demo/sandbox-preview";

function hashMode(hash: string): DemoMode {
  const value = hash.replace(/^#/u, "");
  if (value === "contract-workshop" || value === "open-sandbox") return value;
  return "guided-demo";
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
      {mode === "contract-workshop" ? <ContractWorkshop /> : null}
      {mode === "open-sandbox" ? <SandboxPreview /> : null}
    </>
  );
}
