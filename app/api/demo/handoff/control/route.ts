import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ByoaHandoffHttpError,
  isTrustedHandoffRequest,
  readBoundedHandoffJson
} from "@/lib/demo/agent-handoff-http.server";
import {
  byoaHandoffControlRequestV2Schema,
  parseByoaFreshContextV2Header
} from "@/lib/demo/agent-handoff-v2";
import { BYOA_HANDOFF_COOKIE } from "@/lib/demo/agent-handoff-token.server";
import { isByoaHandoffV2Token, openByoaHandoffV2 } from "@/lib/demo/agent-handoff-token-v2.server";
import {
  ByoaHandoffLedgerV2Error,
  createByoaHandoffLedgerV2Redis,
  settleByoaHandoffV2,
  startByoaHandoffV2,
  timeoutByoaHandoffV2
} from "@/lib/demo/handoff-ledger-v2.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaHandoffControlRequestV2Schema.parse(await readBoundedHandoffJson(request));
    const freshContextId = parseByoaFreshContextV2Header(request.headers);
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token || !isByoaHandoffV2Token(token)) {
      return NextResponse.json({ error: "handoff_control_unavailable" }, { status: 404 });
    }
    const envelope = openByoaHandoffV2(token);
    if (
      envelope.session.runId !== input.runId ||
      envelope.session.contractDigest !== input.contractDigest
    ) {
      return NextResponse.json({ error: "handoff_identity_mismatch" }, { status: 409 });
    }
    const redis = createByoaHandoffLedgerV2Redis();
    const binding = {
      runId: input.runId,
      contractDigest: input.contractDigest,
      token,
      freshContextId
    } as const;
    const receipt =
      input.action === "start"
        ? await startByoaHandoffV2(redis, binding)
        : input.action === "settle"
          ? await settleByoaHandoffV2(redis, binding, "SETTLED")
          : input.action === "unavailable"
            ? await settleByoaHandoffV2(redis, binding, "UNAVAILABLE")
            : await timeoutByoaHandoffV2(redis, binding);
    return NextResponse.json(
      {
        ok: true,
        state: receipt.state,
        serverTimeMs: receipt.serverTimeMs,
        startedAtMs: receipt.startedAtMs
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (caught) {
    const status =
      caught instanceof ByoaHandoffHttpError
        ? caught.status
        : caught instanceof Error && caught.name === "ZodError"
          ? 400
          : caught instanceof ByoaHandoffLedgerV2Error &&
              (caught.code === "HANDOFF_EXPIRED" ||
                caught.code === "HANDOFF_MISSING" ||
                caught.code === "HANDOFF_LIFETIME_INSUFFICIENT")
            ? 410
            : caught instanceof ByoaHandoffLedgerV2Error &&
                (caught.code.endsWith("INVALID_STATE") ||
                  caught.code === "HANDOFF_TIMEOUT_EARLY" ||
                  caught.code === "HANDOFF_BINDING_MISMATCH")
              ? 409
              : 503;
    return NextResponse.json(
      { error: caught instanceof ByoaHandoffHttpError ? caught.code : "handoff_control_denied" },
      { status }
    );
  }
}
