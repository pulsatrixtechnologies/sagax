// Ask the bot's browser to attach the visit signature. The program is the
// browser engine, with arguments, never a shell. The headers are the
// signature headers only.
import { type SpawnOptions } from "node:child_process";
import { spawnChild } from "../process/spawn-helper.ts";

const TIMEOUT_MS = 8_000;

export type SpawnHeaders = (command: string, args: readonly string[], options: SpawnOptions) => ReturnType<typeof spawnChild>;

export function applySignedBrowserHeaders(
  command: string,
  env: NodeJS.ProcessEnv,
  headers: Record<string, string>,
  spawnImpl: SpawnHeaders = spawnChild,
): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const [name, value] of Object.entries(headers)) {
      if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
        reject(new Error("A signature header must be one line."));
        return;
      }
      if (/^(?:authorization|cookie|proxy-authorization)$/i.test(name)) {
        reject(new Error("A visit signature is not a login."));
        return;
      }
    }
    let child: ReturnType<typeof spawnChild>;
    try {
      child = spawnImpl(command, ["set", "headers", JSON.stringify(headers)], {
        env, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"],
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The browser did not accept the visit signature."));
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The browser did not accept the visit signature."));
    }, TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("The browser did not accept the visit signature."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("The browser did not accept the visit signature."));
    });
  });
}
