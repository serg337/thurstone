import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import { scoredFailureBodySchema } from "@/lib/scored/service-contract";
import { recordScoredTrialFailure } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredFailureBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 2_200_000,
        requireCsrfHeader: true
      })
    );
    const receipt = await recordScoredTrialFailure(request, body);
    return NextResponse.json(
      {
        ok: true,
        status: receipt.progress.status,
        completedCount: receipt.progress.completedCount,
        currentOrdinal: receipt.progress.currentOrdinal,
        currentAttempt: receipt.progress.currentAttempt,
        terminal: receipt.progress.status !== "active",
        inferencePerformed: receipt.inferencePerformed
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
