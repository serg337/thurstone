import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import { requireProbeActivation } from "@/lib/probe/activation";
import { probeSessionStartBodySchema } from "@/lib/probe/service-contract";
import { startProbeCalibrationSession } from "@/lib/probe/service";
import {
  PROBE_RESULTS_COOKIE,
  PROBE_SESSION_COOKIE,
  probeSessionCookieOptions
} from "@/lib/probe/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, { maximumBodyBytes: 256 });
    probeSessionStartBodySchema.parse(body);
    const session = await startProbeCalibrationSession(request);
    const response = NextResponse.json(
      {
        version: 1,
        csrfToken: session.csrfToken,
        continuation: session.continuation,
        buildCommit: session.buildCommit,
        expiresAt: session.expiresAt,
        inferencePerformed: false
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(PROBE_SESSION_COOKIE, session.cookieValue, probeSessionCookieOptions());
    return response;
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (
    request.headers.get("origin") !== "https://toolproof-rust.vercel.app" ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return NextResponse.json(
      { error: "request_rejected", inferencePerformed: false },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const activation = await requireProbeActivation();
    if (activation.guard.phase !== "idle" || activation.guard.calibrationCalls !== 0) {
      return NextResponse.json(
        { error: "session_recovery_required", inferencePerformed: false },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "session_recovery_required", inferencePerformed: false },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  const response = NextResponse.json(
    { ok: true, inferencePerformed: false },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set(PROBE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  response.cookies.set(PROBE_RESULTS_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  return response;
}
