import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const verifierPath = resolve(process.cwd(), "scripts/verify-probe-no-leakage.mjs");
const temporaryRoots: string[] = [];

async function buildFixture(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/toolproof-probe-no-leakage-`);
  temporaryRoots.push(root);
  await mkdir(`${root}/.next/server/app/lab`, { recursive: true });
  await mkdir(`${root}/.next/static/chunks/app/lab`, { recursive: true });
  await writeFile(
    `${root}/.next/server/app/lab/page_client-reference-manifest.js`,
    'globalThis.__RSC_MANIFEST={chunks:["/_next/static/chunks/vendor.js","/_next/static/chunks/app/lab/page.js"]};',
    "utf8"
  );
  await writeFile(`${root}/.next/static/chunks/vendor.js`, "const vendor = true;", "utf8");
  await writeFile(`${root}/.next/static/chunks/app/lab/page.js`, "const lab = true;", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Probe production client boundary verifier", () => {
  it("finds both flat and Vercel-style nested Lab chunks from the recursive build tree", async () => {
    const root = await buildFixture();
    const { stdout } = await execFileAsync(process.execPath, [verifierPath], { cwd: root });
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      mode: "probe-no-leakage",
      labChunkCount: 2,
      allClientChunkCount: 2,
      forbiddenSentinels: 7,
      sourceMaps: 0
    });
  });

  it("rejects server truth in any client chunk even when the chunk is not Lab-referenced", async () => {
    const root = await buildFixture();
    await mkdir(`${root}/.next/static/chunks/other`, { recursive: true });
    await writeFile(
      `${root}/.next/static/chunks/other/leak.js`,
      'const hidden = "expectedTool";',
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [verifierPath], { cwd: root })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Production client bundle leaks server truth: expectedTool")
    });
  });
});
