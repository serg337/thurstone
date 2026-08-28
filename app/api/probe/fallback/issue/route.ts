import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { issueFallbackProbeCalibrationTrial } from "@/lib/probe/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, {
      maximumBodyBytes: 2_200_000,
      requireCsrfHeader: true
    });
    const receipt = await issueFallbackProbeCalibrationTrial(request, body);
    return NextResponse.json(receipt, {
      status: receipt.status === "issued" ? 201 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}
