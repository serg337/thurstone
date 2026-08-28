import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import {
  scoredSessionRecoveryBodySchema,
  scoredSessionResponseSchema,
  scoredSessionStartBodySchema
} from "@/lib/scored/service-contract";
import { recoverScoredSession, startScoredSession } from "@/lib/scored/service.server";
import {
  SCORED_RECOVERY_COOKIE,
  SCORED_RESULTS_COOKIE,
  SCORED_SESSION_COOKIE,
  scoredRecoveryCookieOptions,
  scoredSessionCookieOptions
} from "@/lib/scored/session.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredSessionStartBodySchema.parse(
      await readBoundedProbeJson(request, { maximumBodyBytes: 1_024 })
    );
    const result = await startScoredSession(request, body);
    const { sessionCookieValue, recoveryCookieValue, ...publicReceipt } = result;
    const response = NextResponse.json(scoredSessionResponseSchema.parse(publicReceipt), {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
    response.cookies.set(SCORED_RESULTS_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0
    });
    response.cookies.set(SCORED_SESSION_COOKIE, sessionCookieValue, scoredSessionCookieOptions());
    response.cookies.set(
      SCORED_RECOVERY_COOKIE,
      recoveryCookieValue,
      scoredRecoveryCookieOptions()
    );
    return response;
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = scoredSessionRecoveryBodySchema.parse(
      await readBoundedProbeJson(request, { maximumBodyBytes: 512, allowedMethod: "PUT" })
    );
    const result = await recoverScoredSession(request, body);
    const { sessionCookieValue, ...publicReceipt } = result;
    const response = NextResponse.json(scoredSessionResponseSchema.parse(publicReceipt), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
    response.cookies.set(SCORED_SESSION_COOKIE, sessionCookieValue, scoredSessionCookieOptions());
    if (publicReceipt.path === "/results") {
      response.cookies.set(SCORED_RESULTS_COOKIE, "terminal", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 4 * 60 * 60
      });
    }
    return response;
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
