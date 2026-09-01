import "server-only";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Maximum encoded request body accepted by the small handoff control routes. */
export const BYOA_HANDOFF_CONTROL_MAX_BODY_BYTES = 16 * 1024;

export class ByoaHandoffHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "ByoaHandoffHttpError";
  }
}

export async function readBoundedHandoffJson(
  request: Request,
  maximumBodyBytes: number = BYOA_HANDOFF_CONTROL_MAX_BODY_BYTES
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes < 2) {
    throw new RangeError("maximumBodyBytes must be a safe integer of at least two bytes.");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new ByoaHandoffHttpError("handoff_content_length_invalid", 400);
    }
    if (declaredLength > maximumBodyBytes) {
      throw new ByoaHandoffHttpError("handoff_body_too_large", 413);
    }
  }
  if (!request.body) throw new ByoaHandoffHttpError("handoff_json_invalid", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBodyBytes) {
        await reader.cancel("handoff_body_too_large");
        throw new ByoaHandoffHttpError("handoff_body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytesRead === 0) throw new ByoaHandoffHttpError("handoff_json_invalid", 400);
  if (contentLength !== null && Number(contentLength) !== bytesRead) {
    throw new ByoaHandoffHttpError("handoff_content_length_mismatch", 400);
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(source) as unknown;
  } catch (caught) {
    if (caught instanceof ByoaHandoffHttpError) throw caught;
    throw new ByoaHandoffHttpError("handoff_json_invalid", 400);
  }
}

export function isTrustedHandoffRequest(request: Request): boolean {
  if (request.headers.get("x-thurstone-request") !== "byoa-handoff") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return process.env.NODE_ENV !== "production";
  try {
    const supplied = new URL(origin);
    const target = new URL(request.url);
    if (supplied.origin === target.origin) return true;
    return (
      process.env.NODE_ENV !== "production" &&
      LOOPBACK_HOSTS.has(supplied.hostname) &&
      LOOPBACK_HOSTS.has(target.hostname) &&
      supplied.port === target.port
    );
  } catch {
    return false;
  }
}

export function trustedHandoffClientOrigin(request: Request): string | null {
  const value = request.headers.get("x-thurstone-origin");
  if (!value) return null;
  try {
    const supplied = new URL(value);
    const target = new URL(request.url);
    if (supplied.origin === target.origin) return supplied.origin;
    if (
      process.env.NODE_ENV !== "production" &&
      LOOPBACK_HOSTS.has(supplied.hostname) &&
      LOOPBACK_HOSTS.has(target.hostname) &&
      supplied.port === target.port
    ) {
      return supplied.origin;
    }
    return null;
  } catch {
    return null;
  }
}
