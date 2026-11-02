/** Shared Claude driver leaf helpers (#1383 wave 5). */
import { readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import { ARTIFACT_HTML_MAX } from "../../../shared/claude-chat-blocks.ts";

// Resolved from the server root, never relative to this file: bundling inlines
// this module into an entry one directory up, so a `".."` here would climb too
// far. See server/proxy-paths.ts.
export const PERM_PROXY_PATH = SPAWNED_PROXIES.permission;
export const DWEB_PROXY_PATH = SPAWNED_PROXIES.dweb;
export const HOOK_HELPER_PATH = SPAWNED_PROXIES.hook;
// in the packaged app process.execPath is the Electron binary — this env
// makes it behave as plain node for the spawned MCP proxies (harmless in dev)
export const NODE_ENV_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

export function removePrivateTempDir(filePath: string | null | undefined): boolean {
  if (!filePath) return true;
  try {
    rmSync(dirname(filePath), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    return true;
  } catch {
    return false;
  }
}

export function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/** Small HTML/SVG the Artifact tool wrote. Host paths never reach the
 * transcript; the bytes ride a sibling ```widget fence. Anything else
 * (missing file, huge file, non-HTML) is skipped. */
export function readArtifactHtml(filePath: string): string | undefined {
  if (!isAbsolute(filePath) || filePath.includes("\0")) return undefined;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm") && !lower.endsWith(".svg")) return undefined;
  try {
    const html = readFileSync(filePath, "utf8");
    if (html.length === 0 || html.length > ARTIFACT_HTML_MAX) return undefined;
    return html;
  } catch {
    return undefined;
  }
}
