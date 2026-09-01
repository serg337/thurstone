import type { Metadata } from "next";

import { BrowserEntryGuide } from "@/components/demo/browser-entry-guide";
import { DemoClient } from "@/components/demo/demo-client";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Define what a WebMCP request should mean, arm a safe reference test, and verify the agent’s native action and effect."
};

export default function DemoPage() {
  return (
    <div className="page-shell demo-page">
      <header className="demo-hero" aria-labelledby="demo-title">
        <div>
          <p className="eyebrow">Bring your own agent · safe reference checkout</p>
          <h1 id="demo-title">Test Thurstone as a WebMCP owner.</h1>
          <p>
            Define what a request should mean, ask your own supported agent to use the live site,
            and see whether the resulting action and state match your contract.
          </p>
          <span className="demo-safety-note">
            No account · no purchase or payment · one admitted agent invocation per test
          </span>
        </div>
      </header>
      <BrowserEntryGuide />
      <DemoClient />
    </div>
  );
}
