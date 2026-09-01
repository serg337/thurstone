import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BYOA_HANDOFF_CONTROL_MAX_BODY_BYTES,
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson,
  trustedHandoffClientOrigin
} from "@/lib/demo/agent-handoff-http.server";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://thurstone.invarra.ai/api/demo/handoff/prepare", {
    method: "POST",
    headers
  });
}

describe("BYOA handoff HTTP boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the exact same-origin custom-header request", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      isTrustedHandoffRequest(
        request({
          Origin: "https://thurstone.invarra.ai",
          "X-Thurstone-Request": "byoa-handoff"
        })
      )
    ).toBe(true);
  });

  it("rejects missing headers, foreign origins, and originless production writes", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTrustedHandoffRequest(request())).toBe(false);
    expect(
      isTrustedHandoffRequest(
        request({ Origin: "https://attacker.example", "X-Thurstone-Request": "byoa-handoff" })
      )
    ).toBe(false);
    expect(isTrustedHandoffRequest(request({ "X-Thurstone-Request": "byoa-handoff" }))).toBe(false);
  });

  it("accepts originless writes only for local test and development clients", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isTrustedHandoffRequest(request({ "X-Thurstone-Request": "byoa-handoff" }))).toBe(true);
  });

  it("derives handoff links only from a verified client origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      trustedHandoffClientOrigin(request({ "X-Thurstone-Origin": "https://thurstone.invarra.ai" }))
    ).toBe("https://thurstone.invarra.ai");
    expect(
      trustedHandoffClientOrigin(request({ "X-Thurstone-Origin": "https://attacker.example" }))
    ).toBeNull();
    expect(trustedHandoffClientOrigin(request())).toBeNull();
  });

  it("parses a bounded JSON body and rejects declared or streamed oversize before parsing", async () => {
    const valid = new Request("https://thurstone.invarra.ai/api/demo/handoff/open", {
      method: "POST",
      body: JSON.stringify({ token: "opaque" })
    });
    await expect(readBoundedHandoffJson(valid)).resolves.toEqual({ token: "opaque" });

    const declared = new Request("https://thurstone.invarra.ai/api/demo/handoff/open", {
      method: "POST",
      headers: { "Content-Length": String(BYOA_HANDOFF_CONTROL_MAX_BODY_BYTES + 1) },
      body: "{}"
    });
    await expect(readBoundedHandoffJson(declared)).rejects.toMatchObject({
      code: "handoff_body_too_large",
      status: 413
    });

    const streamed = new Request("https://thurstone.invarra.ai/api/demo/handoff/open", {
      method: "POST",
      body: JSON.stringify({ padding: "x".repeat(BYOA_HANDOFF_CONTROL_MAX_BODY_BYTES) })
    });
    await expect(readBoundedHandoffJson(streamed)).rejects.toBeInstanceOf(ByoaHandoffHttpError);
  });
});
