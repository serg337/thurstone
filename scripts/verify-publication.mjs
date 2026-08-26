import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mandatoryIgnoreEntries = [
  "/docs/csr.md",
  "/docs/lip.md",
  "/docs/ToolProof_Project_Brief_v2.md",
  "/docs/ToolProof_WebMCP_Challenge_Winning_Brief.md",
  "/.toolproof-local/",
  "/ToolProof_Master_Codex_Goal_Prompt.md",
  "/docs/ToolProof_Master_Codex_Goal_Prompt.md"
];

const excludedPaths = mandatoryIgnoreEntries.map((entry) =>
  entry.replace(/^\//, "").replace(/\/$/, "")
);

function git(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

const ignoreLines = new Set(readFileSync(".gitignore", "utf8").split(/\r?\n/u));
const missingEntries = mandatoryIgnoreEntries.filter((entry) => !ignoreLines.has(entry));
if (missingEntries.length > 0) {
  throw new Error(`Missing mandatory .gitignore entries: ${missingEntries.join(", ")}`);
}

const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const trackedViolations = tracked.filter((path) =>
  excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
);
if (trackedViolations.length > 0) {
  throw new Error(`Excluded paths are tracked: ${trackedViolations.join(", ")}`);
}

const reachableObjects = git(["rev-list", "--objects", "--all"]);
const historyViolations = reachableObjects
  .split(/\r?\n/u)
  .map((line) => line.replace(/^[0-9a-f]+\s+/u, ""))
  .filter((path) =>
    excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
  );
if (historyViolations.length > 0) {
  throw new Error(`Excluded paths exist in reachable history: ${historyViolations.join(", ")}`);
}

console.log(
  `Publication boundary verified: ${mandatoryIgnoreEntries.length} mandatory ignores, ${tracked.length} tracked files, no excluded reachable paths.`
);
