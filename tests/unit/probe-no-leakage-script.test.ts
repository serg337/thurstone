import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const verifierPath = resolve(process.cwd(), "scripts/verify-probe-no-leakage.mjs");
const temporaryRoots: string[] = [];
type StaticLayout = "local-next" | "vercel-builder" | "build-output-api";

function staticRoot(root: string, layout: StaticLayout): string {
  if (layout === "local-next") return `${root}/.next/static`;
  if (layout === "vercel-builder") return `${root}/.next/output/static`;
  return `${root}/.vercel/output/static`;
}

function emittedChunkPath(layout: StaticLayout, relativePath: string): string {
  return layout === "local-next" ? `chunks/${relativePath}` : `_next/static/chunks/${relativePath}`;
}

async function buildFixture(layout: StaticLayout): Promise<{ root: string; staticRoot: string }> {
  const root = await mkdtemp(`${tmpdir()}/toolproof-probe-no-leakage-`);
  temporaryRoots.push(root);
  await mkdir(`${root}/.next/server/app/lab`, { recursive: true });
  const outputRoot = staticRoot(root, layout);
  await mkdir(`${outputRoot}/${emittedChunkPath(layout, "app/lab")}`, { recursive: true });
  await writeFile(
    `${root}/.next/server/app/lab/page_client-reference-manifest.js`,
    'globalThis.__RSC_MANIFEST={chunks:["/_next/static/chunks/vendor.js","/_next/static/chunks/app/lab/page.js"]};',
    "utf8"
  );
  await writeFile(
    `${outputRoot}/${emittedChunkPath(layout, "vendor.js")}`,
    "const vendor = true;",
    "utf8"
  );
  await writeFile(
    `${outputRoot}/${emittedChunkPath(layout, "app/lab/page.js")}`,
    "const lab = true;",
    "utf8"
  );
  return { root, staticRoot: outputRoot };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Probe production client boundary verifier", () => {
  it.each([
    ["local Next output", "local-next"],
    ["Vercel builder output", "vercel-builder"],
    ["Build Output API output", "build-output-api"]
  ] as const)("finds manifest-bound client chunks in %s", async (_name, layout) => {
    const { root } = await buildFixture(layout);
    const { stdout } = await execFileAsync(process.execPath, [verifierPath], { cwd: root });
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      mode: "probe-no-leakage",
      labChunkCount: 2,
      allClientChunkCount: 2,
      forbiddenSentinels: 7,
      labOnlyForbiddenSentinels: 8,
      sourceMaps: 0
    });
  });

  it("rejects server truth in any client chunk even when the chunk is not Lab-referenced", async () => {
    const { root, staticRoot: outputRoot } = await buildFixture("vercel-builder");
    await mkdir(`${outputRoot}/public-script`, { recursive: true });
    await writeFile(
      `${outputRoot}/public-script/leak.js`,
      'const hidden = "expectedTool";',
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [verifierPath], { cwd: root })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Production client bundle leaks server truth: expectedTool")
    });
  });

  it("rejects source maps anywhere in Build Output API static assets", async () => {
    const { root, staticRoot: outputRoot } = await buildFixture("build-output-api");
    await writeFile(
      `${outputRoot}/${emittedChunkPath("build-output-api", "vendor.js.map")}`,
      "{}",
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [verifierPath], { cwd: root })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Production client source maps must remain disabled during blinded execution."
      )
    });
  });

  it("permits prior-attempt lineage only outside the Lab-referenced client chunks", async () => {
    const priorEvidenceDigest = "016f607f498384bcac2d60474aaa3f3373635cd662bb2eb4d7bb71b0b223b863";
    const { root, staticRoot: outputRoot } = await buildFixture("vercel-builder");
    await mkdir(`${outputRoot}/results`, { recursive: true });
    await writeFile(
      `${outputRoot}/results/post-unlock.js`,
      `const priorEvidenceDigest = "${priorEvidenceDigest}";`,
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [verifierPath], { cwd: root })
    ).resolves.toMatchObject({ stdout: expect.stringContaining('"labOnlyForbiddenSentinels":8') });

    await writeFile(
      `${outputRoot}/${emittedChunkPath("vercel-builder", "app/lab/page.js")}`,
      `const priorEvidenceDigest = "${priorEvidenceDigest}";`,
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [verifierPath], { cwd: root })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Lab client bundle leaks prior calibration lineage")
    });
  });
});
