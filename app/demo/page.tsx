import type { Metadata } from "next";

import { DemoClient } from "@/components/demo/demo-client";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Walk through a verified WebMCP intent boundary, author a reference contract, or open Thurstone’s native sandbox."
};

export default function DemoPage() {
  return (
    <div className="page-shell demo-page">
      <header className="demo-hero" aria-labelledby="demo-title">
        <div>
          <p className="eyebrow">Interactive reference checkout</p>
          <h1 id="demo-title">See whether intent becomes the permitted WebMCP action.</h1>
          <p>
            Start with a 60-second boundary. Then define your own contract or use the live sandbox.
          </p>
        </div>
      </header>
      <DemoClient />
    </div>
  );
}
