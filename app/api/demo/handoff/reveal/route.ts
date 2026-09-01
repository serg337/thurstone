import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  BYOA_HANDOFF_REVEAL_VERSION,
  byoaHandoffRevealRequestSchema
} from "@/lib/demo/agent-handoff";
import { BYOA_HANDOFF_COOKIE, openByoaHandoff } from "@/lib/demo/agent-handoff-token.server";

import { isTrustedHandoffRequest } from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const input = byoaHandoffRevealRequestSchema.parse(await request.json());
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token) throw new Error("missing");
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
  } catch {
    return NextResponse.json({ error: "handoff_reveal_unavailable" }, { status: 404 });
  }
}
