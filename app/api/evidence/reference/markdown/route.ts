import { readSemanticResults } from "@/lib/results/semantic-results.server";

export async function GET() {
  const results = await readSemanticResults();
  if (results.status !== "paired-comparison") {
    return Response.json({ error: "terminal_reference_evidence_unavailable" }, { status: 404 });
  }
  return new Response(results.evidenceExports.markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="toolproof-reference-evidence.md"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-ToolProof-Evidence-SHA256": results.evidenceExports.markdownSha256
    }
  });
}
