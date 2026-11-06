// @ts-nocheck
/** serverPathView (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { realpathSync } from "node:fs";
export type Host = Record<string, any>;

export function createServerPathView(getHost: () => Host): any {
function serverPathView(botId: string): { dataDirs: string[]; botWorkspaces: string[] } {
  const host = getHost();

  let real = DATA_DIR;
  try { real = realpathSync(DATA_DIR); } catch { /* not created yet */ }
  const dataDirs = real === DATA_DIR ? [DATA_DIR] : [DATA_DIR, real];
  const workspace = host.workspaceDir(botId);
  const botWorkspaces = real !== DATA_DIR && workspace.startsWith(`${DATA_DIR}/`) ? [workspace, real + workspace.slice(DATA_DIR.length)] : [workspace];
  return { dataDirs, botWorkspaces };

}
  return serverPathView;
}
