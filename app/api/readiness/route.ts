import { NextResponse } from "next/server";

import { readJudgeDemoStatus } from "@/lib/judge/service.server";
import { readPublicProbeControlStatus } from "@/lib/probe/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const [probe, judge] = await Promise.all([readPublicProbeControlStatus(), readJudgeDemoStatus()]);
  const judgeReady =
    judge.status === "available" ||
    judge.status === "running" ||
    judge.status === "recoverable" ||
    judge.status === "sealed";
  return NextResponse.json(
    {
      status: judgeReady ? "ready" : "degraded",
      service: "toolproof",
      nativeWebMcp: "client-detected",
      modelBackedJudgeLane: judgeReady ? "ready" : "unavailable",
      judge,
      probe,
      commit: process.env.TOOLPROOF_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unversioned"
    },
    {
      status: judgeReady ? 200 : 503,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" }
    }
  );
}
