import type { Metadata } from "next";

import { AgentRunner } from "@/components/demo/agent-runner";

export const metadata: Metadata = {
  title: "Live test · Demo",
  description: "Run one isolated Thurstone test against the frozen reference WebMCP catalog."
};

export default function DemoRunPage() {
  return (
    <div className="page-shell demo-run-page">
      <AgentRunner />
    </div>
  );
}
