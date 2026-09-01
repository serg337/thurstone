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
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";
import {
  createByoaHandoffLedgerV2Redis,
  receiveByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token) throw new Error("missing");
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
      return NextResponse.json(
        {
          version: BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
          session: receiveAndRedactByoaSessionV2(envelope.session, receivedAt),
          projection
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
  } catch {
    return NextResponse.json({ error: "handoff_unavailable" }, { status: 404 });
  }
}
