import { readInvocationIntegrityResults } from "@/lib/results/invocation-integrity-results.server";

export async function GET() {
  const results = await readInvocationIntegrityResults();
  if (results.status === "pending") {
    return Response.json({ error: "invocation_integrity_evidence_pending" }, { status: 404 });
  }
  if (results.status === "invalid") {
    return Response.json({ error: results.reason }, { status: 409 });
  }
  return new Response(results.evidenceExports.json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="thurstone-invocation-integrity-evidence.json"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Thurstone-Evidence-SHA256": results.evidenceExports.jsonSha256,
      "X-Thurstone-Package-SHA256": results.evidencePackage.packageDigest
    }
  });
}
