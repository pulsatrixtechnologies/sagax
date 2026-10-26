// The widget self-check (JC, 2026-10-19): "the bot must check its own widget
// and fix it while it builds it". A bot hands the HTML of a ```widget fence to
// check_widget; this file renders it the way the chat does (the same document
// from src/lib/rich-blocks.ts, in an iframe sandboxed to allow-scripts) at a
// desktop and a phone width, light and dark, and returns the defects the
// in-page audit (widget-check-audit.ts) and the console found, with a small
// screenshot. The bot fixes and checks again, three times at most per turn.
//
// One headless Chrome, warm: started on the first check, reused, closed after
// a few idle minutes, never started while the server's memory is high (#804),
// and marked as the OOM killer's first choice. It speaks CDP over a pipe (no
// port, no window). Checks run one at a time.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { buildWidgetDocument, WIDGET_MAX_HEIGHT, WIDGET_MESSAGE, WIDGET_MIN_HEIGHT, WIDGET_SANDBOX } from "../src/lib/rich-blocks.ts";
import { widgetFontFace } from "../src/lib/widget-kit.ts";
import { auditWidgetPage, type AuditDefect } from "./widget-check-audit.ts";

export const WIDGET_CHECK_MAX_ATTEMPTS = 3;
/** The fence a widget that still fails after the last attempt is shown in:
 * the chat draws it as usual with a discreet "display may be imperfect". */
export const IMPERFECT_WIDGET_FENCE = "widget-imperfect";
export const WIDGET_CHECK_MAX_SOURCE = 200_000;
/** Checks waiting for the one browser before new ones are turned away. */
export const WIDGET_CHECK_MAX_QUEUE = 4;

/** Where the widget is drawn: the chat column on a desktop, a phone. */
export const WIDGET_CHECK_VIEWS = [
  { name: "desktop", width: 720, scheme: "light" },
  { name: "desktop", width: 720, scheme: "dark" },
  { name: "phone", width: 360, scheme: "light" },
  { name: "phone", width: 360, scheme: "dark" },
] as const;
type View = (typeof WIDGET_CHECK_VIEWS)[number];
/** The chat surface behind a widget (widget-kit.ts FALLBACK --color-panel). */
const SURFACE = { light: "#ffffff", dark: "#161616" } as const;

export interface WidgetDefect {
  kind: AuditDefect["kind"] | "script";
  target: string;
  detail: string;
  /** Where it was seen, e.g. "phone dark". */
  views: string[];
}

export interface WidgetCheckResult {
  status: "passed" | "failed" | "unavailable";
  defects: WidgetDefect[];
  /** A small JPEG of the view with the most defects, base64; failed only. */
  screenshot?: string;
  reason?: string;
  ms: number;
}

// ---------------------------------------------------------------------------
// Finding a Chrome

/** SAGAX_WIDGET_CHECK_CHROME, the browser Sagax already runs for its bots
 * (AGENT_BROWSER_EXECUTABLE_PATH: the server image's Chrome for Testing), the
 * desktop bundle's Chrome, then a Playwright headless shell (development).
 * Never the person's own browser. */
export function resolveWidgetChrome(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const explicit = env.SAGAX_WIDGET_CHECK_CHROME?.trim();
  if (explicit === "off") return null;
  if (explicit) return exists(explicit) ? explicit : null;
  const agent = env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (agent && exists(agent)) return agent;
  const resources = env.SAGAX_RESOURCES_PATH?.trim();
  if (resources) {
    for (const candidate of bundledChromes(join(resources, "browser-engine"))) if (exists(candidate)) return candidate;
  }
  return playwrightShell(env, exists);
}

function bundledChromes(directory: string): string[] {
  try {
    const target = readdirSync(directory).find((name) => name === `${process.platform}-${process.arch}`) ?? "";
    const base = target ? join(directory, target) : directory;
    return [
      join(base, "chrome"),
      join(base, "chrome", "chrome"),
      join(base, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(base, "chrome", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(base, "chrome.exe"),
    ];
  } catch {
    return [];
  }
}

function playwrightShell(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | null {
  const cache = env.PLAYWRIGHT_BROWSERS_PATH?.trim()
    || (process.platform === "darwin" ? join(homedir(), "Library", "Caches", "ms-playwright") : join(homedir(), ".cache", "ms-playwright"));
  let entries: string[];
  try { entries = readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse(); }
  catch { return null; }
  for (const entry of entries) {
    for (const folder of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64", "chrome-linux"]) {
      for (const binary of ["chrome-headless-shell", "headless_shell"]) {
        const candidate = join(cache, entry, folder, binary);
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

let fontFace: string | undefined;
/** The chat's own font, so text wraps where it wraps in the app: from the
 * package in development, from the built UI (SAGAX_STATIC_DIR, where Vite
 * emits geist-latin-wght-normal-<hash>.woff2) in the image and the desktop,
 * which carry no node_modules. */
export function geistFace(staticDir?: string | null): string {
  if (fontFace !== undefined) return fontFace;
  fontFace = "";
  const candidates: Array<() => string> = [
    () => join(dirname(createRequire(import.meta.url).resolve("@fontsource-variable/geist")), "files", "geist-latin-wght-normal.woff2"),
    () => {
      const assets = join(staticDir ?? "", "assets");
      const name = staticDir ? readdirSync(assets).find((file) => /^geist-latin-wght-normal.*\.woff2$/.test(file)) : undefined;
      if (!name) throw new Error("no font");
      return join(assets, name);
    },
  ];
  for (const candidate of candidates) {
    try {
      fontFace = widgetFontFace(`data:font/woff2;base64,${readFileSync(candidate()).toString("base64")}`);
      break;
    } catch { /* next; none: the fallback stack measures close enough */ }
  }
  return fontFace;
}

// ---------------------------------------------------------------------------
// CDP over a pipe

type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

class CdpPipe {
  private next = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private chunks: Buffer[] = [];
  readonly listeners = new Set<(event: CdpEvent) => void>();
  closed = false;

  private readonly input: Writable;

  constructor(input: Writable, output: Readable) {
    this.input = input;
    output.on("data", (chunk: Buffer) => this.read(chunk));
    output.on("close", () => this.close(new Error("Chrome closed its pipe.")));
    input.on("error", () => this.close(new Error("Chrome pipe error.")));
  }

  private read(chunk: Buffer) {
    let start = 0;
    for (let index = chunk.indexOf(0); index !== -1; index = chunk.indexOf(0, start)) {
      this.chunks.push(chunk.subarray(start, index));
      const raw = Buffer.concat(this.chunks).toString("utf8");
      this.chunks = [];
      start = index + 1;
      this.dispatch(raw);
    }
    if (start < chunk.length) this.chunks.push(chunk.subarray(start));
  }

  private dispatch(raw: string) {
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try { message = JSON.parse(raw); } catch { return; }
    if (typeof message.id === "number") {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
      else waiter.resolve(message.result ?? {});
      return;
    }
    if (message.method) for (const listener of this.listeners) listener({ method: message.method, params: message.params ?? {}, sessionId: message.sessionId });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 5_000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("Chrome is closed."));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  close(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// The renderer

export interface WidgetRendererOptions {
  chromePath?: string | null;
  /** The built UI, where the chat's font is found in production. */
  staticDir?: string | null;
  /** The whole check, all views: past it the browser is killed. */
  deadlineMs?: number;
  /** Close the warm browser after this long without a check. */
  idleMs?: number;
  /** false while the server is short of memory: no browser is started and a
   * warm one is closed (server/engine-memory-guard.ts). */
  memoryOk?: () => boolean;
  /** Called with the browser's pid once it runs (OOM score). */
  onSpawn?: (pid: number) => void;
  log?: (line: string) => void;
}

interface Session { child: ChildProcess; cdp: CdpPipe; sessionId: string; profile: string }

/** Build the page the chat draws a widget in: an iframe with the widget's
 * document, sandboxed like WidgetFrame, its height following the widget. */
export function widgetHostPage(code: string, scheme: "light" | "dark", font = geistFace()): string {
  const srcdoc = buildWidgetDocument(code, scheme, font);
  const script = `var f=document.getElementById('w');window.__h=0;addEventListener('message',function(e){if(e.source!==f.contentWindow)return;var d=e.data;if(!d||d.type!==${JSON.stringify(WIDGET_MESSAGE)}||typeof d.height!=='number')return;var h=Math.round(Math.min(Math.max(d.height,${WIDGET_MIN_HEIGHT}),${WIDGET_MAX_HEIGHT}));window.__h=h;f.style.height=h+'px';});f.srcdoc=${JSON.stringify(srcdoc).replace(/</g, "\\u003c")};`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${SURFACE[scheme]};color-scheme:${scheme}}iframe{display:block;width:100%;height:120px;border:0;background:transparent;color-scheme:${scheme}}</style></head><body><iframe id="w" sandbox="${WIDGET_SANDBOX}" referrerpolicy="no-referrer" allow="" title="widget"></iframe><script>${script}</script></body></html>`;
}

const AUDIT_EXPRESSION = (background: string) => `(function(){var __name=function(f){return f};return (${auditWidgetPage.toString()})(${JSON.stringify({ background })});})()`;

export class WidgetRenderer {
  private session: Session | null = null;
  private starting: Promise<Session> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleMs: number;

  private readonly options: WidgetRendererOptions;

  constructor(options: WidgetRendererOptions = {}) {
    this.options = options;
    this.idleMs = options.idleMs ?? 3 * 60_000;
  }

  /** Whether a check can run here at all (a Chrome was found). */
  get available(): boolean {
    return this.chrome() !== null;
  }

  private chrome(): string | null {
    return this.options.chromePath === undefined ? resolveWidgetChrome() : this.options.chromePath;
  }

  /** Check one widget. Never throws: a renderer problem is "unavailable". */
  check(code: string): Promise<WidgetCheckResult> {
    // one browser for every bot: a long line answers at once instead of waiting
    if (this.waiting >= WIDGET_CHECK_MAX_QUEUE) return Promise.resolve({ status: "unavailable", defects: [], reason: "the checker is busy with other widgets", ms: 0 });
    this.waiting += 1;
    const run = this.queue.then(() => this.withDeadline(code)).finally(() => { this.waiting -= 1; });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private waiting = 0;

  private async withDeadline(code: string): Promise<WidgetCheckResult> {
    const deadline = this.options.deadlineMs ?? 20_000;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<WidgetCheckResult>((resolve) => {
      timer = setTimeout(() => {
        this.options.log?.("[widget-check] check passed its deadline; browser closed");
        void this.close();
        resolve({ status: "unavailable", defects: [], reason: "the widget took too long to draw", ms: deadline });
      }, deadline);
      timer.unref?.();
    });
    try { return await Promise.race([this.checkNow(code), late]); }
    finally { clearTimeout(timer); }
  }

  private async checkNow(code: string): Promise<WidgetCheckResult> {
    const started = Date.now();
    const unavailable = (reason: string): WidgetCheckResult => ({ status: "unavailable", defects: [], reason, ms: Date.now() - started });
    if (this.options.memoryOk && !this.options.memoryOk()) {
      await this.close();
      return unavailable("the server is short of memory right now");
    }
    if (!this.chrome()) return unavailable("no headless browser on this server");
    let session: Session;
    try { session = await this.open(); }
    catch (error) {
      this.options.log?.(`[widget-check] browser start failed: ${(error as Error).message}`);
      return unavailable("the headless browser did not start");
    }
    this.armIdle(false);
    try {
      const merged = new Map<string, WidgetDefect>();
      let worst: { view: View; count: number; height: number } | null = null;
      let escaped = false;
      for (const view of WIDGET_CHECK_VIEWS) {
        const found = await this.render(session, code, view);
        const label = `${view.name} ${view.scheme}`;
        for (const defect of found.defects) {
          const key = `${defect.kind}|${defect.target}|${defect.detail.replace(/\d+(\.\d+)?/g, "#")}`;
          const known = merged.get(key);
          if (known) known.views.push(label);
          else merged.set(key, { ...defect, views: [label] });
        }
        if (found.escaped) { escaped = true; continue; }
        if (found.defects.length && (!worst || found.defects.length > worst.count)) worst = { view, count: found.defects.length, height: found.height };
      }
      const defects = [...merged.values()].slice(0, 25);
      let screenshot: string | undefined;
      if (worst && !escaped) {
        await this.render(session, code, worst.view);
        screenshot = await this.screenshot(session, worst.view, worst.height).catch(() => undefined);
      }
      return { status: defects.length ? "failed" : "passed", defects, ...(screenshot ? { screenshot } : {}), ms: Date.now() - started };
    } catch (error) {
      this.options.log?.(`[widget-check] check failed: ${(error as Error).message}`);
      // its own browser only: a deadline may already have replaced it
      await this.close(session);
      return unavailable("the headless browser stopped during the check");
    } finally {
      this.armIdle(true);
    }
  }

  private armIdle(on: boolean) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!on) return;
    this.idleTimer = setTimeout(() => { void this.close(); }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private async open(): Promise<Session> {
    if (this.session && !this.session.cdp.closed) return this.session;
    this.session = null;
    if (!this.starting) this.starting = this.launch().finally(() => { this.starting = null; });
    this.session = await this.starting;
    return this.session;
  }

  private async launch(): Promise<Session> {
    const chrome = this.chrome()!;
    const profile = mkdtempSync(join(tmpdir(), "sagax-widget-check-"));
    const args = [
      "--headless",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps",
      "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
      "--mute-audio", "--hide-scrollbars", "--use-mock-keychain", "--password-store=basic",
      "--renderer-process-limit=1", "--js-flags=--max-old-space-size=96", "--disable-dev-shm-usage",
      // No network at all, loopback included: a widget that navigates its
      // frame away must not reach the server, the cluster or the LAN through
      // the checker (the CSP does not survive a navigation). Every http(s) and
      // ws request goes to a closed proxy port; requests are also failed in
      // Fetch below.
      "--proxy-server=127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--host-resolver-rules=MAP * ~NOTFOUND",
      ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "about:blank",
    ];
    const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true, detached: false });
    const cdp = new CdpPipe(child.stdio[3] as Writable, child.stdio[4] as Readable);
    child.once("exit", () => {
      cdp.close(new Error("Chrome exited."));
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    });
    child.once("error", () => {
      cdp.close(new Error("Chrome could not start."));
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    });
    if (child.pid) this.options.onSpawn?.(child.pid);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }, undefined, 15_000) as { targetId: string };
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
      // every request but the widget's own data: and about: documents fails
      cdp.listeners.add((event) => {
        if (event.sessionId !== sessionId || event.method !== "Fetch.requestPaused") return;
        const { requestId, request } = event.params as { requestId: string; request: { url: string } };
        const local = /^(data|about|blob):/i.test(request.url);
        void cdp.send(local ? "Fetch.continueRequest" : "Fetch.failRequest", local ? { requestId } : { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => undefined);
      });
      await Promise.all([
        cdp.send("Page.enable", {}, sessionId),
        cdp.send("Runtime.enable", {}, sessionId),
        cdp.send("Log.enable", {}, sessionId),
        cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId),
      ]);
      return { child, cdp, sessionId, profile };
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }
  }

  private async render(session: Session, code: string, view: View): Promise<{ defects: Array<Omit<WidgetDefect, "views">>; height: number; escaped?: boolean }> {
    const { cdp, sessionId } = session;
    const scripts: Array<Omit<WidgetDefect, "views">> = [];
    const scriptError = (detail: string) => {
      if (scripts.length < 5 && !scripts.some((known) => known.detail === detail)) scripts.push({ kind: "script", target: "script", detail });
    };
    const listener = (event: CdpEvent) => {
      if (event.sessionId !== sessionId) return;
      if (event.method === "Runtime.exceptionThrown") {
        const details = event.params.exceptionDetails as { text?: string; lineNumber?: number; exception?: { description?: string } } | undefined;
        const text = (details?.exception?.description ?? details?.text ?? "error").split("\n")[0]!;
        scriptError(`uncaught ${text}${typeof details?.lineNumber === "number" ? ` (line ${details.lineNumber + 1})` : ""}`);
      } else if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
        const args = (event.params.args as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
        scriptError(`console.error: ${args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ").slice(0, 200)}`);
      } else if (event.method === "Log.entryAdded") {
        const entry = event.params.entry as { level?: string; text?: string } | undefined;
        if (entry?.level === "error" && entry.text) scriptError(entry.text.slice(0, 200));
      }
    };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: view.width, height: WIDGET_MAX_HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: view.scheme }] }, sessionId);
    const html = widgetHostPage(code, view.scheme, geistFace(this.options.staticDir));
    cdp.listeners.add(listener);
    try {
      const loaded = new Promise<void>((resolve) => {
        const onLoad = (event: CdpEvent) => {
          if (event.sessionId === sessionId && event.method === "Page.loadEventFired") {
            cdp.listeners.delete(onLoad);
            resolve();
          }
        };
        cdp.listeners.add(onLoad);
        setTimeout(() => { cdp.listeners.delete(onLoad); resolve(); }, 4_000).unref?.();
      });
      await cdp.send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` }, sessionId, 8_000);
      await loaded;
      // two frames and a beat: the widget's first paint, its height report
      await cdp.send("Runtime.evaluate", { expression: "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(r,180)})})})", awaitPromise: true }, sessionId, 4_000);
      const { frameTree } = await cdp.send("Page.getFrameTree", {}, sessionId) as { frameTree: { childFrames?: Array<{ frame: { id: string; url?: string } }> } };
      const frame = frameTree.childFrames?.[0]?.frame;
      if (!frame) throw new Error("the widget frame did not load");
      // a widget that left its frame is never audited: the chat resets it
      if (frame.url !== "about:srcdoc") {
        return { defects: [...scripts, { kind: "hidden", target: "document", detail: "the widget navigates its frame away (location, a link or a form); the chat resets it, so nothing would show" }], height: 0, escaped: true };
      }
      const frameId = frame.id;
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId, worldName: "sagax-widget-check" }, sessionId) as { executionContextId: number };
      const evaluated = await cdp.send("Runtime.evaluate", { expression: AUDIT_EXPRESSION(SURFACE[view.scheme]), contextId: executionContextId, returnByValue: true }, sessionId, 6_000) as { result?: { value?: AuditDefect[] }; exceptionDetails?: { text?: string } };
      if (evaluated.exceptionDetails) throw new Error(`audit failed: ${evaluated.exceptionDetails.text ?? "error"}`);
      const height = await cdp.send("Runtime.evaluate", { expression: "window.__h||0", returnByValue: true }, sessionId) as { result?: { value?: number } };
      const found = Array.isArray(evaluated.result?.value) ? evaluated.result.value : [];
      return { defects: [...scripts, ...found], height: Number(height.result?.value ?? 0) || 200 };
    } finally {
      cdp.listeners.delete(listener);
    }
  }

  private async screenshot(session: Session, view: View, height: number): Promise<string> {
    const scale = view.width > 400 ? 0.5 : 0.75;
    const { data } = await session.cdp.send("Page.captureScreenshot", {
      format: "jpeg", quality: 55,
      clip: { x: 0, y: 0, width: view.width, height: Math.min(Math.max(height, 48), 900), scale },
    }, session.sessionId, 6_000) as { data: string };
    return data;
  }

  /** Close the warm browser now (idle, memory, shutdown). */
  async close(only?: Session): Promise<void> {
    const session = only ?? this.session;
    if (!session) return;
    if (this.session === session) this.session = null;
    try { await session.cdp.send("Browser.close", {}, undefined, 1_500); } catch { /* killed below */ }
    if (session.child.exitCode === null) session.child.kill("SIGKILL");
    try { rmSync(session.profile, { recursive: true, force: true }); } catch { /* the exit handler retries */ }
  }
}

// ---------------------------------------------------------------------------
// The loop: what the bot is told

/** A turn's checks are forgotten after this long without one (a runtime
 * with no turn generation shares one key per thread). */
const TURN_IDLE_MS = 15 * 60_000;

/** Attempts per turn (thread + turn generation), and the best one so far. */
export class WidgetCheckAttempts {
  private readonly turns = new Map<string, { at: number; attempts: number; seen: Map<string, number>; best: { attempt: number; defects: number } | null }>();

  /** The turn's attempts so far: a fourth check is refused without a render. */
  used(turnKey: string): { attempts: number; best: { attempt: number; defects: number } | null } {
    const turn = this.turns.get(turnKey);
    return turn && Date.now() - turn.at <= TURN_IDLE_MS ? { attempts: turn.attempts, best: turn.best } : { attempts: 0, best: null };
  }

  seen(turnKey: string, code: string): boolean {
    return this.turns.get(turnKey)?.seen.has(createHash("sha256").update(code).digest("hex")) ?? false;
  }

  record(turnKey: string, code: string, defects: number): { attempt: number; repeated: boolean; best: { attempt: number; defects: number } | null } {
    const now = Date.now();
    for (const [key, turn] of this.turns) if (now - turn.at > TURN_IDLE_MS) this.turns.delete(key);
    if (this.turns.size > 1000) this.turns.delete(this.turns.keys().next().value!);
    const turn = this.turns.get(turnKey) ?? { at: now, attempts: 0, seen: new Map(), best: null };
    this.turns.set(turnKey, turn);
    turn.at = now;
    const hash = createHash("sha256").update(code).digest("hex");
    const earlier = turn.seen.get(hash);
    // the same HTML again costs no attempt, and never turns the count back
    if (earlier !== undefined) return { attempt: turn.attempts, repeated: true, best: turn.best };
    turn.attempts += 1;
    turn.seen.set(hash, turn.attempts);
    if (!turn.best || defects < turn.best.defects) turn.best = { attempt: turn.attempts, defects };
    return { attempt: turn.attempts, repeated: false, best: turn.best };
  }
}

const KIND_LABEL: Record<WidgetDefect["kind"], string> = {
  script: "JavaScript error",
  hscroll: "horizontal scroll",
  overflow: "overflow",
  clipped: "clipped text",
  overlap: "overlap",
  crushed: "crushed text",
  hidden: "hidden or unreachable",
  contrast: "low contrast",
  target: "target too small",
  empty: "empty",
};

const ALL_VIEWS = WIDGET_CHECK_VIEWS.length;
const VIEW_SUMMARY = "desktop 720px and phone 360px, light and dark";

/** The tool result the bot reads. */
export function widgetCheckReport(result: WidgetCheckResult, attempt: { attempt: number; repeated: boolean; best: { attempt: number; defects: number } | null }): { text: string; isError: boolean } {
  if (result.status === "unavailable") {
    return { text: `Widget check unavailable (${result.reason ?? "no renderer"}). Review your HTML yourself for overflow, overlapping and crushed text, then show it.`, isError: false };
  }
  if (result.status === "passed") {
    return { text: `Widget check passed (attempt ${attempt.attempt}): no JavaScript error, overflow, overlap, crushed text, hidden control, low contrast, small target or horizontal scroll at ${VIEW_SUMMARY} (${result.ms} ms). Show this exact HTML in a \`\`\`widget fence.`, isError: false };
  }
  const lines = result.defects.map((defect) => {
    const where = defect.views.length >= ALL_VIEWS ? "all views" : defect.views.join(", ");
    return `- ${KIND_LABEL[defect.kind]} [${where}] ${defect.target}: ${defect.detail}`;
  });
  const head = `Widget check found ${result.defects.length} defect${result.defects.length > 1 ? "s" : ""} (attempt ${attempt.attempt} of ${WIDGET_CHECK_MAX_ATTEMPTS}${attempt.repeated ? ", same HTML as before" : ""}) at ${VIEW_SUMMARY}:`;
  const last = attempt.attempt >= WIDGET_CHECK_MAX_ATTEMPTS;
  const next = last
    ? `That was the last check for this turn. Show your best version (attempt ${attempt.best?.attempt ?? attempt.attempt}, ${attempt.best?.defects ?? result.defects.length} defect(s)) in a \`\`\`${IMPERFECT_WIDGET_FENCE} fence instead of \`\`\`widget; the chat marks it discreetly. Do not mention the check.`
    : "Fix every defect (widths, wrapping, flex rows, min-width:0, the kit classes and variables), then call check_widget again with the corrected HTML. Do not show the widget before it passes.";
  return { text: [head, ...lines, next].join("\n"), isError: true };
}

/** The internal route behind check_widget: one check, counted against the
 * turn, answered as the text the bot reads plus the screenshot. */
export async function checkWidgetForTurn(
  renderer: WidgetRenderer,
  attempts: WidgetCheckAttempts,
  turnKey: string,
  body: unknown,
): Promise<{ status: number; body: { text?: string; isError?: boolean; screenshot?: string; error?: string } }> {
  const html = (body as { html?: unknown } | null)?.html;
  if (typeof html !== "string" || !html.trim()) return { status: 400, body: { error: "html: the widget's HTML, as it goes in the ```widget fence." } };
  if (html.length > WIDGET_CHECK_MAX_SOURCE) return { status: 400, body: { error: `html: at most ${WIDGET_CHECK_MAX_SOURCE} characters; a widget this large will not fit the chat.` } };
  const used = attempts.used(turnKey);
  if (used.attempts >= WIDGET_CHECK_MAX_ATTEMPTS && !attempts.seen(turnKey, html)) {
    return { status: 200, body: { text: `No check left for this turn (${WIDGET_CHECK_MAX_ATTEMPTS} used). Show your best version (attempt ${used.best?.attempt ?? used.attempts}) in a \`\`\`${IMPERFECT_WIDGET_FENCE} fence.`, isError: true } };
  }
  const result = await renderer.check(html);
  const attempt = result.status === "unavailable" ? { attempt: 0, repeated: false, best: null } : attempts.record(turnKey, html, result.defects.length);
  const report = widgetCheckReport(result, attempt);
  return { status: 200, body: { text: report.text, isError: report.isError, ...(result.screenshot ? { screenshot: result.screenshot } : {}) } };
}
