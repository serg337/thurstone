import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const mandatoryIgnoreEntries = [
  "/docs/csr.md",
  "/docs/lip.md",
  "/docs/ToolProof_Project_Brief_v2.md",
  "/docs/ToolProof_WebMCP_Challenge_Winning_Brief.md",
  "/.toolproof-local/",
  "/ToolProof_Master_Codex_Goal_Prompt.md",
  "/docs/ToolProof_Master_Codex_Goal_Prompt.md"
];

const mandatoryDeploymentIgnoreEntries = [...mandatoryIgnoreEntries];

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

function gitBytes(args) {
  const result = spawnSync("git", args, { cwd: process.cwd() });
  if (result.status !== 0) {
    throw new Error(String(result.stderr).trim() || `git ${args.join(" ")} failed`);
  }
  return Buffer.from(result.stdout);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const localRootNames = ["Users", "Volumes", "home", "mnt", "media"];
const posixLocalPath = new RegExp(
  `(?<![A-Za-z0-9._:/-])/(?:${localRootNames.join("|")})/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*`,
  "gu"
);
const windowsUserPath = /[A-Za-z]:\\{1,4}Users(?:\\{1,4}[A-Za-z0-9._-]+)+/gu;

function localPathTokens(value) {
  return [...(value.match(posixLocalPath) ?? []), ...(value.match(windowsUserPath) ?? [])];
}

function assertNoCurrentLocalPaths(paths) {
  const violations = [];
  for (const path of paths) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const tokens = localPathTokens(bytes.toString("utf8"));
    for (const token of tokens) violations.push(`${path}:${sha256(token)}`);
  }
  if (violations.length > 0) {
    throw new Error(`Current tracked private/local path material: ${violations.join(", ")}`);
  }
}

const allowedHistoricalFixtureBlobs = new Map(
  [
    {
      oid: "7a0b9d88769d0c4b1c3c8559f32eaee33c5da740",
      bytesSha256: "9b806bd2951f3219c89ef165eb2d98294a3e9d80c71bc90844801bbdf64ea822",
      path: "scripts/verify-evidence.ts",
      tokenSha256: [
        "0a30ddaab4da3f859a26ac7ec9673255d771c3339dfbf3f45ff26dadb879cc66",
        "764983cafd45e9e2879152a36e69d05a58d7023dff8fb4037e88f72a4305c489"
      ]
    },
    {
      oid: "3af4db955b0ceab7d720389cf01126671450c61c",
      bytesSha256: "df5c398ea0b4c62741eee5b83c4f4c1723228b74d112a814056a1e569ff3e7cc",
      path: "tests/unit/gate1-proof-bundle.test.ts",
      tokenSha256: [
        "7ee7126e93f6a276c349b451e3e614ff36cf180233124bac2cb982f8cc51f27b",
        "9233f6c0634b34d09987acef222bd4d57f5dfdd1094bd7420fe6263832404302"
      ]
    },
    {
      oid: "3ec1b17303b94c240fc54f8520589e33148d15a2",
      bytesSha256: "572bce0b2fcafd785e2f031f423b3406b0e80c2eefbf4a0d449a04a86c89ed76",
      path: "tests/unit/gate1-proof-bundle.test.ts",
      tokenSha256: [
        "7ee7126e93f6a276c349b451e3e614ff36cf180233124bac2cb982f8cc51f27b",
        "9233f6c0634b34d09987acef222bd4d57f5dfdd1094bd7420fe6263832404302"
      ]
    }
  ].map((fixture) => [
    fixture.oid,
    Object.freeze({ ...fixture, tokenSha256: new Set(fixture.tokenSha256) })
  ])
);
const expectedHistoricalFixtureProjection = Object.freeze({
  occurrences: 92,
  sha256: "1a2a185e66e9b87051652e68b967909b6066037c948c08f0f4858617233ba9cc"
});

function historicalLocalPathProjection() {
  const commits = git(["rev-list", "--all"]).split(/\r?\n/u).filter(Boolean);
  const slash = "/";
  const backslash = "\\";
  const patterns = localRootNames.map((root) => `${slash}${root}${slash}`);
  for (let length = 1; length <= 4; length += 1) {
    patterns.push(`:${backslash.repeat(length)}Users${backslash.repeat(length)}`);
  }
  const records = [];
  const blobSha256 = new Map();
  for (const commit of commits) {
    const argumentsList = ["grep", "-n", "-I", "-F"];
    for (const pattern of patterns) argumentsList.push("-e", pattern);
    argumentsList.push(commit, "--", ".");
    const result = spawnSync("git", argumentsList, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16_777_216
    });
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(result.stderr.trim() || "Complete-history local-path scan failed");
    }
    for (const outputLine of result.stdout.split(/\r?\n/u).filter(Boolean)) {
      const match = /^([a-f0-9]{40}):([^:]+):(\d+):(.*)$/u.exec(outputLine);
      if (!match) throw new Error("Complete-history local-path output was malformed");
      const [, observedCommit, path, lineNumber, line] = match;
      const tokens = localPathTokens(line);
      if (tokens.length === 0) continue;
      const oid = git(["rev-parse", `${observedCommit}:${path}`]).trim();
      const fixture = allowedHistoricalFixtureBlobs.get(oid);
      const bytesHash = blobSha256.get(oid) ?? sha256(gitBytes(["cat-file", "-p", oid]));
      blobSha256.set(oid, bytesHash);
      for (const token of tokens) {
        const tokenHash = sha256(token);
        if (
          !fixture ||
          fixture.path !== path ||
          fixture.bytesSha256 !== bytesHash ||
          !fixture.tokenSha256.has(tokenHash)
        ) {
          throw new Error(
            `Unexpected complete-history private/local path material:${observedCommit}:${path}:${lineNumber}:${tokenHash}`
          );
        }
        records.push({
          commit: observedCommit,
          path,
          line: Number(lineNumber),
          oid,
          blobSha: bytesHash,
          lineSha: sha256(line),
          tokenSha: tokenHash
        });
      }
    }
  }
  records.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const projectionHash = sha256(JSON.stringify(records));
  if (
    records.length !== expectedHistoricalFixtureProjection.occurrences ||
    projectionHash !== expectedHistoricalFixtureProjection.sha256
  ) {
    throw new Error(
      `Historical negative-fixture projection drift:${records.length}:${projectionHash}`
    );
  }
  return Object.freeze({ occurrences: records.length, sha256: projectionHash });
}

function assertNoLocalPathsInMessagesOrTags() {
  const commitMessages = gitBytes(["log", "--all", "--format=%H%x00%B%x00"]).toString("utf8");
  const commitTokens = localPathTokens(commitMessages);
  if (commitTokens.length > 0) {
    throw new Error(`Private/local path in commit message:${commitTokens.map(sha256).join(",")}`);
  }
  const refs = git([
    "for-each-ref",
    "--format=%(objecttype)%00%(objectname)%00%(refname)",
    "refs/tags"
  ]);
  for (const row of refs.split(/\r?\n/u).filter(Boolean)) {
    const [type, oid, name] = row.split("\0");
    const bytes = type === "tag" ? gitBytes(["cat-file", "-p", oid]).toString("utf8") : "";
    const tokens = localPathTokens(`${name}\n${bytes}`);
    if (tokens.length > 0) {
      throw new Error(`Private/local path in tag:${name}:${tokens.map(sha256).join(",")}`);
    }
  }
}

const ignoreLines = new Set(readFileSync(".gitignore", "utf8").split(/\r?\n/u));
const missingEntries = mandatoryIgnoreEntries.filter((entry) => !ignoreLines.has(entry));
if (missingEntries.length > 0) {
  throw new Error(`Missing mandatory .gitignore entries: ${missingEntries.join(", ")}`);
}

const deploymentIgnoreLines = new Set(readFileSync(".vercelignore", "utf8").split(/\r?\n/u));
const missingDeploymentEntries = mandatoryDeploymentIgnoreEntries.filter(
  (entry) => !deploymentIgnoreLines.has(entry)
);
if (missingDeploymentEntries.length > 0) {
  throw new Error(
    `Missing mandatory .vercelignore entries: ${missingDeploymentEntries.join(", ")}`
  );
}

const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const candidateFiles = git(["ls-files", "-co", "--exclude-standard", "-z"])
  .split("\0")
  .filter((path) => path && existsSync(path));
const trackedViolations = tracked.filter((path) =>
  excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
);
if (trackedViolations.length > 0) {
  throw new Error(`Excluded paths are tracked: ${trackedViolations.join(", ")}`);
}
assertNoCurrentLocalPaths(candidateFiles);

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
const historicalFixtures = historicalLocalPathProjection();
assertNoLocalPathsInMessagesOrTags();

console.log(
  `Publication boundary verified: ${mandatoryIgnoreEntries.length} Git and deployment ignores, ${tracked.length} tracked / ${candidateFiles.length} candidate files, no excluded reachable paths, no current private/local path material, and ${historicalFixtures.occurrences} exact negative-fixture occurrences bound by ${historicalFixtures.sha256}.`
);
