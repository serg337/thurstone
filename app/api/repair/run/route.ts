import { NextResponse } from "next/server";

import { ProbeHttpError, probeHttpErrorResponse, readBoundedProbeJson } from "@/lib/probe/http";
import { RepairServiceError, runFrozenRepairBuilder } from "@/lib/repair/service.server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await readBoundedProbeJson(request, { maximumBodyBytes: 256 }));
    return NextResponse.json(await runFrozenRepairBuilder(body), {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ProbeHttpError) return probeHttpErrorResponse(error);
    if (error instanceof RepairServiceError) {
      return NextResponse.json(
        { error: error.code, inferencePerformed: error.inferencePerformed },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_request", inferencePerformed: false },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: "repair_request_failed", inferencePerformed: false },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
