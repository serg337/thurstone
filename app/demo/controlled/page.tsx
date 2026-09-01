import type { Metadata } from "next";

import { ControlledMismatchV3 } from "@/components/demo/controlled-mismatch-v3";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";

export const metadata: Metadata = {
  title: "Controlled mismatch · Demo",
  description:
    "Run one provider-free wrong-tool WebMCP invocation in a fresh document and see Thurstone diagnose it."
};

export default function ControlledMismatchPage() {
  return (
    <div className="page-shell demo-run-page">
      <ControlledMismatchV3 buildCommit={resolveDeploymentCommit(process.env)} />
    </div>
  );
}
