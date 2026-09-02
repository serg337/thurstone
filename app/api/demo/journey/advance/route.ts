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
  ByoaHandoffTokenV2Error,
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
  ByoaHandoffLedgerV2Error,
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
    const redis = createByoaHandoffLedgerV2Redis();
    const record = await readContinuousJourneyByRun(input.runId);
    if (record === null) {
      return NextResponse.json({ error: "journey_unavailable" }, { status: 404 });
    }
    const previousTemplate = record.plan.steps[record.position - 1];
    const replayingAdvance =
      record.currentRunId !== input.runId &&
      record.previousRunId === input.runId &&
      record.previousResultDigest === input.resultDigest &&
      previousTemplate?.runId === input.runId &&
      previousTemplate.contractDigest === input.contractDigest &&
      record.currentToken !== null;
    const cookieMatchesInput =
      envelope.session.runId === input.runId &&
      envelope.session.contractDigest === input.contractDigest;
    const cookieMatchesReplayedStep =
      replayingAdvance &&
      envelope.session.runId === record.currentRunId &&
      envelope.session.contractDigest === record.currentContractDigest &&
      digestByoaHandoffV2Token(token) === digestByoaHandoffV2Token(record.currentToken!);
    if (
      (!replayingAdvance && !cookieMatchesInput) ||
      (replayingAdvance && !cookieMatchesInput && !cookieMatchesReplayedStep)
    ) {
      return NextResponse.json({ error: "journey_identity_mismatch" }, { status: 409 });
    }
    const nextPosition = replayingAdvance ? record.position : record.position + 1;
    const nextTemplate = record.plan.steps[nextPosition];
    if (nextTemplate === undefined)
      return NextResponse.json({ error: "journey_complete" }, { status: 409 });
    if (nextTemplate.contract.buildCommit !== resolveDeploymentCommit(process.env)) {
      return NextResponse.json({ error: "journey_build_mismatch" }, { status: 409 });
    }
    let nextToken: string;
    let nextEnvelope: ReturnType<typeof createByoaHandoffEnvelopeV2>;
    if (replayingAdvance) {
      nextToken = record.currentToken!;
      nextEnvelope = openByoaHandoffV2(nextToken);
      if (
        nextEnvelope.session.runId !== nextTemplate.runId ||
        nextEnvelope.session.contractDigest !== nextTemplate.contractDigest
      ) {
        return NextResponse.json({ error: "journey_replay_mismatch" }, { status: 409 });
      }
    } else {
      if (
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
      nextEnvelope = createByoaHandoffEnvelopeV2({
        session: nextTemplate,
        projection: agentVisibleRunProjectionV2(nextTemplate)
      });
      nextToken = sealByoaHandoffV2(nextEnvelope);
      await advanceContinuousJourney(record, nextEnvelope.session, nextToken, input.resultDigest);
    }
    const nextStatus = await readByoaHandoffV2Status(redis, nextEnvelope.session.runId);
    if (nextStatus === null) {
      await issueByoaHandoffV2(redis, {
        runId: nextEnvelope.session.runId,
        contractDigest: nextEnvelope.session.contractDigest,
        token: nextToken,
        expiresAtMs: Date.parse(nextEnvelope.expiresAt)
      });
    } else if (
      nextStatus.contractDigest !== nextEnvelope.session.contractDigest ||
      nextStatus.tokenDigest !== digestByoaHandoffV2Token(nextToken)
    ) {
      return NextResponse.json({ error: "journey_next_binding_mismatch" }, { status: 409 });
    }
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
          position: nextPosition + 1,
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
    const status =
      caught instanceof ByoaHandoffHttpError
        ? caught.status
        : caught instanceof ByoaHandoffTokenV2Error
          ? 410
          : caught instanceof Error && caught.name === "ZodError"
            ? 400
            : caught instanceof ByoaHandoffLedgerV2Error &&
                [
                  "HANDOFF_BINDING_MISMATCH",
                  "HANDOFF_ALREADY_CLAIMED",
                  "HANDOFF_RECEIVE_INVALID_STATE"
                ].includes(caught.code)
              ? 409
              : caught instanceof ByoaHandoffLedgerV2Error &&
                  ["HANDOFF_EXPIRED", "HANDOFF_MISSING"].includes(caught.code)
                ? 410
                : 503;
    return NextResponse.json(
      {
        error:
          status === 503 ? "journey_state_unavailable" : BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
