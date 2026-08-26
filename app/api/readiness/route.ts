import { NextResponse } from "next/server";

import { readPublicProbeControlStatus } from "@/lib/probe/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await readPublicProbeControlStatus();
  return NextResponse.json(
    {
      status: "degraded",
      service: "toolproof",
      nativeWebMcp: "client-detected",
      probe,
      commit: process.env.TOOLPROOF_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unversioned"
    },
    {
      status: 503,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" }
    }
  );
}
