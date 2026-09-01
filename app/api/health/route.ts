import { NextResponse } from "next/server";

import { resolveDeploymentCommit } from "@/lib/deployment/commit";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "toolproof",
      simulation: true,
      commit: resolveDeploymentCommit(process.env)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
