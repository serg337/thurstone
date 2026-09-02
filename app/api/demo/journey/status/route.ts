import { NextResponse } from "next/server";

import {
  BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION,
  byoaContinuousJourneyStatusRequestSchema
} from "@/lib/demo/agent-handoff-v2";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import { readContinuousJourneyByRun } from "@/lib/demo/continuous-journey.server";
import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import {
  createByoaHandoffLedgerV2Redis,
  readByoaHandoffV2Status
} from "@/lib/demo/handoff-ledger-v2.server";
import { readHandoffClaimFailure } from "@/lib/demo/handoff-claim-receipt.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "journey_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaContinuousJourneyStatusRequestSchema.parse(
      await readBoundedHandoffJson(request)
    );
    if (!isByoaHandoffV2Token(input.token)) {
      return NextResponse.json({ error: "journey_unavailable" }, { status: 404 });
    }
    const envelope = openByoaHandoffV2(input.token);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "journey_identity_mismatch" }, { status: 409 });
    }
    const record = await readContinuousJourneyByRun(input.runId);
    if (record === null) {
      return NextResponse.json({ error: "journey_unavailable" }, { status: 404 });
    }
    const results = record.results.map((result) => {
      const step = record.plan.steps.find(({ runId }) => runId === result.runId);
      if (step === undefined) throw new Error("journey_result_unbound");
      return {
        caseId: step.contract.caseId,
        verdict: result.verdict,
        resultDigest: result.resultDigest,
        ownerSummary: result.ownerSummary
      };
    });
    const claimFailure = await readHandoffClaimFailure(input.token);
    const currentStatus = await readByoaHandoffV2Status(
      createByoaHandoffLedgerV2Redis(),
      record.currentRunId
    );
    if (currentStatus === null && claimFailure === null) {
      return NextResponse.json({ error: "journey_status_unavailable" }, { status: 404 });
    }
    return NextResponse.json(
      {
        version: BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION,
        mode: record.plan.mode,
        position: record.position + 1,
        total: record.plan.steps.length,
        state: currentStatus?.state ?? null,
        claimFailure,
        complete:
          (record.plan.mode === "continuous" &&
            results.some(({ verdict }) => verdict !== "pass")) ||
          results.length === record.plan.steps.length,
        results
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const status = caught instanceof ByoaHandoffHttpError ? caught.status : 400;
    return NextResponse.json({ error: "journey_status_denied" }, { status });
  }
}
