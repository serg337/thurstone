import { createProbeRedis } from "../lib/probe/ledger";
import {
  GATE3_FROZEN_PROTOCOL_HASH_ENV,
  configuredGate3FrozenProtocol
} from "../lib/semantic/frozen-config.server";
import { putGate3Freeze, readGate3Freeze } from "../lib/semantic/freeze-store.server";
import { configuredGate3ReviewPackage } from "../lib/semantic/review-package-config.server";

const confirmationName = "TOOLPROOF_GATE3_FREEZE_PERSIST_CONFIRMATION";
const configured = await configuredGate3FrozenProtocol();

if (configured.status === "awaiting-human") {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "gate3-freeze-bootstrap", status: "awaiting-human" })}\n`
  );
} else if (configured.status !== "frozen" || !configured.protocol) {
  throw new Error(configured.issue ?? "gate3_frozen_configuration_invalid");
} else {
  const redis = createProbeRedis();
  const artifactSecret = process.env.TOOLPROOF_SIGNING_SECRET?.trim();
  if (!artifactSecret) throw new Error("gate3_freeze_artifact_secret_missing");
  const existing = await readGate3Freeze(redis, {
    frozenProtocolHash: configured.protocol.frozenProtocolHash,
    artifactSecret
  });
  if (existing) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "gate3-freeze-bootstrap",
        status: "stored",
        frozenProtocolHash: existing.frozenProtocol.frozenProtocolHash,
        reviewPackageHash: existing.reviewPackage.packageHash
      })}\n`
    );
  } else {
    if (
      process.env[confirmationName]?.trim() !== configured.protocol.frozenProtocolHash ||
      process.env[GATE3_FROZEN_PROTOCOL_HASH_ENV]
    ) {
      throw new Error("gate3_freeze_persistence_confirmation_required");
    }
    const review = await configuredGate3ReviewPackage();
    if (!review.reviewPackage) throw new Error("gate3_review_package_missing");
    const stored = await putGate3Freeze(redis, {
      reviewPackage: review.reviewPackage,
      frozenProtocol: configured.protocol,
      artifactSecret
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "gate3-freeze-bootstrap",
        status: "stored",
        disposition: stored.disposition,
        frozenProtocolHash: stored.frozenProtocol.frozenProtocolHash,
        reviewPackageHash: stored.reviewPackage.packageHash
      })}\n`
    );
  }
}
