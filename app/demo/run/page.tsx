import type { Metadata } from "next";

import { ByoaRunnerRouter } from "@/components/demo/byoa-runner-router";

export const metadata: Metadata = {
  title: "Live test · Demo",
  description: "Run one isolated Thurstone test against the frozen reference WebMCP catalog."
};

export default function DemoRunPage() {
  return (
    <div className="page-shell demo-run-page">
      <ByoaRunnerRouter />
    </div>
  );
}
