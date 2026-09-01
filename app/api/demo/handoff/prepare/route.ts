import { NextResponse } from "next/server";

import {
  BYOA_HANDOFF_PREPARE_VERSION,
  byoaHandoffPrepareRequestSchema
} from "@/lib/demo/agent-handoff";
import { createByoaHandoffEnvelope, sealByoaHandoff } from "@/lib/demo/agent-handoff-token.server";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";

import {
  isTrustedHandoffRequest,
  trustedHandoffClientOrigin
} from "@/lib/demo/agent-handoff-http.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 96 * 1024;

export async function POST(request: Request) {
  if (!isTrustedHandoffRequest(request)) {
    return NextResponse.json({ error: "handoff_origin_invalid" }, { status: 403 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "handoff_body_too_large" }, { status: 413 });
  }
  try {
    const bytes = await request.text();
    if (Buffer.byteLength(bytes, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "handoff_body_too_large" }, { status: 413 });
    }
    const body = byoaHandoffPrepareRequestSchema.parse(JSON.parse(bytes) as unknown);
    const activeCommit = resolveDeploymentCommit(process.env);
    if (
      body.session.contract.buildCommit !== activeCommit ||
      body.projection.buildCommit !== activeCommit
    ) {
      return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
    }
    const envelope = createByoaHandoffEnvelope({
      session: body.session,
      projection: body.projection,
      rerun: body.rerun
    });
    const token = sealByoaHandoff(envelope);
    const origin = trustedHandoffClientOrigin(request);
    if (!origin) {
      return NextResponse.json({ error: "handoff_client_origin_invalid" }, { status: 403 });
    }
    return NextResponse.json(
      {
        version: BYOA_HANDOFF_PREPARE_VERSION,
        handoffUrl: `${origin}/demo/handoff#${token}`,
        expiresAt: envelope.expiresAt
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "handoff_prepare_invalid" }, { status: 400 });
  }
}
