import type { Metadata } from "next";

import { JudgeQuickStart } from "@/components/judge/judge-quick-start";

export const metadata: Metadata = {
  title: "Judge quick start",
  description:
    "Run three preloaded Thurstone WebMCP cases: a healthy baseline, disclosed site fault, and authentic semantic collision."
};

export default function JudgeQuickStartPage() {
  return (
    <div className="page-shell judge-page">
      <JudgeQuickStart />
    </div>
  );
}
