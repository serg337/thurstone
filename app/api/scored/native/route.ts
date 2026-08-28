import { NextResponse } from "next/server";

import { readBoundedProbeJson } from "@/lib/probe/http";
import { scoredRouteErrorResponse } from "@/lib/scored/route-response";
import { scoredNativeBodySchema, scoredNativeResponseSchema } from "@/lib/scored/service-contract";
import { admitScoredNative } from "@/lib/scored/service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = scoredNativeBodySchema.parse(
      await readBoundedProbeJson(request, {
        maximumBodyBytes: 2_200_000,
        requireCsrfHeader: true
      })
    );
    const receipt = await admitScoredNative(request, body);
    return NextResponse.json(scoredNativeResponseSchema.parse(receipt), {
      status: receipt.status === "admitted" ? 201 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return scoredRouteErrorResponse(error);
  }
}
