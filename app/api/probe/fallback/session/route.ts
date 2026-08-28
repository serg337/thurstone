import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { probeRouteErrorResponse } from "@/lib/probe/route-response";
import {
  FALLBACK_PROBE_CALIBRATION_LANE,
  FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
  FALLBACK_PROBE_SESSION_RESPONSE_VERSION,
  fallbackProbeSessionRecoverBodySchema,
  fallbackProbeSessionRecoveryResponseSchema,
  fallbackProbeSessionStartBodySchema,
  fallbackProbeSessionStartResponseSchema
} from "@/lib/probe/service-contract";
import {
  clearUnstartedFallbackProbeCalibrationSession,
  recoverFallbackProbeCalibrationSession,
  startFallbackProbeCalibrationSession
} from "@/lib/probe/service";
import {
  PROBE_OPERATOR_COOKIE,
  PROBE_RECOVERY_COOKIE,
  PROBE_RESULTS_COOKIE,
  PROBE_SESSION_COOKIE,
  probeRecoveryCookieOptions,
  probeSessionCookieOptions
} from "@/lib/probe/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = fallbackProbeSessionStartBodySchema.parse(
      await readBoundedProbeJson(request, { maximumBodyBytes: 256 })
    );
    const session = await startFallbackProbeCalibrationSession(request, body.launchId);
    const response = NextResponse.json(
      fallbackProbeSessionStartResponseSchema.parse({
        version: FALLBACK_PROBE_SESSION_RESPONSE_VERSION,
        protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
        lane: FALLBACK_PROBE_CALIBRATION_LANE,
        csrfToken: session.csrfToken,
        continuation: session.continuation,
        buildCommit: session.buildCommit,
        expiresAt: session.expiresAt,
        recoveryExpiresAt: session.recoveryExpiresAt,
        inferencePerformed: false
      }),
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
    for (const name of [PROBE_RESULTS_COOKIE, PROBE_OPERATOR_COOKIE]) {
      response.cookies.set(name, "", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0
      });
    }
    response.cookies.set(PROBE_SESSION_COOKIE, session.cookieValue, probeSessionCookieOptions());
    response.cookies.set(
      PROBE_RECOVERY_COOKIE,
      session.recoveryCookieValue,
      probeRecoveryCookieOptions()
    );
    return response;
  } catch (error) {
    return probeRouteErrorResponse(error);
  }
}

export async function PUT(request: Request) {
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
    const body = fallbackProbeSessionRecoverBodySchema.parse(
      await readBoundedProbeJson(request, { maximumBodyBytes: 256, allowedMethod: "PUT" })
    );
    const recovered = await recoverFallbackProbeCalibrationSession(request, body.documentId);
    const response = NextResponse.json(
      fallbackProbeSessionRecoveryResponseSchema.parse({
        version: FALLBACK_PROBE_SESSION_RESPONSE_VERSION,
        protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
        lane: FALLBACK_PROBE_CALIBRATION_LANE,
        status: "recovered",
        csrfToken: recovered.csrfToken,
        continuation: recovered.continuation,
        buildCommit: recovered.buildCommit,
        expiresAt: recovered.expiresAt,
        recoveryExpiresAt: recovered.recoveryExpiresAt,
        path: recovered.path,
        inferencePerformed: false
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(PROBE_SESSION_COOKIE, recovered.cookieValue, probeSessionCookieOptions());
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
    await clearUnstartedFallbackProbeCalibrationSession(request);
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
