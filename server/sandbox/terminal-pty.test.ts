// The in-chat terminal's PTYs: the `script` wrapper (electron/script-pty.mjs)
// that gives `docker exec -it`, `ssh -t` and a login shell a real terminal,
// the provisioner's Docker exec in a terminal (sandboxd-docker.ts execTty),
// and the frames the server sends the provisioner (sandbox-tty-frames.ts).
// The Docker cases run against the local Docker daemon when there is one.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scriptPtyCommand, shellQuote, spawnScriptPty } from "../../electron/script-pty.mjs";
import { loginShellArgv, parseResize } from "../../electron/desktop-terminal.mjs";
import { dockerApi } from "./sandboxd-docker.ts";
import { ttyDataFrames, ttyFrameDecoder, ttyResizeFrame } from "./sandbox-tty-frames.ts";

function dockerSocket(): string | null {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe", timeout: 10_000 });
    const host = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8", timeout: 10_000 }).trim();
    return host.startsWith("unix://") ? host.slice("unix://".length) : null;
  } catch {
    return null;
  }
}

function imagePresent(image: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Read a stream until `pattern` shows up (or fail after `ms`). */
function waitFor(stream: NodeJS.ReadableStream, pattern: RegExp, ms = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => { stream.off("data", onData); reject(new Error(`timed out waiting for ${pattern}; saw ${JSON.stringify(seen.slice(-400))}`)); }, ms);
    const onData = (chunk: Buffer | string) => {
      seen += chunk.toString();
      if (pattern.test(seen)) {
        clearTimeout(timer);
        stream.off("data", onData);
        resolve(seen);
      }
    };
    stream.on("data", onData);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("script PTY command", () => {
  it("wraps argv in the platform's script, and has none on Windows", () => {
    const mac = scriptPtyCommand(["docker", "exec", "-it", "vm", "bash"], { platform: "darwin" })!;
    expect(mac.command).toBe("/bin/sh");
    expect(mac.args[1]).toContain("/usr/bin/script -q /dev/null");
    expect(mac.args.slice(-5)).toEqual(["docker", "exec", "-it", "vm", "bash"]);
    const linux = scriptPtyCommand(["ssh", "-tt", "nas"], { platform: "linux" })!;
    expect(linux.command).toBe("script");
    expect(linux.args.at(-1)).toBe("/dev/null");
    expect(linux.args.at(-2)).toContain("'ssh' '-tt' 'nas'");
    expect(scriptPtyCommand(["powershell.exe"], { platform: "win32" })).toBeNull();
    expect(() => scriptPtyCommand([])).toThrow();
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("picks the login shell and reads resizes from the server", () => {
    expect(loginShellArgv({ platform: "darwin", env: { SHELL: "/bin/zsh" } })).toEqual(["/bin/zsh", "-l"]);
    expect(loginShellArgv({ platform: "linux", env: { SHELL: "x; rm -rf /" } })).toEqual(["/bin/bash", "-l"]);
    expect(loginShellArgv({ platform: "win32", env: {} })).toEqual(["powershell.exe", "-NoLogo"]);
    expect(parseResize(JSON.stringify({ type: "resize", cols: 100, rows: 30 }))).toEqual({ cols: 100, rows: 30 });
    expect(parseResize("{}")).toBeNull();
  });
});

describe("provisioner terminal frames", () => {
  it("round-trips keystrokes and resizes, split anywhere", () => {
    const decode = ttyFrameDecoder();
    const wire = Buffer.concat([...ttyDataFrames(Buffer.from("ls -la\r")), ttyResizeFrame(132, 43), ...ttyDataFrames(Buffer.from("exit\r"))]);
    const frames = [...wire].flatMap((byte) => {
      const out = decode(Buffer.from([byte]));
      if (!Array.isArray(out)) throw new Error(out.error);
      return out;
    });
    expect(frames).toEqual([
      { type: "data", payload: Buffer.from("ls -la\r") },
      { type: "resize", cols: 132, rows: 43 },
      { type: "data", payload: Buffer.from("exit\r") },
    ]);
    expect(ttyFrameDecoder()(Buffer.from([7, 0, 0, 0, 0]))).toEqual({ error: "unknown frame" });
  });
});

describe.skipIf(process.platform === "win32")("a login shell in a script PTY", () => {
  it("starts at the asked size and follows a resize", async () => {
    const pty = spawnScriptPty(["/bin/sh"], { cols: 91, rows: 21, env: { ...process.env, PS1: "$ " } });
    try {
      pty.input.write("stty size\n");
      await waitFor(pty.output, /21 91/);
      await sleep(200);
      pty.resize(123, 34);
      await sleep(400);
      pty.input.write("stty size\n");
      await waitFor(pty.output, /34 123/);
    } finally {
      pty.close();
    }
  });
});

const socket = process.platform === "win32" ? null : dockerSocket();
const IMAGE = "alpine:latest";
const runnable = Boolean(socket) && imagePresent(IMAGE);

describe.skipIf(!runnable)("docker exec in a terminal (local Docker)", () => {
  const name = `sagax-terminal-test-${process.pid}`;

  beforeAll(() => {
    execFileSync("docker", ["run", "-d", "--rm", "--name", name, IMAGE, "sleep", "300"], { stdio: "pipe", timeout: 60_000 });
  }, 90_000);
  afterAll(() => {
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "pipe", timeout: 30_000 }); } catch { /* gone */ }
  });

  it("runs `docker exec -it` through the script PTY (the Local VM adapter)", async () => {
    const pty = spawnScriptPty(["docker", "exec", "-it", "-e", "TERM=xterm-256color", name, "sh"], { cols: 101, rows: 33 });
    try {
      await sleep(800);
      pty.input.write("stty size; tty\n");
      const first = await waitFor(pty.output, /33 101[\s\S]*\/dev\/pts\//);
      expect(first).toMatch(/\/dev\/pts\/\d+/);
      pty.resize(140, 50);
      await sleep(800);
      pty.input.write("stty size\n");
      await waitFor(pty.output, /50 140/);
      pty.input.write("exit\n");
      await new Promise<void>((resolve) => pty.output.once("end", () => resolve()));
    } finally {
      pty.close();
    }
  }, 40_000);

  it("opens an exec in a terminal with the provisioner's Docker client and resizes it", async () => {
    const docker = dockerApi(socket!);
    const tty = await docker.execTty!(name, { Cmd: ["sh"], User: "root", Env: ["TERM=xterm-256color"], WorkingDir: "/" }, { cols: 90, rows: 25 });
    try {
      tty.stream.write("stty size\n");
      await waitFor(tty.stream, /25 90/);
      await tty.resize({ cols: 120, rows: 45 });
      tty.stream.write("stty size\n");
      await waitFor(tty.stream, /45 120/);
    } finally {
      tty.stream.destroy();
    }
  }, 40_000);
});
