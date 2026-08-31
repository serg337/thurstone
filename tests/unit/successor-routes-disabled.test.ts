import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/successor-eval/decide/route";

function request(origin: string) {
  return new Request("https://thurstone.invarra.ai/api/successor-eval/decide", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/lab`,
      "Sec-Fetch-Site": "same-origin"
    },
    body: JSON.stringify({})
  });
}

describe("successor evaluation route boundary", () => {
  it("is unavailable unless the exact temporary operator lane is enabled", async () => {
    const response = await POST(request("https://thurstone.invarra.ai"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "successor_eval_disabled",
      inferencePerformed: false
    });
  });

  it("rejects cross-origin requests before successor service admission", async () => {
    const response = await POST(request("https://example.invalid"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ inferencePerformed: false });
  });
});
