import { NextResponse } from "next/server";

import { byoaHandoffOpenRequestSchema } from "@/lib/demo/agent-handoff";
import { byoaHandoffOpenRequestV2Schema } from "@/lib/demo/agent-handoff-v2";
import {
  BYOA_HANDOFF_COOKIE,
  byoaHandoffCookieOptions,
  openByoaHandoff
} from "@/lib/demo/agent-handoff-token.server";
import {
  ByoaHandoffTokenV2Error,
  isByoaHandoffV2Token,
  openByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import {
  isByoaHandoffShortCode,
  resolveByoaHandoffV2Credential
} from "@/lib/demo/handoff-short-code.server";
import {
  ByoaHandoffLedgerV2Error,
  claimByoaHandoffV2,
  createByoaHandoffLedgerV2Redis
} from "@/lib/demo/handoff-ledger-v2.server";
import {
  recordHandoffClaimFailure,
  type HandoffClaimFailureReason
} from "@/lib/demo/handoff-claim-receipt.server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

async function claimFailureResponse(
  token: string,
  reason: HandoffClaimFailureReason,
  status: number
) {
  let receipt = null;
  try {
    receipt = await recordHandoffClaimFailure(token, reason);
  } catch {
    if (reason !== "ledger_unavailable") {
      reason = "ledger_unavailable";
      try {
        receipt = await recordHandoffClaimFailure(token, reason);
      } catch {
        receipt = null;
      }
    }
  }
  return NextResponse.json(
    { error: "handoff_claim_denied", reason, claimFailure: receipt },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ledgerFailureReason(error: ByoaHandoffLedgerV2Error): HandoffClaimFailureReason {
  if (error.code === "HANDOFF_EXPIRED") return "expired";
  if (error.code === "HANDOFF_MISSING") return "ledger_record_missing";
  if (error.code === "HANDOFF_BINDING_MISMATCH") return "binding_mismatch";
  if (error.code === "HANDOFF_ALREADY_CLAIMED") {
    return error.details[0] === "REVOKED" ? "revoked" : "already_claimed";
  }
  return "ledger_unavailable";
}

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const value = await readBoundedHandoffJson(request);
    const token =
      typeof value === "object" && value !== null && typeof Reflect.get(value, "token") === "string"
        ? String(Reflect.get(value, "token"))
        : "";
    const resolvedToken = await resolveByoaHandoffV2Credential(token);
    if (isByoaHandoffShortCode(token) && resolvedToken === null) {
      return claimFailureResponse(token, "invalid_token", 410);
    }
    const v2Token = resolvedToken ?? token;
    const usesV2 = isByoaHandoffV2Token(v2Token);
    if (usesV2) {
      const body = byoaHandoffOpenRequestV2Schema.parse(value);
      let envelope: ReturnType<typeof openByoaHandoffV2>;
      try {
        envelope = openByoaHandoffV2(v2Token);
      } catch (caught) {
        const reason = caught instanceof ByoaHandoffTokenV2Error ? caught.code : "invalid_token";
        return claimFailureResponse(v2Token, reason, 410);
      }
      try {
        await claimByoaHandoffV2(createByoaHandoffLedgerV2Redis(), {
          runId: envelope.session.runId,
          contractDigest: envelope.session.contractDigest,
          token: v2Token,
          freshContextId: body.freshContextId
        });
      } catch (caught) {
        const reason =
          caught instanceof ByoaHandoffLedgerV2Error
            ? ledgerFailureReason(caught)
            : "ledger_unavailable";
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
        return claimFailureResponse(v2Token, reason, status);
      }
      const response = NextResponse.json(
        { ok: true, redirect: "/demo/run" },
        { headers: { "Cache-Control": "no-store" } }
      );
      response.cookies.set(
        BYOA_HANDOFF_COOKIE,
        v2Token,
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
  } catch (caught) {
    if (caught instanceof ByoaHandoffHttpError) {
      return NextResponse.json({ error: caught.code }, { status: caught.status });
    }
    return NextResponse.json({ error: "handoff_token_invalid" }, { status: 410 });
  }
}
