// #3680: the processes of spawnCli are created by the spawn helper, so a
// grown server never forks itself on a turn's path. The child must get
// exactly what the server's own spawn gives it.
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runLoginShellProbe } from "../env-path.ts";
import { spawnPcHook } from "../hooks/lifecycle-hook-exec.ts";
import { execCli, killCliTree, spawnCli } from "../procs.ts";
import { spawnSource } from "../resource-usage/sources.ts";
import { CHILD_NICE, execChild, execChildAsync, type ExecChildError, spawnChild, spawnHelperPid, startSpawnHelper, stopSpawnHelper } from "./spawn-helper.ts";

const PROBE = `
const out = { argv: process.argv.slice(1), env: process.env, cwd: process.cwd(), uid: process.getuid(), gid: process.getgid(), ppid: process.ppid };
process.stdout.write(JSON.stringify(out));
`;
const ECHO = `
process.stdout.write("x".repeat(200000));
process.stderr.write("to stderr");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => { process.stdout.write("|" + input.toUpperCase()); process.exitCode = 3; });
`;
const WAIT = `process.stdin.resume(); setTimeout(() => {}, 60000);`;

type Probe = { argv: string[]; env: Record<string, string>; cwd: string; uid: number; gid: number; ppid: number };

function run(child: ChildProcess, input?: string): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  if (input !== undefined) child.stdin?.end(input);
  return new Promise((resolve) => child.once("close", (code: number | null, signal: NodeJS.Signals | null) => resolve({ stdout, stderr, code, signal })));
}

function probe(cwd: string): Promise<Probe> {
  const child = spawnCli(process.execPath, ["-e", PROBE, "--", "one", "two words"], {
    cwd, env: { PATH: process.env.PATH ?? "", SAGAX_SPAWN_PROBE: "kept as is" }, stdio: ["pipe", "pipe", "pipe"],
  });
  return run(child, "").then(({ stdout }) => JSON.parse(stdout) as Probe);
}

const posix = process.platform !== "win32";
const PPID = "process.stdout.write(String(process.ppid))";

function exec(file: string, args: string[], options: Parameters<typeof execChild>[2] = {}): Promise<{ error: ExecChildError | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => execChild(file, args, options, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

// Every process the server starts on a turn's path goes through spawnChild or
// execChild: none of these files starts one with node:child_process itself.
const TURN_PATH_FILES = [
  "server/procs.ts",
  "server/drivers/acp/quiet-status.ts",
  "server/drivers/acp/grok.ts",
  "server/drivers/acp/hermes.ts",
  "server/drivers/acp/deepseek.ts",
  "server/waits/wait-probes.ts",
  "server/resources/process-memory.ts",
  "server/resource-usage/sources.ts",
  "server/env-path.ts",
  // A snapshot's git runs at every turn start, before the engine, and the turn waits for it.
  "server/checkpoints.ts",
  "server/hooks/lifecycle-hook-exec.ts",
  "server/code-branches.ts",
  "server/runner/git.ts",
  "server/runner/runner.ts",
  "server/turns/turn-video.ts",
  "server/parallel-tasks.ts",
  "server/widgets/widget-check.ts",
  "server/browser/browser-engine.ts",
  "server/browser/browser-live.ts",
  "server/browser/browser-network-debug.ts",
  "server/browser/browser-processes.ts",
  "server/computer/computer-app.ts",
  "server/computer/container-computer.ts",
  "server/computer/vps-computer.ts",
  "server/connectors/hosts/grok-host.ts",
  "server/drivers/acp/opencode-go.ts",
  "server/drivers/phone-proxy.ts",
  "server/drivers/pi-mcp-extension.ts",
  "server/harness-connectors.ts",
  "server/memory/memory-store.ts",
  "server/onepassword.ts",
  "server/plugins/plugin-sources.ts",
  "server/proactive/flow-watch-helper.ts",
  "server/proactive/screen-context.ts",
  "server/remote-support/remote-control-session.ts",
  "server/remote-support/remote-session-probe.ts",
  "server/remote-support/remote-support-local.ts",
  "server/routines/routine-watch.ts",
  "server/sandbox/sandbox-plugins.ts",
  "server/tailscale.ts",
  "server/tts/system-voices.ts",
  "server/usage/plan-usage.ts",
  "server/wallet-issuer.ts",
  "server/imessage/imessage-send.ts",
  "server/auth/web-bot-auth-apply.ts",
  "server/index.ts",
];

describe("turn-path process starts (#3680)", () => {
  it("go through the spawn helper, never node:child_process's own spawn or execFile", () => {
    for (const file of TURN_PATH_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      // A dynamic import of node:child_process is a way around the helper too.
      expect({ file, dynamic: /import\(\s*"node:child_process"\s*\)/.test(source) }).toEqual({ file, dynamic: false });
      const imported = /import\s*\{([^}]*)\}\s*from\s*"node:child_process"/.exec(source)?.[1] ?? "";
      const values = imported.split(",").map((name) => name.trim()).filter((name) => name && !name.startsWith("type "));
      for (const name of values) {
        // procs.ts keeps execFile for Windows' taskkill only.
        if (file === "server/procs.ts" && name === "execFile") continue;
        expect({ file, name }).toEqual({ file, name: "(none)" });
      }
    }
  });
});
const lines: string[] = [];

describe.runIf(posix)("spawn helper (#3680)", () => {
  beforeAll(() => startSpawnHelper({ log: (line) => lines.push(line) }));
  afterAll(() => stopSpawnHelper());

  it("creates the children of spawnCli itself: the server process is not forked", async () => {
    const helper = spawnHelperPid();
    expect(helper).toBeGreaterThan(0);
    const seen = await probe(process.cwd());
    expect(seen.ppid).toBe(helper);
    expect(seen.ppid).not.toBe(process.pid);
  });

  it("gives the child the same arguments, environment, folder, user and group as the server's own spawn", async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "spawn-helper-")));
    const through = await probe(folder);
    stopSpawnHelper();
    const own = await probe(folder);
    startSpawnHelper({ log: (line) => lines.push(line) });
    expect(own.ppid).toBe(process.pid);
    const { ppid: _a, ...left } = through;
    const { ppid: _b, ...right } = own;
    expect(left).toEqual(right);
    expect(left.argv).toEqual(["one", "two words"]);
    expect(left.env.SAGAX_SPAWN_PROBE).toBe("kept as is");
    expect(left.cwd).toBe(folder);
  });

  it("passes stdin, stdout, stderr and the exit code through without losing a byte", async () => {
    for (let round = 0; round < 8; round++) {
      const child = spawnCli(process.execPath, ["-e", ECHO], { stdio: ["pipe", "pipe", "pipe"] });
      const result = await run(child, "hello");
      expect(result.stdout).toBe(`${"x".repeat(200000)}|HELLO`);
      expect(result.stderr).toBe("to stderr");
      expect(result.code).toBe(3);
      expect(child.exitCode).toBe(3);
    }
  });

  // A server already at CHILD_NICE or lower cannot start children lower than itself.
  it.runIf(getPriority(0) < CHILD_NICE)("starts children at a lower priority than the server", async () => {
    const child = spawnCli(process.execPath, ["-e", WAIT], { stdio: ["pipe", "pipe", "pipe"] });
    await new Promise((resolve) => child.once("spawn", resolve));
    expect(getPriority(child.pid!)).toBe(CHILD_NICE);
    expect(await killCliTree(child, 1_000)).toBe(true);
  });

  it("stops a child that has no pid yet once it gets one", async () => {
    const child = spawnCli(process.execPath, ["-e", WAIT], { stdio: ["pipe", "pipe", "pipe"] });
    expect(child.pid).toBeUndefined();
    const closed = run(child);
    expect(await killCliTree(child, 1_000)).toBe(true);
    expect((await closed).signal).toBe("SIGTERM");
  });

  it("reports a missing program as Node's spawn does", async () => {
    const child = spawnCli("/nonexistent/spawn-helper-test", [], { stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise((resolve) => child.once("close", resolve));
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => child.once("error", resolve));
    expect(error.code).toBe("ENOENT");
    expect(error.syscall).toBe("spawn /nonexistent/spawn-helper-test");
    expect(await closed).toBe(-2);
  });

  it("runs execCli's probes through the helper, with execFile's output and errors", async () => {
    const helper = spawnHelperPid();
    const ppid = await new Promise<string>((resolve, reject) =>
      execCli(process.execPath, ["-e", PPID], { timeout: 8_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
    expect(Number(ppid)).toBe(helper);
    const failed = await exec(process.execPath, ["-e", "process.stderr.write('no'); process.exit(4)"]);
    expect(failed.error?.code).toBe(4);
    expect(failed.error?.killed).toBe(false);
    expect(failed.error?.message).toContain("Command failed");
    expect(failed.stderr).toBe("no");
    const slow = await exec(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeout: 300, killSignal: "SIGKILL" });
    expect(slow.error?.killed).toBe(true);
    expect(slow.error?.signal).toBe("SIGKILL");
    expect(slow.error?.code).toBeNull();
    const big = await exec(process.execPath, ["-e", "process.stdout.write('y'.repeat(5000))"], { maxBuffer: 1000 });
    expect(big.error?.code).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
    expect(big.stdout).toBe("y".repeat(1000));
    const missing = await exec("/nonexistent/exec-child-test", []);
    expect(missing.error?.code).toBe("ENOENT");
  });

  it("starts the login shell probe and the resource sampler through the helper", async () => {
    const helper = spawnHelperPid();
    const shellPpid = await new Promise<string>((resolve) => {
      runLoginShellProbe("/bin/sh", 5_000, resolve, ["-c", 'printf "__OMB_PATH__%s" "$PPID"']);
    });
    expect(Number(shellPpid)).toBe(helper);
    let text = "";
    const ended = await new Promise<string | undefined>((resolve) => {
      spawnSource(() => ({ argv: ["/bin/sh", "-c", 'printf "%s" "$PPID"'] })).start(1, (chunk) => { text += chunk; }, resolve);
    });
    expect(ended).toBeUndefined();
    expect(Number(text)).toBe(helper);
  });

  it("stops an execChild run on its AbortSignal with execFile's AbortError, without the server's own spawn", async () => {
    const helper = spawnHelperPid();
    const controller = new AbortController();
    const started = Date.now();
    const aborted = await new Promise<{ error: ExecChildError | null; stdout: string }>((resolve) => {
      const child = execChild(process.execPath, ["-e", "process.stdout.write(String(process.ppid)); setTimeout(() => {}, 60000)"], { signal: controller.signal },
        (error, stdout) => resolve({ error, stdout }));
      // Aborted once the child runs and has answered.
      child.stdout?.once("data", () => controller.abort());
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(aborted.error?.name).toBe("AbortError");
    expect(aborted.error?.code).toBe("ABORT_ERR");
    expect(Number(aborted.stdout)).toBe(helper);
    const before = new AbortController();
    before.abort();
    const early = await exec(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { signal: before.signal });
    expect(early.error?.name).toBe("AbortError");
  });

  it("passes extra pipes (a browser's DevTools pipe) through the helper", async () => {
    const helper = spawnHelperPid();
    const script = `const net = require("node:net"); const fs = require("node:fs");
      const input = new net.Socket({ fd: 3, readable: true, writable: false });
      input.on("data", (chunk) => { fs.writeSync(4, String(process.ppid) + ":" + chunk.toString().toUpperCase()); process.exit(0); });`;
    const child = spawnChild(process.execPath, ["-e", script], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    const output = child.stdio[4] as unknown as NodeJS.ReadableStream;
    let text = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => { text += chunk; });
    (child.stdio[3] as unknown as NodeJS.WritableStream).write("ping");
    await new Promise((resolve) => child.once("close", resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text).toBe(`${helper}:PING`);
  });

  it("starts a lifecycle hook and a promise-shaped run through the helper", async () => {
    const helper = spawnHelperPid();
    const hook = await spawnPcHook({ command: 'printf "%s" "$PPID"', stdin: "", timeoutMs: 5_000, files: {} }, process.cwd());
    expect(Number(hook.stdout)).toBe(helper);
    const { stdout } = await execChildAsync(process.execPath, ["-e", PPID]);
    expect(Number(stdout)).toBe(helper);
    const failed = await execChildAsync(process.execPath, ["-e", "process.stdout.write('partial'); process.exit(2)"]).catch((error: ExecChildError & { stdout: string }) => error);
    expect((failed as ExecChildError).code).toBe(2);
    expect((failed as { stdout: string }).stdout).toBe("partial");
  });

  it("starts processes itself while the helper is down, says so, and gets the helper back", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const first = spawnHelperPid()!;
    const live = spawnCli(process.execPath, ["-e", WAIT], { stdio: ["pipe", "pipe", "pipe"] });
    await new Promise((resolve) => live.once("spawn", resolve));
    const inFlight = spawnCli(process.execPath, ["-e", PROBE], { stdio: ["pipe", "pipe", "pipe"] });
    process.kill(first, "SIGKILL");
    // A request the dying helper may not have answered still completes.
    const answered = await run(inFlight, "");
    expect(answered.code === 0 || answered.signal !== null).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lines.some((line) => line.startsWith("[spawn-helper] down"))).toBe(true);
    const second = spawnHelperPid();
    expect(second).toBeGreaterThan(0);
    expect(second).not.toBe(first);
    expect((await probe(process.cwd())).ppid).toBe(second);
    // A child the lost helper had started is still seen to end.
    const ended = new Promise((resolve) => live.once("exit", resolve));
    process.kill(live.pid!, "SIGKILL");
    await ended;
  }, 15_000);
});
