import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import {
  scoredDecisionBodySchema,
  scoredDecisionResponseSchema
} from "@/lib/scored/service-contract";
import { decideScoredTrial } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredDecisionBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 2_200_000,
        requireCsrfHeader: true
      })
    );
    const receipt = await decideScoredTrial(request, body);
    return NextResponse.json(scoredDecisionResponseSchema.parse(receipt), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
