import { NextResponse } from "next/server";

import { judgeDemoRunBodySchema } from "@/lib/judge/contract";
import {
  decideJudgeDemo,
  judgeDemoServiceErrorResponse,
  readJudgeDemoStatus
} from "@/lib/judge/service.server";
import { ProbeHttpError, readBoundedProbeJson } from "@/lib/probe/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  return NextResponse.json(await readJudgeDemoStatus(), {
    status: 200,
    headers: {
      "Cache-Control": fresh
        ? "no-store"
        : "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
    }
  });
}

export async function POST(request: Request) {
  try {
    judgeDemoRunBodySchema.parse(await readBoundedProbeJson(request, { maximumBodyBytes: 128 }));
    const receipt = await decideJudgeDemo(request);
    return NextResponse.json(receipt, {
      status: receipt.status === "fresh" ? 201 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ProbeHttpError) {
      return NextResponse.json(
        { error: error.code, inferencePerformed: false },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    const response = judgeDemoServiceErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
