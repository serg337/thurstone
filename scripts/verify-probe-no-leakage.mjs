import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, ".next/server/app/lab/page_client-reference-manifest.js");
const manifest = await readFile(manifestPath, "utf8");

const staticRootCandidates = [
  {
    path: resolve(root, ".next/static"),
    manifestKey(relativePath) {
      return relativePath.startsWith("chunks/") ? `static/${relativePath}` : null;
    }
  },
  ...[resolve(root, ".next/output/static"), resolve(root, ".vercel/output/static")].map((path) => ({
    path,
    manifestKey(relativePath) {
      return relativePath.startsWith("_next/static/") ? relativePath.slice("_next/".length) : null;
    }
  }))
];

const staticTrees = (
  await Promise.all(
    staticRootCandidates.map(async (candidate) => {
      try {
        return {
          ...candidate,
          files: (await readdir(candidate.path, { recursive: true })).map((file) => String(file))
        };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    })
  )
).filter((tree) => tree !== null);

if (staticTrees.length === 0) {
  throw new Error("No production static output tree was found.");
}

const clientFiles = staticTrees.flatMap((tree) =>
  tree.files
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const relativePath = file.replaceAll("\\", "/");
      return {
        path: resolve(tree.path, file),
        manifestKey: tree.manifestKey(relativePath)
      };
    })
);
const chunks = clientFiles.filter(
  (file) => file.manifestKey !== null && manifest.includes(file.manifestKey)
);

if (chunks.length === 0)
  throw new Error("No Lab client chunks were found in the production build.");

const labSource = (await Promise.all(chunks.map((chunk) => readFile(chunk.path, "utf8")))).join(
  "\n"
);

const forbidden = [
  "calibration_truth_",
  "internalTruthId",
  "expectedTool",
  "What items and quantities are currently in my cart?",
  "Please review my current order, including line prices",
  "Set the Stoneware mug quantity in my cart to 3.",
  "Open the simulated checkout for this cart so it can remain pending"
];
const labOnlyForbidden = [
  "4832959832a45379a82c23a8d08712e7cdc78f2a07e621467ca8f3cd76d9756b",
  "016f607f498384bcac2d60474aaa3f3373635cd662bb2eb4d7bb71b0b223b863",
  "64c3095a1098de30ac266ed2344873da6545875a",
  "run_tOYy-NQLgCCS2YJ8l2DQ4Q"
];

const allClientSource = (
  await Promise.all(clientFiles.map((file) => readFile(file.path, "utf8")))
).join("\n");
for (const value of forbidden) {
  if (labSource.includes(value) || allClientSource.includes(value)) {
    throw new Error(`Production client bundle leaks server truth: ${value}`);
  }
}
for (const value of labOnlyForbidden) {
  if (labSource.includes(value)) {
    throw new Error(`Lab client bundle leaks prior calibration lineage: ${value}`);
  }
}
if (staticTrees.some((tree) => tree.files.some((file) => file.endsWith(".map")))) {
  throw new Error("Production client source maps must remain disabled during blinded execution.");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: "probe-no-leakage",
    labChunkCount: chunks.length,
    allClientChunkCount: clientFiles.length,
    forbiddenSentinels: forbidden.length,
    labOnlyForbiddenSentinels: labOnlyForbidden.length,
    sourceMaps: 0
  })}\n`
);
