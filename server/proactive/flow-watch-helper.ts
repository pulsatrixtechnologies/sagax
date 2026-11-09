// The Flow plugin's helper for proactive watches: `px_flow.py proactive`.
// It runs isolated (python3 -I), with a minimal environment (no secret of the
// server reaches it) and a short timeout.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { FlowHelper } from "./flow-watches.ts";

export const FLOW_HELPER_TIMEOUT_MS = 20_000;

/** The first plugin folder that carries the Flow helper, as a FlowHelper,
 * with the tenant plugins among `dirs` (PX_FLOW_TENANTS). */
export function flowHelperIn(dirs: readonly string[], python = "python3"): FlowHelper | null {
  const root = dirs.find((dir) => existsSync(join(dir, "scripts", "px_flow.py")));
  if (!root) return null;
  const script = join(root, "scripts", "px_flow.py");
  // the organization's tenant plugins (facts, tenant watches) sit next to it
  const tenants = dirs.filter((dir) => dir !== root && existsSync(join(dir, "pulsatrix-flow.json")));
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      execFile(python, ["-I", script, ...args], {
        cwd: root,
        timeout: FLOW_HELPER_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "",
          LANG: process.env.LANG ?? "C.UTF-8",
          CLAUDE_PLUGIN_ROOT: root,
          ...(tenants.length ? { PX_FLOW_TENANTS: tenants.join(delimiter) } : {}),
        },
      }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
    });
  return {
    root,
    proactive: (products) => run(["proactive", ...products.flatMap((product) => ["--product", product])]),
    reference: (topic) => (/^[a-z0-9_-]{1,64}$/i.test(topic) ? run(["reference", topic]) : Promise.reject(new Error("invalid topic"))),
  };
}
