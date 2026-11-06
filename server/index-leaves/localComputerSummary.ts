// @ts-nocheck
/** localComputerSummary (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalComputerSummary(getHost: () => Host): any {
async function localComputerSummary() {
  const host = getHost();
  const { DATA_DIR, SHARED_LOCAL_VM_TARGET, containerComputerStatus } = host;
  const status = await containerComputerStatus(undefined, undefined, SHARED_LOCAL_VM_TARGET);
  const [workspaceBytes, disk] = await Promise.all([host.folderBytes(status.workspace_path), host.diskSpace(DATA_DIR)]);
  const version = status.image_ref.split(":").pop();
  return {
    configured: Boolean(status.runtime),
    state: status.container,
    diskState: host.diskStateForFree(disk.freeBytes, disk.totalBytes),
    workspaceBytes,
    ...(disk.totalBytes ? { limitBytes: disk.totalBytes } : {}),
    ...(version ? { version } : {}),
    ...(status.problem ? { problem: status.problem } : {})
  };

}
  return localComputerSummary;
}
