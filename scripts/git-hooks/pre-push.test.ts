// scripts/git-hooks/pre-push on a throwaway repository: which stamp lets a
// push through without a test, and what runs otherwise (#4316).
//
// A landing step that ran typecheck, lint and terms alone left an empty
// ok-<sha> stamp, and the hook took it for a verify:merge pass: no test ran
// before a merge, so lots whose own tests were red (#4354, #4356) landed.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = resolve(__dirname, "pre-push");

let repo: string;
let fakeBin: string;

function write(path: string, text: string, mode?: number) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  if (mode) chmodSync(full, mode);
}

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...gitEnv } }).trim();
}

function stamp(text: string) {
  write(`.git/sagax-verify-merge/ok-${git("rev-parse", "HEAD")}`, text);
}

function push(gateExit = 0) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_") && !k.startsWith("SAGAX_") && !k.startsWith("OMB_")) env[k] = v;
  env.PATH = `${fakeBin}:${env.PATH}`;
  env.FAKE_DIR = fakeBin;
  env.SAGAX_VERIFY_BASE = "main";
  env.GATE_EXIT = String(gateExit);
  const r = spawnSync("sh", [HOOK], { cwd: repo, encoding: "utf8", env });
  let calls = "";
  try { calls = readFileSync(join(fakeBin, "calls"), "utf8"); } catch { /* nothing ran */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pre-push-"));
  fakeBin = join(repo, ".fake-bin");
  git("init", "-q", "-b", "main");
  write(".gitignore", ".fake-bin/\n");
  write("src/a.ts", "export const a = 1;\n");
  // stand-ins that record their arguments and exit with $GATE_EXIT
  const recorder = (name: string) => `#!/bin/sh\necho "${name} $*" >> "$FAKE_DIR/calls"\nexit "$GATE_EXIT"\n`;
  write("scripts/fast-gate.sh", recorder("fast-gate"), 0o755);
  write(".fake-bin/pnpm", recorder("pnpm"), 0o755);
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "work");
  write("src/a.ts", "export const a = 2;\n");
  git("commit", "-qam", "change");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("pre-push", () => {
  it("trusts only a stamp verify-merge.mjs wrote", () => {
    stamp(`ok ${new Date().toISOString()}\n`);
    const { code, out, calls } = push(1);
    expect(code, out).toBe(0);
    expect(out).toContain("verify:merge already OK");
    expect(calls).toBe("");
  });

  it("runs the test side of the fast gate on a stamp written by a lint-only landing step", () => {
    stamp("");
    const red = push(1);
    expect(red.code, red.out).not.toBe(0);
    expect(red.out).toContain("is not verify:merge's");
    expect(red.calls).toBe("fast-gate --base main --only tests,related,extra-source-text,extra-parity-pairs\n");
    rmSync(join(fakeBin, "calls"));
    const green = push(0);
    expect(green.code, green.out).toBe(0);
    expect(green.calls).toBe("fast-gate --base main --only tests,related,extra-source-text,extra-parity-pairs\n");
  });

  it("runs verify:merge when no stamp exists", () => {
    const { code, out, calls } = push(1);
    expect(code, out).not.toBe(0);
    expect(calls).toBe("pnpm verify:merge --base main\n");
  });
});
