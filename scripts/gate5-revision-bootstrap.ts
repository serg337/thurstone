import { createProbeRedis } from "../lib/probe/ledger";
import {
  GATE5_REVISION_FREEZE_HASH_ENV,
  configuredGate5Revision
} from "../lib/semantic/revision-config.server";
import {
  putGate5RevisionFreeze,
  readGate5RevisionFreeze
} from "../lib/semantic/revision-store.server";

const confirmationName = "TOOLPROOF_GATE5_REVISION_PERSIST_CONFIRMATION";
const configured = await configuredGate5Revision();

if (configured.status === "awaiting-repair" || configured.status === "awaiting-human") {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "gate5-revision-bootstrap", status: configured.status })}\n`
  );
} else if (configured.status !== "ready" || !configured.revision) {
  throw new Error(configured.issue ?? "gate5_revision_configuration_invalid");
} else {
  const artifactSecret = process.env.TOOLPROOF_SIGNING_SECRET?.trim();
  if (!artifactSecret) throw new Error("gate5_revision_secret_missing");
  const redis = createProbeRedis();
  const existing = await readGate5RevisionFreeze(redis, {
    revisionFreezeHash: configured.revision.revisionFreezeHash,
    artifactSecret
  });
  if (!existing) {
    if (
      process.env[confirmationName]?.trim() !== configured.revision.revisionFreezeHash ||
      process.env[GATE5_REVISION_FREEZE_HASH_ENV]
    ) {
      throw new Error("gate5_revision_persistence_confirmation_required");
    }
    await putGate5RevisionFreeze(redis, {
      revision: configured.revision,
      artifactSecret
    });
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "gate5-revision-bootstrap",
      status: "stored",
      revisionFreezeHash: configured.revision.revisionFreezeHash,
      baselineEvidenceDigest: configured.revision.baselineEvidenceDigest
    })}\n`
  );
}
