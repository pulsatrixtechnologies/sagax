// @ts-nocheck
/** storedNamesIn (#1388). Pure move from server/index.ts. */
import { ATTACHMENTS_DIR } from "../attachments/attachments.ts";
import { sep } from "node:path";
export type Host = Record<string, any>;

export function createStoredNamesIn(getHost: () => Host): any {
function storedNamesIn(text: string | undefined): string[] {
  const host = getHost();
  if (!text || !text.includes(ATTACHMENTS_DIR)) return [];
  const out = new Set<string>();
  const prefix = ATTACHMENTS_DIR + sep;
  for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + prefix.length)) {
    const match = /^[A-Za-z0-9-]+\.[a-z0-9]{1,8}/.exec(text.slice(at + prefix.length, at + prefix.length + 96));
    if (match) out.add(match[0]);
  }
  return [...out];
}
  return storedNamesIn;
}
