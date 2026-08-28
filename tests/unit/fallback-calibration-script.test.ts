import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("fallback calibration operator script", () => {
  it("renews the short session after the human ACK gate before deletion", async () => {
    const source = await readFile(
      resolve(process.cwd(), "scripts/fallback-calibration.ts"),
      "utf8"
    );
    const gate = source.lastIndexOf('After human approval, type "ACK"');
    const recovery = source.indexOf(
      "const acknowledgementSession = await recoverFallbackBrowserSession",
      gate
    );
    const rebuiltAdapter = source.indexOf("const acknowledgementAdapter = new", recovery);
    const acknowledgement = source.indexOf("await acknowledgementAdapter.acknowledge()", recovery);

    expect(gate).toBeGreaterThan(0);
    expect(recovery).toBeGreaterThan(gate);
    expect(rebuiltAdapter).toBeGreaterThan(recovery);
    expect(acknowledgement).toBeGreaterThan(rebuiltAdapter);
    expect(source.slice(recovery, acknowledgement)).toContain(
      "acknowledgementSession.continuation !== session.continuation"
    );
    expect(source.slice(recovery, acknowledgement)).toContain(
      'acknowledgementSession.path !== "/results"'
    );
  });
});
