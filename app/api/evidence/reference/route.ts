import { readSemanticResults } from "@/lib/results/semantic-results.server";

export async function GET() {
  const results = await readSemanticResults();
  if (results.status !== "paired-comparison") {
    return Response.json({ error: "terminal_reference_evidence_unavailable" }, { status: 404 });
  }
  return new Response(results.evidenceExports.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="toolproof-reference-evidence.json"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-ToolProof-Evidence-SHA256": results.evidenceExports.jsonSha256
    }
  });
}
