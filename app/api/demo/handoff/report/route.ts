import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import {
  BYOA_HANDOFF_REPORT_V2_VERSION,
  byoaHandoffReportRequestV2Schema,
  parseByoaFreshContextV2Header
} from "@/lib/demo/agent-handoff-v2";
import { BYOA_HANDOFF_COOKIE } from "@/lib/demo/agent-handoff-token.server";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  ByoaHandoffLedgerV2Error,
  createByoaHandoffLedgerV2Redis,
  reportByoaHandoffV2Result
} from "@/lib/demo/handoff-ledger-v2.server";
import { recordContinuousJourneyResult } from "@/lib/demo/continuous-journey.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaHandoffReportRequestV2Schema.parse(await readBoundedHandoffJson(request));
    const freshContextId = parseByoaFreshContextV2Header(request.headers);
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token || !isByoaHandoffV2Token(token)) {
      return NextResponse.json({ error: "handoff_report_unavailable" }, { status: 404 });
    }
    const envelope = openByoaHandoffV2(token);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "handoff_identity_mismatch" }, { status: 409 });
    }
    const receipt = await reportByoaHandoffV2Result(createByoaHandoffLedgerV2Redis(), {
      runId: input.runId,
      contractDigest: input.contractDigest,
      token,
      freshContextId,
      verdict: input.verdict,
      resultDigest: input.resultDigest
    });
    await recordContinuousJourneyResult(
      input.runId,
      input.verdict,
      input.resultDigest,
      input.ownerSummary
    );
    return NextResponse.json(
      { ok: true, version: BYOA_HANDOFF_REPORT_V2_VERSION, state: receipt.state },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const status =
      caught instanceof ByoaHandoffHttpError
        ? caught.status
        : caught instanceof Error && caught.name === "ZodError"
          ? 400
          : caught instanceof ByoaHandoffLedgerV2Error && caught.code.includes("MISMATCH")
            ? 409
            : 503;
    return NextResponse.json({ error: "handoff_report_denied" }, { status });
  }
}
