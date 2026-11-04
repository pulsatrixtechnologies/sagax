// A minimal Chrome DevTools Protocol client: Node's built-in WebSocket and
// fetch, no dependency (the repository has neither puppeteer nor playwright).
//
//   const chrome = await launchChrome({ port });       // headless Chrome
//   const page = await openPage(chrome.port);           // a fresh tab
//   await page.send("Page.navigate", { url });
//   const value = await page.eval("document.title");
//   await page.close(); chrome.kill();
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.PARITY_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chrome found (set PARITY_CHROME); looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`);
  return found;
}

/** Headless Chrome with a throwaway profile. sRGB output so pixel colours
 * are the CSS colours (Electron on a Mac renders the same tokens). */
export async function launchChrome({ port = 0, binary = findChrome() } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "omb-desktop-refs-chrome-"));
  const proc = spawn(binary, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    // larger than any viewport at 2x: a repainted shot (screenshot's
    // `repaint`) draws only what the window itself covers
    "--window-size=2800,2800",
    "--force-color-profile=srgb",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-features=Translate,MediaRouter",
    "--lang=en-US",
    // Linux containers run as root, where Chrome refuses its sandbox.
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  const actualPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome never opened its DevTools port:\n${stderr.slice(-2000)}`)), 20_000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on("exit", (code) => reject(new Error(`Chrome exited ${code}:\n${stderr.slice(-2000)}`)));
  });
  return {
    port: actualPort,
    proc,
    kill() {
      try { proc.kill("SIGTERM"); } catch { /* gone */ }
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500).unref();
    },
  };
}

export class Page {
  constructor(ws, targetId, port) {
    this.ws = ws;
    this.targetId = targetId;
    this.port = port;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.console = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.console.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
      } else if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
        this.console.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      }
      for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }

  once(method, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      const cb = (params) => {
        clearTimeout(timer);
        const list = this.listeners.get(method) ?? [];
        list.splice(list.indexOf(cb), 1);
        resolve(params);
      };
      this.on(method, cb);
    });
  }

  /** Evaluate an expression (awaited) and return its JSON value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 300)}`);
    }
    return r.result.value;
  }

  /** Poll until `expression` is truthy. */
  async waitFor(expression, { timeoutMs = 15_000, interval = 100, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { if (await this.eval(expression)) return; } catch { /* page navigating */ }
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${String(label).slice(0, 200)}`);
      await sleep(interval);
    }
  }

  /** `repaint`: draw the page anew for the shot (a resting pointer's
   * :hover shows only that way in headless Chrome; the surface copy is a
   * frame from before it), clipped to the whole viewport at the page's scale. */
  async screenshot({ repaint } = {}) {
    const extra = repaint ? { fromSurface: false, captureBeyondViewport: true, clip: { x: 0, y: 0, width: repaint.width, height: repaint.height, scale: 1 } } : { fromSurface: true, captureBeyondViewport: false };
    const r = await this.send("Page.captureScreenshot", { format: "png", ...extra });
    return Buffer.from(r.data, "base64");
  }

  async close() {
    try { await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`); } catch { /* gone */ }
    try { this.ws.close(); } catch { /* gone */ }
  }
}

export async function openPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const page = new Page(ws, target.id, port);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return page;
}
