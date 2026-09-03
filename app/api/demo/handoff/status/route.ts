import { NextResponse } from "next/server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import {
  BYOA_HANDOFF_STATUS_V2_VERSION,
  byoaHandoffStatusRequestV2Schema
} from "@/lib/demo/agent-handoff-v2";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  createByoaHandoffLedgerV2Redis,
  digestByoaHandoffV2Token,
  readByoaHandoffV2Status
} from "@/lib/demo/handoff-ledger-v2.server";
import { readHandoffClaimFailure } from "@/lib/demo/handoff-claim-receipt.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaHandoffStatusRequestV2Schema.parse(await readBoundedHandoffJson(request));
    if (!isByoaHandoffV2Token(input.token)) {
      return NextResponse.json({ error: "handoff_status_unavailable" }, { status: 404 });
    }
    const envelope = openByoaHandoffV2(input.token);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "handoff_identity_mismatch" }, { status: 409 });
    }
    const status = await readByoaHandoffV2Status(createByoaHandoffLedgerV2Redis(), input.runId);
    const claimFailure = await readHandoffClaimFailure(input.token);
    if (status === null && claimFailure !== null) {
      return NextResponse.json(
        {
          version: BYOA_HANDOFF_STATUS_V2_VERSION,
          state: null,
          verdict: null,
          resultDigest: null,
          claimFailure
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    if (
      status === null ||
      status.contractDigest !== input.contractDigest ||
      status.tokenDigest !== digestByoaHandoffV2Token(input.token)
    ) {
      return NextResponse.json({ error: "handoff_status_unavailable" }, { status: 404 });
    }
    return NextResponse.json(
      {
        version: BYOA_HANDOFF_STATUS_V2_VERSION,
        state: status.state,
        verdict: status.verdict,
        resultDigest: status.resultDigest,
        claimFailure
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const status =
      caught instanceof ByoaHandoffHttpError
        ? caught.status
        : caught instanceof Error && caught.name === "ZodError"
          ? 400
          : 503;
    return NextResponse.json({ error: "handoff_status_denied" }, { status });
  }
}
