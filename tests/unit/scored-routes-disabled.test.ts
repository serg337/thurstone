import { GET as readiness } from "@/app/api/scored/readiness/route";
import { POST as startSession } from "@/app/api/scored/session/route";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { afterEach, describe, expect, it, vi } from "vitest";

function request(body: unknown): Request {
  return new Request(`${PROBE_PRODUCTION_ORIGIN}/api/scored/session`, {
    method: "POST",
    headers: {
      Origin: PROBE_PRODUCTION_ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => vi.restoreAllMocks());

describe("scored routes before the genuine Gate 3 freeze", () => {
  it("reports not ready without performing inference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await readiness();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not-ready",
      providerCallPerformed: false
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects even a well-formed start request until human approval is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await startSession(
      request({
        intent: "start-frozen-toolproof-scored-run",
        capability: "c".repeat(43),
        phase: "baseline",
        launchId: `launch_${"l".repeat(22)}`,
        documentId: `document_${"d".repeat(22)}`
      })
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "scored_configuration_missing",
      inferencePerformed: false
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("categorically rejects revised execution until the distinct Gate 5 freeze exists", async () => {
    const response = await startSession(
      request({
        intent: "start-frozen-toolproof-scored-run",
        capability: "c".repeat(43),
        phase: "revised",
        launchId: `launch_${"l".repeat(22)}`,
        documentId: `document_${"d".repeat(22)}`
      })
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "scored_configuration_missing",
      inferencePerformed: false
    });
  });
});
