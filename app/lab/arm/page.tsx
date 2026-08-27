import type { Metadata } from "next";

import { ProbeOperatorArm } from "@/components/lab/probe-operator-arm";

export const metadata: Metadata = { title: "Operator arm" };

export default function ProbeOperatorArmPage() {
  return (
    <div className="page-shell route-page probe-evaluation-shell">
      <ProbeOperatorArm />
    </div>
  );
}
