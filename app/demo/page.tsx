import type { Metadata } from "next";

import { DemoClient } from "@/components/demo/demo-client";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Define what a WebMCP request should mean, arm a safe reference test, and verify the agent’s native action and effect."
};

export default function DemoPage() {
  return (
    <div className="page-shell demo-page">
      <div className="demo-aligned-grid">
        <header className="demo-hero" aria-labelledby="demo-title">
          <div>
            <p className="eyebrow">Bring your own agent · safe reference checkout</p>
            <h1 id="demo-title">Test Thurstone as a WebMCP owner.</h1>
            <p>
              Define what a request should mean, ask your own supported agent to use the live site,
              and see whether the resulting action and state match your contract.
            </p>
            <span className="demo-safety-note">
              No Thurstone account · no purchase or payment · one admitted native action per case
            </span>
          </div>
        </header>
      </div>
      <DemoClient />
    </div>
  );
}
