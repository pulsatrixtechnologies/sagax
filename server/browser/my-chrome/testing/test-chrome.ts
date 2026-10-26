// A throwaway headless Chrome for My Chrome tests: a temporary profile,
// --headless=new, its own DevTools port on loopback, never a window, never the
// person's Chrome or profile. Chrome for Testing from SAGAX_TEST_CHROME or the
// Playwright cache; null when none is installed (the suites then skip).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { removeTempDir, waitForExit } from "../../../testing/cleanup.ts";

function playwrightChromes(): string[] {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "darwin" ? join(userInfo().homedir, "Library", "Caches", "ms-playwright") : join(userInfo().homedir, ".cache", "ms-playwright"),
  ].filter((root): root is string => Boolean(root) && existsSync(root!));
  const found: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const base = join(root, entry);
      found.push(
        join(base, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(base, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(base, "chrome-linux64", "chrome"),
        join(base, "chrome-linux", "chrome"),
        join(base, "chrome-win64", "chrome.exe"),
      );
    }
  }
  return found;
}

/** A test Chrome binary, never the person's installed Google Chrome. */
export function findTestChrome(): string | null {
  return [process.env.SAGAX_TEST_CHROME, ...playwrightChromes()].find((path) => path && existsSync(path)) ?? null;
}

export interface TestChrome {
  /** The browser's own DevTools address (what the gate connects to). */
  wsUrl: string;
  close(): Promise<void>;
}

export async function launchTestChrome(binary: string): Promise<TestChrome> {
  const profile = mkdtempSync(join(tmpdir(), "sagax-mychrome-test-"));
  const child: ChildProcess = spawn(binary, [
    "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disable-features=Translate,OptimizationHints,MediaRouter", "--password-store=basic", "--use-mock-keychain",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`test Chrome did not start: ${buffer.slice(0, 500)}`)), 30_000);
    child.stderr!.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) { clearTimeout(timer); resolve(match[1]!); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`test Chrome exited (${code}): ${buffer.slice(0, 500)}`)); });
  });
  child.stderr!.resume();
  return {
    wsUrl,
    close: async () => {
      await waitForExit(child, { signal: "SIGTERM" });
      await removeTempDir(profile);
    },
  };
}
