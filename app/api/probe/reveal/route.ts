import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { requireProbeActivation } from "@/lib/probe/activation";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { revealProbeCalibrationRun } from "@/lib/probe/service";
import { probeRevealBodySchema } from "@/lib/probe/service-contract";
import { PROBE_RESULTS_COOKIE, PROBE_SESSION_COOKIE } from "@/lib/probe/session";

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
    const receipt = await revealProbeCalibrationRun(request, body.continuation);
    return NextResponse.json(receipt, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (
    request.headers.get("origin") !== "https://toolproof-rust.vercel.app" ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    !request.headers.get("x-toolproof-csrf")
  ) {
    return NextResponse.json(
      { error: "request_rejected", inferencePerformed: false },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const activation = await requireProbeActivation();
    if (
      activation.guard.phase !== "idle" ||
      activation.guard.calibrationCalls !== 4 ||
      activation.guard.knownCalls !== 4
    ) {
      return NextResponse.json(
        { error: "terminal_evidence_required", inferencePerformed: false },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "terminal_evidence_required", inferencePerformed: false },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  const response = NextResponse.json(
    { ok: true, inferencePerformed: false },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
  for (const name of [PROBE_SESSION_COOKIE, PROBE_RESULTS_COOKIE]) {
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
