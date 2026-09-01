import type { Metadata } from "next";

import { HandoffOpener } from "@/components/demo/handoff-opener";

export const metadata: Metadata = {
  title: "Fresh-agent handoff · Demo",
  description: "Open one opaque Thurstone test handoff in the built-in Browser."
};

export default function DemoHandoffPage() {
  return (
    <div className="page-shell demo-run-page">
      <HandoffOpener />
    </div>
  );
}
