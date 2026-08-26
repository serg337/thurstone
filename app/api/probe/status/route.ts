import { NextResponse } from "next/server";

import { readPublicProbeControlStatus } from "@/lib/probe/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const receipt = await readPublicProbeControlStatus();
  return NextResponse.json(receipt, {
    status: receipt.status === "controls-ready" ? 200 : 503,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" }
  });
}
