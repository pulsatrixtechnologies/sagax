// Test hygiene for Local VMs: a test run never creates, starts or reuses a
// container under the real name (`openmausbot-computer`) on the developer's
// machine. Every run gets its own namespace (SAGAX_LOCAL_VM_TEST_NAMESPACE),
// so server/computer/container-computer.ts names and labels its containers
// `openmausbot-test-<namespace>-computer` / `com.openmausbot.test-run`, and
// the run removes exactly those afterwards, never anything else.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

export function newLocalVmTestNamespace(): string {
  return `t${process.pid.toString(36)}-${randomBytes(3).toString("hex")}`;
}

type Runner = (command: string, args: string[]) => Promise<{ stdout: string }>;
const defaultRunner: Runner = (command, args) => run(command, args, { timeout: 15_000 });

/** Remove the containers this namespace made, in every runtime present.
 * Only containers carrying the namespace's label are listed, so a real
 * Local VM is never touched. Best effort: no runtime is not an error. */
export async function removeTestLocalVms(namespace: string, runner: Runner = defaultRunner): Promise<string[]> {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(namespace)) throw new Error("invalid Local VM test namespace");
  const removed: string[] = [];
  for (const runtime of ["docker", "podman"]) {
    let ids: string[];
    try {
      const { stdout } = await runner(runtime, ["ps", "-aq", "--filter", `label=com.openmausbot.test-run=${namespace}`]);
      ids = stdout.split(/\s+/).filter((id) => /^[a-f0-9]{6,64}$/i.test(id));
    } catch {
      continue;
    }
    if (!ids.length) continue;
    try {
      await runner(runtime, ["rm", "-f", ...ids]);
      removed.push(...ids);
    } catch { /* leave it to the next run's cleanup */ }
  }
  return removed;
}
