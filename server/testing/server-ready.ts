// A fixture is ready when its health endpoint answers, not after a fixed
// delay. Strip-types cold boots can take over 20 seconds under four-file load.
import type { ChildProcess } from "node:child_process";
import { hostTimeout } from "./host-timeout.ts";

interface ServerHealth { app?: unknown; pid?: unknown; static?: unknown }

export async function waitForServerReady(
  child: ChildProcess,
  base: string,
  output: () => string,
  accepts: (health: ServerHealth) => boolean = health => health.app === "openmausbot",
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + hostTimeout(timeoutMs);
  let lastHealth = "none";
  let spawnError: Error | undefined;
  const onError = (error: Error) => { spawnError = error; };
  child.on("error", onError);
  try {
    for (;;) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`fixture server exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode}${spawnError ? `, error=${spawnError.message}` : ""}).\n${output()}`);
      }
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now()))) });
        if (response.ok) {
          const health = await response.json() as ServerHealth;
          lastHealth = JSON.stringify(health);
          // Solo health identifies the process; the anonymous organization
          // endpoint deliberately withholds its pid. Never accept a wrong pid.
          if ((health.pid === undefined || health.pid === child.pid) && accepts(health)) return;
        } else lastHealth = `HTTP ${response.status}`;
      } catch { /* still starting, or this bounded probe expired */ }
      if (Date.now() >= deadline) throw new Error(`fixture server never became healthy (last health: ${lastHealth}).\n${output()}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    child.off("error", onError);
  }
}
