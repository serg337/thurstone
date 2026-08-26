import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "degraded",
      service: "toolproof",
      nativeWebMcp: "client-detected",
      probe: {
        enabled: false,
        reason:
          "The Probe endpoint and operational replay/rate/spend verification are not implemented."
      },
      commit: process.env.TOOLPROOF_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unversioned"
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
