import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "@/lib/evidence/digest";

export const SCORED_LOCAL_RECOVERY_VERSION = "toolproof-scored-local-recovery@1.0.0";

export interface ScoredLocalRecoveryState {
  readonly version: typeof SCORED_LOCAL_RECOVERY_VERSION;
  readonly phase: "baseline" | "revised";
  readonly launchId: string;
  readonly documentId: string;
  readonly capability: string | null;
  readonly recoveryCookie: string | null;
  readonly buildCommit: string | null;
  readonly frozenProtocolHash: string | null;
  readonly reviewPackageHash: string | null;
}

function recoveryPaths(root: string, phase: "baseline" | "revised") {
  const directory = path.resolve(root, ".toolproof-local/recovery");
  return {
    directory,
    keyPath: path.join(directory, `scored-${phase}.key`),
    artifactPath: path.join(directory, `scored-${phase}.json.enc`),
    temporaryPath: path.join(directory, `.scored-${phase}.json.enc.tmp`)
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readRecoveryKey(keyPath: string): Promise<Buffer> {
  const key = await readFile(keyPath);
  if (key.byteLength !== 32) throw new Error("scored_recovery_key_invalid");
  return key;
}

async function ensureRecoveryKey(keyPath: string): Promise<Buffer> {
  if (await pathExists(keyPath)) return readRecoveryKey(keyPath);
  const key = randomBytes(32);
  const handle = await open(keyPath, "wx", 0o600);
  try {
    await handle.writeFile(key);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return key;
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

export async function saveScoredLocalRecovery(
  state: ScoredLocalRecoveryState,
  root: string = process.cwd()
): Promise<void> {
  const paths = recoveryPaths(root, state.phase);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const key = await ensureRecoveryKey(paths.keyPath);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${SCORED_LOCAL_RECOVERY_VERSION}.${state.phase}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(canonicalJson(state), "utf8")),
    cipher.final()
  ]);
  const artifact = Buffer.from(
    canonicalJson({
      version: SCORED_LOCAL_RECOVERY_VERSION,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url")
    }),
    "utf8"
  );
  await removeIfPresent(paths.temporaryPath);
  const handle = await open(paths.temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(artifact);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(paths.temporaryPath, paths.artifactPath);
}

export async function loadScoredLocalRecovery(
  phase: "baseline" | "revised",
  root: string = process.cwd()
): Promise<ScoredLocalRecoveryState | null> {
  const paths = recoveryPaths(root, phase);
  const artifactExists = await pathExists(paths.artifactPath);
  const keyExists = await pathExists(paths.keyPath);
  if (!artifactExists && !keyExists) return null;
  if (!artifactExists || !keyExists) throw new Error("scored_recovery_artifact_partial");
  const [source, key] = await Promise.all([
    readFile(paths.artifactPath, "utf8"),
    readRecoveryKey(paths.keyPath)
  ]);
  const artifact = JSON.parse(source) as {
    readonly version?: unknown;
    readonly nonce?: unknown;
    readonly ciphertext?: unknown;
    readonly tag?: unknown;
  };
  if (
    artifact.version !== SCORED_LOCAL_RECOVERY_VERSION ||
    typeof artifact.nonce !== "string" ||
    typeof artifact.ciphertext !== "string" ||
    typeof artifact.tag !== "string"
  ) {
    throw new Error("scored_recovery_artifact_invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(artifact.nonce, "base64url"));
    decipher.setAAD(Buffer.from(`${SCORED_LOCAL_RECOVERY_VERSION}.${phase}`, "utf8"));
    decipher.setAuthTag(Buffer.from(artifact.tag, "base64url"));
    const state = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(artifact.ciphertext, "base64url")),
        decipher.final()
      ]).toString("utf8")
    ) as ScoredLocalRecoveryState;
    if (
      state.version !== SCORED_LOCAL_RECOVERY_VERSION ||
      state.phase !== phase ||
      !/^launch_[A-Za-z0-9_-]{22,64}$/u.test(state.launchId) ||
      !/^document_[A-Za-z0-9_-]{22,64}$/u.test(state.documentId) ||
      (state.capability !== null && !/^[A-Za-z0-9_-]{43}$/u.test(state.capability)) ||
      (state.buildCommit !== null && !/^[a-f0-9]{40}$/u.test(state.buildCommit)) ||
      (state.frozenProtocolHash !== null && !/^[a-f0-9]{64}$/u.test(state.frozenProtocolHash)) ||
      (state.reviewPackageHash !== null && !/^[a-f0-9]{64}$/u.test(state.reviewPackageHash))
    ) {
      throw new Error("scored_recovery_state_invalid");
    }
    return state;
  } catch {
    throw new Error("scored_recovery_artifact_invalid");
  }
}

export async function deleteScoredLocalRecovery(
  phase: "baseline" | "revised",
  root: string = process.cwd()
): Promise<void> {
  const paths = recoveryPaths(root, phase);
  for (const filePath of [paths.artifactPath, paths.keyPath, paths.temporaryPath]) {
    await removeIfPresent(filePath);
  }
  if ((await pathExists(paths.artifactPath)) || (await pathExists(paths.keyPath))) {
    throw new Error("scored_recovery_artifact_delete_failed");
  }
}
