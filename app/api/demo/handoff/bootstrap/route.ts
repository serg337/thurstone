import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BYOA_HANDOFF_BOOTSTRAP_VERSION, redactByoaSession } from "@/lib/demo/agent-handoff";
import {
  BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
  byoaHandoffV2ReceivedAt,
  parseByoaFreshContextV2Header,
  receiveAndRedactByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
import { agentVisibleRunProjectionV2 } from "@/lib/demo/agent-session-v2";
import { BYOA_HANDOFF_COOKIE, openByoaHandoff } from "@/lib/demo/agent-handoff-token.server";
import {
  ByoaHandoffTokenV2Error,
  isByoaHandoffV2Token,
  openByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";
import {
  createByoaHandoffLedgerV2Redis,
  receiveByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";
import { readContinuousJourneyByRun } from "@/lib/demo/continuous-journey.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "handoff_unavailable" }, { status: 404 });
  }
  try {
    if (isByoaHandoffV2Token(token)) {
      const envelope = openByoaHandoffV2(token);
      const freshContextId = parseByoaFreshContextV2Header(request.headers);
      const activeCommit = resolveDeploymentCommit(process.env);
      if (envelope.session.contract.buildCommit !== activeCommit) {
        return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
      }
      const receipt = await receiveByoaHandoffV2(createByoaHandoffLedgerV2Redis(), {
        runId: envelope.session.runId,
        contractDigest: envelope.session.contractDigest,
        token,
        freshContextId
      });
      const projection = agentVisibleRunProjectionV2(envelope.session);
      const receivedAt = byoaHandoffV2ReceivedAt(envelope.session.updatedAt, receipt.serverTimeMs);
      const journey = await readContinuousJourneyByRun(envelope.session.runId);
      return NextResponse.json(
        {
          version: BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
          session: receiveAndRedactByoaSessionV2(envelope.session, receivedAt),
          projection,
          ...(journey
            ? {
                journey: {
                  journeyId: journey.plan.journeyId,
                  mode: journey.plan.mode,
                  position: journey.position + 1,
                  total: journey.plan.steps.length
                }
              }
            : {})
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const envelope = openByoaHandoff(token);
    const activeCommit = resolveDeploymentCommit(process.env);
    if (
      envelope.session.contract.buildCommit !== activeCommit ||
      envelope.projection.buildCommit !== activeCommit
    ) {
      return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
    }
    return NextResponse.json(
      {
        version: BYOA_HANDOFF_BOOTSTRAP_VERSION,
        session: redactByoaSession(envelope.session),
        projection: envelope.projection,
        rerun: envelope.rerun
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const invalidToken = caught instanceof ByoaHandoffTokenV2Error;
    return NextResponse.json(
      { error: invalidToken ? "handoff_token_invalid" : "handoff_state_unavailable" },
      { status: invalidToken ? 410 : 503 }
    );
  }
}
