import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  BYOA_HANDOFF_REVEAL_VERSION,
  byoaHandoffRevealRequestSchema
} from "@/lib/demo/agent-handoff";
import {
  BYOA_HANDOFF_REVEAL_V2_VERSION,
  byoaHandoffRevealRequestV2Schema,
  parseByoaFreshContextV2Header
} from "@/lib/demo/agent-handoff-v2";
import { BYOA_HANDOFF_COOKIE, openByoaHandoff } from "@/lib/demo/agent-handoff-token.server";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  createByoaHandoffLedgerV2Redis,
  grantByoaHandoffV2Reveal
} from "@/lib/demo/handoff-ledger-v2.server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const value = await readBoundedHandoffJson(request);
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token) throw new Error("missing");
    if (isByoaHandoffV2Token(token)) {
      const input = byoaHandoffRevealRequestV2Schema.parse(value);
      const envelope = openByoaHandoffV2(token);
      if (
        envelope.session.runId !== input.runId ||
        envelope.session.contractDigest !== input.contractDigest
      ) {
        return NextResponse.json({ error: "handoff_identity_mismatch" }, { status: 409 });
      }
      const freshContextId = parseByoaFreshContextV2Header(request.headers);
      await grantByoaHandoffV2Reveal(createByoaHandoffLedgerV2Redis(), {
        runId: envelope.session.runId,
        contractDigest: envelope.session.contractDigest,
        token,
        freshContextId
      });
      return NextResponse.json(
        {
          version: BYOA_HANDOFF_REVEAL_V2_VERSION,
          contract: envelope.session.contract,
          lineage: envelope.session.lineage
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const input = byoaHandoffRevealRequestSchema.parse(value);
    const envelope = openByoaHandoff(token);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "handoff_identity_mismatch" }, { status: 409 });
    }
    return NextResponse.json(
      { version: BYOA_HANDOFF_REVEAL_VERSION, contract: envelope.session.contract },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    if (caught instanceof ByoaHandoffHttpError) {
      return NextResponse.json({ error: caught.code }, { status: caught.status });
    }
    return NextResponse.json({ error: "handoff_reveal_unavailable" }, { status: 404 });
  }
}
