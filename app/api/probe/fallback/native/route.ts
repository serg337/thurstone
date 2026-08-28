import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { admitFallbackProbeNativeDispatch } from "@/lib/probe/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, {
      maximumBodyBytes: 512 * 1_024,
      requireCsrfHeader: true
    });
    const receipt = await admitFallbackProbeNativeDispatch(request, body);
    return NextResponse.json(receipt, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}
