// The teardown contract a suite relies on when it spawns a real process
// against a throwaway home (#5082): the stop wait ends only once the process
// is gone, and the home is removed after it, never under a process that still
// writes into it. server/turns/steer-queue.test.ts failed as a whole file on
// Linux CI (EACCES, ENOTEMPTY from rm) because its own wait resolved at the
// SIGKILL and removed the home under a server still letting go of it.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./cleanup.ts";

const started: ChildProcess[] = [];

/** A node child running `script`, resolved once it printed "ready". */
async function child(script: string, env: NodeJS.ProcessEnv = {}): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ["-e", script], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  started.push(proc);
  await new Promise<void>((resolve, reject) => {
    let out = "";
    proc.stdout!.on("data", (chunk) => {
      out += chunk;
      if (out.includes("ready")) resolve();
    });
    proc.on("error", reject);
    proc.on("exit", (code, signal) => reject(new Error(`child ended before ready (${code ?? signal})`)));
  });
  return proc;
}

const gone = (proc: ChildProcess) => proc.exitCode !== null || proc.signalCode !== null;

afterEach(async () => {
  for (const proc of started.splice(0)) if (!gone(proc)) proc.kill("SIGKILL");
});

describe("teardown of a spawned process and its home (#5082)", () => {
  it("waits for the process to be gone, past the SIGKILL when it ignores the polite signal", async () => {
    const proc = await child(`process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready");`);
    await waitForExit(proc, { signal: "SIGTERM", graceMs: 200 });
    expect(gone(proc)).toBe(true);
  });

  it("removes the home only after a process that writes into it while it stops, and the home stays gone", async () => {
    const home = mkdtempSync(join(tmpdir(), "cleanup-contract-"));
    // On the polite signal it keeps writing into its home for a while, as a
    // server does while it drains its turns and saves, then exits.
    const proc = await child(
      `const { mkdirSync, writeFileSync } = require("node:fs");
       const { join } = require("node:path");
       const home = process.env.CONTRACT_HOME;
       process.on("SIGTERM", () => {
         let n = 0;
         const tick = setInterval(() => {
           mkdirSync(join(home, "late"), { recursive: true });
           writeFileSync(join(home, "late", String(n++)), "late write");
           if (n === 15) { clearInterval(tick); process.exit(0); }
         }, 20);
       });
       setInterval(() => {}, 1000);
       console.log("ready");`,
      { CONTRACT_HOME: home },
    );
    await waitForExit(proc, { signal: "SIGTERM" });
    expect(gone(proc)).toBe(true);
    await removeTempDir(home);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(home)).toBe(false);
  });
});
