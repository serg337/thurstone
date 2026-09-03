import { NextResponse } from "next/server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import { byoaHandoffRevokeRequestV2Schema } from "@/lib/demo/agent-handoff-v2";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  ByoaHandoffLedgerV2Error,
  createByoaHandoffLedgerV2Redis,
  revokeByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";
import { resolveByoaHandoffV2Credential } from "@/lib/demo/handoff-short-code.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaHandoffRevokeRequestV2Schema.parse(await readBoundedHandoffJson(request));
    const token = await resolveByoaHandoffV2Credential(input.token);
    if (token === null || !isByoaHandoffV2Token(token)) {
      return NextResponse.json({ error: "handoff_revoke_invalid" }, { status: 400 });
    }
    const envelope = openByoaHandoffV2(token);
    const receipt = await revokeByoaHandoffV2(createByoaHandoffLedgerV2Redis(), {
      runId: envelope.session.runId,
      contractDigest: envelope.session.contractDigest,
      token
    });
    return NextResponse.json(
      { ok: true, state: receipt.state },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const status =
      caught instanceof ByoaHandoffHttpError
        ? caught.status
        : caught instanceof Error && caught.name === "ZodError"
          ? 400
          : caught instanceof ByoaHandoffLedgerV2Error &&
              caught.code === "HANDOFF_REVOKE_INVALID_STATE"
            ? 409
            : caught instanceof ByoaHandoffLedgerV2Error &&
                (caught.code === "HANDOFF_EXPIRED" || caught.code === "HANDOFF_MISSING")
              ? 410
              : 503;
    return NextResponse.json(
      { error: caught instanceof ByoaHandoffHttpError ? caught.code : "handoff_revoke_denied" },
      { status }
    );
  }
}
