import type { Metadata } from "next";

import { JudgeQuickStart } from "@/components/judge/judge-quick-start";

export const metadata: Metadata = {
  title: "Judge quick start",
  description:
    "Run one preloaded Thurstone WebMCP contract from owner intent to a live, independently verified verdict."
};

export default function JudgeQuickStartPage() {
  return (
    <div className="page-shell judge-page">
      <JudgeQuickStart />
    </div>
  );
}
