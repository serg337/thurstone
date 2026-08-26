import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "toolproof",
      simulation: true,
      commit: process.env.TOOLPROOF_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unversioned"
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
