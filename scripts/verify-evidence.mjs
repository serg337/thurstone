import { existsSync } from "node:fs";

const manifestPath = "evidence/frozen-run-manifest.json";

if (!existsSync(manifestPath)) {
  console.error(
    `No sealed evidence manifest exists at ${manifestPath}. This is expected before the authentic baseline gate and must not be reported as a pass.`
  );
  process.exit(2);
}

console.error(
  "Evidence verification is not implemented yet; fail closed until the frozen schema exists."
);
process.exit(2);
