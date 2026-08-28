import { NextResponse } from "next/server";

import { readGate3ScoredReadiness } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const receipt = await readGate3ScoredReadiness();
  return NextResponse.json(receipt, {
    status: receipt.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=15"
    }
  });
}
