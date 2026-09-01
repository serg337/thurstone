import { NextResponse } from "next/server";

import { byoaHandoffOpenRequestSchema } from "@/lib/demo/agent-handoff";
import {
  BYOA_HANDOFF_COOKIE,
  byoaHandoffCookieOptions,
  openByoaHandoff
} from "@/lib/demo/agent-handoff-token.server";

import { isTrustedHandoffRequest } from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  try {
    const body = byoaHandoffOpenRequestSchema.parse(await request.json());
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
