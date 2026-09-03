import { NextResponse } from "next/server";

import {
  BYOA_HANDOFF_PREPARE_VERSION,
  byoaHandoffPrepareRequestSchema
} from "@/lib/demo/agent-handoff";
import {
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  byoaHandoffPrepareRequestV2Schema
} from "@/lib/demo/agent-handoff-v2";
import { createByoaHandoffEnvelope, sealByoaHandoff } from "@/lib/demo/agent-handoff-token.server";
import {
  createByoaHandoffEnvelopeV2,
  sealByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import {
  ByoaHandoffLedgerV2Error,
  createByoaHandoffLedgerV2Redis,
  issueByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";
import { issueByoaHandoffShortCode } from "@/lib/demo/handoff-short-code.server";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";
import { storeContinuousJourney } from "@/lib/demo/continuous-journey.server";

import {
  BYOA_HANDOFF_PREPARE_MAX_BODY_BYTES,
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson,
  trustedHandoffClientOrigin
} from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  let failureStage = "parse";
  try {
    const value = await readBoundedHandoffJson(request, BYOA_HANDOFF_PREPARE_MAX_BODY_BYTES);
    if (
      typeof value === "object" &&
      value !== null &&
      Reflect.get(value, "version") === BYOA_HANDOFF_PREPARE_V2_VERSION
    ) {
      const body = byoaHandoffPrepareRequestV2Schema.parse(value);
      failureStage = "deployment";
      const activeCommit = resolveDeploymentCommit(process.env);
      if (
        body.session.contract.buildCommit !== activeCommit ||
        body.projection.buildCommit !== activeCommit
      ) {
        return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
      }
      const origin = trustedHandoffClientOrigin(request);
      if (!origin) {
        return NextResponse.json({ error: "handoff_client_origin_invalid" }, { status: 403 });
      }
      failureStage = "envelope";
      const envelope = createByoaHandoffEnvelopeV2({
        session: body.session,
        projection: body.projection
      });
      failureStage = "seal";
      const token = sealByoaHandoffV2(envelope);
      try {
        failureStage = "ledger";
        await issueByoaHandoffV2(createByoaHandoffLedgerV2Redis(), {
          runId: envelope.session.runId,
          contractDigest: envelope.session.contractDigest,
          token,
          expiresAtMs: Date.parse(envelope.expiresAt)
        });
        if (body.journey !== undefined) {
          failureStage = "journey";
          await storeContinuousJourney(body.journey, Date.parse(body.journey.steps[0]!.expiresAt));
        }
      } catch (caught) {
        if (
          caught instanceof ByoaHandoffLedgerV2Error &&
          (caught.code === "HANDOFF_ISSUE_RATE_LIMIT" || caught.code === "HANDOFF_ACTIVE_LIMIT")
        ) {
          return NextResponse.json(
            { error: "handoff_rate_limited" },
            {
              status: 429,
              headers: { "Cache-Control": "no-store", "Retry-After": "60" }
            }
          );
        }
        const status =
          caught instanceof ByoaHandoffLedgerV2Error && caught.code === "HANDOFF_ISSUE_CONFLICT"
            ? 409
            : 503;
        return NextResponse.json({ error: "handoff_ledger_unavailable" }, { status });
      }
      failureStage = "short-code";
      const shortCode = await issueByoaHandoffShortCode(token, Date.parse(envelope.expiresAt));
      return NextResponse.json(
        {
          version: BYOA_HANDOFF_PREPARE_V2_VERSION,
          handoffUrl: `${origin}/demo/handoff#${shortCode}`,
          expiresAt: envelope.expiresAt
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const body = byoaHandoffPrepareRequestSchema.parse(value);
    const activeCommit = resolveDeploymentCommit(process.env);
    if (
      body.session.contract.buildCommit !== activeCommit ||
      body.projection.buildCommit !== activeCommit
    ) {
      return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
    }
    const envelope = createByoaHandoffEnvelope({
      session: body.session,
      projection: body.projection,
      rerun: body.rerun
    });
    const token = sealByoaHandoff(envelope);
    const origin = trustedHandoffClientOrigin(request);
    if (!origin) {
      return NextResponse.json({ error: "handoff_client_origin_invalid" }, { status: 403 });
    }
    return NextResponse.json(
      {
        version: BYOA_HANDOFF_PREPARE_VERSION,
        handoffUrl: `${origin}/demo/handoff#${token}`,
        expiresAt: envelope.expiresAt
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    if (caught instanceof ByoaHandoffHttpError) {
      return NextResponse.json(
        { error: caught.code },
        { status: caught.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    const controlledReason =
      caught instanceof Error && /^HANDOFF_[A-Z_]+$/u.test(caught.message)
        ? `_${caught.message.toLowerCase()}`
        : "";
    return NextResponse.json(
      { error: `handoff_prepare_invalid_${failureStage}${controlledReason}` },
      { status: 400 }
    );
  }
}
