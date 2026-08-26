import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const lockRoot = packageLock.packages?.[""];

if (packageLock.lockfileVersion !== 3 || !lockRoot) {
  throw new Error("Expected an npm v3 lockfile with a root package record.");
}

const groups = ["dependencies", "devDependencies"];
let directCount = 0;

for (const group of groups) {
  const declared = packageJson[group] ?? {};
  const locked = lockRoot[group] ?? {};

  for (const [name, version] of Object.entries(declared)) {
    directCount += 1;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
      throw new Error(`${group}.${name} is not an exact version: ${version}`);
    }
    if (locked[name] !== version) {
      throw new Error(`${group}.${name} differs between package.json and package-lock.json.`);
    }
  }
}

const nodeVersion = process.version.replace(/^v/u, "");
if (nodeVersion !== "22.23.2") {
  throw new Error(`Expected Node 22.23.2, received ${nodeVersion}.`);
}

const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
if (npmVersion !== "10.9.8" || packageJson.packageManager !== "npm@10.9.8") {
  throw new Error(`Expected npm 10.9.8, received ${npmVersion}.`);
}

console.log(
  `Install identity verified: Node ${nodeVersion}, npm ${npmVersion}, lockfile v3, ${directCount} exact direct pins.`
);
