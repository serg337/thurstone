import "server-only";

import { NextResponse } from "next/server";

import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";

const MAX_DISABLED_ROUTE_BODY_BYTES = 4_096;

export function rejectInvalidProbeRequest(request: Request): NextResponse | undefined {
  const origin = request.headers.get("origin");
  if (origin !== PROBE_PRODUCTION_ORIGIN) {
    return NextResponse.json({ error: "request_rejected" }, { status: 403 });
  }

  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return NextResponse.json({ error: "request_rejected" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return NextResponse.json({ error: "request_rejected" }, { status: 400 });
    }
    if (parsedLength > MAX_DISABLED_ROUTE_BODY_BYTES) {
      return NextResponse.json({ error: "body_too_large" }, { status: 413 });
    }
  }

  return undefined;
}

export function probeDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: "probe_disabled", inferencePerformed: false },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
