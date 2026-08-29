import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const INVENTORY_VERSION = "toolproof-npm-transitive-inventory@1.0.0";
const INVENTORY_PATH = "third_party/npm-transitive-inventory.json";
const LOCKFILE_PATH = "package-lock.json";
const NODE_VERSION = "22.23.2";

const NOTICE_FILES = Object.freeze([
  Object.freeze({
    path: "third_party/licenses/nodejs-22.23.2-LICENSE.txt",
    sha256: "c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4",
    sourceIdentity: "https://github.com/nodejs/node/blob/v22.23.2/LICENSE",
    covers: Object.freeze(["Node.js MIT license and bundled third-party notices"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/LGPL-3.0-or-later.txt",
    sha256: "e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118",
    sourceIdentity: "https://www.gnu.org/licenses/lgpl-3.0.txt",
    covers: Object.freeze(["LGPL-3.0-or-later"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/MIT-terms.txt",
    sha256: "435a6722c786b0a56fbe7387028f1d9d3f3a2d0fb615bb8fee118727c3f59b7b",
    sourceIdentity: "concat-map@0.0.1 LICENSE from installed lockfile tree",
    covers: Object.freeze(["MIT terms used by compound binary-component notices"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/axe-core-4.13.0-MPL-2.0.txt",
    sha256: "af175b9d96ee93c21a036152e1b905b0b95304d4ae8c2c921c7609100ba8df7e",
    sourceIdentity: "axe-core@4.13.0 LICENSE",
    covers: Object.freeze(["MPL-2.0 for axe-core packages"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/axe-core-4.13.0-THIRD-PARTY.txt",
    sha256: "4f8563870d0fca38bbc3e00b6f670cb7fa9f380ba9f26a7f7d1184a6b18b1653",
    sourceIdentity: "axe-core@4.13.0 LICENSE-3RD-PARTY.txt",
    covers: Object.freeze(["axe-core bundled third-party attributions"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/caniuse-lite-1.0.30001810-CC-BY-4.0.txt",
    sha256: "fd3a263fe19ed8faa9068b43abaebafc02c77897b0c6fc09abc04bb592e5f16e",
    sourceIdentity: "caniuse-lite@1.0.30001810 LICENSE",
    covers: Object.freeze(["CC-BY-4.0"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/lightningcss-1.33.0-MPL-2.0.txt",
    sha256: "5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e",
    sourceIdentity: "lightningcss@1.33.0 LICENSE",
    covers: Object.freeze(["MPL-2.0 for lightningcss packages"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/sharp-0.35.4-Apache-2.0.txt",
    sha256: "73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68",
    sourceIdentity: "sharp@0.35.4 LICENSE",
    covers: Object.freeze(["Apache-2.0 for sharp binary packages"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/sharp-libvips-linux-x64-1.3.3-NOTICE.md",
    sha256: "4f87b4934d26d52ed65a42e96bfe88e75ac98dbd3bc302b50fe6c07d22e42630",
    sourceIdentity: "@img/sharp-libvips-linux-x64@1.3.3 README.md",
    covers: Object.freeze(["Linux x64 libvips bundled-component attribution"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/sharp-libvips-linuxmusl-x64-1.3.3-NOTICE.md",
    sha256: "2948195d2a4f5bb3c9cdc22ac4184e38b63c8319c2753d454571cf7b31482b17",
    sourceIdentity: "@img/sharp-libvips-linuxmusl-x64@1.3.3 README.md",
    covers: Object.freeze(["Linux musl x64 libvips bundled-component attribution"])
  }),
  Object.freeze({
    path: "third_party/licenses/npm/sharp-wasm32-0.35.4-NOTICE.md",
    sha256: "9d7a84ade91e8e50f5dfc303fb53e580e806f6f89bde804e84a01c1b8853fff5",
    sourceIdentity: "@img/sharp-wasm32@0.35.4 README.md",
    covers: Object.freeze(["sharp wasm32 bundled-component attribution"])
  })
]);

const NOTICE_FILE_BY_PATH = new Map(NOTICE_FILES.map((entry) => [entry.path, entry]));

const PERMISSIVE_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Python-2.0"
]);

const NOTICE_REQUIRED_LICENSES = new Set([
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "CC-BY-4.0",
  "LGPL-3.0-or-later",
  "MPL-2.0"
]);

const LICENSE_ALIASES = new Map([
  ["Apache 2.0", "Apache-2.0"],
  ["Apache License 2.0", "Apache-2.0"],
  ["BSD 2-Clause", "BSD-2-Clause"],
  ["BSD 3-Clause", "BSD-3-Clause"]
]);

function fail(code, detail = "") {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function readJson(filePath, code) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(code, error instanceof Error ? error.message : String(error));
  }
}

function packageNameFromLockPath(lockPath) {
  const marker = "/node_modules/";
  const normalized = lockPath.startsWith("node_modules/") ? `/${lockPath}` : lockPath;
  const index = normalized.lastIndexOf(marker);
  if (index < 0) fail("inventory_lock_path_invalid", lockPath);
  const name = normalized.slice(index + marker.length);
  if (!/^(?:@[a-z0-9_.~-]+\/)?[a-z0-9_.~-]+$/iu.test(name)) {
    fail("inventory_package_name_invalid", `${lockPath} -> ${name}`);
  }
  return name;
}

function normalizeLicense(value, identity) {
  let license = value;
  if (license && typeof license === "object" && !Array.isArray(license)) {
    license = license.type;
  }
  if (typeof license !== "string" || license.trim() === "") {
    fail("inventory_license_unknown", identity);
  }
  const normalized = LICENSE_ALIASES.get(license.trim()) ?? license.trim();
  if (PERMISSIVE_LICENSES.has(normalized) || NOTICE_REQUIRED_LICENSES.has(normalized)) {
    return normalized;
  }
  fail("inventory_license_incompatible_or_unknown", `${identity} -> ${normalized}`);
}

function compatibilityFor(license) {
  if (PERMISSIVE_LICENSES.has(license)) return "compatible-permissive";
  if (NOTICE_REQUIRED_LICENSES.has(license)) return "compatible-notice-required";
  fail("inventory_license_incompatible_or_unknown", license);
}

function noticeReference(pathValue) {
  if (!NOTICE_FILE_BY_PATH.has(pathValue)) fail("inventory_notice_reference_unknown", pathValue);
  return pathValue;
}

function noticeReferencesFor(name, license) {
  if (!NOTICE_REQUIRED_LICENSES.has(license)) return [];
  const references = new Set();
  if (license.includes("Apache-2.0")) {
    references.add(noticeReference("third_party/licenses/npm/sharp-0.35.4-Apache-2.0.txt"));
  }
  if (license.includes("LGPL-3.0-or-later")) {
    references.add(noticeReference("third_party/licenses/npm/LGPL-3.0-or-later.txt"));
  }
  if (license.includes("MIT")) {
    references.add(noticeReference("third_party/licenses/npm/MIT-terms.txt"));
  }
  if (license === "CC-BY-4.0" && name === "caniuse-lite") {
    references.add(
      noticeReference("third_party/licenses/npm/caniuse-lite-1.0.30001810-CC-BY-4.0.txt")
    );
  }
  if (license === "MPL-2.0" && (name === "axe-core" || name === "@axe-core/playwright")) {
    references.add(noticeReference("third_party/licenses/npm/axe-core-4.13.0-MPL-2.0.txt"));
    references.add(noticeReference("third_party/licenses/npm/axe-core-4.13.0-THIRD-PARTY.txt"));
  }
  if (license === "MPL-2.0" && name.startsWith("lightningcss")) {
    references.add(noticeReference("third_party/licenses/npm/lightningcss-1.33.0-MPL-2.0.txt"));
  }
  if (name === "@img/sharp-wasm32") {
    references.add(noticeReference("third_party/licenses/npm/sharp-wasm32-0.35.4-NOTICE.md"));
  }
  if (name === "@img/sharp-libvips-linux-x64") {
    references.add(
      noticeReference("third_party/licenses/npm/sharp-libvips-linux-x64-1.3.3-NOTICE.md")
    );
  }
  if (name === "@img/sharp-libvips-linuxmusl-x64") {
    references.add(
      noticeReference("third_party/licenses/npm/sharp-libvips-linuxmusl-x64-1.3.3-NOTICE.md")
    );
  }
  if (references.size === 0) {
    fail("inventory_notice_reference_missing", `${name} -> ${license}`);
  }
  return [...references].sort(compareText);
}

function distributionStatus(scopes, installedInstances, skippedOptionalInstances) {
  const scopeSet = new Set(scopes);
  if (!scopeSet.has("prod")) {
    return scopeSet.has("optional")
      ? "development-only-optional-not-deployed"
      : "development-only-not-deployed";
  }
  if (!scopeSet.has("optional")) return "runtime-lock-dependency-deployed-by-host";
  if (installedInstances > 0 && skippedOptionalInstances > 0) {
    return "optional-runtime-mixed-installed-and-not-installed-platforms";
  }
  if (installedInstances > 0) return "optional-runtime-installed-on-linux-host";
  return "optional-runtime-not-installed-on-linux-host";
}

function verifiedNoticeFiles(rootDirectory) {
  return NOTICE_FILES.map((entry) => {
    const absolute = path.join(rootDirectory, entry.path);
    if (!existsSync(absolute)) fail("inventory_notice_file_missing", entry.path);
    const actual = sha256(readFileSync(absolute));
    if (actual !== entry.sha256) {
      fail("inventory_notice_file_drift", `${entry.path}: ${actual} != ${entry.sha256}`);
    }
    return entry;
  }).sort((left, right) => compareText(left.path, right.path));
}

function normalizeRepository(repository) {
  const candidate =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && typeof repository.url === "string"
        ? repository.url
        : "";
  let value = candidate.trim();
  if (!value) return null;
  value = value.replace(/^git\+/, "");
  value = value.replace(/^git:\/\//, "https://");
  value = value.replace(/^http:\/\//, "https://");
  value = value.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  value = value.replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/");
  value = value.replace(/^git@github\.com:/, "https://github.com/");
  value = value.replace(/^github:/, "https://github.com/");
  value = value.replace(/\.git(?:#.*)?$/u, "");
  value = value.replace(/#.*$/u, "");
  return /^https?:\/\//u.test(value) ? value : null;
}

function sourceUrl(metadata, lockEntry, npmUrl, identity) {
  const repository = normalizeRepository(metadata?.repository);
  if (repository) return repository;
  if (typeof metadata?.homepage === "string" && /^https?:\/\//u.test(metadata.homepage)) {
    return metadata.homepage.replace(/^http:\/\//u, "https://").replace(/#.*$/u, "");
  }
  if (typeof lockEntry.resolved === "string" && /^https:\/\//u.test(lockEntry.resolved)) {
    return lockEntry.resolved;
  }
  if (/^https:\/\/www\.npmjs\.com\/package\//u.test(npmUrl)) return npmUrl;
  fail("inventory_source_url_missing", identity);
}

function scopesFor(lockEntry) {
  const scopes = new Set();
  if (lockEntry.dev === true || lockEntry.devOptional === true) scopes.add("dev");
  if (lockEntry.optional === true || lockEntry.devOptional === true) scopes.add("optional");
  if (lockEntry.dev !== true && lockEntry.devOptional !== true) scopes.add("prod");
  return [...scopes].sort(compareText);
}

function aggregateIncrement(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function buildInventory(rootDirectory) {
  const observedNodeVersion = process.version.replace(/^v/u, "");
  const nodeVersionFile = readFileSync(path.join(rootDirectory, ".node-version"), "utf8").trim();
  const nvmrcVersion = readFileSync(path.join(rootDirectory, ".nvmrc"), "utf8").trim();
  if (
    observedNodeVersion !== NODE_VERSION ||
    nodeVersionFile !== NODE_VERSION ||
    nvmrcVersion !== NODE_VERSION
  ) {
    fail(
      "inventory_node_runtime_drift",
      `${observedNodeVersion}/${nodeVersionFile}/${nvmrcVersion} != ${NODE_VERSION}`
    );
  }
  const lockfilePath = path.join(rootDirectory, LOCKFILE_PATH);
  const lockBytes = readFileSync(lockfilePath);
  const lock = readJson(lockfilePath, "inventory_lockfile_invalid");
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
    fail("inventory_lockfile_v3_required");
  }
  const root = lock.packages[""];
  if (!root || typeof root.name !== "string" || typeof root.version !== "string") {
    fail("inventory_root_package_invalid");
  }

  const unique = new Map();
  let lockInstances = 0;
  let installedInstances = 0;
  let skippedOptionalInstances = 0;

  for (const [lockPath, lockEntry] of Object.entries(lock.packages)) {
    if (lockPath === "" || !lockPath.includes("node_modules/")) continue;
    lockInstances += 1;
    if (!lockEntry || typeof lockEntry !== "object" || typeof lockEntry.version !== "string") {
      fail("inventory_lock_entry_invalid", lockPath);
    }
    const inferredName = packageNameFromLockPath(lockPath);
    const packageJsonPath = path.join(rootDirectory, lockPath, "package.json");
    const installed = existsSync(packageJsonPath);
    let metadata = null;
    let metadataSource;
    if (installed) {
      metadata = readJson(packageJsonPath, "inventory_installed_metadata_invalid");
      installedInstances += 1;
      metadataSource = "installed-package-json";
      if (metadata.name !== inferredName || metadata.version !== lockEntry.version) {
        fail(
          "inventory_installed_lock_drift",
          `${lockPath}: ${metadata.name}@${metadata.version} != ${inferredName}@${lockEntry.version}`
        );
      }
    } else {
      if (lockEntry.optional !== true) fail("inventory_nonoptional_package_missing", lockPath);
      skippedOptionalInstances += 1;
      metadataSource = "lockfile-skipped-optional";
    }

    const identity = `${inferredName}@${lockEntry.version}`;
    const installedLicense = installed ? normalizeLicense(metadata.license, identity) : null;
    const lockLicense = normalizeLicense(lockEntry.license, identity);
    if (installedLicense !== null && installedLicense !== lockLicense) {
      fail(
        "inventory_installed_license_drift",
        `${identity}: ${installedLicense} != ${lockLicense}`
      );
    }
    const license = installedLicense ?? lockLicense;
    const npmUrl = `https://www.npmjs.com/package/${inferredName}`;
    const source = sourceUrl(metadata, lockEntry, npmUrl, identity);
    const existing = unique.get(identity) ?? {
      name: inferredName,
      version: lockEntry.version,
      license,
      compatibility: compatibilityFor(license),
      sourceUrl: source,
      npmUrl,
      scopes: new Set(),
      metadataSources: new Set(),
      lockPaths: [],
      installedInstances: 0,
      skippedOptionalInstances: 0
    };
    if (
      existing.name !== inferredName ||
      existing.version !== lockEntry.version ||
      existing.license !== license ||
      existing.sourceUrl !== source ||
      existing.npmUrl !== npmUrl
    ) {
      fail("inventory_unique_package_drift", identity);
    }
    for (const scope of scopesFor(lockEntry)) existing.scopes.add(scope);
    existing.metadataSources.add(metadataSource);
    existing.lockPaths.push(lockPath);
    if (installed) existing.installedInstances += 1;
    else existing.skippedOptionalInstances += 1;
    unique.set(identity, existing);
  }

  const packages = [...unique.values()]
    .sort(
      (left, right) =>
        compareText(left.name, right.name) || compareText(left.version, right.version)
    )
    .map((entry) => {
      const scopes = [...entry.scopes].sort(compareText);
      return {
        name: entry.name,
        version: entry.version,
        license: entry.license,
        compatibility: entry.compatibility,
        scopes,
        distributionStatus: distributionStatus(
          scopes,
          entry.installedInstances,
          entry.skippedOptionalInstances
        ),
        sourceUrl: entry.sourceUrl,
        npmUrl: entry.npmUrl,
        noticeReferences: noticeReferencesFor(entry.name, entry.license),
        metadataSources: [...entry.metadataSources].sort(compareText),
        instances: entry.lockPaths.length,
        installedInstances: entry.installedInstances,
        skippedOptionalInstances: entry.skippedOptionalInstances,
        lockPaths: [...entry.lockPaths].sort(compareText)
      };
    });

  const licenseSummary = {};
  const compatibilitySummary = {};
  const distributionSummary = {};
  const scopeSummary = { prod: 0, dev: 0, optional: 0 };
  for (const entry of packages) {
    aggregateIncrement(licenseSummary, entry.license);
    aggregateIncrement(compatibilitySummary, entry.compatibility);
    aggregateIncrement(distributionSummary, entry.distributionStatus);
    for (const scope of entry.scopes) aggregateIncrement(scopeSummary, scope);
  }

  const noticeFiles = verifiedNoticeFiles(rootDirectory);
  const usedNoticeReferences = new Set([
    "third_party/licenses/nodejs-22.23.2-LICENSE.txt",
    ...packages.flatMap((entry) => entry.noticeReferences)
  ]);
  for (const noticeFile of noticeFiles) {
    if (!usedNoticeReferences.has(noticeFile.path)) {
      fail("inventory_notice_file_unreferenced", noticeFile.path);
    }
  }

  const payload = {
    version: INVENTORY_VERSION,
    generator: "scripts/verify-third-party-inventory.mjs",
    rootPackage: `${root.name}@${root.version}`,
    lockfileVersion: 3,
    packageLockSha256: sha256(lockBytes),
    policy: {
      installedMetadataRequiredForPresentAndNonoptionalPackages: true,
      skippedPlatformOptionalFallback: "package-lock-v3-license-and-resolved-source",
      unknownOrIncompatibleLicensesFail: true,
      compatibilityClasses: {
        "compatible-permissive": [...PERMISSIVE_LICENSES].sort(compareText),
        "compatible-notice-required": [...NOTICE_REQUIRED_LICENSES].sort(compareText)
      }
    },
    summary: {
      uniquePackages: packages.length,
      lockInstances,
      installedInstances,
      skippedOptionalInstances,
      scopePackageCounts: scopeSummary,
      compatibilityPackageCounts: Object.fromEntries(
        Object.entries(compatibilitySummary).sort(([left], [right]) => compareText(left, right))
      ),
      distributionPackageCounts: Object.fromEntries(
        Object.entries(distributionSummary).sort(([left], [right]) => compareText(left, right))
      ),
      licensePackageCounts: Object.fromEntries(
        Object.entries(licenseSummary).sort(([left], [right]) => compareText(left, right))
      )
    },
    noticeFiles,
    runtimeComponents: [
      {
        name: "Node.js",
        version: NODE_VERSION,
        sourceUrl: `https://github.com/nodejs/node/tree/v${NODE_VERSION}`,
        license: "MIT",
        runtimeRole: "Pinned local, CI, build, operator-script, and server JavaScript runtime.",
        distributionStatus:
          "Required host runtime; the executable is supplied by the build/deployment host and is not redistributed in this repository.",
        noticeReferences: ["third_party/licenses/nodejs-22.23.2-LICENSE.txt"]
      }
    ],
    runtimeServices: [
      {
        name: "Upstash Redis",
        provider: "Upstash",
        role: "Production-only durable replay, evidence, call-count, and spend-control store.",
        sourceUrl: "https://upstash.com/docs/redis",
        termsUrl: "https://upstash.com/terms",
        notice:
          "Managed runtime service; no service source code is redistributed. The MIT-licensed @upstash/redis SDK is inventoried separately."
      },
      {
        name: "Vercel",
        provider: "Vercel",
        role: "Signed-out HTTPS application hosting and server-route runtime.",
        sourceUrl: "https://vercel.com/docs",
        termsUrl: "https://vercel.com/legal/terms",
        notice:
          "Managed deployment service; no Vercel service source code is redistributed. Open-source npm dependencies are inventoried separately."
      }
    ],
    packages
  };
  return {
    ...payload,
    inventoryPayloadSha256: sha256(Buffer.from(canonicalJson(payload), "utf8"))
  };
}

function inventoryBytes(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function main() {
  const argumentsList = process.argv.slice(2);
  if (
    argumentsList.length > 1 ||
    (argumentsList[0] && !["--check", "--write"].includes(argumentsList[0]))
  ) {
    fail("usage", "node scripts/verify-third-party-inventory.mjs [--check|--write]");
  }
  const mode = argumentsList[0] ?? "--check";
  const rootDirectory = process.cwd();
  const inventory = buildInventory(rootDirectory);
  const bytes = inventoryBytes(inventory);
  const inventoryPath = path.join(rootDirectory, INVENTORY_PATH);
  if (mode === "--write") {
    writeFileSync(inventoryPath, bytes, { encoding: "utf8", mode: 0o644 });
  } else {
    if (!existsSync(inventoryPath)) fail("inventory_generated_file_missing", INVENTORY_PATH);
    const actual = readFileSync(inventoryPath, "utf8");
    if (actual !== bytes) fail("inventory_generated_file_drift", INVENTORY_PATH);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: mode.slice(2),
      inventoryPath: INVENTORY_PATH,
      uniquePackages: inventory.summary.uniquePackages,
      lockInstances: inventory.summary.lockInstances,
      installedInstances: inventory.summary.installedInstances,
      skippedOptionalInstances: inventory.summary.skippedOptionalInstances,
      noticeRequiredPackages:
        inventory.summary.compatibilityPackageCounts["compatible-notice-required"],
      noticeFiles: inventory.noticeFiles.length,
      packageLockSha256: inventory.packageLockSha256,
      inventoryPayloadSha256: inventory.inventoryPayloadSha256,
      generatedFileSha256: sha256(Buffer.from(bytes, "utf8"))
    })}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`
  );
  process.exitCode = 1;
}
