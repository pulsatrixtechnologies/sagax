import { basename } from "node:path";
import { pathToFileURL } from "node:url";

/** Whether a module runs as its own program, the file `name` (no extension)
 * node was started on. A spawned proxy is also part of the server's bundle
 * (index.js), where import.meta.url is the server's entry too: only the file
 * name tells the two apart, so the server never runs a proxy's loop, prints
 * its usage or takes its exit code (#3901, #3910). */
export function isProgramEntry(name: string, entry: string | undefined, moduleUrl: string): boolean {
  if (!entry || moduleUrl !== pathToFileURL(entry).href) return false;
  const file = basename(entry);
  return /\.[cm]?[jt]s$/.test(file) && file.replace(/\.[cm]?[jt]s$/, "") === name;
}
