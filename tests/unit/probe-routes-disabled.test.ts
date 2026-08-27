import { describe, expect, it } from "vitest";

import { POST as complete } from "@/app/api/probe/complete/route";
import { POST as decide } from "@/app/api/probe/decide/route";
import { POST as issue } from "@/app/api/probe/issue/route";
import { POST as native } from "@/app/api/probe/native/route";
import { POST as reveal } from "@/app/api/probe/reveal/route";
import { POST as session } from "@/app/api/probe/session/route";

function request(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://toolproof-rust.vercel.app${path}`, {
    method: "POST",
    headers: {
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-toolproof-csrf": "disabled-route-boundary-token-0001",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

describe("Probe routes remain fail-closed before exact activation", () => {
  it("returns one honest no-inference receipt from every active-lane route", async () => {
    const routes: Array<[string, (request: Request) => Promise<Response>, unknown]> = [
      ["/api/probe/session", session, { intent: "start-four-case-calibration" }],
      ["/api/probe/issue", issue, {}],
      ["/api/probe/decide", decide, {}],
      ["/api/probe/native", native, {}],
      ["/api/probe/complete", complete, {}],
      ["/api/probe/reveal", reveal, { continuation: "x".repeat(32) }]
    ];
    for (const [path, route, body] of routes) {
      const response = await route(request(path, body));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "probe_disabled",
        inferencePerformed: false
      });
    }
  });

  it("rejects cross-site and disguised JSON before activation checks", async () => {
    const crossSite = await issue(
      request(
        "/api/probe/issue",
        {},
        {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      )
    );
    expect(crossSite.status).toBe(403);

    const disguised = await decide(
      request("/api/probe/decide", {}, { "content-type": "application/json-evil" })
    );
    expect(disguised.status).toBe(415);
  });
});
