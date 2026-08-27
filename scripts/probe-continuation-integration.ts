import { randomBytes } from "node:crypto";

import {
  PROBE_CONTINUATION_STAGES,
  createProbeContinuationKeyspace,
  getProbeContinuation,
  probeContinuationKey,
  putProbeContinuation
} from "../lib/probe/continuation-store";
import { createProbeRedis } from "../lib/probe/ledger";

const redis = createProbeRedis();
const testId = randomBytes(8).toString("hex");
const keyspace = createProbeContinuationKeyspace(
  `tp:{webmcp26}:continuation:integration_${testId}`
);
const artifactSecret = randomBytes(32).toString("base64url");
const jti = `jti_integration_${testId}`;
const keys = PROBE_CONTINUATION_STAGES.map((stage) => probeContinuationKey(keyspace, jti, stage));

try {
  for (const stage of PROBE_CONTINUATION_STAGES) {
    const payload = { testId, stage, synthetic: true };
    const stored = await putProbeContinuation(
      redis,
      { jti, stage, payload, artifactSecret },
      keyspace
    );
    if (stored.disposition !== "new") throw new Error("continuation_not_new");
    const replay = await putProbeContinuation(
      redis,
      { jti, stage, payload, artifactSecret },
      keyspace
    );
    if (replay.disposition !== "existing") throw new Error("continuation_not_idempotent");
    const recovered = await getProbeContinuation<typeof payload>(
      redis,
      { jti, stage, artifactSecret },
      keyspace
    );
    if (!recovered || JSON.stringify(recovered.payload) !== JSON.stringify(payload)) {
      throw new Error("continuation_recovery_mismatch");
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "probe-continuation-integration",
      stages: PROBE_CONTINUATION_STAGES.length,
      encrypted: true,
      idempotent: true
    })}\n`
  );
} finally {
  if (keys.length > 0) await redis.unlink(...keys);
  if (keys.length > 0 && (await redis.exists(...keys)) !== 0) {
    throw new Error("continuation_cleanup_failed");
  }
}
