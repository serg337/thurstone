import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { parseInvocationIntegrityTranscript } from "@/lib/invocation-integrity/contract";
import {
  InvocationIntegrityVerificationError,
  verifyInvocationIntegrityTranscript
} from "@/lib/invocation-integrity/verifier.server";
import { ProbeHttpError, readBoundedProbeJson } from "@/lib/probe/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TRANSCRIPT_BYTES = 262_144;

export async function POST(request: Request) {
  try {
    const body = await readBoundedProbeJson(request, {
      maximumBodyBytes: MAX_TRANSCRIPT_BYTES
    });
    const transcript = parseInvocationIntegrityTranscript(body);
    const receipt = await verifyInvocationIntegrityTranscript(transcript);
    return NextResponse.json(receipt, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ProbeHttpError) {
      return NextResponse.json(
        { error: error.code, inferencePerformed: false },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "invocation_integrity_transcript_invalid", inferencePerformed: false },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof InvocationIntegrityVerificationError) {
      return NextResponse.json(
        { error: error.code, inferencePerformed: false },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: "invocation_integrity_verification_failed", inferencePerformed: false },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
