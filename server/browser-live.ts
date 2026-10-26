import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { promisify } from "node:util";
import { BROWSER_VIEWPORT_ARGS, browserRuntimeEnv, ownsBrowserViewport, type BrowserRuntime } from "./browser-runtime.ts";
import { closeBrowserSession } from "./browser-engine.ts";
import { parseDescribedElement, teachDescribeScript, TeachRecordings, type TeachRecorder } from "./browser-teach.ts";

const execute = promisify(execFile);
const MAX_FRAME = 3 * 1024 * 1024;
const MAX_BUFFER = 4 * 1024 * 1024;
const HEARTBEAT_MS = 10_000;
// The Computer tab's preview: a live thumbnail, not a control surface.
const PREVIEW_FPS = 5;
const COMMAND_TIMEOUT_MS = 30_000;
const VIEWPORT_TIMEOUT_MS = 5_000;
// Opening a view while the bot's own command holds the session: each stream
// probe waits up to STATUS_PROBE_MS (it may also have to launch the browser),
// then the view shows that it is waiting and probes again with a bounded
// backoff for as long as the viewer stays, up to a limit. A probe that is
// waiting in line answers as soon as the bot's command finishes.
const STATUS_PROBE_MS = 10_000;
const BUSY_RETRY_MS = [1_000, 2_000, 5_000];
const BUSY_LIMIT_MS = 10 * 60_000;
/** Where a browser the person opens lands, and a new tab opened from the
 * toolbar: a search page to start from, not a blank one. */
export const BROWSER_START_URL = "https://www.google.com/";
// The native press resolver supplies the virtual key codes and Enter/Tab text
// that its raw input_keyboard relay omits. Keep unknown keys literal.
const DISCRETE_KEYS = new Set(["Backspace", "Enter", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
// Interacting (or Take control) takes control, and an
// interrupted action is recovered from the panel's menu.
/** A recording asks the page about an element: brief, or the step goes without it. */
const DESCRIBE_TIMEOUT_MS = 5_000;
const RESTART_NEEDED = "A browser action was interrupted. Choose Restart browser… in the browser menu before continuing.";

export class BrowserLiveError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "BrowserLiveError"; this.status = status; }
}

/** The engine ran the person's command and answered that it failed, such as
 * an address that does not resolve. The browser is fine: the view says what
 * failed and keeps working (isSettledBrowserFailure), with no restart. */
export class BrowserActionFailedError extends BrowserLiveError {
  readonly settled = true;
  constructor(args: readonly string[]) {
    const opening = args[0] === "open" || (args[0] === "tab" && args[1] === "new" && args.length > 2);
    super(opening ? "This page could not be opened. Check the address and try again." : "The browser could not do that. Try again.", 422);
    this.name = "BrowserActionFailedError";
  }
}

/** The engine is there but did not answer in time: another command, usually
 * the bot's own, holds the same browser session. Not a missing engine. */
/** A preview (watch-only) view found no running browser. It never launches
 * one just to be watched: the card says the browser is closed and asks
 * again later; taking control opens it. */
export class BrowserOfflineError extends BrowserLiveError {
  constructor() { super("The browser is not running.", 409); this.name = "BrowserOfflineError"; }
}

export class BrowserBusyError extends BrowserLiveError {
  constructor(message = "The browser is busy with another action and did not answer in time. Try again shortly.") {
    super(message, 503); this.name = "BrowserBusyError";
  }
}

/** execFile's own timeout: it killed a command that had not exited, as
 * opposed to a missing binary, a failed command, an abort or an overflow. */
function timedOut(error: unknown): boolean {
  const failure = error as { killed?: unknown; signal?: unknown; code?: unknown } | null;
  return failure?.killed === true && failure.signal === "SIGKILL" && failure.code == null;
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return number(value, min, max) && Number.isSafeInteger(value);
}
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }

function displayUrl(value: unknown): string {
  if (!text(value, 8192)) return "";
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'about:'].includes(url.protocol)) return "";
    url.username = ""; url.password = "";
    return url.href;
  } catch { return ""; }
}

/** Chrome's own launch-failure wording: the engine is installed and its
 * daemon answers, but no browser can start (no display, an early exit).
 * Distinct from a missing engine — the fix is a fresh session, not an
 * install, so the generic "check the engine is installed" guidance would
 * send the operator the wrong way (#1383). */
/** The engine's own JSON answer says the command failed, whether it exited
 * non-zero or not: it ran to the end. A timeout, an abort or a crash leaves
 * no such answer, and stays an interrupted action. */
function engineAnsweredFailure(error: unknown): boolean {
  const stdout = (error as { stdout?: unknown } | null)?.stdout;
  if (typeof stdout !== "string" || !stdout.trim()) return false;
  try { return object(JSON.parse(stdout))?.success === false; } catch { return false; }
}

function browserLaunchFailure(error: unknown): boolean {
  const detail = [
    (error as { stderr?: unknown })?.stderr,
    (error as { stdout?: unknown })?.stdout,
    error instanceof Error ? error.message : String(error),
  ].filter((part): part is string => typeof part === "string").join("\n");
  return /missing x server|\$DISPLAY|devtoolsactiveport|chrome exited|could not launch|failed to launch|browser launch failed/iu.test(detail);
}

/** Project only the viewer protocol. Never relay engine commands, results or console output. */
export function normalizeBrowserLiveMessage(value: unknown): ObjectValue | null {
  const message = object(value);
  if (!message) return null;
  if (message.type === "error") return { type: "error", retryable: true, message: "The browser stream was interrupted." };
  if (message.type === "url") return { type: "url", url: displayUrl(message.url) };
  if (message.type === "tabs" && Array.isArray(message.tabs) && message.tabs.length <= 100) {
    return { type: "tabs", tabs: message.tabs.flatMap((value) => {
      const tab = object(value);
      if (!tab || typeof tab.tabId !== "string" || !/^t[1-9]\d{0,8}$/.test(tab.tabId)) return [];
      return [{ tabId: tab.tabId, title: text(tab.title, 512) ? tab.title : "", url: displayUrl(tab.url), active: tab.active === true }];
    }) };
  }
  if (message.type === "status" && typeof message.connected === "boolean") {
    return { type: "status", connected: message.connected, screencasting: message.screencasting === true,
      viewportWidth: integer(message.viewportWidth, 1, 8192) ? message.viewportWidth : 1280,
      viewportHeight: integer(message.viewportHeight, 1, 8192) ? message.viewportHeight : 720 };
  }
  if (message.type !== "frame" || !integer(message.seq, 1, Number.MAX_SAFE_INTEGER)
      || !text(message.data, MAX_FRAME) || !/^(?:\/9j\/|iVBORw0KGgo)/.test(message.data)
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) return null;
  const meta = object(message.metadata);
  if (!meta || !integer(meta.deviceWidth, 1, 8192) || !integer(meta.deviceHeight, 1, 8192)
      || meta.deviceWidth * meta.deviceHeight > 16_777_216) return null;
  return { type: "frame", seq: message.seq, data: message.data, format: message.data.startsWith("/9j/") ? "jpeg" : "png",
    metadata: { deviceWidth: meta.deviceWidth, deviceHeight: meta.deviceHeight,
      offsetTop: number(meta.offsetTop, 0, 8192) ? meta.offsetTop : 0,
      pageScaleFactor: number(meta.pageScaleFactor, 0.01, 100) ? meta.pageScaleFactor : 1,
      scrollOffsetX: number(meta.scrollOffsetX, -1e8, 1e8) ? meta.scrollOffsetX : 0,
      scrollOffsetY: number(meta.scrollOffsetY, -1e8, 1e8) ? meta.scrollOffsetY : 0,
      timestamp: number(meta.timestamp, 0, Number.MAX_SAFE_INTEGER) ? meta.timestamp : 0 } };
}

export function browserStreamPort(value: unknown): number {
  const data = object(value);
  if (!data || data.enabled !== true || !integer(data.port, 1, 65535)) {
    throw new BrowserLiveError("The browser did not provide a valid local stream. Update or reinstall the browser engine.", 503);
  }
  return data.port;
}

type Action = { type: "take" | "release" | "restart" } | { type: "ack"; seq: number }
  | { type: "record-start" | "record-stop" | "record-discard" }
  | { type: "command"; args: string[] } | { type: "input"; message: ObjectValue };

/** HTTP bodies can select a fixed action, never a CLI command, flag, port or CDP method. */
export function parseBrowserLiveAction(value: unknown): Action {
  const body = object(value);
  const invalid = () => new BrowserLiveError("Invalid browser action.");
  if (!body) throw invalid();
  if (body.type === "take" || body.type === "release" || body.type === "restart") return { type: body.type };
  // Teach by demonstration: the person's own recording (server/browser-teach.ts).
  if (body.type === "record-start" || body.type === "record-stop" || body.type === "record-discard") return { type: body.type };
  if (body.type === "ack" && integer(body.seq, 1, Number.MAX_SAFE_INTEGER)) return { type: "ack", seq: body.seq };
  if (body.type === "back" || body.type === "forward" || body.type === "reload") return { type: "command", args: [body.type] };
  if (body.type === "navigate" || body.type === "tab-new") {
    if (body.type === "tab-new" && body.url === undefined) return { type: "command", args: ["tab", "new", BROWSER_START_URL] };
    // eslint-disable-next-line no-control-regex -- Reject control characters before URL parsing normalizes them.
    if (!text(body.url, 8192) || !body.url || /[\u0000-\u0020\u007f\\]/u.test(body.url)) throw invalid();
    let url: URL;
    try { url = new URL(body.url); } catch { throw invalid(); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw invalid();
    return { type: "command", args: body.type === "navigate" ? ["open", url.href] : ["tab", "new", url.href] };
  }
  if (body.type === "tab-select" || body.type === "tab-close") {
    if (typeof body.tabId !== "string" || !/^t[1-9]\d{0,8}$/.test(body.tabId)) throw invalid();
    return { type: "command", args: body.type === "tab-select" ? ["tab", body.tabId] : ["tab", "close", body.tabId] };
  }
  if (body.type === "input_mouse") {
    if (!["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"].includes(String(body.eventType))
        || !number(body.x, 0, 8192) || !number(body.y, 0, 8192)) throw invalid();
    const button = body.button ?? "none";
    const clickCount = body.clickCount ?? 0, modifiers = body.modifiers ?? 0;
    const deltaX = body.deltaX ?? 0, deltaY = body.deltaY ?? 0;
    if (!["none", "left", "middle", "right"].includes(String(button)) || !integer(clickCount, 0, 3)
        || !integer(modifiers, 0, 15) || !number(deltaX, -10000, 10000) || !number(deltaY, -10000, 10000)) throw invalid();
    return { type: "input", message: { type: "input_mouse", eventType: body.eventType, x: body.x, y: body.y, button, clickCount, modifiers, deltaX, deltaY } };
  }
  if (body.type === "input_keyboard") {
    if (body.eventType === "char") {
      if (!text(body.text, 4096) || !body.text) throw invalid();
      return { type: "input", message: { type: "input_keyboard", eventType: "char", text: body.text } };
    }
    if (!["keyDown", "keyUp"].includes(String(body.eventType)) || !text(body.key, 64) || !body.key) throw invalid();
    const modifiers = body.modifiers ?? 0, keyCode = body.windowsVirtualKeyCode ?? 0;
    if (!integer(modifiers, 0, 15) || !integer(keyCode, 0, 255)
        || (body.code !== undefined && !text(body.code, 64)) || (body.text !== undefined && !text(body.text, 4096))) throw invalid();
    return { type: "input", message: { type: "input_keyboard", eventType: body.eventType, key: body.key,
      modifiers, windowsVirtualKeyCode: keyCode, ...(body.code === undefined ? {} : { code: body.code }), ...(body.text === undefined ? {} : { text: body.text }) } };
  }
  throw invalid();
}

interface OpenOptions {
  botId: string;
  session: string;
  spec: { command: string; args?: readonly string[]; env?: NodeJS.ProcessEnv };
  owner: string;
  isCurrent: () => boolean;
  res: ServerResponse;
  /** Watch-only: the Computer tab's live preview. It never launches or sizes
   * the browser, streams at a lower rate, and can only acknowledge frames. */
  preview?: boolean;
}
interface Viewer extends OpenOptions {
  id: string;
  socket?: WebSocket;
  closed: boolean;
  blocked: boolean;
  heartbeat?: NodeJS.Timeout;
  drainTimer?: NodeJS.Timeout;
  frameSeq?: number;
  frameAt?: number;
  hiddenFrame?: ObjectValue;
  pendingFrame?: ObjectValue;
  pendingActions: number;
  pressedKeys: Set<string>;
  pressedButtons: Set<string>;
  port?: number;
  restarting: boolean;
  /** Headers are out, but the browser has not answered yet: only waiting and error events. */
  waiting: boolean;
  abort: AbortController;
  /** Ends this view's watch: the browser is not idle while it is open. */
  unwatch: () => void;
}

export class BrowserLive {
  private readonly runtime: BrowserRuntime;
  private readonly viewers = new Map<string, Viewer>();
  private readonly sessionResets = new Map<string, Promise<boolean>>();
  /** Teach by demonstration recordings, per person and browser session. */
  readonly teach = new TeachRecordings();
  constructor({ runtime }: { runtime: BrowserRuntime }) { this.runtime = runtime; }

  private current(viewer: Viewer): boolean {
    try { return !viewer.closed && !viewer.res.destroyed && !viewer.res.writableEnded && viewer.isCurrent(); } catch { return false; }
  }

  private send(viewer: Viewer, message: ObjectValue): void {
    if (!this.current(viewer)) { this.close(viewer); return; }
    if (!viewer.res.headersSent) return; // A peer can change control while this viewer is still starting.
    if (viewer.waiting && message.type !== "waiting" && message.type !== "error") return;
    if (viewer.res.writableLength > MAX_BUFFER) { this.close(viewer); return; }
    if (viewer.blocked) return;
    const { type, ...data } = message;
    let written: boolean;
    try { written = viewer.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { this.close(viewer); return; }
    if (!written) {
      viewer.blocked = true;
      viewer.drainTimer = setTimeout(() => this.close(viewer), HEARTBEAT_MS);
      viewer.drainTimer.unref();
      viewer.res.once("drain", () => {
        viewer.blocked = false; clearTimeout(viewer.drainTimer);
        this.control(viewer.session);
        const pending = viewer.pendingFrame; viewer.pendingFrame = undefined;
        if (pending) this.frame(viewer, pending);
      });
    }
  }

  private control(session: string): void {
    for (const viewer of this.viewers.values()) {
      if (viewer.session !== session) continue;
      const held = Boolean(this.runtime.heldBy(session));
      if (held && this.runtime.heldBy(session) !== viewer.id && viewer.frameSeq) {
        try { this.sendSocket(viewer, { type: "ack", seq: viewer.frameSeq }); } catch { this.close(viewer); continue; }
        viewer.frameSeq = undefined; viewer.frameAt = undefined;
      }
      if (held && this.runtime.heldBy(session) !== viewer.id && viewer.pendingFrame) {
        const pending = viewer.pendingFrame; viewer.pendingFrame = undefined;
        this.frame(viewer, pending);
      }
      this.send(viewer, { type: "control", held, owned: this.runtime.heldBy(session) === viewer.id, controlling: this.runtime.canControl(session, viewer.id) });
      if (!held && viewer.hiddenFrame) {
        const frame = viewer.hiddenFrame; viewer.hiddenFrame = undefined;
        this.frame(viewer, frame);
      }
    }
  }

  private frame(viewer: Viewer, frame: ObjectValue): void {
    if (!this.current(viewer)) { this.close(viewer); return; }
    const holder = this.runtime.heldBy(viewer.session);
    if (holder && holder !== viewer.id) {
      viewer.hiddenFrame = frame;
      try { this.sendSocket(viewer, { type: "ack", seq: frame.seq }); } catch { this.close(viewer); }
      return;
    }
    // ACKs can arrive before the SSE transport drains. Keep one newest frame
    // instead of dropping it and then waiting for an ACK the viewer cannot send.
    if (viewer.blocked) { viewer.pendingFrame = frame; return; }
    viewer.pendingFrame = undefined;
    viewer.frameSeq = frame.seq as number; viewer.frameAt = Date.now();
    this.send(viewer, frame);
  }

  private sendSocket(viewer: Viewer, message: ObjectValue): void {
    if (viewer.socket?.readyState !== WebSocket.OPEN || viewer.socket.bufferedAmount > 64 * 1024) {
      throw new BrowserLiveError("The browser connection closed. Reopen the browser panel.", 409);
    }
    viewer.socket.send(JSON.stringify(message));
  }

  private close(viewer: Viewer, endResponse = true): void {
    if (viewer.closed) return;
    viewer.closed = true;
    viewer.abort.abort();
    viewer.unwatch();
    this.viewers.delete(viewer.id);
    clearTimeout(viewer.heartbeat); clearTimeout(viewer.drainTimer);
    viewer.socket?.close();
    viewer.hiddenFrame = undefined; viewer.pendingFrame = undefined;
    // the person's last view of this browser: their recording waits a little
    // for a reconnect, then is dropped (a closed window keeps nothing)
    if (![...this.viewers.values()].some((other) => other.owner === viewer.owner && other.session === viewer.session)) {
      this.teach.orphan(viewer.owner, viewer.session, true);
    }
    if (!viewer.restarting) {
      this.abandonPressedInput(viewer);
      this.runtime.release(viewer.session, viewer.id);
    }
    if (endResponse && !viewer.res.writableEnded && !viewer.res.destroyed) {
      if (viewer.blocked || viewer.res.writableLength > MAX_BUFFER) viewer.res.destroy();
      else viewer.res.end();
    }
    this.control(viewer.session);
  }

  private abandonPressedInput(viewer: Viewer): void {
    // A disconnect may lose the matching key-up/mouse-up. Do not let an
    // agent inherit held input; an explicit restart is the recovery barrier.
    if (viewer.pressedKeys.size || viewer.pressedButtons.size) this.runtime.abandonHumanInput(viewer.session, viewer.id);
  }

  /** `person`: the person's own command (navigate, a tab), whose answered
   * failure is theirs to see and retry. The view's own setup keeps its
   * engine errors. */
  private async command(viewer: Viewer, args: string[], timeout = COMMAND_TIMEOUT_MS, person = false): Promise<ObjectValue> {
    if (!this.current(viewer)) throw new BrowserLiveError("This browser view is no longer available.", 409);
    const env = browserRuntimeEnv({ ...viewer.spec.env, AGENT_BROWSER_SESSION: viewer.session });
    try {
      const { stdout } = await execute(viewer.spec.command, [...args, "--json", "--no-webmcp"], {
        env, timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true,
        signal: viewer.abort.signal,
      });
      if (!this.current(viewer)) throw new Error("stale viewer");
      const result = object(JSON.parse(stdout));
      const data = object(result?.data);
      if (result?.success !== true || !data) {
        // Keep the engine's own error internal (logged, never sent) so a
        // launch failure is recognized for what it is below.
        const detail = [result?.error, result?.message].filter((part): part is string => typeof part === "string").join(" ");
        throw Object.assign(new Error(detail ? `browser command failed: ${detail}` : "browser command failed"), { stdout });
      }
      return data;
    } catch (error) {
      if (timedOut(error)) throw new BrowserBusyError();
      console.warn("browser-live:", error);
      if (browserLaunchFailure(error)) {
        // The daemon is alive but holding a launch configuration Chrome
        // cannot satisfy on this host (a headed launch with no display). It
        // fails every command the same way until the daemon is killed —
        // discard the session so the next connect starts a fresh one. One
        // tracked reset per session: a reconnect or repeated command joins
        // the in-flight teardown instead of spawning another (#1383).
        if (!this.sessionResets.has(viewer.session)) {
          const reset = closeBrowserSession(viewer.spec.command, env).then((closed) => {
            if (closed) console.warn(`browser-live: reset ${viewer.session} after a failed browser launch; reconnecting starts a fresh session`);
            else console.warn(`browser-live: reset of ${viewer.session} after a failed browser launch did not finish; the next command retries it`);
            return closed;
          }, () => false);
          this.sessionResets.set(viewer.session, reset);
          void reset.finally(() => { if (this.sessionResets.get(viewer.session) === reset) this.sessionResets.delete(viewer.session); });
        }
        throw new BrowserLiveError("The browser could not start on this server. Reconnect to retry with a fresh browser session.", 503);
      }
      if (person && engineAnsweredFailure(error)) throw new BrowserActionFailedError(args);
      throw new BrowserLiveError("The browser could not complete this action. Check that the browser engine is installed, then reconnect.", 503);
    }
  }

  /** Find (or start) the session's stream and make sure its browser runs. */
  private async connect(viewer: Viewer): Promise<number> {
    // A failed launch already started this session's daemon teardown; wait
    // for it so the status probe meets a fresh daemon, not the stuck one.
    // Checked on every attempt: a reset can start while the view waits. An
    // idle close in progress is waited out the same way.
    const resetting = this.sessionResets.get(viewer.session);
    if (resetting) await resetting;
    await this.runtime.settled(viewer.session);
    let status = await this.command(viewer, ["stream", "status"], STATUS_PROBE_MS);
    // A fill_credential write runs with the stream off (the stream sends
    // each command, script included): never turn it back on meanwhile.
    if (status.enabled !== true && typeof this.runtime.filling === "function" && this.runtime.filling(viewer.session)) throw new BrowserBusyError("The browser is typing a saved login. The live view comes back in a moment.");
    if (status.enabled !== true) {
      try { status = await this.command(viewer, ["stream", "enable"]); }
      catch (error) {
        if (error instanceof BrowserBusyError) throw error;
        status = await this.command(viewer, ["stream", "status"]); // Another view may have enabled the same session.
      }
    }
    const port = browserStreamPort(status);
    if (viewer.preview) {
      if (status.connected !== true) throw new BrowserOfflineError();
      return port;
    }
    // A browser that was already running, which the probe did not launch,
    // was sized when it launched: sizing it again only delays the view (one
    // more engine command, about a second, on every Take control).
    const alreadyRunning = status.connected === true && object(status.lifecycle)?.launched === false;
    // Only a browser that is not running yet is opened, so this never
    // navigates away from the bot's page: it launches on the start page.
    if (status.connected !== true) await this.command(viewer, ["open", BROWSER_START_URL]);
    // The status probe itself may have launched the browser. Give its page the
    // standard size, as the bot's runtime does, so the page, the frames and
    // the clicks share one geometry; at that size this changes nothing. Best
    // effort and brief: a failure or a busy session keeps the current size.
    if (!alreadyRunning && ownsBrowserViewport(viewer.spec.env ?? {})) {
      await this.command(viewer, [...BROWSER_VIEWPORT_ARGS], VIEWPORT_TIMEOUT_MS).catch(() => undefined);
    }
    return port;
  }

  /** While another command holds the session, keep the view open and waiting
   * instead of failing it: start the event stream, say so, and retry with a
   * bounded backoff until the browser answers, the viewer leaves, or the
   * limit passes. */
  private async connectWhenFree(viewer: Viewer): Promise<number> {
    const deadline = Date.now() + BUSY_LIMIT_MS;
    for (let attempt = 0; ; attempt++) {
      try { return await this.connect(viewer); }
      catch (error) {
        if (!(error instanceof BrowserBusyError) || !this.current(viewer)) throw error;
        if (Date.now() >= deadline) throw new BrowserBusyError("The bot is still using this browser. Reconnect when it has finished.");
      }
      viewer.waiting = true;
      this.startEvents(viewer);
      this.send(viewer, { type: "waiting", reason: "busy" });
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); viewer.abort.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, BUSY_RETRY_MS[Math.min(attempt, BUSY_RETRY_MS.length - 1)]);
        timer.unref?.();
        viewer.abort.signal.addEventListener("abort", done, { once: true });
      });
      if (!this.current(viewer)) throw new BrowserLiveError("This browser view is no longer available.", 409);
    }
  }

  private startEvents(viewer: Viewer): void {
    if (viewer.res.headersSent) return;
    viewer.res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
    viewer.res.flushHeaders();
  }

  private async input(viewer: Viewer, message: ObjectValue): Promise<void> {
    if (!viewer.port) throw new BrowserLiveError("The browser stream is not connected.", 409);
    let command: ObjectValue;
    const { type, eventType, ...fields } = message;
    const key = String(fields.code || fields.key);
    const shortcut = Number(fields.modifiers) > 0 && !["Alt", "Control", "Meta", "Shift"].includes(String(fields.key))
      && !(fields.modifiers === 8 && text(fields.key, 64) && [...fields.key].length === 1);
    // press already released the key. Match raw held keys, not the modifiers
    // on keyUp: they may have changed, or blur may flush releases with zero.
    if (type === "input_keyboard" && eventType === "keyUp" && !viewer.pressedKeys.has(key)) return;
    if (type === "input_mouse") command = { action: "input_mouse", type: eventType, ...fields };
    else if (eventType === "char") command = { action: "keyboard", subaction: "insertText", text: fields.text };
    else if (eventType === "keyDown" && (shortcut || DISCRETE_KEYS.has(String(fields.key)))) {
      // press resolves virtual key codes, required text and modifiers, and
      // acknowledges the complete key-down/up pair before hand-back.
      const modifiers = fields.modifiers as number;
      const chord = [[1, "Alt"], [2, "Control"], [4, "Meta"], [8, "Shift"]] as const;
      command = { action: "press", key: [...chord.filter(([bit]) => modifiers & bit).map(([, key]) => key), fields.key].join("+") };
    } else command = { action: "input_keyboard", type: eventType, key: fields.key,
      ...(fields.code === undefined ? {} : { code: fields.code }), ...(fields.text === undefined ? {} : { text: fields.text }) };
    if (command.action === "input_keyboard" && eventType === "keyDown") {
      if (viewer.pressedKeys.size >= 64 && !viewer.pressedKeys.has(key)) throw new BrowserLiveError("Too many keys are held. Restart the browser before continuing.", 409);
      viewer.pressedKeys.add(key);
    }
    if (type === "input_mouse" && eventType === "mousePressed") viewer.pressedButtons.add(String(fields.button));
    const origin = `http://127.0.0.1:${viewer.port}`;
    try {
      // The native command relay awaits the daemon's CDP reply. A WS send is
      // only an enqueue, so it cannot serve as the human hand-back barrier.
      const response = await fetch(`${origin}/api/command`, { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(command), signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("input rejected"); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) throw new Error("input response too large");
        chunks.push(chunk);
      }
      if (object(JSON.parse(Buffer.concat(chunks).toString("utf8")))?.success !== true) throw new Error("input failed");
      if (command.action === "press" || (command.action === "input_keyboard" && eventType === "keyUp")) viewer.pressedKeys.delete(key);
      if (type === "input_mouse" && eventType === "mouseReleased") viewer.pressedButtons.delete(String(fields.button));
    } catch { throw new BrowserLiveError("The browser could not confirm this input. Restart the browser before continuing.", 503); }
  }

  async open(options: OpenOptions): Promise<void> {
    if (this.viewers.size >= 8 || [...this.viewers.values()].filter((v) => v.session === options.session).length >= 2) {
      throw new BrowserLiveError("Too many browser views are open. Close another browser panel first.", 429);
    }
    const viewer: Viewer = { ...options, id: randomUUID(), closed: false, blocked: false, pendingActions: 0, restarting: false, pressedKeys: new Set(), pressedButtons: new Set(), waiting: false, abort: new AbortController(), unwatch: () => {} };
    if (!this.current(viewer)) throw new BrowserLiveError("This browser view is no longer available.", 409);
    viewer.unwatch = this.runtime.watch(viewer.session, viewer.spec);
    this.viewers.set(viewer.id, viewer);
    this.teach.orphan(viewer.owner, viewer.session, false);
    options.res.once("close", () => this.close(viewer));
    options.res.once("error", () => this.close(viewer));
    try {
      const port = await this.connectWhenFree(viewer);
      // Best-effort steps of the startup swallow their own failures, an abort
      // by close() included; a viewer closed meanwhile gets no socket.
      if (!this.current(viewer)) throw new BrowserLiveError("This browser view is no longer available.", 409);
      viewer.port = port;
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=${viewer.preview ? PREVIEW_FPS : 15}`);
      viewer.socket = socket;
      this.startEvents(viewer);
      viewer.waiting = false;
      this.send(viewer, { type: "ready", viewerId: viewer.id });
      this.control(viewer.session);
      socket.addEventListener("message", (event) => {
        if (!this.current(viewer)) { this.close(viewer); return; }
        if (typeof event.data !== "string" || event.data.length > MAX_BUFFER) { this.close(viewer); return; }
        let message: ObjectValue | null;
        let raw: ObjectValue | null;
        try { raw = object(JSON.parse(event.data)); message = normalizeBrowserLiveMessage(raw); } catch { this.close(viewer); return; }
        if (!message) { if (raw?.type === "frame") this.close(viewer); return; }
        const heldBy = this.runtime.heldBy(viewer.session);
        if (heldBy && heldBy !== viewer.id && ["tabs", "url"].includes(String(message.type))) return;
        if (message.type === "frame") this.frame(viewer, message);
        else {
          if (message.type === "url" && typeof message.url === "string") this.teach.get(viewer.owner, viewer.session)?.observeUrl(message.url);
          this.send(viewer, message);
        }
      });
      socket.addEventListener("error", () => { if (!viewer.restarting) { this.send(viewer, { type: "error", retryable: true, message: "The browser stream disconnected." }); this.close(viewer); } });
      socket.addEventListener("close", () => { if (!viewer.restarting) this.close(viewer); });
      // Install stream handlers before awaiting the upgrade: upstream can send
      // its cached status, tabs and opening frame immediately after opening.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new BrowserLiveError("The browser stream did not connect. Reopen the browser panel.", 503)), 10_000);
        const failed = () => { clearTimeout(timer); reject(new BrowserLiveError("The browser stream did not connect. Reopen the browser panel.", 503)); };
        socket.addEventListener("error", failed, { once: true });
        socket.addEventListener("close", failed, { once: true });
        socket.addEventListener("open", () => { clearTimeout(timer); socket.removeEventListener("error", failed); socket.removeEventListener("close", failed); resolve(); }, { once: true });
      });
      if (!this.current(viewer)) { this.close(viewer); return; }
      viewer.heartbeat = setInterval(() => {
        if (!this.current(viewer) || (viewer.frameAt && Date.now() - viewer.frameAt > 2 * HEARTBEAT_MS)) { this.close(viewer); return; }
        this.control(viewer.session);
        this.send(viewer, { type: "heartbeat" });
      }, HEARTBEAT_MS);
      viewer.heartbeat.unref();
    } catch (error) {
      if (error instanceof BrowserOfflineError) {
        // An expected answer, not a failure: say it on the stream and end it.
        this.startEvents(viewer);
        viewer.waiting = false;
        this.send(viewer, { type: "offline" });
        this.close(viewer); return;
      }
      console.warn("browser-live:", error);
      if (options.res.headersSent) {
        // A view that waited out a busy browser gets the reason, and no
        // automatic retry loop on top of the wait it already did.
        const busy = error instanceof BrowserBusyError;
        this.send(viewer, { type: "error", retryable: !busy, message: busy ? error.message : "The browser stream could not start." });
        this.close(viewer); return;
      }
      this.close(viewer, options.res.headersSent);
      throw error instanceof BrowserLiveError ? error : new BrowserLiveError("The browser stream could not start. Reopen the browser panel.", 503);
    }
  }

  async action({ viewerId, botId, owner, body }: { viewerId: string; botId: string; owner: string; body: unknown }): Promise<unknown> {
    const viewer = this.viewers.get(viewerId);
    if (!viewer || viewer.botId !== botId || viewer.owner !== owner || !this.current(viewer)) {
      if (viewer && viewer.botId === botId && viewer.owner === owner) this.close(viewer);
      throw new BrowserLiveError("This browser view is no longer available. Reopen the browser panel.", 404);
    }
    const action = parseBrowserLiveAction(body);
    // A preview only watches: it acknowledges frames and nothing else.
    if (viewer.preview && action.type !== "ack") throw new BrowserLiveError("This browser preview is view-only. Take control to use the browser.", 403);
    if (action.type === "restart") {
      if (viewer.restarting) throw new BrowserLiveError("The browser is already restarting.", 409);
      viewer.restarting = true;
      try {
        const restarting = this.runtime.restart(viewer.session, viewer.id, async () => {
          if (!this.current(viewer)) throw new Error("stale viewer");
          const env = browserRuntimeEnv({ ...viewer.spec.env, AGENT_BROWSER_SESSION: viewer.session });
          if (!await closeBrowserSession(viewer.spec.command, env)) throw new Error("browser close failed");
        });
        this.control(viewer.session);
        await restarting;
        this.closeForSession(viewer.session);
        return { ok: true };
      } catch { throw new BrowserLiveError("The browser could not restart. Wait for active work to finish and try again.", 409); }
      finally { viewer.restarting = false; if (viewer.closed) this.runtime.release(viewer.session, viewer.id); this.control(viewer.session); }
    }
    if (action.type === "ack") {
      if (viewer.frameSeq === action.seq) {
        this.sendSocket(viewer, { type: "ack", seq: action.seq });
        viewer.frameSeq = undefined; viewer.frameAt = undefined;
      }
      return { ok: true };
    }
    if (action.type === "record-start") {
      this.teach.start(viewer.owner, viewer.session);
      return { ok: true, recording: true };
    }
    if (action.type === "record-stop") {
      // The steps go to this person once; the recording is gone afterwards.
      const steps = this.teach.stop(viewer.owner, viewer.session);
      return { ok: true, steps: steps ?? [], expired: steps === null };
    }
    if (action.type === "record-discard") {
      this.teach.discard(viewer.owner, viewer.session);
      return { ok: true };
    }
    if (action.type === "release") {
      this.abandonPressedInput(viewer);
      this.runtime.release(viewer.session, viewer.id); this.control(viewer.session);
      return { ok: true };
    }
    if (action.type === "take") {
      try {
        const taking = this.runtime.take(viewer.session, viewer.id);
        this.control(viewer.session);
        // waited: the bot's own action finished first, so input the person
        // aimed at the page before the grant may no longer fit it.
        const waited = await taking;
        if (!this.current(viewer)) { this.close(viewer); throw new BrowserLiveError("This browser view closed.", 409); }
        return { ok: true, waited: waited === true };
      } catch { throw this.refusal(viewer, "Another browser view or bot action is using this browser. Try again shortly."); }
      finally { this.control(viewer.session); }
    }
    if (!this.runtime.canControl(viewer.session, viewer.id)) throw this.refusal(viewer, "Browser control changed. Try again.");
    if (viewer.pendingActions >= 32) throw new BrowserLiveError("Too many browser actions are pending. Try again shortly.", 429);
    viewer.pendingActions += 1;
    try {
      await this.runtime.withHumanAction(viewer.session, viewer.id, async () => {
        if (!this.current(viewer)) throw new BrowserLiveError("This browser view closed.", 409);
        const recorder = this.teach.get(viewer.owner, viewer.session);
        if (recorder && action.type === "input") await this.recordInput(viewer, recorder, action.message);
        if (action.type === "input") await this.input(viewer, action.message);
        else if (action.type === "command") {
          await this.command(viewer, action.args, COMMAND_TIMEOUT_MS, true);
          if (recorder) recordCommand(recorder, action.args);
        }
      });
      return { ok: true };
    } catch (error) { throw error instanceof BrowserLiveError ? error : this.refusal(viewer, "Browser control changed. Try again."); }
    finally { viewer.pendingActions -= 1; this.control(viewer.session); }
  }

  /** What the page says about the element under a point, or the focused one,
   * for the recording. Null when the page could not be asked. */
  private async describe(viewer: Viewer, point?: { x: number; y: number }) {
    try {
      const data = await this.command(viewer, ["eval", teachDescribeScript(point)], DESCRIBE_TIMEOUT_MS);
      return parseDescribedElement(data.result);
    } catch { return null; }
  }

  /** Records the person's input before it reaches the page: a click is
   * described where it lands, typed text goes to the focused field's step
   * (never kept in a secret field), and Enter, Tab and Escape are steps. */
  private async recordInput(viewer: Viewer, recorder: TeachRecorder, message: ObjectValue): Promise<void> {
    if (message.type === "input_mouse") {
      if (message.eventType === "mousePressed" && message.button === "left" && Number(message.clickCount) <= 1) {
        recorder.click(await this.describe(viewer, { x: Number(message.x), y: Number(message.y) }));
      }
      return;
    }
    if (message.type !== "input_keyboard") return;
    const text = message.eventType === "char" ? message.text
      : message.eventType === "keyDown" && !(Number(message.modifiers) & 7) ? message.text : undefined;
    if (typeof text === "string" && text) {
      if (!recorder.typingOpen) recorder.beginTyping(await this.describe(viewer));
      recorder.type(text);
      return;
    }
    if (message.eventType !== "keyDown" || Number(message.modifiers) & 7) return;
    if (message.key === "Backspace") recorder.backspace();
    else if (message.key === "Enter" || message.key === "Tab" || message.key === "Escape") recorder.press(String(message.key));
  }

  /** Why this viewer cannot act now: an interrupted browser needs a restart. */
  private refusal(viewer: Viewer, otherwise: string): BrowserLiveError {
    return new BrowserLiveError(this.runtime.interrupted(viewer.session) ? RESTART_NEEDED : otherwise, 409);
  }

  /** Done on a sign-in card, from any window or device: whichever view holds
   * this browser hands it back, exactly as its own Hand back would. */
  handBack(session: string): void {
    const holder = this.runtime.heldBy(session);
    const viewer = holder ? this.viewers.get(holder) : undefined;
    if (!viewer || viewer.session !== session) return;
    this.abandonPressedInput(viewer);
    this.runtime.release(session, viewer.id);
    this.control(session);
  }

  closeForSession(session: string): void { for (const viewer of this.viewers.values()) if (viewer.session === session) this.close(viewer); }
  closeForOwner(owner: string): void {
    this.teach.discardOwner(owner);
    for (const viewer of this.viewers.values()) if (viewer.owner === owner) this.close(viewer);
  }
  closeForBot(botId: string): void { for (const viewer of this.viewers.values()) if (viewer.botId === botId) this.close(viewer); }
  closeAll(): void { for (const viewer of this.viewers.values()) this.close(viewer); }
}

/** A toolbar command as a recorded step. Selecting or closing a tab is not one. */
function recordCommand(recorder: TeachRecorder, args: readonly string[]): void {
  if (args[0] === "open") recorder.command("open", args[1]);
  else if (args[0] === "back" || args[0] === "forward" || args[0] === "reload") recorder.command(args[0]);
  else if (args[0] === "tab" && args[1] === "new") recorder.command("tab", args[2] === BROWSER_START_URL ? undefined : args[2]);
}
