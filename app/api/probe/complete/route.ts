import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { completeProbeCalibrationTrial } from "@/lib/probe/service";
import { PROBE_RESULTS_COOKIE } from "@/lib/probe/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, {
      maximumBodyBytes: 3_500_000,
      requireCsrfHeader: true
    });
    const receipt = await completeProbeCalibrationTrial(request, body);
    const response = NextResponse.json(receipt, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
    if (receipt.terminal) {
      response.cookies.set(PROBE_RESULTS_COOKIE, "terminal", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 20 * 60
      });
    }
    return response;
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}
