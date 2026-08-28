import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST,
  fallbackRunnerImplementationHash,
  type FallbackRunnerImplementationManifest
} from "@/lib/fallback/implementation-contract";
import {
  FALLBACK_RUNNER_SETTINGS_MANIFEST,
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";

const FROZEN_IMPLEMENTATION_HASH =
  "fd1b8e723bbb627ebb747c95c46f48c295e6f5f5c755543e4201eb355ca2fdd0";
const FROZEN_RUNNER_CONTRACT_HASH =
  "6c44eb19479e460cdef51bca52b577526170eb455d26066b97ec81fe1d7b5230";
const LEGACY_SETTINGS_HASH = "5ce5e19631ecb10a01a64ca6a1b4ef842de85ea6b722401d33f6b050e96199c1";
const FROZEN_SEMANTIC_SETTINGS_PROJECTION_HASH =
  "309970feb5d8264784dbd8e758eefb87ec854759c2457e00fea1015576974079";
const FROZEN_PROMPT_HASH = "ef2fdb41bc196bdf07f2c5253e5b9b134073c3fd21ceafa7b06c0225602038ac";

describe("fallback runner implementation contract", () => {
  it("has deterministic frozen implementation and runner hashes", async () => {
    await expect(fallbackRunnerImplementationHash()).resolves.toBe(FROZEN_IMPLEMENTATION_HASH);
    await expect(fallbackRunnerImplementationHash()).resolves.toBe(FROZEN_IMPLEMENTATION_HASH);
    await expect(fallbackRunnerContractHash()).resolves.toBe(FROZEN_RUNNER_CONTRACT_HASH);
    await expect(fallbackRunnerContractHash()).resolves.toBe(FROZEN_RUNNER_CONTRACT_HASH);
  });

  it("changes both hashes when any bound implementation version changes", async () => {
    const versionKeys: readonly (keyof FallbackRunnerImplementationManifest)[] = [
      "version",
      "implementation",
      "labPageAdapterVersion",
      "trialEvidenceVersion",
      "nativeBridgeVersion",
      "trialRunnerVersion",
      "browserRuntimeVersion"
    ];
    for (const key of versionKeys) {
      const changed = {
        ...FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST,
        [key]: `${FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST[key]}-changed`
      };
      await expect(fallbackRunnerImplementationHash(changed)).resolves.not.toBe(
        FROZEN_IMPLEMENTATION_HASH
      );
      await expect(fallbackRunnerContractHash(changed)).resolves.not.toBe(
        FROZEN_RUNNER_CONTRACT_HASH
      );
    }
  });

  it("changes only versioned implementation metadata in the runner settings", async () => {
    const { version, implementation, ...semanticSettings } = FALLBACK_RUNNER_SETTINGS_MANIFEST;
    expect(version).toBe("toolproof-fallback-runner-settings@1.1.0");
    expect(implementation).toBe("googlechromelabs-webmcp-tools-adapter@1.1.0");
    await expect(fallbackRunnerSettingsHash()).resolves.not.toBe(LEGACY_SETTINGS_HASH);
    await expect(canonicalSha256(semanticSettings)).resolves.toBe(
      FROZEN_SEMANTIC_SETTINGS_PROJECTION_HASH
    );
    await expect(fallbackRunnerPromptHash()).resolves.toBe(FROZEN_PROMPT_HASH);
  });
});
