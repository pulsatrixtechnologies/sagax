import { execFile as execFileCallback } from "node:child_process";

/** Run a command, never throw: the exit code and both streams (moved out of main.mjs). */
export function runQuiet(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    execFileCallback(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
