// A hook process on the solo machine (the bot's computer). Scrubbed
// environment, our child PID only. Not used on an organization server.
import { spawn } from "node:child_process";

import { pcShell, scrubHookEnv, type HookOutput, type HookRun } from "./lifecycle-hooks.ts";

export function spawnPcHook(run: HookRun, cwd: string, hookRoot?: string, platform = process.platform): Promise<HookOutput> {
  const shell = pcShell(platform, run.command);
  const env = scrubHookEnv(process.env, cwd, hookRoot);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(shell.file, shell.args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve({ stdout: "", code: 1 });
      return;
    }
    const out: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, run.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 16_000) out.push(chunk);
    });
    child.on("error", () => { clearTimeout(timer); resolve({ stdout: "", code: 1 }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString("utf8").slice(0, 16_000), code: code ?? 1 });
    });
    child.stdin?.end(run.stdin);
  });
}
