import { describe, expect, it } from "vitest";

import {
  ProbeHttpError,
  assertProbeRequestBoundary,
  probeDisabledResponse,
  probeHttpErrorResponse,
  readBoundedProbeJson,
  rejectInvalidProbeRequest
} from "@/lib/probe/http";

function request(headers: Record<string, string>) {
  return new Request("https://toolproof-rust.vercel.app/api/probe/issue", {
    method: "POST",
    headers
  });
}

describe("disabled Probe HTTP boundary", () => {
  it("requires the exact production origin, same-origin fetch metadata, and JSON", () => {
    expect(
      rejectInvalidProbeRequest(
        request({
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
          "content-type": "application/json"
        })
      )?.status
    ).toBe(403);
    expect(
      rejectInvalidProbeRequest(
        request({
          origin: "https://toolproof-rust.vercel.app",
          "sec-fetch-site": "same-origin",
          "content-type": "text/plain"
        })
      )?.status
    ).toBe(415);
  });

  it("rejects declared oversized bodies and otherwise stays disabled", async () => {
    const validHeaders = {
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json"
    };
    expect(
      rejectInvalidProbeRequest(request({ ...validHeaders, "content-length": "4097" }))?.status
    ).toBe(413);
    expect(rejectInvalidProbeRequest(request(validHeaders))).toBeUndefined();

    const response = probeDisabledResponse();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "probe_disabled",
      inferencePerformed: false
    });
  });

  it("enforces the active boundary and reads a body using its actual streamed bytes", async () => {
    const body = JSON.stringify({ value: "x".repeat(24) });
    const active = new Request("https://toolproof-rust.vercel.app/api/probe/decide", {
      method: "POST",
      headers: {
        origin: "https://toolproof-rust.vercel.app",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "content-type": "application/json",
        "x-toolproof-csrf": "a".repeat(32)
      },
      body
    });
    await expect(
      readBoundedProbeJson(active, { maximumBodyBytes: 128, requireCsrfHeader: true })
    ).resolves.toEqual({ value: "x".repeat(24) });

    const oversized = new Request("https://toolproof-rust.vercel.app/api/probe/decide", {
      method: "POST",
      headers: {
        origin: "https://toolproof-rust.vercel.app",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-toolproof-csrf": "b".repeat(32)
      },
      body: JSON.stringify({ value: "x".repeat(256) })
    });
    await expect(
      readBoundedProbeJson(oversized, { maximumBodyBytes: 64, requireCsrfHeader: true })
    ).rejects.toMatchObject({ code: "body_too_large", status: 413 });
  });

  it("fails closed on CSRF/fetch metadata and redacts unexpected errors", async () => {
    const active = request({
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json"
    });
    expect(() =>
      assertProbeRequestBoundary(active, {
        maximumBodyBytes: 4_096,
        requireCsrfHeader: true
      })
    ).toThrowError(ProbeHttpError);
    const response = probeHttpErrorResponse(new Error("secret provider detail"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "request_failed",
      inferencePerformed: false
    });

    const disguisedJson = request({
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json-evil"
    });
    expect(() =>
      assertProbeRequestBoundary(disguisedJson, { maximumBodyBytes: 4_096 })
    ).toThrowError(/unsupported_media_type/u);
  });
});
