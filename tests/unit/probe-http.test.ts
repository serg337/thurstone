import { describe, expect, it } from "vitest";

import { probeDisabledResponse, rejectInvalidProbeRequest } from "@/lib/probe/http";

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
});
