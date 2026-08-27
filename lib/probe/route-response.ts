import "server-only";

import { NextResponse } from "next/server";

import { ProbeHttpError } from "@/lib/probe/http";
import { ProbeServiceError } from "@/lib/probe/service";
import { z } from "zod";

export function probeRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProbeHttpError) {
    return NextResponse.json(
      { error: error.code, inferencePerformed: false },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (error instanceof ProbeServiceError) {
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
    { error: "probe_request_failed", inferencePerformed: false },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}
