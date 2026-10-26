// Where the person's Chrome listens for DevTools (My Chrome). Only this
// computer's loopback, and only the address Chrome publishes itself: the
// `DevToolsActivePort` file it writes in its user data folder when remote
// debugging is on (chrome://inspect/#remote-debugging, Chrome 144+). Sagax
// reads that one small file (a port and a path) and nothing else of the
// profile: never its cookies, its Login Data or its history.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LOOPBACK_WS = /^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/devtools\/browser\/[\w-]+$/;

/** The DevToolsActivePort files of Google Chrome's default profile on this platform. */
export function devToolsActivePortFiles(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort")];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [join(local, "Google", "Chrome", "User Data", "DevToolsActivePort")];
  }
  const config = env.XDG_CONFIG_HOME ?? join(home, ".config");
  return [join(config, "google-chrome", "DevToolsActivePort"), join(config, "chromium", "DevToolsActivePort")];
}

/** The browser address in a DevToolsActivePort file's text, or null. */
export function parseDevToolsActivePort(text: string): string | null {
  const [portLine, pathLine] = text.split(/\r?\n/);
  const port = Number(portLine?.trim());
  const path = pathLine?.trim() ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !/^\/devtools\/browser\/[\w-]+$/.test(path)) return null;
  return `ws://127.0.0.1:${port}${path}`;
}

/** Chrome's browser address from the person's setting (a port, a loopback
 * http:// or ws:// address) or else its DevToolsActivePort file. */
export async function locateChrome(address: string, deps: { fetch?: typeof fetch; files?: string[] } = {}): Promise<string> {
  const value = address.trim();
  if (value.startsWith("ws://")) {
    if (!LOOPBACK_WS.test(value)) throw new Error("My Chrome only connects to a Chrome on this computer.");
    return value;
  }
  if (value) {
    const base = /^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value.replace(/\/+$/, "");
    const answer = await (deps.fetch ?? fetch)(`${base}/json/version`, { signal: AbortSignal.timeout(5_000) });
    if (!answer.ok) throw new Error(`Chrome did not answer at ${base}.`);
    const body = await answer.json() as { webSocketDebuggerUrl?: unknown };
    const url = typeof body.webSocketDebuggerUrl === "string" ? body.webSocketDebuggerUrl : "";
    if (!LOOPBACK_WS.test(url)) throw new Error("Chrome gave an address that is not on this computer.");
    return url;
  }
  for (const file of deps.files ?? devToolsActivePortFiles()) {
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    const url = parseDevToolsActivePort(text);
    if (url) return url;
  }
  throw new Error("Chrome's remote debugging is off. In Chrome, open chrome://inspect/#remote-debugging and turn it on, then try again.");
}
