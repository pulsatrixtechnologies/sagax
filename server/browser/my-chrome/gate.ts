// My Chrome gate: the only way a bot's engine reaches the person's own Chrome.
// Port of OpenMausBot #2706 (My Chrome) with the CDP layer of #2928 reduced to
// what Sagax needs, under JC's rules (2026-10-19).
//
// agent-browser connects here as if this were Chrome (AGENT_BROWSER_CDP, a
// loopback ws:// address with a random path per bot session). The gate holds
// one DevTools connection to the person's Chrome and passes on what driving a
// tab needs, nothing else (cdp-policy.ts):
//
// - The engine sees and reaches only the tabs it opened through the gate (and
//   popups those tabs opened). The person's other tabs, windows, contexts and
//   the browser itself stay invisible and unreachable.
// - Every tab the bot opened carries a guard session of the gate's own:
//   Fetch interception of documents refuses any top-level navigation outside
//   the allowed sites (a link, a redirect, a form, a script), and a banner in
//   the page says a bot drives it, with a Stop button that ends everything.
// - Frames and workers of another site inside an allowed page are detached
//   from the engine: it cannot run script in them or read their cookies.
// - No cookie call, no storage of any origin, no request or response headers,
//   no bodies, no downloads, no file upload, no browser-wide call.
// - stop() terminates every engine connection at once, then takes the guards
//   and banners out and closes the connection to Chrome. Until resume(),
//   nothing connects.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { cdpMethodVerdict, maybeSameSite, sanitizeNetworkEvent, sessionEventAllowed } from "./cdp-policy.ts";
import { isBlankPage } from "./sites.ts";

export const PILOT_WORLD = "sagax-pilot";
export const PILOT_STOP_BINDING = "__sagaxPilotStop";
export const PILOT_BANNER_ID = "sagax-pilot-banner";
const GATE_TIMEOUT_MS = 15_000;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

type Json = Record<string, unknown>;
interface CdpMessage { id?: number; method?: string; params?: Json; sessionId?: string; result?: Json; error?: { message?: string; code?: number } }

interface Client {
  id: number;
  label: string;
  ws: WebSocket;
  discover: boolean;
}

interface Tab {
  targetId: string;
  client: Client;
  url: string;
  title: string;
  /** The gate's own session on the tab (Fetch guard, banner, Stop). */
  guard?: string;
  scriptId?: string;
  /** The last navigation the guard refused: its error page is not off site. */
  blockedUrl?: string;
  /** A popup whose guard is not on yet. */
  pendingGuard?: boolean;
}

interface Session {
  id: string;
  client: Client;
  tab: Tab;
  /** A frame or worker inside the tab, not the tab itself. */
  child: boolean;
  targetId: string;
}

type Pending =
  | { kind: "gate"; resolve: (result: Json) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  | { kind: "client"; client: Client; clientId: number; method: string; params: Json; sessionId?: string };

export interface MyChromeGateOptions {
  /** The ws:// browser address of the person's Chrome. */
  resolveChrome(): Promise<string>;
  /** Whether bots may be on this page now. Read on every check, so revoking a
   * site closes it at once. */
  allows(url: string): boolean;
  /** A tab, a connection or the stop state changed. */
  onChange?(): void;
  /** The person pressed Stop in a tab's banner. */
  onStopFromTab?(): void;
  /** Tests: open the connection to Chrome. */
  connect?(url: string): WebSocket;
}

export interface MyChromeGateStatus {
  stopped: boolean;
  /** Connected to the person's Chrome. */
  connected: boolean;
  /** Epoch ms of the last action an engine sent (input or navigation). */
  lastActionAt: number;
  clients: Array<{ label: string; tabs: Array<{ url: string; title: string }> }>;
}

class GateRefusal extends Error {}

/** The banner, in an isolated world the page's own scripts cannot reach. Its
 * Stop button calls a binding that exists only in that world, and only a
 * person's real click (isTrusted) counts. Hidden from the accessibility tree,
 * so the bot's snapshot never lists it. */
export function pilotBannerScript(): string {
  return `(() => {
  if (window.__sagaxPilotBanner) return;
  window.__sagaxPilotBanner = true;
  const fr = String(navigator.language || "").toLowerCase().startsWith("fr");
  const text = fr ? "Un bot Sagax pilote cet onglet" : "A Sagax bot is driving this tab";
  const stop = fr ? "Arrêter" : "Stop";
  const mount = () => {
    const root = document.documentElement;
    if (!root) { setTimeout(mount, 30); return; }
    if (document.getElementById(${JSON.stringify(PILOT_BANNER_ID)})) return;
    const host = document.createElement("sagax-pilot");
    host.id = ${JSON.stringify(PILOT_BANNER_ID)};
    host.setAttribute("aria-hidden", "true");
    const hostStyle = "all:initial !important;position:fixed !important;z-index:2147483647 !important;right:12px !important;bottom:12px !important;display:block !important;visibility:visible !important;opacity:1 !important;transform:none !important;clip-path:none !important;pointer-events:auto !important;";
    host.style.cssText = hostStyle;
    const hostStyleSet = host.getAttribute("style");
    const shadow = host.attachShadow({ mode: "closed" });
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;font:13px/18px -apple-system,system-ui,sans-serif;background:#1f2937;color:#fff;padding:6px 8px 6px 12px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.35);";
    const label = document.createElement("span");
    label.textContent = text;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = stop;
    button.style.cssText = "font:inherit;font-weight:600;background:#dc2626;color:#fff;border:0;border-radius:999px;padding:2px 12px;cursor:pointer;";
    button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      try { ${PILOT_STOP_BINDING}("stop"); } catch {}
    });
    bar.append(label, button);
    shadow.append(bar);
    root.appendChild(host);
    const observer = new MutationObserver(() => {
      if (host.hasAttribute("data-sagax-gone")) { observer.disconnect(); return; }
      if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
    });
    observer.observe(root, { childList: true });
    // A page that hides or restyles the banner (its own stylesheet, the
    // host's attributes) gets it put back at once.
    const restore = new MutationObserver(() => {
      if (host.hasAttribute("data-sagax-gone")) { restore.disconnect(); return; }
      if (host.getAttribute("style") !== hostStyleSet) host.style.cssText = hostStyle;
      if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
      if (host.hasAttribute("class")) host.removeAttribute("class");
    });
    restore.observe(host, { attributes: true });
  };
  mount();
})();`;
}

export class MyChromeGate {
  private readonly options: MyChromeGateOptions;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  private readonly tokens = new Map<string, string>(); // path token -> label
  private chrome: WebSocket | null = null;
  private chromeReady: Promise<WebSocket> | null = null;
  private readonly clients = new Set<Client>();
  private readonly tabs = new Map<string, Tab>();
  private readonly sessions = new Map<string, Session>();
  private readonly guards = new Map<string, Tab>(); // guard session -> tab
  private readonly pending = new Map<number, Pending>();
  /** targetId -> who asked to attach, for the attachedToTarget event that
   * Chrome sends before its answer. */
  private readonly attaching = new Map<string, Client | "gate">();
  private readonly notes = new Map<string, string[]>();
  private nextId = 1;
  private nextClient = 1;
  private stoppedFlag = false;
  private lastActionAt = 0;

  constructor(options: MyChromeGateOptions) {
    this.options = options;
  }

  get stopped(): boolean { return this.stoppedFlag; }

  /** Listen on loopback (once). */
  async start(): Promise<void> {
    if (this.server) return;
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
    const server = createServer((_req, res) => { res.statusCode = 404; res.end(); });
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const label = this.labelFor(req.url ?? "");
      if (label === null || this.stoppedFlag) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, label));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    server.unref();
    this.server = server;
    this.wss = wss;
    this.port = (server.address() as { port: number }).port;
  }

  /** The address one engine session connects to. The random path is the
   * only way in. */
  urlFor(label: string): string {
    if (!this.server) throw new Error("My Chrome gate is not listening.");
    for (const [token, existing] of this.tokens) if (existing === label) return `ws://127.0.0.1:${this.port}/devtools/browser/${token}`;
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, label);
    return `ws://127.0.0.1:${this.port}/devtools/browser/${token}`;
  }

  private labelFor(path: string): string | null {
    const match = /^\/devtools\/browser\/([0-9a-f]{48})$/.exec(path.split("?")[0] ?? "");
    return match ? this.tokens.get(match[1]!) ?? null : null;
  }

  status(): MyChromeGateStatus {
    const clients = [...this.clients].map((client) => ({
      label: client.label,
      tabs: [...this.tabs.values()].filter((tab) => tab.client === client).map((tab) => ({ url: tab.url, title: tab.title })),
    }));
    return { stopped: this.stoppedFlag, connected: this.chrome?.readyState === WebSocket.OPEN, lastActionAt: this.lastActionAt, clients };
  }

  /** What the gate refused for this engine session since the last call. */
  takeNotes(label: string): string[] {
    const notes = this.notes.get(label) ?? [];
    this.notes.delete(label);
    return notes;
  }

  private note(client: Client, text: string): void {
    const list = this.notes.get(client.label) ?? [];
    if (list.length < 20) list.push(text);
    this.notes.set(client.label, list);
  }

  /** Stop: every engine connection ends now; then the guards and banners come
   * out and the connection to Chrome closes. Nothing connects until resume(). */
  async stop(): Promise<void> {
    this.stoppedFlag = true;
    // Every address handed out dies with Stop: a copy left in an engine's
    // environment cannot reconnect after a resume.
    this.tokens.clear();
    const clients = [...this.clients];
    this.clients.clear();
    for (const client of clients) {
      try { client.ws.terminate(); } catch { /* already gone */ }
    }
    this.options.onChange?.();
    await this.releaseAll(clients);
    this.closeChrome();
    this.options.onChange?.();
  }

  resume(): void {
    this.stoppedFlag = false;
    this.options.onChange?.();
  }

  /** Close the listener and Chrome connection (server shutdown). */
  async close(): Promise<void> {
    await this.stop();
    this.wss?.close();
    await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    this.server = null;
    this.wss = null;
  }

  // ── engine connections ──

  private accept(ws: WebSocket, label: string): void {
    const client: Client = { id: this.nextClient++, label, ws, discover: false };
    // One engine connection per session at a time: a newer one replaces it.
    for (const existing of this.clients) {
      if (existing.label === label) this.dropClient(existing);
    }
    this.clients.add(client);
    ws.on("message", (data: RawData) => { void this.fromClient(client, data); });
    ws.on("close", () => this.dropClient(client));
    ws.on("error", () => this.dropClient(client));
    this.options.onChange?.();
  }

  private dropClient(client: Client): void {
    if (!this.clients.delete(client)) return;
    try { client.ws.terminate(); } catch { /* gone */ }
    void this.releaseAll([client]);
    this.options.onChange?.();
  }

  /** Detach a client's sessions and take its tabs' guards out. Its tabs stay
   * open in the person's Chrome as ordinary tabs. */
  private async releaseAll(clients: Client[]): Promise<void> {
    const set = new Set(clients);
    for (const [id, session] of this.sessions) {
      if (!set.has(session.client)) continue;
      this.sessions.delete(id);
      if (!session.child) this.gateSend("Target.detachFromTarget", { sessionId: id }).catch(() => undefined);
    }
    const work: Promise<unknown>[] = [];
    for (const tab of this.tabs.values()) {
      if (!set.has(tab.client)) continue;
      this.tabs.delete(tab.targetId);
      work.push(this.unguard(tab));
    }
    await Promise.allSettled(work);
  }

  private reply(client: Client, id: number, body: { result?: Json; error?: { code: number; message: string } }, sessionId?: string): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    client.ws.send(JSON.stringify({ id, ...body, ...(sessionId ? { sessionId } : {}) }));
  }

  private refuse(client: Client, message: CdpMessage, reason: string): void {
    if (typeof message.id === "number") this.reply(client, message.id, { error: { code: -32000, message: reason } }, message.sessionId);
  }

  private async fromClient(client: Client, data: RawData): Promise<void> {
    let message: CdpMessage;
    try { message = JSON.parse(String(data)) as CdpMessage; }
    catch { this.dropClient(client); return; }
    if (typeof message.id !== "number" || typeof message.method !== "string") return;
    if (this.stoppedFlag || !this.clients.has(client)) { this.refuse(client, message, "The person stopped My Chrome."); return; }
    const params: Json = message.params && typeof message.params === "object" ? { ...message.params } : {};
    try {
      if (message.sessionId) await this.sessionCommand(client, message, params);
      else await this.browserCommand(client, message, params);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Sagax refused this call in My Chrome.";
      this.refuse(client, message, reason);
    }
  }

  private async browserCommand(client: Client, message: CdpMessage, params: Json): Promise<void> {
    const method = message.method!;
    const verdict = cdpMethodVerdict(method, false);
    if (!verdict.allow) throw new GateRefusal(verdict.reason);
    const owned = (targetId: unknown): Tab => {
      const tab = typeof targetId === "string" ? this.tabs.get(targetId) : undefined;
      if (!tab || tab.client !== client) throw new GateRefusal("That tab is not one this bot opened in My Chrome.");
      return tab;
    };
    switch (method) {
      case "Target.setDiscoverTargets": {
        client.discover = params.discover === true;
        this.reply(client, message.id!, { result: {} });
        if (client.discover) {
          for (const tab of this.tabs.values()) {
            if (tab.client === client) this.toClient(client, { method: "Target.targetCreated", params: { targetInfo: this.targetInfo(tab) } });
          }
        }
        return;
      }
      case "Target.getTargets":
      case "Browser.getVersion":
      case "Schema.getDomains":
        return this.forward(client, message, {});
      case "Target.getTargetInfo":
        owned(params.targetId);
        return this.forward(client, message, { targetId: params.targetId });
      case "Target.attachToTarget":
        owned(params.targetId);
        if (params.flatten === false) throw new GateRefusal("My Chrome attaches in flat mode only.");
        this.attaching.set(params.targetId as string, client);
        return this.forward(client, message, { targetId: params.targetId, flatten: true });
      case "Target.detachFromTarget": {
        const session = typeof params.sessionId === "string" ? this.sessions.get(params.sessionId) : undefined;
        if (!session || session.client !== client) throw new GateRefusal("That session is not this bot's.");
        return this.forward(client, message, { sessionId: params.sessionId });
      }
      case "Target.closeTarget":
      case "Target.activateTarget":
        owned(params.targetId);
        return this.forward(client, message, { targetId: params.targetId });
      case "Target.createTarget":
        return this.createTarget(client, message, params);
      default:
        throw new GateRefusal(`Sagax refuses ${method} in My Chrome.`);
    }
  }

  /** A new tab: always blank first, guarded, then sent to the page asked for.
   * Never a hidden tab, another browser context or a new window of its own. */
  private async createTarget(client: Client, message: CdpMessage, params: Json): Promise<void> {
    const url = typeof params.url === "string" ? params.url : "about:blank";
    if (!isBlankPage(url) && !this.options.allows(url)) throw new GateRefusal(this.offSiteText(url));
    const created = await this.gateSend("Target.createTarget", {
      url: "about:blank",
      ...(params.background === true ? { background: true } : {}),
    });
    const targetId = String(created.targetId ?? "");
    if (!targetId) throw new GateRefusal("Chrome did not open the tab.");
    const tab: Tab = { targetId, client, url: "about:blank", title: "" };
    this.tabs.set(targetId, tab);
    try {
      await this.guard(tab);
    } catch (error) {
      this.tabs.delete(targetId);
      await this.gateSend("Target.closeTarget", { targetId }).catch(() => undefined);
      throw new GateRefusal(`Sagax could not guard the new tab: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.clients.has(client)) return;
    if (client.discover) this.toClient(client, { method: "Target.targetCreated", params: { targetInfo: this.targetInfo(tab) } });
    if (!isBlankPage(url)) await this.gateSend("Page.navigate", { url }, tab.guard).catch(() => undefined);
    this.lastActionAt = Date.now();
    this.options.onChange?.();
    this.reply(client, message.id!, { result: { targetId } });
  }

  private async sessionCommand(client: Client, message: CdpMessage, params: Json): Promise<void> {
    const method = message.method!;
    const session = this.sessions.get(message.sessionId!);
    if (!session || session.client !== client) throw new GateRefusal("That session is not this bot's.");
    const verdict = cdpMethodVerdict(method, true, params);
    if (!verdict.allow) throw new GateRefusal(verdict.reason);
    if (!this.onSite(session.tab)) {
      if (method !== "Page.navigate" && method !== "Page.navigateToHistoryEntry" && method !== "Page.getNavigationHistory" && method !== "Page.stopLoading") {
        throw new GateRefusal(`This tab is on ${session.tab.url}, which is not one of the sites allowed in My Chrome. Open an allowed site in it again.`);
      }
    }
    if (method === "Page.navigate") {
      const url = typeof params.url === "string" ? params.url : "";
      if (!isBlankPage(url) && !this.options.allows(url)) {
        this.note(client, this.offSiteText(url));
        throw new GateRefusal(this.offSiteText(url));
      }
    }
    if (method === "Page.navigateToHistoryEntry") {
      // Back and forward can restore a page without a request the guard sees
      // (the back/forward cache): check where the entry leads before going.
      // An entry that cannot be read is refused.
      const entry = await this.historyEntry(session.tab, params.entryId);
      if (entry === null) throw new GateRefusal("Sagax could not check where that history entry leads, so it did not go there.");
      if (!isBlankPage(entry) && !this.options.allows(entry)) {
        this.note(client, this.offSiteText(entry));
        throw new GateRefusal(this.offSiteText(entry));
      }
    }
    if (method === "Target.setAutoAttach") params.flatten = true;
    if (method.startsWith("Input.") || method.startsWith("Page.navigate") || method === "Page.reload") {
      this.lastActionAt = Date.now();
      this.options.onChange?.();
    }
    return this.forward(client, message, params);
  }

  /** The address a history entry of the tab leads to, or null when unreadable. */
  private async historyEntry(tab: Tab, entryId: unknown): Promise<string | null> {
    if (!tab.guard) return null;
    try {
      const history = await this.gateSend("Page.getNavigationHistory", {}, tab.guard);
      const entries = Array.isArray(history.entries) ? history.entries as Array<{ id?: unknown; url?: unknown }> : [];
      const found = entries.find((entry) => entry.id === entryId);
      return found && typeof found.url === "string" ? found.url : null;
    } catch {
      return null;
    }
  }

  private onSite(tab: Tab): boolean {
    return isBlankPage(tab.url) || tab.url === tab.blockedUrl || tab.url.startsWith("chrome-error://") || this.options.allows(tab.url);
  }

  private offSiteText(url: string): string {
    let shown = url;
    try { shown = new URL(url).origin; } catch { /* keep */ }
    return `Sagax blocked ${shown}: it is not one of the sites the person allowed in My Chrome. Ask them to allow it in Settings, or stay on the allowed sites.`;
  }

  private async forward(client: Client, message: CdpMessage, params: Json): Promise<void> {
    const chrome = await this.chromeSocket();
    const id = this.nextId++;
    this.pending.set(id, { kind: "client", client, clientId: message.id!, method: message.method!, params, ...(message.sessionId ? { sessionId: message.sessionId } : {}) });
    chrome.send(JSON.stringify({ id, method: message.method, params, ...(message.sessionId ? { sessionId: message.sessionId } : {}) }));
  }

  private toClient(client: Client, message: CdpMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
  }

  private targetInfo(tab: Tab): Json {
    return { targetId: tab.targetId, type: "page", title: tab.title, url: tab.url, attached: false, canAccessOpener: false, browserContextId: "" };
  }

  // ── the connection to Chrome ──

  private chromeSocket(): Promise<WebSocket> {
    if (this.chrome?.readyState === WebSocket.OPEN) return Promise.resolve(this.chrome);
    if (this.chromeReady) return this.chromeReady;
    this.chromeReady = (async () => {
      const url = await this.options.resolveChrome();
      const ws = this.options.connect ? this.options.connect(url) : new WebSocket(url, { perMessageDeflate: false, maxPayload: MAX_MESSAGE_BYTES });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { ws.terminate(); reject(new Error("Chrome did not answer. Is remote debugging on?")); }, GATE_TIMEOUT_MS);
        ws.once("open", () => { clearTimeout(timer); resolve(); });
        ws.once("error", (error) => { clearTimeout(timer); reject(new Error(`Could not reach Chrome: ${error.message}`)); });
      });
      if (this.stoppedFlag) { ws.terminate(); throw new Error("The person stopped My Chrome."); }
      this.chrome = ws;
      ws.on("message", (data: RawData) => this.fromChrome(data));
      ws.on("close", () => this.chromeClosed(ws));
      ws.on("error", () => this.chromeClosed(ws));
      await this.gateSend("Target.setDiscoverTargets", { discover: true });
      return ws;
    })();
    this.chromeReady.then(() => { this.chromeReady = null; }, () => { this.chromeReady = null; });
    return this.chromeReady;
  }

  private chromeClosed(ws: WebSocket): void {
    if (this.chrome !== ws) return;
    this.chrome = null;
    for (const [id, pending] of this.pending) {
      if (pending.kind === "gate") { clearTimeout(pending.timer); pending.reject(new Error("Chrome closed the connection.")); }
      else this.reply(pending.client, pending.clientId, { error: { code: -32000, message: "Chrome closed the connection." } }, pending.sessionId);
      this.pending.delete(id);
    }
    const clients = [...this.clients];
    this.clients.clear();
    for (const client of clients) { try { client.ws.terminate(); } catch { /* gone */ } }
    this.tabs.clear();
    this.sessions.clear();
    this.guards.clear();
    this.attaching.clear();
    this.options.onChange?.();
  }

  private closeChrome(): void {
    const ws = this.chrome;
    if (!ws) return;
    this.chromeClosed(ws);
    try { ws.close(); } catch { /* gone */ }
  }

  private gateSend(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const chrome = this.chrome;
    if (!chrome || chrome.readyState !== WebSocket.OPEN) {
      if (method === "Target.setDiscoverTargets") return Promise.reject(new Error("Chrome is not connected."));
      return this.chromeSocket().then(() => this.gateSend(method, params, sessionId));
    }
    const id = this.nextId++;
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} did not answer.`)); }, GATE_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { kind: "gate", resolve, reject, timer });
      chrome.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private fromChrome(data: RawData): void {
    let message: CdpMessage;
    try { message = JSON.parse(String(data)) as CdpMessage; } catch { return; }
    if (typeof message.id === "number") { this.answer(message); return; }
    if (typeof message.method !== "string") return;
    const params = (message.params ?? {}) as Json;
    if (message.sessionId) {
      const guarded = this.guards.get(message.sessionId);
      if (guarded) { this.guardEvent(guarded, message.method, params); return; }
      const session = this.sessions.get(message.sessionId);
      if (!session) return;
      this.sessionEvent(session, message.method, params);
      return;
    }
    this.browserEvent(message.method, params);
  }

  private answer(message: CdpMessage): void {
    const pending = this.pending.get(message.id!);
    if (!pending) return;
    this.pending.delete(message.id!);
    if (pending.kind === "gate") {
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "Chrome refused."));
      else pending.resolve(message.result ?? {});
      return;
    }
    const { client } = pending;
    if (!this.clients.has(client)) return;
    if (message.error) {
      this.reply(client, pending.clientId, { error: { code: message.error.code ?? -32000, message: message.error.message ?? "Chrome refused." } }, pending.sessionId);
      return;
    }
    let result = message.result ?? {};
    if (pending.method === "Target.getTargets") {
      const infos = Array.isArray(result.targetInfos) ? result.targetInfos as Json[] : [];
      result = { targetInfos: infos.filter((info) => {
        const tab = this.tabs.get(String(info.targetId));
        return tab?.client === client;
      }) };
    }
    if (pending.method === "Target.attachToTarget" && typeof result.sessionId === "string") {
      this.attaching.delete(String(pending.params.targetId));
      this.adoptSession(client, String(result.sessionId), String(pending.params.targetId));
    }
    if (pending.method === "Target.detachFromTarget" && typeof pending.params.sessionId === "string") {
      this.sessions.delete(pending.params.sessionId);
    }
    this.reply(client, pending.clientId, { result }, pending.sessionId);
  }

  private adoptSession(client: Client, sessionId: string, targetId: string): void {
    const tab = this.tabs.get(targetId);
    if (!tab || tab.client !== client || this.sessions.has(sessionId)) return;
    this.sessions.set(sessionId, { id: sessionId, client, tab, child: false, targetId });
  }

  private browserEvent(method: string, params: Json): void {
    if (method === "Target.attachedToTarget") { this.attachedAtBrowser(params); return; }
    if (method === "Target.detachedFromTarget") {
      const sessionId = String(params.sessionId ?? "");
      const session = this.sessions.get(sessionId);
      if (session) {
        this.sessions.delete(sessionId);
        this.toClient(session.client, { method, params });
      }
      const guarded = this.guards.get(sessionId);
      if (guarded) { this.guards.delete(sessionId); if (guarded.guard === sessionId) guarded.guard = undefined; }
      return;
    }
    if (!method.startsWith("Target.target")) return;
    const info = (params.targetInfo ?? {}) as Json;
    const targetId = String(info.targetId ?? params.targetId ?? "");
    if (method === "Target.targetCreated" && info.type === "page" && typeof info.openerId === "string") {
      const opener = this.tabs.get(info.openerId);
      // A popup an allowed page opened belongs to the same bot, guarded the
      // same way, before anything of it reaches the engine. Chrome holds it
      // (autoAttachRelated) until the guard is on; without that, the gate
      // attaches on its own a moment later.
      if (opener && !this.tabs.has(targetId) && this.clients.has(opener.client)) {
        const tab: Tab = { targetId, client: opener.client, url: String(info.url ?? ""), title: String(info.title ?? ""), pendingGuard: true };
        this.tabs.set(targetId, tab);
        const fallback = setTimeout(() => {
          if (tab.pendingGuard && this.tabs.get(targetId) === tab) this.adoptPopup(tab);
        }, 500);
        fallback.unref?.();
        return;
      }
    }
    const tab = this.tabs.get(targetId);
    if (!tab) {
      // A frame or worker the engine holds a session on.
      if (method === "Target.targetInfoChanged") this.childChanged(targetId, info);
      return;
    }
    if (method === "Target.targetDestroyed" || method === "Target.targetCrashed") {
      this.tabs.delete(targetId);
      if (tab.guard) this.guards.delete(tab.guard);
      if (tab.client.discover) this.toClient(tab.client, { method, params });
      this.options.onChange?.();
      return;
    }
    if (typeof info.url === "string") tab.url = info.url;
    if (typeof info.title === "string") tab.title = info.title;
    if (tab.client.discover) this.toClient(tab.client, { method, params: { ...params, targetInfo: { ...info, openerId: undefined } } });
    this.options.onChange?.();
  }

  private childChanged(targetId: string, info: Json): void {
    for (const session of this.sessions.values()) {
      if (!session.child || session.targetId !== targetId) continue;
      const url = String(info.url ?? "");
      if (!isBlankPage(url) && !this.options.allows(url)) this.hideChild(session.id);
    }
  }

  /** An attach at the browser level: one the engine or the gate asked for. */
  private attachedAtBrowser(params: Json): void {
    const sessionId = String(params.sessionId ?? "");
    const info = (params.targetInfo ?? {}) as Json;
    const targetId = String(info.targetId ?? "");
    const asker = this.attaching.get(targetId);
    if (asker === "gate") return; // the gate's own guard: recorded by guard()
    if (asker) {
      this.adoptSession(asker, sessionId, targetId);
      if (this.sessions.has(sessionId)) this.toClient(asker, { method: "Target.attachedToTarget", params });
      return;
    }
    // A popup of a guarded tab, held by autoAttachRelated: this session is its guard.
    const opener = typeof info.openerId === "string" ? this.tabs.get(info.openerId) : undefined;
    let tab = this.tabs.get(targetId);
    if (!tab && opener && this.clients.has(opener.client) && info.type === "page") {
      tab = { targetId, client: opener.client, url: String(info.url ?? ""), title: String(info.title ?? ""), pendingGuard: true };
      this.tabs.set(targetId, tab);
    }
    if (tab?.pendingGuard) {
      this.adoptPopup(tab, sessionId);
      return;
    }
    // Nothing of ours asked: let it run and go.
    this.gateSend("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
    this.gateSend("Target.detachFromTarget", { sessionId }).catch(() => undefined);
  }

  private adoptPopup(tab: Tab, heldSession?: string): void {
    tab.pendingGuard = false;
    void this.guard(tab, heldSession).then(() => {
      if (this.tabs.get(tab.targetId) !== tab) return;
      if (tab.client.discover) this.toClient(tab.client, { method: "Target.targetCreated", params: { targetInfo: this.targetInfo(tab) } });
      this.options.onChange?.();
    }, () => {
      this.tabs.delete(tab.targetId);
      if (heldSession) this.gateSend("Runtime.runIfWaitingForDebugger", {}, heldSession).catch(() => undefined);
    });
  }

  private sessionEvent(session: Session, method: string, params: Json): void {
    if (method === "Target.attachedToTarget") {
      const child = String(params.sessionId ?? "");
      const info = (params.targetInfo ?? {}) as Json;
      const url = String(info.url ?? "");
      if (isBlankPage(url) || this.options.allows(url)) {
        this.sessions.set(child, { id: child, client: session.client, tab: session.tab, child: true, targetId: String(info.targetId ?? "") });
        this.toClient(session.client, { method, params, sessionId: session.id });
      } else {
        // A frame or worker of another site: it runs, but the engine never holds it.
        this.gateSend("Runtime.runIfWaitingForDebugger", {}, child).catch(() => undefined);
        this.gateSend("Target.detachFromTarget", { sessionId: child }).catch(() => undefined);
      }
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const child = String(params.sessionId ?? "");
      if (!this.sessions.has(child)) return;
      this.sessions.delete(child);
      this.toClient(session.client, { method, params, sessionId: session.id });
      return;
    }
    if (!this.onSite(session.tab)) return;
    let sent: Json | null = params;
    if (method.startsWith("Network.")) sent = sanitizeNetworkEvent(method, params, (url) => this.options.allows(url));
    else if (!sessionEventAllowed(method)) sent = null;
    if (sent) this.toClient(session.client, { method, params: sent, sessionId: session.id });
  }

  private hideChild(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.toClient(session.client, { method: "Target.detachedFromTarget", params: { sessionId, targetId: session.targetId } });
    this.gateSend("Target.detachFromTarget", { sessionId }).catch(() => undefined);
  }

  // ── the guard on each tab ──

  private async guard(tab: Tab, heldSession?: string): Promise<void> {
    let guard = heldSession ?? "";
    if (!guard) {
      this.attaching.set(tab.targetId, "gate");
      let attached: Json;
      try { attached = await this.gateSend("Target.attachToTarget", { targetId: tab.targetId, flatten: true }); }
      finally { if (this.attaching.get(tab.targetId) === "gate") this.attaching.delete(tab.targetId); }
      guard = String(attached.sessionId ?? "");
    }
    if (!guard) throw new Error("no session");
    tab.guard = guard;
    this.guards.set(guard, tab);
    await this.gateSend("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] }, guard);
    // Nothing a bot clicks writes into the person's Downloads (this tab only;
    // the person's other tabs keep their own behavior).
    await this.gateSend("Page.setDownloadBehavior", { behavior: "deny" }, guard).catch(() => undefined);
    await this.gateSend("Runtime.addBinding", { name: PILOT_STOP_BINDING, executionContextName: PILOT_WORLD }, guard);
    await this.gateSend("Runtime.enable", {}, guard);
    // Scripts for new documents run only with the Page domain on.
    await this.gateSend("Page.enable", {}, guard);
    const script = await this.gateSend("Page.addScriptToEvaluateOnNewDocument", { source: pilotBannerScript(), worldName: PILOT_WORLD, runImmediately: true }, guard);
    tab.scriptId = typeof script.identifier === "string" ? script.identifier : undefined;
    // Popups this tab opens are held until their guard is on.
    await this.gateSend("Target.autoAttachRelated", { targetId: tab.targetId, waitForDebuggerOnStart: true }).catch(() => undefined);
    await this.gateSend("Runtime.runIfWaitingForDebugger", {}, guard).catch(() => undefined);
  }

  private guardEvent(tab: Tab, method: string, params: Json): void {
    if (method === "Fetch.requestPaused") {
      const requestId = String(params.requestId ?? "");
      const url = String((params.request as Json | undefined)?.url ?? "");
      const topFrame = params.frameId === tab.targetId;
      if (topFrame && !isBlankPage(url) && !this.options.allows(url)) {
        tab.blockedUrl = url;
        this.note(tab.client, this.offSiteText(url));
        this.gateSend("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, tab.guard).catch(() => undefined);
        this.options.onChange?.();
        return;
      }
      // A frame of another origin on the same site would share the allowed
      // page's process, where the engine could reach its scripts and
      // cookies: it is not loaded. Other sites get their own process, which
      // the gate keeps detached from the engine.
      if (!topFrame && !isBlankPage(url) && !this.options.allows(url) && maybeSameSite(url, tab.url)) {
        this.note(tab.client, `Sagax did not load a frame of ${originOf(url)}: it is not one of the sites allowed in My Chrome.`);
        this.gateSend("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, tab.guard).catch(() => undefined);
        return;
      }
      this.gateSend("Fetch.continueRequest", { requestId }, tab.guard).catch(() => undefined);
      return;
    }
    if (method === "Runtime.bindingCalled" && params.name === PILOT_STOP_BINDING) {
      this.options.onStopFromTab?.();
      void this.stop();
    }
  }

  private async unguard(tab: Tab): Promise<void> {
    const guard = tab.guard;
    if (!guard || !this.chrome) return;
    tab.guard = undefined;
    this.guards.delete(guard);
    const send = (method: string, params: Json = {}) => this.gateSend(method, params, guard).catch(() => undefined);
    await send("Fetch.disable");
    if (tab.scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: tab.scriptId });
    await send("Runtime.evaluate", { expression: `(() => { const host = document.getElementById(${JSON.stringify(PILOT_BANNER_ID)}); if (host) { host.setAttribute("data-sagax-gone", ""); host.remove(); } })()` });
    await send("Runtime.removeBinding", { name: PILOT_STOP_BINDING });
    await this.gateSend("Target.detachFromTarget", { sessionId: guard }).catch(() => undefined);
  }
}

function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return url.slice(0, 80); }
}
