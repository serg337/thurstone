import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, ".next/server/app/lab/page_client-reference-manifest.js");
const manifest = await readFile(manifestPath, "utf8");
const chunks = [
  ...new Set(
    [...manifest.matchAll(/\/_next\/(static\/chunks\/[A-Za-z0-9._-]+\.js)/gu)].map(
      (match) => match[1]
    )
  )
];

if (chunks.length === 0)
  throw new Error("No Lab client chunks were found in the production build.");

const labSource = (
  await Promise.all(chunks.map((chunk) => readFile(resolve(root, ".next", chunk), "utf8")))
).join("\n");

const forbidden = [
  "calibration_truth_",
  "internalTruthId",
  "expectedTool",
  "What items and quantities are currently in my cart?",
  "Please review my current order, including line prices",
  "Set the Stoneware mug quantity in my cart to 3.",
  "Open the simulated checkout for this cart so it can remain pending"
];

const staticFiles = await readdir(resolve(root, ".next/static/chunks"), { recursive: true });
const everyClientChunk = staticFiles.filter((file) => String(file).endsWith(".js"));
const allClientSource = (
  await Promise.all(
    everyClientChunk.map((file) =>
      readFile(resolve(root, ".next/static/chunks", String(file)), "utf8")
    )
  )
).join("\n");
for (const value of forbidden) {
  if (labSource.includes(value) || allClientSource.includes(value)) {
    throw new Error(`Production client bundle leaks server truth: ${value}`);
  }
}
if (staticFiles.some((file) => String(file).endsWith(".map"))) {
  throw new Error("Production client source maps must remain disabled during blinded execution.");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: "probe-no-leakage",
    labChunkCount: chunks.length,
    allClientChunkCount: everyClientChunk.length,
    forbiddenSentinels: forbidden.length,
    sourceMaps: 0
  })}\n`
);
