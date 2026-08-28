import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import {
  scoredAuthorizationResponseSchema,
  scoredIssueBodySchema
} from "@/lib/scored/service-contract";
import { issueScoredTrial } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredIssueBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 2_200_000,
        requireCsrfHeader: true
      })
    );
    const receipt = await issueScoredTrial(request, body);
    return NextResponse.json(scoredAuthorizationResponseSchema.parse(receipt), {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
