import {
  SCORED_RUN_ATTEMPT_VERSION,
  SCORED_RUN_CASE_COUNT,
  SCORED_RUN_OWNER_LEASE_SECONDS,
  SCORED_RUN_STORE_SCRIPTS,
  SCORED_RUN_TTL_SECONDS,
  ScoredRunStoreError,
  acknowledgeScoredRun,
  acquireScoredRunOwner,
  createScoredRun,
  createScoredRunIdentity,
  createScoredRunKeyspace,
  readPermanentScoredRun,
  readScoredRun,
  recordScoredRunAttempt,
  scoredRunIdentityHash,
  sealScoredRunEvidence,
  type ScoredRunAttempt,
  type ScoredRunRedisClient
} from "@/lib/scored/run-store.server";
import { describe, expect, it } from "vitest";

const SECRET = Buffer.alloc(32, 13).toString("base64url");
const DOCUMENT = `document_${"d".repeat(22)}`;
const KEYSPACE = createScoredRunKeyspace("tp:{webmcp26}:scored-run:unit");

function runnerCaseId(index: number): string {
  return `case_${String(index).padStart(22, "0")}`;
}

async function identity(phase: "baseline" | "revised" = "baseline") {
  return createScoredRunIdentity({
    phase,
    appCommit: "a".repeat(40),
    reviewPackageHash: "1".repeat(64),
    frozenProtocolHash: "2".repeat(64),
    freezeCandidateHash: "3".repeat(64),
    runId: `run_${"r".repeat(22)}`,
    actorHash: "4".repeat(64),
    phaseCallOffset: 0,
    predecessorProtocolHash: null,
    predecessorEvidenceDigest: null,
    predecessorRunId: null,
    orderedRunnerCaseIds: Array.from({ length: SCORED_RUN_CASE_COUNT }, (_, index) =>
      runnerCaseId(index)
    )
  });
}

function attempt(input: {
  ordinal: number;
  attempt?: 0 | 1;
  disposition?: "scored" | "infrastructure-invalid";
  retryEligible?: boolean;
  marker?: string;
}): ScoredRunAttempt {
  const disposition = input.disposition ?? "scored";
  return {
    version: SCORED_RUN_ATTEMPT_VERSION,
    ordinal: input.ordinal,
    attempt: input.attempt ?? 0,
    runnerCaseId: runnerCaseId(input.ordinal),
    disposition,
    infrastructureRetryEligible: input.retryEligible ?? false,
    usableModelDecisionMade: disposition === "scored",
    targetExecutionMade: disposition === "scored",
    capturedAt: new Date(1_787_950_000_000 + input.ordinal * 1_000).toISOString(),
    evidence: {
      marker: input.marker ?? `private-evidence-${input.ordinal}-${input.attempt ?? 0}`
    }
  };
}

class MemoryScoredRedis implements ScoredRunRedisClient {
  readonly anchor: Record<string, string> = {};
  readonly data: Record<string, string> = {};
  readonly evidence: Record<string, string> = {};
  nowMs = 1_787_950_000_000;
  dataPresent = false;

  async eval<TResult = unknown>(script: string, _keys: string[], args: string[]): Promise<TResult> {
    if (script === SCORED_RUN_STORE_SCRIPTS.create) {
      if (Object.keys(this.anchor).length > 0) {
        if (this.anchor.identity_hash !== args[0] || !this.dataPresent) {
          return [0, "SCORED_RUN_CONFLICT"] as TResult;
        }
        return [
          2,
          "EXISTING",
          this.anchor.created_at_ms,
          this.data.expires_at_ms,
          Number(this.data.expires_at_ms) - this.nowMs
        ] as TResult;
      }
      const expiresAt = this.nowMs + Number(args[14]);
      Object.assign(this.anchor, {
        version: args[1],
        status: "active",
        identity_hash: args[0],
        phase: args[2],
        app_commit: args[3],
        review_package_hash: args[4],
        frozen_protocol_hash: args[5],
        freeze_candidate_hash: args[6],
        schedule_hash: args[7],
        run_hash: args[8],
        actor_hash: args[9],
        attempt_count: "0",
        completed_count: "0",
        transport_failure_count: "0",
        current_ordinal: "0",
        current_attempt: "0",
        created_at_ms: String(this.nowMs)
      });
      Object.assign(this.data, {
        version: args[1],
        status: "active",
        identity_hash: args[0],
        schedule_token: args[10],
        current_runner_hash: args[11],
        owner_hash: args[12],
        owner_expires_at_ms: String(this.nowMs + Number(args[13])),
        attempt_count: "0",
        completed_count: "0",
        transport_failure_count: "0",
        current_ordinal: "0",
        current_attempt: "0",
        created_at_ms: String(this.nowMs),
        expires_at_ms: String(expiresAt)
      });
      this.dataPresent = true;
      return [1, "CREATED", this.nowMs, expiresAt, Number(args[14])] as TResult;
    }

    if (script === SCORED_RUN_STORE_SCRIPTS.acquireOwner) {
      if (!this.dataPresent || this.anchor.identity_hash !== args[0]) {
        return [0, "MISSING_SCORED_RUN"] as TResult;
      }
      const prior = this.data.owner_hash;
      if (prior !== args[1] && Number(this.data.owner_expires_at_ms) > this.nowMs) {
        return [0, "SCORED_RUN_OWNED"] as TResult;
      }
      const expiry = this.nowMs + Number(args[2]);
      this.data.owner_hash = args[1]!;
      this.data.owner_expires_at_ms = String(expiry);
      return [1, prior === args[1] ? "RENEWED" : "ACQUIRED", expiry] as TResult;
    }

    if (script === SCORED_RUN_STORE_SCRIPTS.recordAttempt) {
      if (!this.dataPresent || this.anchor.identity_hash !== args[0]) {
        return [0, "MISSING_SCORED_RUN"] as TResult;
      }
      if (
        this.data.owner_hash !== args[1] ||
        this.data.current_ordinal !== args[2] ||
        this.data.current_attempt !== args[3] ||
        this.data.current_runner_hash !== args[4]
      ) {
        return [0, "SCORED_RUN_SEQUENCE_MISMATCH"] as TResult;
      }
      const field = `attempt_${args[2]}_${args[3]}`;
      const digest = `digest_${args[2]}_${args[3]}`;
      if (this.data[field]) {
        if (this.anchor[digest] !== args[6]) {
          return [0, "SCORED_RUN_ATTEMPT_CONFLICT"] as TResult;
        }
        return [
          2,
          "ATTEMPT_EXISTING",
          this.anchor.status,
          this.anchor.completed_count,
          this.anchor.current_ordinal,
          this.anchor.current_attempt
        ] as TResult;
      }
      this.data[field] = args[5]!;
      this.anchor[digest] = args[6]!;
      for (const record of [this.anchor, this.data]) {
        record.attempt_count = String(Number(record.attempt_count) + 1);
      }
      if (args[7] === "infrastructure-invalid") {
        for (const record of [this.anchor, this.data]) {
          record.transport_failure_count = String(Number(record.transport_failure_count) + 1);
        }
        if (args[8] === "1" && args[3] === "0") {
          this.anchor.current_attempt = "1";
          this.data.current_attempt = "1";
          return [
            1,
            "REPLACEMENT_ADMITTED",
            "active",
            this.anchor.completed_count,
            args[2],
            "1"
          ] as TResult;
        }
        for (const record of [this.anchor, this.data]) {
          record.status = "terminal-invalid";
          record.terminal_reason = args[9]!;
          record.terminal_at_ms = String(this.nowMs);
        }
        return [
          1,
          "TERMINAL_INVALID",
          "terminal-invalid",
          this.anchor.completed_count,
          args[2],
          args[3]
        ] as TResult;
      }
      for (const record of [this.anchor, this.data]) {
        record.completed_count = String(Number(record.completed_count) + 1);
      }
      const nextOrdinal = Number(args[2]) + 1;
      if (nextOrdinal === Number(args[10])) {
        for (const record of [this.anchor, this.data]) {
          record.status = "terminal-complete";
          record.current_ordinal = String(nextOrdinal);
          record.current_attempt = "0";
          record.terminal_at_ms = String(this.nowMs);
        }
        return [
          1,
          "TERMINAL_COMPLETE",
          "terminal-complete",
          this.anchor.completed_count,
          nextOrdinal,
          "0"
        ] as TResult;
      }
      for (const record of [this.anchor, this.data]) {
        record.current_ordinal = String(nextOrdinal);
        record.current_attempt = "0";
      }
      this.data.current_runner_hash = args[11]!;
      return [1, "RECORDED", "active", this.anchor.completed_count, nextOrdinal, "0"] as TResult;
    }

    if (script === SCORED_RUN_STORE_SCRIPTS.sealEvidence) {
      if (!this.dataPresent || this.anchor.identity_hash !== args[0]) {
        return [0, "MISSING_SCORED_RUN"] as TResult;
      }
      if (
        (this.anchor.status !== "terminal-complete" && this.anchor.status !== "terminal-invalid") ||
        this.anchor.attempt_count !== args[3]
      ) {
        return [0, "SCORED_RUN_EVIDENCE_BOUNDARY_MISMATCH"] as TResult;
      }
      if (this.anchor.evidence_status) {
        const copiesMatch =
          this.evidence.schedule_token === this.data.schedule_token &&
          Object.entries(this.data)
            .filter(([key]) => /^attempt_\d+_[01]$/u.test(key))
            .every(([key, value]) => this.evidence[key] === value);
        return this.anchor.evidence_digest === args[1] &&
          this.anchor.attempt_manifest_digest === args[2] &&
          this.evidence.status === "sealed" &&
          this.evidence.identity_hash === args[0] &&
          this.evidence.attempt_count === args[3] &&
          copiesMatch
          ? ([2, "EVIDENCE_VERIFIED_EXISTING", this.anchor.evidence_verified_at_ms] as TResult)
          : ([0, "SCORED_RUN_EVIDENCE_CONFLICT"] as TResult);
      }
      if (Object.keys(this.evidence).length > 0) {
        return [0, "PERMANENT_SCORED_EVIDENCE_CONFLICT"] as TResult;
      }
      Object.assign(this.evidence, {
        version: args[4],
        status: "sealed",
        identity_hash: args[0],
        phase: this.anchor.phase,
        terminal_status: this.anchor.status,
        evidence_digest: args[1],
        attempt_manifest_digest: args[2],
        attempt_count: args[3],
        completed_count: this.anchor.completed_count,
        transport_failure_count: this.anchor.transport_failure_count,
        sealed_at_ms: String(this.nowMs),
        schedule_token: this.data.schedule_token
      });
      for (const [key, value] of Object.entries(this.data)) {
        if (/^attempt_\d+_[01]$/u.test(key)) this.evidence[key] = value;
      }
      this.anchor.evidence_status = "verified";
      this.anchor.evidence_digest = args[1]!;
      this.anchor.attempt_manifest_digest = args[2]!;
      this.anchor.evidence_verified_at_ms = String(this.nowMs);
      return [1, "EVIDENCE_VERIFIED_NEW", this.nowMs] as TResult;
    }

    if (script === SCORED_RUN_STORE_SCRIPTS.acknowledge) {
      if (this.anchor.identity_hash !== args[0]) {
        return [0, "SCORED_RUN_IDENTITY_MISMATCH"] as TResult;
      }
      if (
        this.evidence.identity_hash !== args[0] ||
        this.evidence.evidence_digest !== args[1] ||
        this.anchor.evidence_digest !== args[1] ||
        this.evidence.attempt_manifest_digest !== this.anchor.attempt_manifest_digest ||
        this.evidence.attempt_count !== this.anchor.attempt_count
      ) {
        return [0, "SCORED_RUN_ACK_MISMATCH"] as TResult;
      }
      if (this.anchor.status === "acknowledged") {
        if (this.evidence.status !== "acknowledged") {
          return [0, "SCORED_RUN_ACK_MISMATCH"] as TResult;
        }
        this.dataPresent = false;
        for (const key of Object.keys(this.data)) delete this.data[key];
        return [2, "ACKNOWLEDGED_EXISTING", this.anchor.acknowledged_at_ms] as TResult;
      }
      if (this.anchor.status !== "terminal-complete" && this.anchor.status !== "terminal-invalid") {
        return [0, "SCORED_RUN_NOT_TERMINAL"] as TResult;
      }
      if (
        this.anchor.evidence_status !== "verified" ||
        this.evidence.status !== "sealed" ||
        this.evidence.terminal_status !== this.anchor.status
      ) {
        return [0, "SCORED_RUN_EVIDENCE_UNVERIFIED"] as TResult;
      }
      if (
        this.dataPresent &&
        (this.data.identity_hash !== args[0] || this.data.status !== this.anchor.status)
      ) {
        return [0, "SCORED_RUN_ACK_MISMATCH"] as TResult;
      }
      this.anchor.terminal_status = this.anchor.status;
      this.anchor.status = "acknowledged";
      this.anchor.evidence_digest = args[1]!;
      this.anchor.acknowledged_at_ms = String(this.nowMs);
      this.evidence.status = "acknowledged";
      this.evidence.acknowledged_at_ms = String(this.nowMs);
      this.dataPresent = false;
      for (const key of Object.keys(this.data)) delete this.data[key];
      return [1, "ACKNOWLEDGED_NEW", this.nowMs] as TResult;
    }
    throw new Error("Unexpected write script.");
  }

  async evalRo<TResult = unknown>(
    script: string,
    keys: string[],
    args: string[]
  ): Promise<TResult> {
    void keys;
    void args;
    if (script === SCORED_RUN_STORE_SCRIPTS.readPermanentEvidence) {
      if (Object.keys(this.anchor).length === 0) return [2, "MISSING"] as TResult;
      if (Object.keys(this.evidence).length === 0) return [2, "MISSING_EVIDENCE"] as TResult;
      const validPair =
        (this.anchor.status === "acknowledged" && this.evidence.status === "acknowledged") ||
        ((this.anchor.status === "terminal-complete" ||
          this.anchor.status === "terminal-invalid") &&
          this.evidence.status === "sealed");
      const expectedTerminalStatus =
        this.anchor.status === "acknowledged" ? this.anchor.terminal_status : this.anchor.status;
      if (
        !validPair ||
        this.anchor.identity_hash !== this.evidence.identity_hash ||
        this.anchor.evidence_digest !== this.evidence.evidence_digest ||
        this.anchor.attempt_manifest_digest !== this.evidence.attempt_manifest_digest ||
        this.anchor.attempt_count !== this.evidence.attempt_count ||
        this.anchor.completed_count !== this.evidence.completed_count ||
        expectedTerminalStatus !== this.evidence.terminal_status
      ) {
        return [0, "PERMANENT_SCORED_EVIDENCE_MISMATCH"] as TResult;
      }
      return [1, "FOUND", { ...this.anchor }, { ...this.evidence }] as TResult;
    }
    if (script !== SCORED_RUN_STORE_SCRIPTS.read) throw new Error("Unexpected read script.");
    if (Object.keys(this.anchor).length === 0) return [2, "MISSING"] as TResult;
    if (!this.dataPresent) return [1, "ANCHOR_ONLY", { ...this.anchor }] as TResult;
    return [
      1,
      "FOUND",
      { ...this.anchor },
      { ...this.data },
      Number(this.data.expires_at_ms) - this.nowMs
    ] as TResult;
  }
}

describe("scored durable run store", () => {
  it("binds one 24-case schedule, encrypts attempts, admits one pre-decision replacement, and deletes only data on ACK", async () => {
    const redis = new MemoryScoredRedis();
    const run = await identity();
    const created = await createScoredRun(
      redis,
      {
        identity: run,
        documentId: DOCUMENT,
        artifactSecret: SECRET,
        createdAt: new Date(redis.nowMs).toISOString()
      },
      KEYSPACE
    );
    expect(created).toEqual({
      disposition: "new",
      createdAtMs: redis.nowMs,
      expiresAtMs: redis.nowMs + SCORED_RUN_TTL_SECONDS * 1_000
    });
    expect(redis.data.schedule_token).not.toContain(run.orderedRunnerCaseIds[0]!);

    const renewed = await acquireScoredRunOwner(
      redis,
      { identity: run, documentId: DOCUMENT, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(renewed).toEqual({
      disposition: "renewed",
      ownerExpiresAtMs: redis.nowMs + SCORED_RUN_OWNER_LEASE_SECONDS * 1_000
    });

    const failure = attempt({
      ordinal: 0,
      disposition: "infrastructure-invalid",
      retryEligible: true,
      marker: "PRIVATE-FIRST-FAILURE"
    });
    const replacement = await recordScoredRunAttempt(
      redis,
      { identity: run, documentId: DOCUMENT, artifactSecret: SECRET, attempt: failure },
      KEYSPACE
    );
    expect(replacement).toMatchObject({
      status: "active",
      currentOrdinal: 0,
      currentAttempt: 1,
      completedCount: 0,
      transportFailureCount: 1,
      attemptCount: 1
    });
    expect(redis.data.attempt_0_0).not.toContain("PRIVATE-FIRST-FAILURE");
    expect(redis.anchor.digest_0_0).toMatch(/^[a-f0-9]{64}$/u);

    await recordScoredRunAttempt(
      redis,
      {
        identity: run,
        documentId: DOCUMENT,
        artifactSecret: SECRET,
        attempt: attempt({ ordinal: 0, attempt: 1 })
      },
      KEYSPACE
    );
    for (let ordinal = 1; ordinal < SCORED_RUN_CASE_COUNT; ordinal += 1) {
      await recordScoredRunAttempt(
        redis,
        {
          identity: run,
          documentId: DOCUMENT,
          artifactSecret: SECRET,
          attempt: attempt({ ordinal })
        },
        KEYSPACE
      );
    }
    const terminal = await readScoredRun(
      redis,
      { identity: run, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(terminal).toMatchObject({
      status: "terminal-complete",
      completedCount: 24,
      remainingCount: 0,
      attemptCount: 25,
      transportFailureCount: 1
    });
    expect(terminal?.attempts).toHaveLength(25);

    const permanentDigests = Object.fromEntries(
      Object.entries(redis.anchor).filter(([key]) => key.startsWith("digest_"))
    );
    expect(
      await sealScoredRunEvidence(
        redis,
        {
          identity: run,
          evidenceDigest: "e".repeat(64),
          attemptManifestDigest: "m".repeat(64).replaceAll("m", "d"),
          attemptCount: 25
        },
        KEYSPACE
      )
    ).toBe("new");
    expect(
      await sealScoredRunEvidence(
        redis,
        {
          identity: run,
          evidenceDigest: "e".repeat(64),
          attemptManifestDigest: "d".repeat(64),
          attemptCount: 25
        },
        KEYSPACE
      )
    ).toBe("existing");
    expect(redis.dataPresent).toBe(true);
    expect(redis.evidence).toMatchObject({
      status: "sealed",
      terminal_status: "terminal-complete",
      evidence_digest: "e".repeat(64),
      attempt_count: "25"
    });
    expect(redis.evidence.schedule_token).toBeTruthy();
    expect(
      Object.keys(redis.evidence).filter((key) => /^attempt_\d+_[01]$/u.test(key))
    ).toHaveLength(25);
    const sealedToken = redis.evidence.attempt_0_0!;
    redis.evidence.attempt_0_0 = `${sealedToken}tamper`;
    await expect(
      readPermanentScoredRun(redis, { identity: run, artifactSecret: SECRET }, KEYSPACE)
    ).rejects.toBeInstanceOf(ScoredRunStoreError);
    redis.evidence.attempt_0_0 = sealedToken;
    const sealedPermanent = await readPermanentScoredRun(
      redis,
      { identity: run, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(sealedPermanent).toMatchObject({
      status: "terminal-complete",
      terminalStatus: "terminal-complete",
      attemptCount: 25
    });
    expect(sealedPermanent?.attempts).toHaveLength(25);

    // The human-wait interval may outlive transient recovery. ACK relies only on the permanent
    // anchor+evidence pair and remains recoverable when its first response is lost.
    redis.dataPresent = false;
    for (const key of Object.keys(redis.data)) delete redis.data[key];
    expect(
      await acknowledgeScoredRun(redis, { identity: run, evidenceDigest: "e".repeat(64) }, KEYSPACE)
    ).toBe("new");
    expect(redis.dataPresent).toBe(false);
    expect(redis.anchor).toMatchObject({
      status: "acknowledged",
      terminal_status: "terminal-complete",
      evidence_digest: "e".repeat(64)
    });
    expect(
      Object.fromEntries(Object.entries(redis.anchor).filter(([key]) => key.startsWith("digest_")))
    ).toEqual(permanentDigests);
    expect(
      await acknowledgeScoredRun(redis, { identity: run, evidenceDigest: "e".repeat(64) }, KEYSPACE)
    ).toBe("existing");
    const permanent = await readPermanentScoredRun(
      redis,
      { identity: run, artifactSecret: SECRET },
      KEYSPACE
    );
    expect(permanent).toMatchObject({
      status: "acknowledged",
      terminalStatus: "terminal-complete",
      completedCount: 24,
      attemptCount: 25,
      evidenceDigest: "e".repeat(64)
    });
    expect(permanent?.attempts).toHaveLength(25);
  });

  it("rejects wrong-case attempts, owner conflicts, tampering, and a second infrastructure failure", async () => {
    const redis = new MemoryScoredRedis();
    const run = await identity();
    await createScoredRun(
      redis,
      {
        identity: run,
        documentId: DOCUMENT,
        artifactSecret: SECRET,
        createdAt: new Date(redis.nowMs).toISOString()
      },
      KEYSPACE
    );
    await expect(
      acquireScoredRunOwner(
        redis,
        {
          identity: run,
          documentId: `document_${"x".repeat(22)}`,
          artifactSecret: SECRET
        },
        KEYSPACE
      )
    ).rejects.toMatchObject({ code: "SCORED_RUN_OWNED" });

    const wrongCase = { ...attempt({ ordinal: 0 }), runnerCaseId: runnerCaseId(1) };
    await expect(
      recordScoredRunAttempt(
        redis,
        {
          identity: run,
          documentId: DOCUMENT,
          artifactSecret: SECRET,
          attempt: wrongCase
        },
        KEYSPACE
      )
    ).rejects.toMatchObject({ code: "ATTEMPT_RUNNER_CASE_MISMATCH" });

    await recordScoredRunAttempt(
      redis,
      {
        identity: run,
        documentId: DOCUMENT,
        artifactSecret: SECRET,
        attempt: attempt({ ordinal: 0, disposition: "infrastructure-invalid", retryEligible: true })
      },
      KEYSPACE
    );
    const terminalInvalid = await recordScoredRunAttempt(
      redis,
      {
        identity: run,
        documentId: DOCUMENT,
        artifactSecret: SECRET,
        attempt: attempt({
          ordinal: 0,
          attempt: 1,
          disposition: "infrastructure-invalid",
          retryEligible: true
        })
      },
      KEYSPACE
    );
    expect(terminalInvalid).toMatchObject({
      status: "terminal-invalid",
      completedCount: 0,
      transportFailureCount: 2,
      attemptCount: 2
    });

    redis.data.attempt_0_0 = `${redis.data.attempt_0_0}tamper`;
    await expect(
      readScoredRun(redis, { identity: run, artifactSecret: SECRET }, KEYSPACE)
    ).rejects.toBeInstanceOf(ScoredRunStoreError);
  });

  it("derives a distinct exact identity for phase/schedule changes", async () => {
    const baseline = await identity("baseline");
    const revised = await identity("revised");
    expect(await scoredRunIdentityHash(baseline)).not.toBe(await scoredRunIdentityHash(revised));
    expect(baseline.scheduleHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
