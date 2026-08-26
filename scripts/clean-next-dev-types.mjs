import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const generatedTarget = resolve(process.cwd(), ".next", "dev");

if (basename(generatedTarget) !== "dev" || basename(dirname(generatedTarget)) !== ".next") {
  throw new Error(`Refusing to clean unexpected path: ${generatedTarget}`);
}

rmSync(generatedTarget, { recursive: true, force: true });
console.log("Removed only the generated .next/dev type cache before the production build.");
