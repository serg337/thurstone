import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { completeFallbackProbeCalibrationTrial } from "@/lib/probe/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, {
      maximumBodyBytes: 3_500_000,
      requireCsrfHeader: true
    });
    const receipt = await completeFallbackProbeCalibrationTrial(request, body);
    return NextResponse.json(receipt, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}
