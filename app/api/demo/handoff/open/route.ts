import { NextResponse } from "next/server";

import { byoaHandoffOpenRequestSchema } from "@/lib/demo/agent-handoff";
import { byoaHandoffOpenRequestV2Schema } from "@/lib/demo/agent-handoff-v2";
import {
  BYOA_HANDOFF_COOKIE,
  byoaHandoffCookieOptions,
  openByoaHandoff
} from "@/lib/demo/agent-handoff-token.server";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  ByoaHandoffLedgerV2Error,
  claimByoaHandoffV2,
  createByoaHandoffLedgerV2Redis
} from "@/lib/demo/handoff-ledger-v2.server";

import { isTrustedHandoffRequest } from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const value = await request.json();
    const token =
      typeof value === "object" && value !== null && typeof Reflect.get(value, "token") === "string"
        ? String(Reflect.get(value, "token"))
        : "";
    const usesV2 = isByoaHandoffV2Token(token);
    if (usesV2) {
      const body = byoaHandoffOpenRequestV2Schema.parse(value);
      const envelope = openByoaHandoffV2(body.token);
      try {
        await claimByoaHandoffV2(createByoaHandoffLedgerV2Redis(), {
          runId: envelope.session.runId,
          contractDigest: envelope.session.contractDigest,
          token: body.token,
          freshContextId: body.freshContextId
        });
      } catch (caught) {
        const status =
          caught instanceof ByoaHandoffLedgerV2Error && caught.code === "HANDOFF_ALREADY_CLAIMED"
            ? 409
            : caught instanceof ByoaHandoffLedgerV2Error &&
                (caught.code === "HANDOFF_EXPIRED" || caught.code === "HANDOFF_MISSING")
              ? 410
              : caught instanceof ByoaHandoffLedgerV2Error &&
                  caught.code === "HANDOFF_BINDING_MISMATCH"
                ? 409
                : 503;
        return NextResponse.json({ error: "handoff_claim_denied" }, { status });
      }
      const response = NextResponse.json(
        { ok: true, redirect: "/demo/run" },
        { headers: { "Cache-Control": "no-store" } }
      );
      response.cookies.set(
        BYOA_HANDOFF_COOKIE,
        body.token,
        byoaHandoffCookieOptions(request.url, envelope.expiresAt)
      );
      return response;
    }
    const body = byoaHandoffOpenRequestSchema.parse(value);
    const envelope = openByoaHandoff(body.token);
    const response = NextResponse.json(
      { ok: true, redirect: "/demo/run" },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(
      BYOA_HANDOFF_COOKIE,
      body.token,
      byoaHandoffCookieOptions(request.url, envelope.expiresAt)
    );
    return response;
  } catch {
    return NextResponse.json({ error: "handoff_token_invalid" }, { status: 410 });
  }
}
