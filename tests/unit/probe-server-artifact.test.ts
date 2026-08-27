import { describe, expect, it } from "vitest";

import {
  ProbeArtifactError,
  openProbeArtifact,
  sealProbeArtifact,
  signProbeArtifact,
  verifyProbeArtifact
} from "@/lib/probe/server-artifact";

const secret = Buffer.alloc(32, 7).toString("base64url");
const otherSecret = Buffer.alloc(32, 8).toString("base64url");

describe("Probe server artifacts", () => {
  it("signs canonical values with domain separation", () => {
    const token = signProbeArtifact("session", { z: 1, a: true }, secret);
    expect(verifyProbeArtifact("session", token, secret)).toEqual({ a: true, z: 1 });
    expect(() => verifyProbeArtifact("provider", token, secret)).toThrowError(ProbeArtifactError);
    expect(() => verifyProbeArtifact("session", token, otherSecret)).toThrowError(
      /invalid_artifact_signature/u
    );
  });

  it("rejects signed artifact tampering and malformed values", () => {
    const token = signProbeArtifact("session", { ok: true }, secret);
    const segments = token.split(".");
    const tampered = `${segments[0]}.${segments[1]}x.${segments[2]}`;
    expect(() => verifyProbeArtifact("session", tampered, secret)).toThrowError(
      /invalid_artifact_signature/u
    );
    expect(() => verifyProbeArtifact("session", "broken", secret)).toThrowError(
      /malformed_artifact/u
    );
  });

  it("encrypts authenticated continuations without exposing their contents", () => {
    const value = { request: "private current trial", rows: [{ score: false }] };
    const token = sealProbeArtifact("continuation", value, secret);
    expect(token).not.toContain("private");
    expect(token).not.toContain("score");
    expect(openProbeArtifact("continuation", token, secret)).toEqual(value);
    expect(() => openProbeArtifact("different", token, secret)).toThrowError(
      /invalid_sealed_artifact/u
    );
  });

  it("rejects sealed artifact tampering and weak secrets", () => {
    const token = sealProbeArtifact("continuation", { ok: true }, secret);
    const segments = token.split(".");
    const tampered = [segments[0], segments[1], `${segments[2]}a`, segments[3]].join(".");
    expect(() => openProbeArtifact("continuation", tampered, secret)).toThrowError(
      /invalid_sealed_artifact/u
    );
    expect(() => signProbeArtifact("session", {}, "weak")).toThrowError(/weak_signing_secret/u);
  });
});
