import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { probeAcknowledgeBodySchema, probeRevealBodySchema } from "@/lib/probe/service-contract";
import {
  acknowledgeFallbackProbeCalibrationRun,
  revealFallbackProbeCalibrationRun
} from "@/lib/probe/service";
import {
  PROBE_OPERATOR_COOKIE,
  PROBE_RECOVERY_COOKIE,
  PROBE_RESULTS_COOKIE,
  PROBE_SESSION_COOKIE
} from "@/lib/probe/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = probeRevealBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 1_900_000,
        requireCsrfHeader: true
      })
    );
    const receipt = await revealFallbackProbeCalibrationRun(request, body.continuation);
    return NextResponse.json(receipt, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = probeAcknowledgeBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 1_900_000,
        requireCsrfHeader: true,
        allowedMethod: "DELETE"
      })
    );
    await acknowledgeFallbackProbeCalibrationRun(request, body.continuation);
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
  const response = NextResponse.json(
    { ok: true, inferencePerformed: false },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
  for (const name of [
    PROBE_SESSION_COOKIE,
    PROBE_RESULTS_COOKIE,
    PROBE_RECOVERY_COOKIE,
    PROBE_OPERATOR_COOKIE
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0
    });
  }
  return response;
}
