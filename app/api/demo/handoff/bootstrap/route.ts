import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BYOA_HANDOFF_BOOTSTRAP_VERSION, redactByoaSession } from "@/lib/demo/agent-handoff";
import { BYOA_HANDOFF_COOKIE, openByoaHandoff } from "@/lib/demo/agent-handoff-token.server";
import { resolveDeploymentCommit } from "@/lib/deployment/commit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = (await cookies()).get(BYOA_HANDOFF_COOKIE)?.value;
    if (!token) throw new Error("missing");
    const envelope = openByoaHandoff(token);
    const activeCommit = resolveDeploymentCommit(process.env);
    if (
      envelope.session.contract.buildCommit !== activeCommit ||
      envelope.projection.buildCommit !== activeCommit
    ) {
      return NextResponse.json({ error: "handoff_build_mismatch" }, { status: 409 });
    }
    return NextResponse.json(
      {
        version: BYOA_HANDOFF_BOOTSTRAP_VERSION,
        session: redactByoaSession(envelope.session),
        projection: envelope.projection,
        rerun: envelope.rerun
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "handoff_unavailable" }, { status: 404 });
  }
}
