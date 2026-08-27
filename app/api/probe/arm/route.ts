import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { armProbeCalibrationOperator } from "@/lib/probe/service";
import { probeOperatorArmBodySchema } from "@/lib/probe/service-contract";
import { PROBE_OPERATOR_COOKIE, probeOperatorCookieOptions } from "@/lib/probe/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = probeOperatorArmBodySchema.parse(
      await readBoundedProbeJson(request, { maximumBodyBytes: 256 })
    );
    const armed = await armProbeCalibrationOperator(request, body.capability);
    const response = NextResponse.json(
      { ok: true, status: "armed", inferencePerformed: false },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(PROBE_OPERATOR_COOKIE, armed.cookieValue, probeOperatorCookieOptions());
    return response;
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}
