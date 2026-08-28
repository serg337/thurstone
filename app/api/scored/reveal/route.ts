import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import { scoredAcknowledgeBodySchema, scoredRevealBodySchema } from "@/lib/scored/service-contract";
import { acknowledgeVerifiedScoredRun, revealScoredRun } from "@/lib/scored/service.server";
import {
  SCORED_RECOVERY_COOKIE,
  SCORED_RESULTS_COOKIE,
  SCORED_SESSION_COOKIE
} from "@/lib/scored/session.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    scoredRevealBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 256,
        requireCsrfHeader: true
      })
    );
    return NextResponse.json(await revealScoredRun(request), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = scoredAcknowledgeBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 512,
        requireCsrfHeader: true,
        allowedMethod: "DELETE"
      })
    );
    const receipt = await acknowledgeVerifiedScoredRun(request, body.evidenceDigest);
    const response = NextResponse.json(
      { ok: true, ...receipt },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    for (const name of [SCORED_SESSION_COOKIE, SCORED_RECOVERY_COOKIE, SCORED_RESULTS_COOKIE]) {
      response.cookies.set(name, "", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0
      });
    }
    return response;
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
