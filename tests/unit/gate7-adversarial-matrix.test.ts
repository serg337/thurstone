import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import {
  createProbeFixtureSynopsis,
  probeFixtureSynopsisSchema
} from "@/lib/probe/calibration-envelope";
import { PROBE_LEDGER_SCRIPTS } from "@/lib/probe/ledger";
import {
  GATE7_ADVERSARIAL_MATRIX,
  buildGate7AdversarialEvidence,
  verifyGate7AdversarialSourceCoverage
} from "@/scripts/verify-gate7-adversarial-matrix";

describe("Gate 7 consolidated adversarial matrix", () => {
  it("rejects stale fixture identity/version and pins durable admission ceilings", () => {
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    expect(
      probeFixtureSynopsisSchema.safeParse({
        ...fixture,
        fixtureVersion: "checkout-fixture@stale"
      }).success
    ).toBe(false);
    expect(
      probeFixtureSynopsisSchema.safeParse({
        ...fixture,
        fixtureId: "checkout-seed-stale"
      }).success
    ).toBe(false);

    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "CONCURRENCY_LIMIT"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "GLOBAL_CALL_LIMIT"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "PURPOSE_CALL_LIMIT"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "SPEND_LIMIT"}');
  });

  it("fails closed if any required case, source assertion, or classification drifts", () => {
    expect(() => verifyGate7AdversarialSourceCoverage(process.cwd())).not.toThrow();
    expect(GATE7_ADVERSARIAL_MATRIX).toHaveLength(21);
    expect(
      GATE7_ADVERSARIAL_MATRIX.every(
        (entry) => entry.semanticAccounting === "excluded_from_model_scores"
      )
    ).toBe(true);
  });

  it("matches the retained deterministic, provider-free evidence byte for byte", () => {
    const expected = `${JSON.stringify(buildGate7AdversarialEvidence(process.cwd()), null, 2)}\n`;
    const retained = readFileSync(
      resolve(process.cwd(), "evidence/gate7/adversarial-matrix.json"),
      "utf8"
    );
    expect(retained).toBe(expected);
  });
});
