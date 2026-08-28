import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { configuredGate5Revision } from "../lib/semantic/revision-config.server";

const execFile = promisify(execFileCallback);
const revision = await configuredGate5Revision();

if (revision.status !== "ready" || !revision.revision) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "gate5-one-variable", status: revision.status })}\n`
  );
} else {
  const result = await execFile(
    "git",
    ["diff", "--name-only", `${revision.revision.v1AppCommit}..${revision.revision.v2AppCommit}`],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  const files = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    files.length !== 1 ||
    files[0] !== "lib/webmcp/checkout-request-tool.ts" ||
    process.env.VERCEL_GIT_COMMIT_SHA !== revision.revision.v2AppCommit
  ) {
    throw new Error("gate5_source_diff_not_one_variable");
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "gate5-one-variable",
      status: "verified",
      changedField: revision.revision.changedField,
      file: files[0],
      v1AppCommit: revision.revision.v1AppCommit,
      v2AppCommit: revision.revision.v2AppCommit,
      revisionFreezeHash: revision.revision.revisionFreezeHash
    })}\n`
  );
}
