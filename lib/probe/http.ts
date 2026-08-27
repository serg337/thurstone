import "server-only";

import { NextResponse } from "next/server";

import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";

const MAX_DISABLED_ROUTE_BODY_BYTES = 4_096;

export class ProbeHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "ProbeHttpError";
  }
}

export interface ProbeRequestBoundaryOptions {
  readonly maximumBodyBytes: number;
  readonly requireCsrfHeader?: boolean;
  readonly allowedMethod?: "POST" | "PUT" | "DELETE";
}

function declaredBodyLength(request: Request, maximumBodyBytes: number): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return;
  const parsedLength = Number(contentLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
    throw new ProbeHttpError("request_rejected", 400);
  }
  if (parsedLength > maximumBodyBytes) throw new ProbeHttpError("body_too_large", 413);
}

export function assertProbeRequestBoundary(
  request: Request,
  options: ProbeRequestBoundaryOptions
): void {
  if (!Number.isSafeInteger(options.maximumBodyBytes) || options.maximumBodyBytes < 2) {
    throw new RangeError("maximumBodyBytes must be a safe integer of at least two bytes.");
  }
  if (request.method !== (options.allowedMethod ?? "POST")) {
    throw new ProbeHttpError("method_not_allowed", 405);
  }
  if (request.headers.get("origin") !== PROBE_PRODUCTION_ORIGIN) {
    throw new ProbeHttpError("request_rejected", 403);
  }
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new ProbeHttpError("request_rejected", 403);
  }
  const fetchMode = request.headers.get("sec-fetch-mode");
  if (fetchMode !== null && fetchMode !== "cors" && fetchMode !== "same-origin") {
    throw new ProbeHttpError("request_rejected", 403);
  }
  const fetchDestination = request.headers.get("sec-fetch-dest");
  if (fetchDestination !== null && fetchDestination !== "empty") {
    throw new ProbeHttpError("request_rejected", 403);
  }
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType)) {
    throw new ProbeHttpError("unsupported_media_type", 415);
  }
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new ProbeHttpError("unsupported_content_encoding", 415);
  }
  if (options.requireCsrfHeader) {
    const csrf = request.headers.get("x-toolproof-csrf");
    if (!csrf || !/^[A-Za-z0-9_-]{32,128}$/u.test(csrf)) {
      throw new ProbeHttpError("request_rejected", 403);
    }
  }
  declaredBodyLength(request, options.maximumBodyBytes);
}

export async function readBoundedProbeJson(
  request: Request,
  options: ProbeRequestBoundaryOptions
): Promise<unknown> {
  assertProbeRequestBoundary(request, options);
  if (!request.body) throw new ProbeHttpError("invalid_json", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > options.maximumBodyBytes) {
        await reader.cancel("body_too_large");
        throw new ProbeHttpError("body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytesRead === 0) throw new ProbeHttpError("invalid_json", 400);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== bytesRead) {
    throw new ProbeHttpError("content_length_mismatch", 400);
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProbeHttpError("invalid_json", 400);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ProbeHttpError("invalid_json", 400);
  }
}

export function probeHttpErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProbeHttpError) {
    return NextResponse.json(
      { error: error.code, inferencePerformed: false },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { error: "request_failed", inferencePerformed: false },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

export function rejectInvalidProbeRequest(request: Request): NextResponse | undefined {
  try {
    assertProbeRequestBoundary(request, {
      maximumBodyBytes: MAX_DISABLED_ROUTE_BODY_BYTES
    });
    return undefined;
  } catch (error) {
    if (error instanceof ProbeHttpError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "request_rejected" }, { status: 400 });
  }
}

export function probeDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: "probe_disabled", inferencePerformed: false },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
