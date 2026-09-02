import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION,
  BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
  byoaContinuousJourneyAdvanceRequestSchema,
  byoaHandoffV2ReceivedAt,
  parseByoaFreshContextV2Header,
  receiveAndRedactByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
import {
  BYOA_HANDOFF_COOKIE,
  byoaHandoffCookieOptions
} from "@/lib/demo/agent-handoff-token.server";
import {
  createByoaHandoffEnvelopeV2,
  isByoaHandoffV2Token,
  openByoaHandoffV2,
  sealByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import {
  advanceContinuousJourney,
  readContinuousJourneyByRun
} from "@/lib/demo/continuous-journey.server";
import {
  claimByoaHandoffV2,
  createByoaHandoffLedgerV2Redis,
  digestByoaHandoffV2Context,
  digestByoaHandoffV2Token,
  issueByoaHandoffV2,
  readByoaHandoffV2Status,
  receiveByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";
import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import { agentVisibleRunProjectionV2 } from "@/lib/demo/agent-session-v2";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "journey_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaContinuousJourneyAdvanceRequestSchema.parse(
      await readBoundedHandoffJson(request)
    );
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value ?? "";
    if (!isByoaHandoffV2Token(token)) {
      return NextResponse.json({ error: "journey_unavailable" }, { status: 404 });
    }
    const envelope = openByoaHandoffV2(token);
    const freshContextId = parseByoaFreshContextV2Header(request.headers);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "journey_identity_mismatch" }, { status: 409 });
    }
    const redis = createByoaHandoffLedgerV2Redis();
    const record = await readContinuousJourneyByRun(input.runId);
    if (
      record === null ||
      record.currentRunId !== input.runId ||
      record.currentContractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "journey_unavailable" }, { status: 404 });
    }
    const status = await readByoaHandoffV2Status(redis, input.runId);
    if (
      status === null ||
      (record.plan.mode === "continuous" ? status.verdict !== "pass" : status.verdict === null) ||
      status.resultDigest !== input.resultDigest ||
      status.contractDigest !== input.contractDigest ||
      status.tokenDigest !== digestByoaHandoffV2Token(token) ||
      status.freshContextDigest !== digestByoaHandoffV2Context(freshContextId)
    ) {
      return NextResponse.json({ error: "journey_result_unverified" }, { status: 409 });
    }
    const nextTemplate = record.plan.steps[record.position + 1];
    if (nextTemplate === undefined) {
      return NextResponse.json({ error: "journey_complete" }, { status: 409 });
    }
    if (nextTemplate.contract.buildCommit !== resolveDeploymentCommit(process.env)) {
      return NextResponse.json({ error: "journey_build_mismatch" }, { status: 409 });
    }
    const nextEnvelope = createByoaHandoffEnvelopeV2({
      session: nextTemplate,
      projection: agentVisibleRunProjectionV2(nextTemplate)
    });
    const nextToken = sealByoaHandoffV2(nextEnvelope);
    await issueByoaHandoffV2(redis, {
      runId: nextEnvelope.session.runId,
      contractDigest: nextEnvelope.session.contractDigest,
      token: nextToken,
      expiresAtMs: Date.parse(nextEnvelope.expiresAt)
    });
    await claimByoaHandoffV2(redis, {
      runId: nextEnvelope.session.runId,
      contractDigest: nextEnvelope.session.contractDigest,
      token: nextToken,
      freshContextId
    });
    const received = await receiveByoaHandoffV2(redis, {
      runId: nextEnvelope.session.runId,
      contractDigest: nextEnvelope.session.contractDigest,
      token: nextToken,
      freshContextId
    });
    await advanceContinuousJourney(record, nextEnvelope.session);
    const projection = agentVisibleRunProjectionV2(nextEnvelope.session);
    const receivedAt = byoaHandoffV2ReceivedAt(
      nextEnvelope.session.updatedAt,
      received.serverTimeMs
    );
    const response = NextResponse.json(
      {
        version: BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
        session: receiveAndRedactByoaSessionV2(nextEnvelope.session, receivedAt),
        projection,
        journey: {
          journeyId: record.plan.journeyId,
          mode: record.plan.mode,
          position: record.position + 2,
          total: record.plan.steps.length
        }
      },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(
      BYOA_HANDOFF_COOKIE,
      nextToken,
      byoaHandoffCookieOptions(request.url, nextEnvelope.expiresAt)
    );
    return response;
  } catch (caught) {
    const status = caught instanceof ByoaHandoffHttpError ? caught.status : 400;
    return NextResponse.json(
      { error: BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
