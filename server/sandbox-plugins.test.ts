// The bot's plugins in its owner's cloud computer (2026-10-19): copied whole,
// once per change, scripts runnable there. The environment is played by a
// local shell in a temporary folder.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncPluginsToSandbox, type SandboxPluginExec } from "./sandbox-plugins.ts";

const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "sbx-plugins-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function localEnvironment(): SandboxPluginExec & { calls: number } {
  const target = {
    calls: 0,
    exec: (input: { argv: string[]; env?: Record<string, string> }) => new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      target.calls += 1;
      execFile(input.argv[0]!, input.argv.slice(1), { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...input.env }, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
        resolve({ exitCode: error ? ((error as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    }),
  };
  return target;
}

function plugin(): string {
  const dir = scratch();
  mkdirSync(join(dir, "skills", "flow", "scripts"), { recursive: true });
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pulsatrix-flow" }));
  writeFileSync(join(dir, "skills", "flow", "scripts", "px_flow.sh"), "echo DRY-RUN-OK \"$@\"\n");
  writeFileSync(join(dir, "skills", "flow", "big.bin"), Buffer.alloc(600 * 1024, 7));
  return dir;
}

describe("syncPluginsToSandbox", () => {
  it("copies a plugin whole, runs there, and skips an unchanged one with a single read", async () => {
    const source = plugin();
    const root = join(scratch(), "sagax-plugins");
    const env = localEnvironment();
    const first = await syncPluginsToSandbox([{ name: "pulsatrix-flow", dir: source }], env, root);
    expect(first).toEqual({ copied: ["pulsatrix-flow"], unchanged: [], skipped: [] });
    const dest = join(root, "pulsatrix-flow");
    expect(readFileSync(join(dest, ".claude-plugin", "plugin.json"), "utf8")).toContain("pulsatrix-flow");
    expect(readFileSync(join(dest, "skills", "flow", "big.bin")).length).toBe(600 * 1024);
    const run = await env.exec({ argv: ["sh", join(dest, "skills", "flow", "scripts", "px_flow.sh"), "--dry-run"] });
    expect(run.stdout.trim()).toBe("DRY-RUN-OK --dry-run");
    expect(existsSync(join(root, ".incoming-pulsatrix-flow.tgz"))).toBe(false);

    const before = env.calls;
    expect(await syncPluginsToSandbox([{ name: "pulsatrix-flow", dir: source }], env, root)).toEqual({ copied: [], unchanged: ["pulsatrix-flow"], skipped: [] });
    expect(env.calls - before).toBe(1);

    writeFileSync(join(source, "skills", "flow", "scripts", "px_flow.sh"), "echo V2\n");
    expect((await syncPluginsToSandbox([{ name: "pulsatrix-flow", dir: source }], env, root)).copied).toEqual(["pulsatrix-flow"]);
    expect(readFileSync(join(dest, "skills", "flow", "scripts", "px_flow.sh"), "utf8")).toBe("echo V2\n");
  });

  it("refuses a plugin holding a symlink or an unsafe name, copying nothing", async () => {
    const source = plugin();
    symlinkSync("/etc/passwd", join(source, "skills", "passwd"));
    const root = join(scratch(), "sagax-plugins");
    const env = localEnvironment();
    const result = await syncPluginsToSandbox([{ name: "pulsatrix-flow", dir: source }, { name: "../evil", dir: source }], env, root);
    expect(result.copied).toEqual([]);
    expect(result.skipped.map((row) => row.name)).toEqual(["pulsatrix-flow", "../evil"]);
    expect(env.calls).toBe(0);
  });
});
