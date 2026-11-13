// #3623: which upstreams of the gate run as a thread of its own process.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";

import { processUpstreamEnv, startGateUpstream, threadScript } from "./gate-upstream.ts";

const NODE = "/opt/node/bin/node";
const OWN = "/app/dist-server";

describe("threadScript", () => {
  it("takes a script of Sagax's own, started with this executable", () => {
    expect(threadScript(NODE, [join(OWN, "harness-mcp-proxy.js"), "data"], NODE, OWN)).toBe(join(OWN, "harness-mcp-proxy.js"));
    expect(threadScript(NODE, [join(OWN, "drivers", "agents-proxy.js")], NODE, OWN)).toBe(join(OWN, "drivers", "agents-proxy.js"));
    expect(threadScript(NODE, [join(OWN, "mcp-remote-proxy.ts")], NODE, OWN)).toBe(join(OWN, "mcp-remote-proxy.ts"));
  });

  it("leaves everything else a process", () => {
    // another executable (a person's own server, npx, a wrapper)
    expect(threadScript("npx", [join(OWN, "x.js")], NODE, OWN)).toBeUndefined();
    expect(threadScript("/usr/bin/node", [join(OWN, "x.js")], NODE, OWN)).toBeUndefined();
    // flags before the script (the local computer's proxy)
    expect(threadScript(NODE, ["--experimental-strip-types", join(OWN, "local-computer-proxy.ts")], NODE, OWN)).toBeUndefined();
    // a script outside the gate's directory, or one that climbs out of it
    expect(threadScript(NODE, ["/tmp/server.js"], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [join(OWN, "..", "other", "server.js")], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [`${OWN}-evil/server.js`], NODE, OWN)).toBeUndefined();
    // not a script, or none at all
    expect(threadScript(NODE, [join(OWN, "tool")], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, ["relative.js"], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [], NODE, OWN)).toBeUndefined();
  });
});

describe("processUpstreamEnv (#3561)", () => {
  it("keeps the gate's compile cache from a server that is not one of Sagax's relays", () => {
    const env = { PATH: "/bin", NODE_COMPILE_CACHE: "/data/cache/node-compile", TOKEN: "t" };
    expect(processUpstreamEnv(env, { TOKEN: "t" })).toEqual({ PATH: "/bin", TOKEN: "t" });
    expect(processUpstreamEnv(env)).toEqual({ PATH: "/bin", TOKEN: "t" });
    // the server's own settings name one: it is the server's
    expect(processUpstreamEnv({ ...env, NODE_COMPILE_CACHE: "/home/me/cache" }, { NODE_COMPILE_CACHE: "/home/me/cache" }).NODE_COMPILE_CACHE).toBe("/home/me/cache");
    // nothing to take away
    const plain = { PATH: "/bin" };
    expect(processUpstreamEnv(plain)).toBe(plain);
  });
});

describe("relay thread with its fallback process", () => {
  // #3707: a line written while the fallback process does not read its input
  // waits for `drain`; when the thread then answers first, the process is
  // stopped and never drains, and that wait must not hold the lines after it.
  it("keeps writing to the thread that won after the fallback process it waited on is stopped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-upstream-"));
    const script = join(dir, "relay.js");
    // as a process: alive, never reading its input
    writeFileSync(script, "setInterval(() => {}, 60_000);\n");
    // as a thread: silent until the big line, then echoes the head of each line
    const thread = `
      const { createInterface } = require("node:readline");
      let answering = false;
      createInterface({ input: process.stdin }).on("line", (line) => {
        if (line.startsWith("big")) answering = true;
        if (answering) process.stdout.write(line.slice(0, 4) + "\\n");
      });`;
    let fellBack!: () => void;
    const fallbackStarted = new Promise<void>((settle) => { fellBack = settle; });
    const upstream = startGateUpstream({
      command: process.execPath,
      args: [script],
      env: { PATH: process.env.PATH },
      ownDir: dir,
      execPath: process.execPath,
      firstAnswerMs: 50,
      log: (line) => { if (line.includes("starting it as its own process")) fellBack(); },
      startThread: (_file, options) => new Worker(thread, { eval: true, argv: options.argv, env: options.env, stdin: true, stdout: true, stderr: true }),
    });
    const lines: string[] = [];
    const waiters: Array<() => void> = [];
    createInterface({ input: upstream.stdout }).on("line", (line) => {
      lines.push(line);
      for (const wake of waiters.splice(0)) wake();
    });
    const lineSeen = (expected: string, ms: number) => new Promise<boolean>((settle) => {
      const check = () => {
        if (lines.includes(expected)) { clearTimeout(timer); settle(true); } else waiters.push(check);
      };
      const timer = setTimeout(() => settle(false), ms);
      check();
    });
    try {
      upstream.stdin.write("hello\n");
      await fallbackStarted;
      // far above a pipe's buffer: the write to the process waits for drain
      upstream.stdin.write(`big${"x".repeat(4 * 1024 * 1024)}\n`);
      expect(await lineSeen("bigx", 5_000)).toBe(true);
      expect(upstream.kind).toBe("thread");
      upstream.stdin.write("ping\n");
      expect(await lineSeen("ping", 5_000)).toBe(true);
    } finally {
      upstream.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
