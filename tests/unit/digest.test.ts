import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

describe("canonical evidence bytes", () => {
  it("orders object keys deterministically", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: false } })).toBe(
      '{"a":{"b":false,"y":true},"z":1}'
    );
  });

  it("produces the same digest for equivalent key order", async () => {
    await expect(canonicalSha256({ b: 2, a: 1 })).resolves.toBe(
      await canonicalSha256({ a: 1, b: 2 })
    );
  });
});
