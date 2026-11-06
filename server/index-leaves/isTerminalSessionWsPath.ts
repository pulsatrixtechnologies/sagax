// @ts-nocheck
/** isTerminalSessionWsPath (#1388). Pure move from server/index.ts. */
export function isTerminalSessionWsPath(path: string): boolean {
  return /^\/api\/terminal\/sessions\/[\w-]+\/ws$/.test(path);
}
