import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import {
  SCORED_SERVICE_MAX_BODY_BYTES,
  scoredCompleteBodySchema,
  scoredCompleteResponseSchema
} from "@/lib/scored/service-contract";
import { completeScoredTrial } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredCompleteBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: SCORED_SERVICE_MAX_BODY_BYTES,
        requireCsrfHeader: true
      })
    );
    const receipt = await completeScoredTrial(request, body);
    return NextResponse.json(scoredCompleteResponseSchema.parse(receipt), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
