// @ts-nocheck
/** diskSaverTarget (#1388). Pure move from server/index.ts. */
import { oldCheckpointRepos } from "../computer/computer-care.ts";
export type Host = Record<string, any>;

export function createDiskSaverTarget(getHost: () => Host): any {
function diskSaverTarget(key: string) {
  const host = getHost();
  const { SHARED_LOCAL_VM_TARGET, containerComputerStatus, containerExec, localVmMode } = host;
  if (key === "local") {
    if (host.IDENTITY.kind === "perspicax") return null;
    return {
      exec: async (script) => {
        if (localVmMode(host.cfg) !== "shared") return null;
        const status = await containerComputerStatus(undefined, undefined, SHARED_LOCAL_VM_TARGET);
        if (status.container !== "running" || !status.runtime) return null;
        const result = await containerExec(SHARED_LOCAL_VM_TARGET, script, { runtime: status.runtime, timeoutSeconds: 120 });
        return { exitCode: result.exitCode, stdout: result.stdout };
      },
      host: { oldCheckpoints: () => oldCheckpointRepos(host.checkpoints.CHECKPOINTS_DIR) }
    };
  }
  const principalId = key.startsWith("person:") ? key.slice("person:".length) : "";
  const sandbox = host.userSandbox;
  if (!principalId || !sandbox) return null;
  return {
    exec: async (script) => {
      // Never wake a sleeping environment just to measure it.
      if ((await sandbox.status(principalId)).state !== "running") return null;
      const result = await sandbox.exec(principalId, { argv: ["sh", "-c", script], timeoutSec: 120, maxOutputBytes: 64 * 1024 });
      return { exitCode: result.exitCode, stdout: result.stdout };
    }
  };

}
  return diskSaverTarget;
}
