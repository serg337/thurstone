import { NextResponse } from "next/server";

import {
  decideSuccessorEvaluation,
  successorEvalErrorResponse
} from "@/lib/successor-eval/service.server";
import { ProbeHttpError, readBoundedProbeJson } from "@/lib/probe/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const input = await readBoundedProbeJson(request, { maximumBodyBytes: 96 * 1024 });
    return NextResponse.json(await decideSuccessorEvaluation(input), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ProbeHttpError) {
      return NextResponse.json(
        { error: error.code, inferencePerformed: false },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    const response = successorEvalErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
