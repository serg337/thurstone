import type { Metadata } from "next";

import { ByoaRunner } from "@/components/demo/byoa-runner";

export const metadata: Metadata = {
  title: "Live test · Demo",
  description: "Run one isolated Thurstone test against the frozen reference WebMCP catalog."
};

export default function DemoRunPage() {
  return (
    <div className="page-shell demo-run-page">
      <ByoaRunner />
    </div>
  );
}
