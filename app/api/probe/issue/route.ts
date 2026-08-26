import { probeDisabledResponse, rejectInvalidProbeRequest } from "@/lib/probe/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return rejectInvalidProbeRequest(request) ?? probeDisabledResponse();
}
