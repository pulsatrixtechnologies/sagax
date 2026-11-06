// @ts-nocheck
/** insideDataDir (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { sep } from "node:path";
import { realpathSync } from "node:fs";
export type Host = Record<string, any>;

export function createInsideDataDir(getHost: () => Host): any {
function insideDataDir(path: string) {
  void getHost();

  try {
    const root = realpathSync(DATA_DIR);
    const real = realpathSync(path);
    return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
  } catch {
    return false;
  }

}
  return insideDataDir;
}
