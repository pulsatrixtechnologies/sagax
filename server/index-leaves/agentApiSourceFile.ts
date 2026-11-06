// @ts-nocheck
/** agentApiSourceFile (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentApiSourceFile(getHost: () => Host): any {
function agentApiSourceFile(from: BotRecord, sourceThreadId: string, relative: string): { path: string; bytes: number } | Refusal {
  const host = getHost();
  const { agentRefuse, realpathSync } = host;
  const roots = host.messageFileRootsForThread(from.id, sourceThreadId).filter((root) => root !== ATTACHMENTS_DIR);
  for (const root of roots) {
    const candidate = join(root, relative);
    try {
      const real = realpathSync(candidate);
      const realRoot = realpathSync(root);
      if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) continue;
      const info = statSync(real);
      if (!info.isFile()) continue;
      if (info.size > AGENT_SEND_FILE_MAX_BYTES) return agentRefuse(413, "file_too_large", `${relative} is larger than 25 MiB.`);
      return { path: real, bytes: info.size };
    } catch {
      // not in this root
    }
  }
  return agentRefuse(404, "file_not_found", `No file ${relative} in your workspace.`);

}
  return agentApiSourceFile;
}
