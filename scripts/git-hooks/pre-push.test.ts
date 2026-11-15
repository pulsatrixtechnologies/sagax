// scripts/git-hooks/pre-push on a throwaway repository: which stamp lets a
// push through without a test, and what runs otherwise (#4316).
//
// A landing step that ran typecheck, lint and terms alone left an empty
// ok-<sha> stamp, and the hook took it for a verify:merge pass: no test ran
// before a merge, so lots whose own tests were red (#4354, #4356) landed.
//
// The queue (#4377): waiters are served first come, first served through
// tickets beside the lock; a dead waiter's ticket and a dead holder's lock
// are dropped.
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function hookEnv(gateExit: number) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_") && !k.startsWith("SAGAX_") && !k.startsWith("OMB_")) env[k] = v;
  env.PATH = `${fakeBin}:${env.PATH}`;
  env.FAKE_DIR = fakeBin;
  env.SAGAX_VERIFY_BASE = "main";
  env.GATE_EXIT = String(gateExit);
  return env;
}

function readCalls() {
  try { return readFileSync(join(fakeBin, "calls"), "utf8"); } catch { return ""; }
}

function push(gateExit = 0) {
  const r = spawnSync("sh", [HOOK], { cwd: repo, encoding: "utf8", env: hookEnv(gateExit) });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: readCalls() };
}

const queueDir = () => join(repo, ".git/sagax-verify-merge");
const lockDir = () => join(queueDir(), "queue.lock");
const ticketDir = () => join(queueDir(), "queue.tickets");

// Processes a test starts: stopped by exact pid after each test.
let started: ChildProcess[] = [];
function live(): number {
  const p = spawn("sleep", ["120"], { stdio: "ignore" });
  started.push(p);
  return p.pid as number;
}
function deadPid(): number {
  const r = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" });
  return Number(r.stdout.trim());
}
function holdLock(pid: number) {
  mkdirSync(lockDir(), { recursive: true });
  writeFileSync(join(lockDir(), "pid"), `${pid}\n`);
}
// Same name the hook gives its own ticket: arrival second, then pid.
function ticket(second: number, pid: number) {
  mkdirSync(ticketDir(), { recursive: true });
  const name = `${String(second).padStart(10, "0")}-${pid}`;
  writeFileSync(join(ticketDir(), name), "");
  return name;
}

function pushAsync() {
  const child = spawn("sh", [HOOK], { cwd: repo, env: hookEnv(0) });
  started.push(child);
  let out = "";
  child.stdout?.on("data", (d) => { out += d; });
  child.stderr?.on("data", (d) => { out += d; });
  const done = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
  return { child, done, out: () => out };
}

async function until(cond: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  started = [];
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

describe("pre-push queue (#4377)", () => {
  it("serves the oldest live waiter first, even once the lock is free", async () => {
    const holder = live();
    holdLock(holder);
    const older = live();
    ticket(1, older);
    const hook = pushAsync();
    await until(() => hook.out().includes("queue position 2"));
    // the holder is done: the older waiter's turn, not ours
    rmSync(lockDir(), { recursive: true, force: true });
    await pause(2500);
    expect(hook.child.exitCode, hook.out()).toBeNull();
    expect(readCalls()).toBe("");
    expect(existsSync(lockDir())).toBe(false);
    // the older waiter leaves: we are first and take the lock
    process.kill(older, "SIGKILL");
    expect(await hook.done, hook.out()).toBe(0);
    expect(readCalls()).toBe("pnpm verify:merge --base main\n");
    expect(readdirSync(ticketDir()).filter((t) => t.endsWith(`-${hook.child.pid}`))).toEqual([]);
    expect(existsSync(lockDir())).toBe(false);
  }, 30000);

  it("drops the ticket of a dead waiter", async () => {
    const dead = deadPid();
    const name = ticket(1, dead);
    const hook = pushAsync();
    expect(await hook.done, hook.out()).toBe(0);
    expect(readCalls()).toBe("pnpm verify:merge --base main\n");
    expect(readdirSync(ticketDir())).not.toContain(name);
  }, 30000);

  it("removes a lock whose holder is dead, as before", async () => {
    holdLock(deadPid());
    const hook = pushAsync();
    expect(await hook.done, hook.out()).toBe(0);
    expect(hook.out()).toContain("removing stale verify:merge lock");
    expect(readCalls()).toBe("pnpm verify:merge --base main\n");
    expect(existsSync(lockDir())).toBe(false);
  }, 30000);

  it("removes its ticket when stopped while waiting", async () => {
    holdLock(live());
    const hook = pushAsync();
    await until(() => hook.out().includes("queue position 1"));
    expect(readdirSync(ticketDir())).toHaveLength(1);
    hook.child.kill("SIGTERM");
    expect(await hook.done).not.toBe(0);
    expect(readdirSync(ticketDir())).toEqual([]);
    expect(existsSync(join(lockDir(), "pid"))).toBe(true);
  }, 30000);

  it("waits up to two hours", () => {
    expect(readFileSync(HOOK, "utf8")).toMatch(/-gt 7200\b/);
  });
});
