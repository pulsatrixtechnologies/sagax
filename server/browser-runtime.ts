import { killCliTree, spawnCli } from "./procs.ts";
import { scrubHeldSecrets } from "../shared/redact.ts";
import { DEFAULT_BROWSER_RESULT_BUDGET, describePageChange, OBSERVE_PAGE_SCRIPT, parsePageState, READ_OPEN_PAGE_ONLY, readsAroundBrowser, scrubBrowserResult, shapeBrowserToolResult, slimBrowserToolList, stripHarnessOwnedArguments, type PageState } from "./browser-tool-shape.ts";
import { randomBytes } from "node:crypto";
import { aimOf, FILL_CREDENTIAL_TOOL, FILL_CREDENTIAL_TOOL_SPEC, formPostsOnly, formStaysOnOrigin, LOGIN_MODE, parseEvalArray, parseEvalObject, parseFillArguments, parseProbe, parseWrite, probeScript, problemText, SecretRedactor, writeScript, type FillRequest, type LoginRequest } from "./credential-fill.ts";
import { itemIdFromHandle } from "../shared/credential-vault.ts";
import {
  parsePurchaseCall, parseReceiptCall, RECORD_PURCHASE_TOOL, RECORD_PURCHASE_TOOL_SPEC, REQUEST_PURCHASE_TOOL, REQUEST_PURCHASE_TOOL_SPEC,
  type PurchaseFlightLeg, type PurchaseItem,
} from "../shared/payment-vault.ts";
import { clearScript, loginOutcomeText, loginStateScript, markerScript, MAX_LOGIN_STEPS, parseLoginState, stepFields, submitScript, type LoginField, type LoginOutcome, type LoginPageState } from "./login-fill.ts";
import type { VaultFillField } from "../shared/credential-vault.ts";

export interface BrowserSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export const BROWSER_CONTROL_REFUSAL = "Browser tools are paused while a person controls this browser. Wait for them to hand control back; do not try another browser or execution tool.";
/** Harness-owned recovery tool, advertised beside the engine's own tools. A
 * phone or chat-only user has no Browser panel Restart button; without this
 * an interrupted action refuses the bot's browser until the app restarts. */
export const BROWSER_RESTART_TOOL = "restart_browser";
const BROWSER_RESTART_TOOL_SPEC = {
  name: BROWSER_RESTART_TOOL,
  description: "Close and restart your browser. Use this only when a browser tool says the browser must be restarted, or it stays busy after a call that did not answer. Every open tab is closed and unsaved page state such as form input is lost; sign-ins stay unless it is a temporary browser. afterwards open the page you need again and check whether the interrupted action already happened before repeating it.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};
const BROWSER_INTERRUPTED = `The browser engine is stuck. Press Restart in the Browser panel, or call ${BROWSER_RESTART_TOOL}, before using browser tools again.`;
/** Told on the first call after an idle close (closeIfIdle). A temporary
 * browser saves nothing, so its sign-ins went with it. */
const idleClosedNote = (saves: boolean) => `Your browser sat unused and was closed to free memory; this call opened it again. Pages you had open are gone (${saves ? "saved sign-ins are kept" : "it is a temporary browser, so its sign-ins are gone too"}), so open the page you need again before using earlier @eN refs.`;
const RESTART_COST = "a restart closes every tab and loses page state such as form input";
/** Actions whose result also says what changed on the page, so the model
 * need not spend a step reading it back. */
const PAGE_ACTIONS: ReadonlySet<string> = new Set([
  "agent_browser_click", "agent_browser_fill", "agent_browser_type", "agent_browser_press",
  "agent_browser_check", "agent_browser_uncheck", "agent_browser_select",
]);
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 16_777_216;
/** Startup, not per-request work: a cold engine spawn can exceed a tight
 * per-request budget before anything has been accepted to guard. */
const HANDSHAKE_TIMEOUT_MS = 1_000;
const HOST_ENV = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATH", "Path", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR"];

/** MCP, viewer commands, and cleanup must resolve the same HOME/socket paths.
 * Inherit OS plumbing, never the harness's model-provider credentials. */
export function browserRuntimeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = Object.fromEntries(HOST_ENV.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  return { ...env, ...overrides };
}

/** The page size of a headless browser OMB launches, in CSS pixels.
 *
 * agent-browser sizes the Chrome *window* (`--window-size=1280,720`). Full
 * Chrome in headless mode (Chrome for Testing, as the Docker image installs)
 * takes its emulated browser UI out of that window, so the page itself comes
 * out 1280×577 while the screencast metadata still reports 1280×720, and the
 * live view aimed clicks at the wrong place. chrome-headless-shell has no such
 * UI, so there this changes nothing. agent-browser has no launch option for
 * the page size; `set viewport` sets it and resizes the window's content area,
 * which the browser's later tabs inherit. */
export const BROWSER_VIEWPORT = { width: 1280, height: 720 } as const;
export const BROWSER_VIEWPORT_ARGS = ["set", "viewport", String(BROWSER_VIEWPORT.width), String(BROWSER_VIEWPORT.height)] as const;

/** A session attached to a Chrome that is already running: the person's own
 * (My Chrome), found automatically or at a configured address. */
export function attachesToChrome(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.AGENT_BROWSER_CDP || env.AGENT_BROWSER_AUTO_CONNECT);
}

/** Only a headless browser this server launches is OMB's to size. A browser
 * attached over CDP is someone's own Chrome, and a headed window is the
 * user's to size. */
export function ownsBrowserViewport(env: NodeJS.ProcessEnv): boolean {
  return env.AGENT_BROWSER_HEADLESS === "1" && !attachesToChrome(env);
}

export class TransportError extends Error {}

/** The vault as one turn's browser sees it (server/credential-vault.ts
 * fillResolverFor), built per call by the caller, which knows the bot, the
 * conversation and whose vault it is. */
export interface CredentialFillAccess {
  /** The value to type: the vault checks the bot's grant and the page's
   * top-level URL (read from the engine) against the item's sites. */
  /** `form`: the identity of the form the field sits in (its submit
   * targets), so a payment approval is used on that one form. */
  resolve(request: { handle: string; field: VaultFillField; pageUrl: string; form?: string }): Promise<{ ok: true; value: string; label: string } | { ok: false; message: string; code?: string }>;
  /** The bot holds a live grant on some item: its own scripts are off in
   * the whole browser session, so it cannot plant a listener before a fill. */
  armed(): boolean;
  /** Ask the person to approve a payment. The value never comes back. */
  requestPurchase?(input: { pageUrl: string; amount: string; currency: string; cardId: string; merchant?: string; addressId?: string; contactId?: string; items?: PurchaseItem[]; flights?: PurchaseFlightLeg[] }): { ok: true; message: string } | { ok: false; message: string };
  /** The shop confirmed the order: the receipt for the person. */
  recordPurchase?(input: { pageUrl: string; orderRef?: string; total?: string; items?: PurchaseItem[]; flights?: PurchaseFlightLeg[] }): { ok: true; message: string } | { ok: false; message: string };
}

/** Argument names that address an element. On a browser where a login was
 * filled, or while the bot may use one, only an accessibility ref (@eN) is
 * accepted there: a CSS selector can test an input's value attribute
 * (`[value^="a"]`, `:has(...)`), which frameworks mirror from what was typed,
 * and so guess a secret one character at a time from found / not found. */
const ELEMENT_ARGUMENTS = ["selector", "target", "ref", "element", "sel", "locator"];
const ACCESSIBILITY_REF = /^@?e\d{1,6}$/;
export function cssSelectorArgument(params: unknown): string | null {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  for (const key of ELEMENT_ARGUMENTS) {
    const value = (args as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !ACCESSIBILITY_REF.test(value.trim())) return key;
  }
  return null;
}
const REFS_ONLY = "In this browser a saved login is allowed or was filled, so elements are addressed only by their @eN refs from a snapshot, never by a CSS selector. Take a snapshot and pass the ref.";

/** Tools that type or press keys into the page. */
function keyboardTool(name: string | undefined): boolean {
  return typeof name === "string" && /^agent_browser_(press|type|fill|keyboard|key|insert)/.test(name);
}

/** Text that would press Tab, Enter or another control key mid-call (the
 * engine types each \t \n \r as a real key), moving the focus after the
 * one-time check. */
function controlCharacters(params: unknown): boolean {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  if (!args || typeof args !== "object") return false;
  return Object.values(args as Record<string, unknown>).some((value) => typeof value === "string" &&
    [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f));
}
const CONTROL_KEYS_REFUSAL = "In this browser a saved login was filled, so typed text may not contain Tab, Enter or other control characters (each would press a key and could move into the filled field). Type the text alone, then press the key with its own call.";

/** The @eN ref a keyboard tool aims at, if any. */
function elementRef(params: unknown): string | null {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  if (!args || typeof args !== "object") return null;
  for (const key of ELEMENT_ARGUMENTS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string" && ACCESSIBILITY_REF.test(value.trim())) return value.trim();
  }
  return null;
}

/** "free" unless the focus is on a field Sagax filled (or inside a frame,
 * which the top document cannot see into). */
const FOCUS_ON_FILLED_SCRIPT = `(() => {'use strict';
const el = document.activeElement;
if (!el) return 'free';
if (el.tagName === 'IFRAME' || el.hasAttribute('data-sagax-filled')) return 'filled';
return 'free';
})()`;
/** The current contents of the fields Sagax filled, edited or not. */
const FILLED_VALUES_SCRIPT = `(() => {'use strict';
return JSON.stringify(Array.from(document.querySelectorAll('[data-sagax-filled]')).map((el) => typeof el.value === 'string' ? el.value : '').filter(Boolean).slice(0, 20));
})()`;
/** The taint a person's own sign-in leaves (armForPerson): not an origin. */
const PERSON_SIGN_IN = "person-sign-in";
/** How long a person's own sign-in holds the bot's browser at most. */
export const PERSON_SIGN_IN_MS = 30 * 60_000;
const PERSON_SIGNING_IN = "The person is signing in themselves in this browser; it cannot be restarted until they press Done on the login card.";
export const NOT_ARMED_FOR_PERSON = "This browser was not prepared for your sign-in. Press \"I'll sign in myself instead\" on the card again, sign in, then press Done.";
/** Empty every password and one-time code field of the top document. */
const CLEAR_SIGN_IN_FIELDS_SCRIPT = `(() => {'use strict';
let cleared = 0;
for (const el of Array.from(document.querySelectorAll('input'))) {
  const code = el.autocomplete === 'one-time-code' || /otp|totp|2fa|mfa|one.?time|verification|security.?code|auth.?code/i.test([el.name, el.id, el.autocomplete, el.placeholder].join(' '));
  if (el.type !== 'password' && !code) continue;
  if (!el.value) continue;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  cleared++;
}
return String(cleared);
})()`;
const KEYS_INTO_FILLED_REFUSAL = "That field holds a saved login Sagax filled: it cannot be typed into or edited, and keys are not sent to it. Act on another field, or submit the form.";

/** The bot's script, run only if the page is still on `origin`: the check is
 * in the same evaluation, so nothing can switch the document in between. */
function guardScript(params: unknown, origin: string): unknown {
  const call = params as { arguments?: Record<string, unknown> } | null;
  const script = call?.arguments?.script;
  if (typeof script !== "string") return params;
  const guard = `if (location.origin !== ${JSON.stringify(origin)}) throw new Error("The page changed before the script ran; nothing ran.");\n`;
  return { ...call, arguments: { ...call!.arguments, script: guard + script } };
}

/** Tools that run the bot's own code in the page or reach into frames. */
function scriptTool(name: string | undefined): boolean {
  return typeof name === "string" && /eval|script|evaluate|frame|init|inject|addstyle|add_style|cdp/i.test(name);
}
const BROWSER_FILLING = "The browser is busy typing a saved login. Try again in a moment.";
const EXCLUSIVE_WAIT_MS = 15_000;
const SCRIPTS_OFF_AFTER_FILL = "Scripts in the page are turned off in this browser since Sagax filled a saved login in it, so nothing can read it back. Use snapshots, clicks, fills and get_text, or call restart_browser to start a clean browser.";
const SCRIPTS_OFF_WHILE_ALLOWED = "Scripts in the page are turned off in this browser while you are allowed to use a saved login, so nothing can capture it. Use snapshots, clicks, fills and get_text.";
const SCREENSHOT_AFTER_FILL_REFUSAL = "Screenshots are turned off in this browser since Sagax filled a saved login in it, so the value cannot appear in an image. Use a snapshot or get_text, or call restart_browser.";

const FIELD_NAMES: Record<VaultFillField, string> = {
  username: "user name", password: "password", totp: "one-time code", apiKey: "API key",
  cardNumber: "card number", cardExpiry: "expiry", cardCvc: "security code", cardholder: "name on the card",
  addressLine1: "street", addressLine2: "address line", addressCity: "city", addressRegion: "region",
  addressPostal: "postal code", addressCountry: "country", addressRecipient: "recipient", addressPhone: "phone",
  contactName: "name", contactEmail: "email", contactPhone: "phone", contactCompany: "company",
};

function toolText(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true as const } : {}) };
}

/** One timed browser action, logged with SAGAX_BROWSER_TIMING=1. Times are in
 * milliseconds. `inFlight` counts this session's browser work already running
 * when the action started: the engine runs one command per session, so the
 * action waited behind it. */
export interface BrowserTiming {
  session: string;
  tool: string;
  outcome: "ok" | "error";
  totalMs: number;
  /** Transport handshake and page sizing; the first call launches the browser here. */
  launchMs?: number;
  engineMs?: number;
  /** Page reads: the snapshot after agent_browser_open, or the text before and after a page action. */
  observeMs?: number;
  /** Text the model receives, after shaping; the frame's base64 for a preview frame. */
  chars?: number;
  inFlight: number;
}

export function formatBrowserTiming(timing: BrowserTiming): string {
  const parts = [`browser timing: ${timing.tool} ${timing.outcome}`];
  const phases: Array<[string, number | undefined]> = [
    ["total", timing.totalMs], ["launch", timing.launchMs], ["engine", timing.engineMs], ["observe", timing.observeMs],
  ];
  for (const [label, value] of phases) {
    if (value !== undefined) parts.push(`${label}=${Math.round(value)}ms`);
  }
  if (timing.chars !== undefined) parts.push(`chars=${timing.chars}`);
  parts.push(`inflight=${timing.inFlight}`, `session=${timing.session}`);
  return parts.join(" ");
}

/** The text a tool result hands the model, in characters. */
function resultChars(result: unknown): number {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const item of content) {
    const text = (item as { text?: unknown } | null)?.text;
    if (typeof text === "string") chars += text.length;
  }
  return chars;
}

/** An error the engine answered: the action ran and failed (a page that
 * would not load). Nothing is left running in the browser, so unlike a
 * timeout or a lost connection it does not need a restart. Errors mark
 * themselves with `settled: true`. */
export function isSettledBrowserFailure(error: unknown): boolean {
  return (error as { settled?: unknown } | null)?.settled === true;
}
type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** A server-owned JSONL client. Neither child stderr nor its environment is
 * returned to the agent. Reuse the existing cross-platform spawn/kill rules. */
class BrowserClient {
  readonly child: ReturnType<typeof spawnCli>;
  readonly ready: Promise<void>;
  private pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private stopped = false;
  private idleTimer?: NodeJS.Timeout;
  private stoppedPromise?: Promise<void>;
  private requestTimeoutMs: number;
  private idleMs: number;
  private maxPending: number;
  private onClose: () => void;
  private onRequestTimeout: (params: unknown) => void;

  constructor(
    spec: BrowserSpawnSpec,
    requestTimeoutMs: number,
    idleMs: number,
    maxPending: number,
    onClose: () => void,
    onRequestTimeout: (params: unknown) => void,
  ) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.idleMs = idleMs;
    this.maxPending = maxPending;
    this.onClose = onClose;
    this.onRequestTimeout = onRequestTimeout;
    this.child = spawnCli(spec.command, spec.args, {
      env: browserRuntimeEnv(spec.env), stdio: ["pipe", "pipe", "pipe"], shell: false,
    });
    this.child.stderr.resume();
    this.child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    this.child.stdin.on("error", () => { void this.stop(new TransportError("Browser connection closed.")); });
    this.child.on("error", () => { void this.stop(new TransportError("Could not start the browser engine.")); });
    this.child.on("close", () => { void this.stop(new TransportError("Browser connection closed.")); });
    this.ready = this.rpc("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "openmausbot-browser", version: "1" },
    }, Math.max(this.requestTimeoutMs, HANDSHAKE_TIMEOUT_MS)).then((result) => {
      if (!result || typeof result !== "object" || !("protocolVersion" in result)) {
        throw new TransportError("Browser engine returned an invalid handshake.");
      }
      this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
    }).catch((error: unknown) => {
      void this.stop(error instanceof Error ? error : new TransportError("Browser handshake failed."));
      throw error;
    });
  }

  private read(chunk: Buffer): void {
    if (this.stopped) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      if (newline > MAX_RESPONSE_BYTES) {
        void this.stop(new TransportError("Browser response exceeded the size limit."));
        return;
      }
      const line = this.buffer.subarray(0, newline).toString("utf8");
      this.buffer = this.buffer.subarray(newline + 1);
      if (!line.trim()) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line);
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error();
      } catch {
        void this.stop(new TransportError("Browser engine returned invalid JSON."));
        return;
      }
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (!pending) continue; // MCP notifications do not contain tool results.
      this.pending.delete(message.id!);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Browser request failed."));
      else if (Object.hasOwn(message, "result")) pending.resolve(message.result);
      else pending.reject(new TransportError("Browser response has no result."));
      this.armIdle();
    }
    if (this.buffer.length > MAX_RESPONSE_BYTES) {
      void this.stop(new TransportError("Browser response exceeded the size limit."));
    }
  }

  private write(message: unknown): void {
    if (this.stopped) throw new TransportError("Browser connection closed.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) void this.stop(new TransportError("Browser connection closed."));
    });
  }

  rpc(method: string, params: unknown, timeoutMs: number = this.requestTimeoutMs): Promise<unknown> {
    if (this.stopped) return Promise.reject(new TransportError("Browser connection closed."));
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error("Too many pending browser requests. Try again when the current action finishes."));
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_REQUEST_BYTES) return Promise.reject(new Error("Browser request exceeded the size limit."));
    if (this.idleTimer) clearTimeout(this.idleTimer);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Seal the gate synchronously with the timer, before stop() teardown:
        // the rejection can surface through the ready handshake, which sits
        // outside agentRpc's uncertainty classifier.
        this.onRequestTimeout(params);
        void this.stop(new TransportError("Browser request timed out; restart the browser before taking control."));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.write(message); }
      catch { void this.stop(new TransportError("Browser connection closed.")); }
    });
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.stopped && this.pending.size === 0) {
      // Only the stateless MCP transport expires; saved browser state and the
      // browser daemon itself belong to the profile, not this client.
      this.idleTimer = setTimeout(() => { void this.stop(undefined, "transport"); }, this.idleMs);
      this.idleTimer.unref();
    }
  }

  /** Upstream's MCP loop exits on stdin EOF without closing the daemon.
   * In particular, Windows taskkill /T would also kill that profile's Chrome,
   * even when the daemon created a new process group. Idle is not shutdown. */
  private retireTransport(): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.child.off("exit", finish);
        resolve();
      };
      const timer = setTimeout(() => {
        try { this.child.kill("SIGKILL"); } catch { /* transport already exited */ }
        finish();
      }, 1_000);
      this.child.once("exit", finish);
      if (this.child.exitCode !== null || this.child.signalCode !== null) finish();
      else this.child.stdin.end();
    });
  }

  stop(error = new TransportError("Browser connection closed."), scope: "transport" | "tree" = "tree"): Promise<void> {
    if (this.stoppedPromise) return this.stoppedPromise;
    this.stopped = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose();
    this.stoppedPromise = scope === "transport" ? this.retireTransport() : killCliTree(this.child, 1_000).then((stopped) => {
      if (stopped) return;
      try {
        if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, "SIGKILL");
        else this.child.kill("SIGKILL");
      } catch { /* owned process already exited */ }
    });
    return this.stoppedPromise;
  }
}

/** Sets the page size of a session's browser, launching it if needed. */
export type ApplyViewport = (spec: BrowserSpawnSpec) => Promise<unknown>;

interface Gate {
  owner: string | null;
  ready: boolean;
  releasing: boolean;
  agents: number;
  /** Agent actions whose command reached the engine. A refused call or a
   * preview frame counts in `agents` but leaves the page as it was. */
  dispatched: number;
  humans: number;
  uncertain: boolean;
  /** The agent call that lost its transport (a timeout, a crash), while it is
   * the only cause of `uncertain`. The engine may still be running it; once a
   * read answers, it has ended (recoverAfterLoss). Null when a person left the
   * uncertainty behind: only a restart clears that. */
  lostCall: string | null;
  closing: boolean;
  /** A fill_credential holds the session alone: every other agent action is
   * refused until it ends, so no tab switch or script lands between its steps. */
  exclusive: boolean;
  changed: Set<() => void>;
  /** Live views open on this browser (watch): it is never idle while one is. */
  watchers: number;
  /** The bot's MCP requests in flight (agentRpc), a tool listing included. */
  calls: number;
  /** When a bot, a person or a live view last used it. */
  lastUsed: number;
  /** Its launch settings, as last used: an idle close closes with them. */
  spec?: BrowserSpawnSpec;
  /** An idle close in progress: agent calls and new views wait for it. */
  idleClose?: Promise<void>;
  /** Closed while idle since the last agent call, which is told so. */
  idleClosed: boolean;
}

/** A session's MCP client, the launch settings it was started with, and its
 * one-time page sizing. */
type ClientEntry = { key: string; client: BrowserClient; viewport?: Promise<unknown> };

/** The engine's live stream sends every command it runs, script included,
 * to each stream client. Before the write of a fill the runtime pauses it:
 * the returned function turns it back on; null means it could not be
 * paused, and nothing is typed. */
export type PauseStream = (session: string, spec: BrowserSpawnSpec) => Promise<(() => Promise<void>) | null>;

/** Closes one session's native browser daemon; true only when it is gone. */
export type CloseBrowser = (session: string, spec: BrowserSpawnSpec) => Promise<boolean>;

/** A tool result with one more text line at its end (an egress refusal). */
function withNotice(result: unknown, notice: string | null): unknown {
  if (!notice || !result || typeof result !== "object" || !Array.isArray((result as { content?: unknown }).content)) return result;
  const shaped = result as { content: unknown[] };
  return { ...shaped, content: [...shaped.content, { type: "text", text: notice }] };
}

/** PATCH /api/bots/:id changing the bot's browser profile while a person
 * signs in themselves in its browser: the Browser panel would move to a
 * browser that is not armed. Null to go on, else the refusal. */
export function browserProfileChangeRefusal(runtime: Pick<BrowserRuntime, "personSigningInForBot">, botId: string, current: string | undefined, requested: string | undefined): string | null {
  if (requested === current || !runtime.personSigningInForBot(botId)) return null;
  return "Someone is signing in themselves in this bot's browser. Finish (Done) or decline the login card first.";
}

export class BrowserRuntime {
  private gates = new Map<string, Gate>();
  private clients = new Map<string, ClientEntry>();
  /** One engine check per session at a time; concurrent calls share it. */
  private recoveries = new Map<string, Promise<string | null>>();
  /** Last advertised tools per session, so a turn that starts while the
   * browser is uncertain still sees the tools it can use after recovering. */
  private toolLists = new Map<string, unknown>();
  /** recoveryCheckMs: how long the call after a lost one waits for the
   * engine to answer. It stays well inside the harness proxy's 130 s budget
   * for one call. */
  /** loginSettleMs / loginPollMs: how long a sign-in waits for the page to
   * answer a submit, and how often it looks (server/login-fill.ts). */
  private options: { requestTimeoutMs: number; takeoverTimeoutMs: number; idleMs: number; maxPending: number; resultBudget: number; recoveryCheckMs: number; loginSettleMs: number; loginPollMs: number };
  private closeBrowser: CloseBrowser;
  private applyViewport?: ApplyViewport;
  private pauseStream?: PauseStream;
  /** What the egress gate refused for a session since the last call, as one
   * line (server/browser/egress/registry.ts, port of OpenMausBot #2930). */
  private egressNotice?: (session: string) => string | null;
  /** Values filled into each session, hidden from every later result. */
  readonly redactor = new SecretRedactor();
  /** Held secrets (a filled login's password, a fresh one-time code) out of
   * every tool result before the bot reads it. */
  private scrub: (text: string) => string;
  private onTiming?: (timing: BrowserTiming) => void;
  /** Sessions where a person is signing in themselves (armForPerson until
   * Done): kept apart from the redactor, which a restart forgets. */
  /** The clock of a person's sign-in (PERSON_SIGN_IN_MS), for tests. */
  private now: () => number;
  private personSignIns = new Map<string, { botId: string; until: number }>();

  /** The person's sign-in under way in this session, if it has not run out
   * (PERSON_SIGN_IN_MS: a card left open never blocks the bot for good). */
  private signingIn(session: string): boolean {
    const entry = this.personSignIns.get(session);
    if (entry && entry.until <= this.now()) this.personSignIns.delete(session);
    return this.personSignIns.has(session);
  }

  constructor({ closeBrowser, applyViewport, pauseStream, egressNotice, now, scrub, onTiming, ...options }: Partial<BrowserRuntime["options"]> & { closeBrowser?: CloseBrowser; applyViewport?: ApplyViewport; pauseStream?: PauseStream; egressNotice?: (session: string) => string | null; now?: () => number; scrub?: (text: string) => string; onTiming?: (timing: BrowserTiming) => void } = {}) {
    this.now = now ?? Date.now;
    this.egressNotice = egressNotice;
    this.options = { requestTimeoutMs: 120_000, takeoverTimeoutMs: 15_000, idleMs: 60_000, maxPending: 16, resultBudget: DEFAULT_BROWSER_RESULT_BUDGET, recoveryCheckMs: 30_000, loginSettleMs: 8_000, loginPollMs: 250, ...options };
    this.closeBrowser = closeBrowser ?? (async () => false);
    this.applyViewport = applyViewport;
    this.pauseStream = pauseStream;
    this.scrub = scrub ?? scrubHeldSecrets;
    this.onTiming = onTiming;
  }

  private timed<T>(session: string, tool: string, phases: Partial<BrowserTiming>, fn: () => Promise<T>): Promise<T> {
    if (!this.onTiming) return fn();
    const onTiming = this.onTiming;
    const started = performance.now();
    const inFlight = this.gate(session).agents;
    const report = (outcome: BrowserTiming["outcome"]) => onTiming({ session, tool, outcome, totalMs: performance.now() - started, ...phases, inFlight });
    return fn().then((result) => {
      report((result as { isError?: unknown } | null)?.isError === true ? "error" : "ok");
      return result;
    }, (error: unknown) => {
      report("error");
      throw error;
    });
  }

  private gate(session: string): Gate {
    let gate = this.gates.get(session);
    if (!gate) {
      gate = { owner: null, ready: false, releasing: false, agents: 0, dispatched: 0, humans: 0, uncertain: false, lostCall: null, closing: false, exclusive: false, changed: new Set(), watchers: 0, calls: 0, lastUsed: Date.now(), idleClosed: false };
      this.gates.set(session, gate);
    }
    return gate;
  }

  private changed(gate: Gate): void {
    if (gate.releasing && gate.humans === 0) {
      gate.owner = null;
      gate.releasing = false;
      gate.ready = false;
    }
    for (const notify of gate.changed) notify();
  }

  async withAgentAction<T>(session: string, fn: () => Promise<T>): Promise<T> {
    const gate = this.gate(session);
    if (gate.owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
    if (gate.uncertain) throw new Error(BROWSER_INTERRUPTED);
    if (gate.closing) throw new Error("The browser is closing. Try again shortly.");
    if (gate.exclusive) throw new Error(BROWSER_FILLING);
    gate.agents++;
    try {
      const result = await fn();
      // Discard observations completed after takeover was requested.
      if (gate.owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
      return result;
    } finally {
      gate.agents--;
      gate.lastUsed = Date.now();
      this.changed(gate);
    }
  }

  /** One live-preview frame, skipped while an agent action runs in this
   * browser. Each frame is an engine command, and the engine runs one at a
   * time: a frame sent behind a stuck action stays queued there after its own
   * timeout. Measured on agent-browser 0.37.0, 27 such frames during a 120 s
   * stuck click kept the engine busy for about two minutes after the click
   * ended, so neither recovery nor a restart could reach it. */
  async previewFrame<T>(session: string, capture: () => Promise<T>): Promise<T> {
    // No picture of a browser where a saved login was filled: a user name, a
    // one-time code or an API key may be on screen. Until a restart.
    if (this.redactor.hasTaint(session)) throw new Error("Frames of this browser are off since a saved login was filled in it.");
    if (this.gate(session).agents > 0) throw new Error("The browser is busy with an agent action.");
    const phases: Partial<BrowserTiming> = {};
    return this.timed(session, "preview_frame", phases, () => this.withAgentAction(session, async () => {
      const frame = await capture();
      const png = (frame as { png?: unknown } | null)?.png;
      if (typeof png === "string") phases.chars = png.length;
      return frame;
    }));
  }

  /** One MCP request from the bot's turn. Every tool result it answers,
   * the runtime's own recovery notes included, loses the values Sagax filled
   * in this session and any held secret on the way out. */
  async agentRpc(session: string, spec: BrowserSpawnSpec, method: "tools/list" | "tools/call", params: unknown, beforeDispatch?: () => void, credentials?: CredentialFillAccess): Promise<unknown> {
    // agent_browser_read with a `url` fetches around the browser and its
    // egress gate; it reads the open page only (OpenMausBot #2930 port).
    if (method === "tools/call" && readsAroundBrowser(params)) return toolText(READ_OPEN_PAGE_ONLY, true);
    // A call that arrives while its idle browser closes waits, then reopens
    // it. Without one, nothing is awaited: the call is counted in the same
    // turn of the event loop, so no idle close can start under it.
    for (let closing = this.gates.get(session)?.idleClose; closing; closing = this.gates.get(session)?.idleClose) await closing;
    const gate = this.gate(session);
    gate.spec = spec;
    gate.calls++;
    try {
      // A value Sagax filled never comes back to a bot, whatever tool reads the page.
      const redacted = this.redactor.redact(session, await this.agentRpcUnredacted(session, spec, method, params, beforeDispatch, credentials));
      if (method !== "tools/call") return redacted;
      const result = withNotice(scrubBrowserResult(redacted, this.scrub), this.egressNotice?.(session) ?? null);
      if (!gate.idleClosed) return result;
      gate.idleClosed = false;
      const content = (result as { content?: unknown } | null)?.content;
      const note = idleClosedNote(spec.env.AGENT_BROWSER_RESTORE_SAVE !== "never");
      return { ...result as object, content: [{ type: "text", text: note }, ...Array.isArray(content) ? content : []] };
    } catch (error) {
      if (error instanceof Error) {
        const message = this.redactor.redactText(session, error.message);
        if (message !== error.message) error.message = message;
      }
      throw error;
    } finally {
      gate.calls--;
      gate.lastUsed = Date.now();
    }
  }

  private async agentRpcUnredacted(session: string, spec: BrowserSpawnSpec, method: "tools/list" | "tools/call", params: unknown, beforeDispatch?: () => void, credentials?: CredentialFillAccess): Promise<unknown> {
    if (method !== "tools/list" && method !== "tools/call") throw new Error("Unsupported browser method.");
    if (method === "tools/call" && cssSelectorArgument(params) !== null && (this.redactor.hasTaint(session) || credentials?.armed())) {
      return toolText(REFS_ONLY, true);
    }
    // tools/list bypasses withAgentAction (a human may hold control), so it
    // must refuse the closing window itself or its client outlives restart().
    if (method !== "tools/call" && this.gate(session).closing) throw new Error("The browser is closing. Try again shortly.");
    if (method === "tools/call" && params && typeof params === "object" && (params as { name?: unknown }).name === BROWSER_RESTART_TOOL) {
      beforeDispatch?.();
      await this.agentRestart(session, () => this.closeBrowser(session, spec));
      beforeDispatch?.(); // A turn revoked while the browser closed receives no result.
      return { content: [{ type: "text", text: "Browser restarted. Open pages were closed; open the page you need again and check whether the interrupted action already happened before repeating it." }] };
    }
    // Uncertainty survives client replacement: nothing new reaches the engine
    // until it is resolved. Listing never reaches the engine; it answers from
    // the last list so the restart tool is reachable and the engine's tools
    // are there once it succeeds.
    const toolName = toolNameOf(params);
    const gate = this.gate(session);
    if (gate.uncertain) {
      if (method === "tools/list") return withRestartTool(this.toolLists.get(session) ?? { tools: [] });
      // A person still holding the browser hears the pause, not the stuck
      // engine. Once they hand it back, the call is a tool result — not a
      // dead MCP server — so this thread can Restart and continue.
      if (gate.owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
      const lostCall = gate.lostCall;
      if (lostCall === null) return stuckBrowserToolError();
      beforeDispatch?.();
      const url = await this.recoverAfterLoss(session, spec);
      beforeDispatch?.(); // A turn revoked during the check receives no result.
      return url === null ? stillBusyToolError(lostCall) : recoveredResult(lostCall, url);
    }
    const phases: Partial<BrowserTiming> = {};
    const invoke = async () => {
      const launchStarted = performance.now();
      let dispatched = false;
      const entry = this.connect(session, spec);
      await entry.client.ready;
      beforeDispatch?.();
      if (method === "tools/call" && this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
      if (method === "tools/call" && this.applyViewport) {
        // The bot's first call on a transport may launch the browser. Size its
        // page first, once per transport, so the page, the bot's screenshots
        // and the live view agree. Failure only leaves the engine's default.
        entry.viewport ??= this.applyViewport(spec).catch(() => undefined);
        await entry.viewport;
        beforeDispatch?.();
        if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
      }
      phases.launchMs = performance.now() - launchStarted;
      try {
        if (method === "tools/call" && toolName === FILL_CREDENTIAL_TOOL) {
          return await this.fillCredential(session, spec, entry.client, params, beforeDispatch, credentials);
        }
        if (method === "tools/call" && toolName === REQUEST_PURCHASE_TOOL) {
          return await this.requestPurchase(session, entry.client, params, beforeDispatch, credentials);
        }
        if (method === "tools/call" && toolName === RECORD_PURCHASE_TOOL) {
          return await this.recordPurchase(session, entry.client, params, beforeDispatch, credentials);
        }
        let guardedParams = params;
        if (method === "tools/call" && scriptTool(toolName)) {
          // While the bot may use a saved login, and in a browser where one
          // was filled (until a restart), no script of its own runs at all.
          // Otherwise the origin it runs on is recorded, and the script is
          // guarded in the same evaluation, so a later fill there refuses
          // (a listener could still be waiting) and a tab switch in between
          // cannot make it run on another document than the one recorded.
          if (credentials?.armed()) return toolText(SCRIPTS_OFF_WHILE_ALLOWED, true);
          if (this.redactor.hasTaint(session)) return toolText(SCRIPTS_OFF_AFTER_FILL, true);
          if (toolName !== "agent_browser_eval") return toolText("This tool is not available in Sagax's browser.", true);
          const origin = await this.engineOrigin(entry.client);
          beforeDispatch?.();
          if (!origin) return toolText("The page's address could not be read; the script did not run.", true);
          this.redactor.scriptedOn(session, origin);
          guardedParams = guardScript(params, origin);
        }
        if (method === "tools/call" && toolName === "agent_browser_screenshot" && this.redactor.hasTaint(session)) {
          return toolText(SCREENSHOT_AFTER_FILL_REFUSAL, true);
        }
        // Keys and typing on a browser where a login was filled: never into
        // a filled field (editing it, or copying from it, would defeat the
        // redaction of its value). The target is focused and checked first,
        // with the session held alone so nothing moves the focus in between.
        let releaseKeys: (() => void) | null = null;
        if (method === "tools/call" && keyboardTool(toolName) && this.redactor.hasTaint(session) && controlCharacters(params)) {
          return toolText(CONTROL_KEYS_REFUSAL, true);
        }
        if (method === "tools/call" && keyboardTool(toolName) && this.redactor.hasTaint(session)) {
          if (!await this.holdExclusive(session)) return toolText(BROWSER_FILLING, true);
          releaseKeys = () => { this.gate(session).exclusive = false; };
          try {
            const target = elementRef(params);
            if (target) {
              const clicked = await entry.client.rpc("tools/call", { name: "agent_browser_click", arguments: { selector: target } });
              beforeDispatch?.();
              if ((clicked as { isError?: unknown } | null)?.isError === true) { releaseKeys(); return toolText(`${target} could not be focused; nothing was typed.`, true); }
            }
            const focused = parseWrite(await entry.client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: FOCUS_ON_FILLED_SCRIPT, timeoutMs: 5_000 } }));
            beforeDispatch?.();
            if (focused !== "free") { releaseKeys(); return toolText(KEYS_INTO_FILLED_REFUSAL, true); }
          } catch (error) {
            releaseKeys();
            throw error;
          }
        }
        // The model sees slimmed schemas and text-only, bounded results; the
        // launch/session parameters OMB owns never reach the engine from a call.
        const request = method === "tools/call" ? stripHarnessOwnedArguments(guardedParams) : params;
        // Read the page around an action with eval, not a snapshot: a
        // snapshot renumbers every @eN ref the model holds. A failed read only
        // leaves the change out; a lost transport still engages recovery.
        const observePage = async (): Promise<PageState | null> => {
          const observeStarted = performance.now();
          try {
            return parsePageState(await entry.client.rpc("tools/call", {
              name: "agent_browser_eval", arguments: { script: OBSERVE_PAGE_SCRIPT, timeoutMs: 5_000 },
            }));
          } catch (error) {
            if (error instanceof TransportError) throw error;
            return null;
          } finally {
            phases.observeMs = (phases.observeMs ?? 0) + performance.now() - observeStarted;
          }
        };
        let before: PageState | null = null;
        if (method === "tools/call" && toolName !== undefined && PAGE_ACTIONS.has(toolName)) {
          before = await observePage();
          beforeDispatch?.();
          if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
        }
        const engineStarted = performance.now();
        if (method === "tools/call") { dispatched = true; gate.dispatched++; }
        let result: unknown;
        try {
          result = await entry.client.rpc(method, request);
        } finally {
          releaseKeys?.();
        }
        phases.engineMs = performance.now() - engineStarted;
        beforeDispatch?.(); // A turn revoked while the tool ran receives no result.
        if (method === "tools/list") {
          const tools = withRestartTool(slimBrowserToolList(result));
          this.toolLists.set(session, tools);
          return tools;
        }
        // Redact the engine's raw answer before anything shapes or trims it:
        // a cut through a value would otherwise leave its prefix whole. What
        // the filled fields hold now (edited, partial) is redacted too.
        if (this.redactor.hasTaint(session)) await this.refreshFilledValues(session, entry.client);
        result = this.redactor.redact(session, result);
        if (before) before = this.redactor.redact(session, before);
        if (before && result && typeof result === "object" && (result as { isError?: boolean }).isError !== true &&
            this.gate(session).owner === null) {
          const observed = await observePage();
          const after = observed ? this.redactor.redact(session, observed) : null;
          beforeDispatch?.();
          if (after) {
            const action = result as { content?: unknown[] };
            const change = { type: "text", text: describePageChange(before, after) };
            result = { ...action, content: [...(Array.isArray(action.content) ? action.content : []), change] };
          }
        }
        if (toolName === "agent_browser_open" && result && typeof result === "object" &&
            (result as { isError?: boolean }).isError !== true) {
          // Navigation alone does not prove that the requested page loaded.
          // Observe in the same scoped session, without replaying the action.
          beforeDispatch?.();
          if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
          let observation: unknown;
          const observeStarted = performance.now();
          try {
            observation = await entry.client.rpc("tools/call", {
              name: "agent_browser_snapshot", arguments: { compact: true },
            });
          } catch (error) {
            // A tool-level refusal does not undo the completed navigation.
            // Transport failures still engage the uncertainty/recovery gate.
            if (error instanceof TransportError) throw error;
            observation = { isError: true, content: [] };
          } finally {
            phases.observeMs = (phases.observeMs ?? 0) + performance.now() - observeStarted;
          }
          observation = this.redactor.redact(session, observation);
          beforeDispatch?.();
          const navigation = result as { content?: unknown[] };
          const page = observation as { content?: unknown[]; isError?: boolean } | null;
          const observed = page?.isError !== true && Array.isArray(page?.content) && page.content.some((item) =>
            item && typeof item === "object" && (item as { type?: unknown }).type === "text" &&
            typeof (item as { text?: unknown }).text === "string" && (item as { text: string }).text.trim().length > 0);
          result = {
            content: [
              ...(Array.isArray(navigation.content) ? navigation.content : []),
              { type: "text", text: !observed
                ? "Navigation returned, but page verification failed. Do not claim the requested page loaded and do not blindly repeat navigation."
                : "Page observed after navigation. Its refs are current, so act on them without another snapshot. Check this result for redirects, sign-in requirements or page errors before reporting task success:" },
              ...(Array.isArray(page?.content) ? page.content : []),
            ],
            ...(!observed ? { isError: true } : {}),
          };
        }
        const shaped = shapeBrowserToolResult(result, { toolName, budget: this.options.resultBudget });
        phases.chars = resultChars(shaped);
        return shaped;
      }
      catch (error) {
        // An MCP timeout cannot prove the independent daemon stopped an
        // accepted action, so nothing may reach the engine until it answers
        // again (recoverAfterLoss) or a restart closes the browser.
        // A stop from close()/restart() is intentional, not uncertainty.
        if (method === "tools/call" && error instanceof TransportError) {
          this.latchLostCall(session, toolName ?? method);
          // The request that timed out may be the runtime's own page read; the
          // bot hears about the call it made.
          if (gate.lostCall !== null && toolName) gate.lostCall = toolName;
        }
        throw error;
      }
      finally { if (dispatched) gate.dispatched--; }
    };
    if (method !== "tools/call") return invoke();
    try {
      return await this.timed(session, toolName ?? "unknown", phases, () => this.withAgentAction(session, invoke));
    } catch (error) {
      if (error instanceof Error && error.message === BROWSER_INTERRUPTED) return stuckBrowserToolError();
      // The call that lost its transport: a tool result that says what is
      // known, rather than an error that reads as "restart now".
      if (error instanceof TransportError && gate.uncertain && gate.lostCall !== null) return lostCallToolError(toolName ?? gate.lostCall);
      throw error;
    }
  }

  /** The active page's URL as the engine reads it (location.href, which a
   * page cannot redefine, through agent_browser_get_url), never as a page
   * script reports it in its own answer. Empty when it cannot be read. */
  private async engineUrl(client: BrowserClient): Promise<string> {
    const text = firstText(await client.rpc("tools/call", { name: "agent_browser_get_url", arguments: {} })).trim();
    try { return new URL(text).href; } catch { return ""; }
  }

  private async engineOrigin(client: BrowserClient): Promise<string> {
    const href = await this.engineUrl(client);
    try { return href ? new URL(href).origin : ""; } catch { return ""; }
  }

  /** Learn what the filled fields of the page hold now, so an edited or
   * partial value is redacted like the value itself. Never returned. */
  private async refreshFilledValues(session: string, client: BrowserClient): Promise<void> {
    try {
      const answer = await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: FILLED_VALUES_SCRIPT, timeoutMs: 5_000 } });
      const parsed = parseEvalArray(answer);
      for (const value of parsed) this.redactor.remember(session, value);
    } catch (error) {
      if (error instanceof TransportError) throw error;
    }
  }

  /** Whether a fill holds this session now (the Browser panel does not
   * turn the engine's stream back on meanwhile). */
  filling(session: string): boolean {
    return this.gates.get(session)?.exclusive === true;
  }

  /** Hold the session alone: new agent actions are refused, then wait for
   * those already running (this one aside) to end. False on timeout. */
  private async holdExclusive(session: string): Promise<boolean> {
    const gate = this.gate(session);
    if (gate.exclusive) return false;
    gate.exclusive = true;
    const deadline = Date.now() + EXCLUSIVE_WAIT_MS;
    while (gate.agents > 1) {
      if (Date.now() > deadline || gate.closing || gate.owner !== null) {
        gate.exclusive = false;
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  }

  /** fill_credential (server/credential-fill.ts), holding the session alone
   * so no other action (a tab switch, a script) lands between its steps.
   * The page's address comes from the engine; a probe with no secret marks
   * the target in the top document; the vault answers only for a granted bot
   * on a bound site; the value is typed by a strict-mode script that checks,
   * in the same evaluation and before it touches the value, that it runs in
   * the top frame of that same origin, on the marked element, focused. The
   * script goes to the engine as agent_browser_eval, which hands it to the
   * engine's command over stdin, never on a command line (agent-browser
   * 0.38.2 mcp.rs call_eval): no process list shows it. The result names the
   * item and the field, never the value. */
  /** Ask the person to approve a payment. The card number stays in the vault. */
  private async requestPurchase(session: string, client: BrowserClient, params: unknown, beforeDispatch: (() => void) | undefined, credentials: CredentialFillAccess | undefined): Promise<unknown> {
    const call = parsePurchaseCall(params);
    if (typeof call === "string") return toolText(call, true);
    if (!credentials?.requestPurchase) return toolText("Purchases are not available in this browser.", true);
    const cardId = itemIdFromHandle(call.credential);
    const addressId = call.address ? itemIdFromHandle(call.address) : null;
    const contactId = call.contact ? itemIdFromHandle(call.contact) : null;
    if (!cardId || (call.address && !addressId) || (call.contact && !contactId)) return toolText("request_purchase needs a card handle (cred_...).", true);
    const href = await this.engineUrl(client);
    beforeDispatch?.();
    if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
    if (!href) return toolText("The page's address could not be read; nothing was asked.", true);
    const opened = credentials.requestPurchase({
      pageUrl: href, amount: call.amount, currency: call.currency, cardId,
      ...(call.merchant ? { merchant: call.merchant } : {}),
      ...(addressId ? { addressId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(call.items ? { items: call.items } : {}),
      ...(call.flights ? { flights: call.flights } : {}),
    });
    return toolText(opened.message, !opened.ok);
  }

  /** The receipt of a purchase the person approved, from the shop's
   * confirmation page (the page's own site, never one the bot names). */
  private async recordPurchase(session: string, client: BrowserClient, params: unknown, beforeDispatch: (() => void) | undefined, credentials: CredentialFillAccess | undefined): Promise<unknown> {
    const call = parseReceiptCall(params);
    if (typeof call === "string") return toolText(call, true);
    if (!credentials?.recordPurchase) return toolText("Purchases are not available in this browser.", true);
    const href = await this.engineUrl(client);
    beforeDispatch?.();
    if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
    if (!href) return toolText("The page's address could not be read; nothing was recorded.", true);
    const recorded = credentials.recordPurchase({ pageUrl: href, ...call });
    return toolText(recorded.message, !recorded.ok);
  }

  private async fillCredential(session: string, spec: BrowserSpawnSpec, client: BrowserClient, params: unknown, beforeDispatch: (() => void) | undefined, credentials: CredentialFillAccess | undefined): Promise<unknown> {
    const request = parseFillArguments(params);
    if (typeof request === "string") return toolText(request, true);
    if (!credentials) return toolText("Saved credentials are not available to you here; nothing was filled.", true);
    if (!await this.holdExclusive(session)) return toolText(BROWSER_FILLING, true);
    const stillOurs = () => {
      beforeDispatch?.();
      if (this.gate(session).owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
    };
    try {
      if (request.field === LOGIN_MODE) return await this.loginHeld(session, spec, client, request, stillOurs, credentials);
      const href = await this.engineUrl(client);
      stillOurs();
      if (!href) return toolText("The page's address could not be read; nothing was filled.", true);
      const done = await this.fillOne(session, spec, client, request, href, stillOurs, credentials);
      if (!done.ok) return toolText(done.message, true);
      return toolText(`Filled the ${FIELD_NAMES[request.field]} of "${done.label}" on ${new URL(href).host}. You do not see the value; check the page and submit the form when ready.`);
    } finally {
      this.gate(session).exclusive = false;
    }
  }

  /** One field, the session already held: probe, vault, write. */
  private async fillOne(session: string, spec: BrowserSpawnSpec, client: BrowserClient, request: FillRequest, href: string, stillOurs: () => void, credentials: CredentialFillAccess, typing?: (nonce: string) => void): Promise<{ ok: true; label: string; nonce: string } | { ok: false; code: string; message: string }> {
    const refuse = (code: string) => ({ ok: false as const, code, message: problemText(code, request.field) });
    const origin = new URL(href).origin;
    if (this.redactor.wasScripted(session, origin)) return refuse("scripted");
    const aim = aimOf(request);
    if (request.ref) {
      const clicked = await client.rpc("tools/call", { name: "agent_browser_click", arguments: { selector: request.ref } });
      stillOurs();
      if ((clicked as { isError?: unknown } | null)?.isError === true) {
        return { ok: false, code: "ref", message: `${request.ref} could not be focused; nothing was filled. Take a new snapshot and pass a current ref.` };
      }
    }
    const nonce = randomBytes(16).toString("hex");
    const probe = parseProbe(await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: probeScript(aim, request.field, nonce, origin), timeoutMs: 5_000 } }));
    stillOurs();
    if (!probe) return { ok: false, code: "unreadable", message: "The page could not be read; nothing was filled." };
    if (probe.problem === "moved") return refuse("moved");
    if (!probe.top) return refuse("frame");
    if (probe.problem) return refuse(probe.problem);
    if (!formStaysOnOrigin(probe.targets, origin)) return refuse("cross_origin_form");
    if (!formPostsOnly(probe.methods)) return refuse("get_form");
    const resolved = await credentials.resolve({ handle: request.credential, field: request.field, pageUrl: href, form: [...probe.targets, ...probe.methods].sort().join("\n") });
    stillOurs();
    if (!resolved.ok) return { ok: false, code: resolved.code ?? "vault", message: resolved.message };
    // Remembered before the value leaves: anything the engine says from now
    // on, including an error that quotes it, is redacted.
    this.redactor.remember(session, resolved.value, { shortLived: request.field === "totp", pieces: request.field !== "username", caseless: request.field === "username" });
    this.redactor.taint(session, origin);
    // The engine's stream would broadcast the write, value included, to its
    // clients: it is off while the write runs.
    const resume = this.pauseStream ? await this.pauseStream(session, spec) : async () => {};
    if (!resume) return { ok: false, code: "stream", message: "The browser's live view could not be paused, so nothing was typed. Try again." };
    // Known before the write leaves, so a sign-in cut short after it (an
    // error, the person taking the browser) still empties this field.
    typing?.(nonce);
    let written: string | null;
    try {
      written = parseWrite(await client.rpc("tools/call", {
        name: "agent_browser_eval", arguments: { script: writeScript(nonce, request.field, origin, resolved.value), timeoutMs: 5_000 },
      }));
    } finally {
      await resume().catch(() => undefined);
    }
    stillOurs();
    if (written !== "ok") return refuse(written ?? "fill_failed");
    return { ok: true, label: resolved.label, nonce };
  }

  /** What the page asks for now (server/login-fill.ts), or null. */
  private async loginState(client: BrowserClient, origin: string): Promise<LoginPageState | null> {
    try {
      return parseLoginState(parseEvalObject(await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: loginStateScript(origin), timeoutMs: 5_000 } })));
    } catch (error) {
      if (error instanceof TransportError) throw error;
      return null;
    }
  }

  /** fill_credential with field "login" (server/login-fill.ts, port of
   * OpenMausBot #2929): each step of the sign-in is filled through fillOne,
   * then submitted once; a field that comes back after it was sent is a
   * refusal, and the password and code are then cleared from the page. */
  private async loginHeld(session: string, spec: BrowserSpawnSpec, client: BrowserClient, request: LoginRequest, stillOurs: () => void, credentials: CredentialFillAccess): Promise<unknown> {
    const secrets: Array<{ nonce: string; origin: string }> = [];
    const state = { settled: false };
    try {
      return await this.loginSteps(session, spec, client, request, stillOurs, credentials, secrets, state);
    } finally {
      // Any exit that is not a finished step (a refusal, an error, a lost
      // engine, the person taking the browser): the password and code Sagax
      // typed are emptied, best effort, so none waits in the page.
      if (!state.settled && secrets.length) {
        for (const origin of new Set(secrets.map((secret) => secret.origin))) {
          const nonces = secrets.filter((secret) => secret.origin === origin).map((secret) => secret.nonce);
          await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: clearScript(nonces, origin), timeoutMs: 5_000 } }).catch(() => undefined);
        }
      }
    }
  }

  private async loginSteps(session: string, spec: BrowserSpawnSpec, client: BrowserClient, request: LoginRequest, stillOurs: () => void, credentials: CredentialFillAccess, secrets: Array<{ nonce: string; origin: string }>, outcome: { settled: boolean }): Promise<unknown> {
    const sent = new Set<LoginField>();
    const filled: LoginField[] = [];
    let label = "";
    const clear = async (): Promise<boolean> => {
      let cleared = false;
      for (const origin of new Set(secrets.map((secret) => secret.origin))) {
        try {
          const nonces = secrets.filter((secret) => secret.origin === origin).map((secret) => secret.nonce);
          const answer = parseWrite(await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: clearScript(nonces, origin), timeoutMs: 5_000 } }));
          cleared ||= answer === "cleared";
        } catch (error) {
          if (error instanceof TransportError) throw error;
        }
      }
      return cleared;
    };
    const finish = (result: LoginOutcome, isError = false) => {
      outcome.settled = result.kind !== "refused" && result.kind !== "nothing";
      return toolText(loginOutcomeText(result), isError);
    };
    for (let step = 0; step < MAX_LOGIN_STEPS; step++) {
      const href = await this.engineUrl(client);
      stillOurs();
      if (!href) return step === 0 ? toolText("The page's address could not be read; nothing was filled.", true) : finish({ kind: "submitted", label, filled, url: "(unreadable)", alert: "" });
      const origin = new URL(href).origin;
      const state = await this.loginState(client, origin);
      stillOurs();
      if (!state) {
        if (step === 0) return toolText("The page could not be read; nothing was filled.", true);
        return finish({ kind: "submitted", label, filled, url: href, alert: "" });
      }
      const { fill, again } = stepFields(state, sent);
      // Sent once and asked again: the site said no. A user name shown
      // again beside a new field is a page that keeps it; a password or
      // code asked again, nothing new at all, or a filled password or code
      // still in place, is a refusal.
      if (step > 0 && (again.some((field) => field !== "username") || (fill.length === 0 && (again.length > 0 || state.secretLeft)))) {
        const cleared = await clear();
        stillOurs();
        return finish({ kind: "refused", label, filled, alert: state.alert, cleared }, true);
      }
      if (fill.length === 0) {
        if (step === 0) return toolText("No sign-in field was found on this page; nothing was filled. Open the site's sign-in page first, or fill one field at a time with its @eN ref.", true);
        return finish({ kind: "submitted", label, filled, url: href, alert: state.alert });
      }
      const stepFilled: LoginField[] = [];
      let last = "";
      for (const field of fill) {
        const done = await this.fillOne(session, spec, client, { credential: request.credential, field }, href, stillOurs, credentials,
          field === "username" ? undefined : (nonce) => { secrets.push({ nonce, origin }); });
        if (!done.ok) {
          // A field the page seemed to have but the finder does not take, or
          // that this login has no value for (a code without a seed): left.
          if (field !== "password" && (done.code === "missing" || done.code === "no_value")) continue;
          if (secrets.length) await clear();
          stillOurs();
          return toolText(done.message, true);
        }
        label = done.label;
        stepFilled.push(field);
        sent.add(field);
        last = done.nonce;
      }
      if (!stepFilled.length) return toolText("This login has nothing to fill into the fields this page shows; nothing was filled.", true);
      filled.push(...stepFilled);
      if (!request.submit) return finish({ kind: "filled_only", label, filled });
      if (state.captcha) return finish({ kind: "captcha", label, filled });
      let submitted: string | null = null;
      try {
        submitted = parseWrite(await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: submitScript(last, origin), timeoutMs: 5_000 } }));
      } catch (error) {
        if (error instanceof TransportError) throw error;
      }
      stillOurs();
      if (submitted === "captcha") return finish({ kind: "captcha", label, filled });
      if (submitted === "unsafe_form") return toolText("The form changed where or how it sends just before the submit (another site, or in the page address), so Sagax did not submit it and emptied the password and code it typed.", true);
      if (submitted !== "submitted" && submitted !== "clicked") return finish({ kind: "no_submit", label, filled });
      await this.settleAfterSubmit(client, href, last, origin, sent, stillOurs);
    }
    const href = await this.engineUrl(client);
    stillOurs();
    return finish({ kind: "submitted", label, filled, url: href || "(unreadable)", alert: "" });
  }

  /** Wait for the page to answer a submit: a new address, the filled field
   * gone, or a field to fill. Bounded; the next step judges (an inline
   * error that leaves the filled password in place is a refusal there). */
  private async settleAfterSubmit(client: BrowserClient, href: string, nonce: string, origin: string, sent: ReadonlySet<LoginField>, stillOurs: () => void): Promise<void> {
    const pause = () => new Promise((resolve) => setTimeout(resolve, this.options.loginPollMs));
    const deadline = Date.now() + this.options.loginSettleMs;
    while (Date.now() < deadline) {
      await pause();
      stillOurs();
      let now = "";
      try { now = await this.engineUrl(client); } catch (error) { if (error instanceof TransportError) throw error; }
      if (now && now !== href) {
        // A navigation: give the new document a moment to be readable.
        for (let tries = 0; tries < 20 && Date.now() < deadline && !await this.loginState(client, new URL(now).origin); tries++) await pause();
        return;
      }
      let marker: string | null = null;
      try {
        marker = parseWrite(await client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: markerScript(nonce, origin), timeoutMs: 5_000 } }));
      } catch (error) {
        if (error instanceof TransportError) throw error;
      }
      if (marker === "gone" || marker === "moved") return;
      const state = await this.loginState(client, origin);
      if (!state) continue;
      const next = stepFields(state, sent);
      if (next.fill.length || next.again.length) return;
    }
  }

  /** A person is about to sign in themselves in this browser (the vault
   * card's "I'll sign in myself", port of OpenMausBot #2707). Refused where a
   * bot ran a script in this browser session (a listener could still wait
   * in the page); otherwise armed like a filled browser: the bot's scripts,
   * screenshots, preview frames and CSS selectors are off until a restart.
   * Null when armed, else the refusal. */
  armForPerson(session: string, botId: string): string | null {
    if (this.signingIn(session)) { this.redactor.taint(session, PERSON_SIGN_IN); this.personSignIns.set(session, { botId, until: this.now() + PERSON_SIGN_IN_MS }); return null; }
    if (this.redactor.everScripted(session)) return "A bot ran a script in this browser, so it is not clean for a sign-in. Press Restart in the Browser panel (or ask the bot to call restart_browser), then try again.";
    this.redactor.taint(session, PERSON_SIGN_IN);
    this.personSignIns.set(session, { botId, until: this.now() + PERSON_SIGN_IN_MS });
    return null;
  }

  /** Whether a person's own sign-in is under way in this session. */
  armedForPerson(session: string): boolean {
    return this.signingIn(session) && this.redactor.isTainted(session, PERSON_SIGN_IN);
  }

  /** Whether a person is signing in themselves in one of this bot's
   * browsers: its browser profile does not change meanwhile. */
  personSigningInForBot(botId: string): boolean {
    return [...this.personSignIns.keys()].some((session) => this.personSignIns.get(session)?.botId === botId && this.signingIn(session));
  }

  /** The person's sign-in ended (Done, or the card declined): the browser
   * stays armed until its next restart, as after a fill. */
  endPersonSignIn(session: string): void {
    this.personSignIns.delete(session);
  }

  /** Forget what a session's browser held (a restart, a close, an idle
   * close). A person's sign-in under way survives it: the session is armed
   * again at once, so no script of the bot runs in the new browser either. */
  private forgetSession(session: string): void {
    this.redactor.forget(session);
    if (this.signingIn(session)) this.redactor.taint(session, PERSON_SIGN_IN);
  }

  /** After the person signed in themselves: empty the page's password and
   * code fields, so the bot never reads them back. Null when done (or no
   * browser runs), else why not (the person still holds the browser). */
  async clearAfterPerson(session: string): Promise<string | null> {
    if (!this.armedForPerson(session)) return NOT_ARMED_FOR_PERSON;
    const entry = this.clients.get(session);
    if (!entry) return null;
    try {
      await this.withAgentAction(session, async () => entry.client.rpc("tools/call", { name: "agent_browser_eval", arguments: { script: CLEAR_SIGN_IN_FIELDS_SCRIPT, timeoutMs: 5_000 } }));
      return null;
    } catch (error) {
      if (error instanceof Error && error.message === BROWSER_CONTROL_REFUSAL) return "Give the browser back to the bot (or wait a few seconds without using it), then press Done.";
      if (error instanceof TransportError) return null;
      return error instanceof Error ? error.message : "The browser could not be reached.";
    }
  }

  /** One call the harness itself makes in a browser it owns (a meeting's
   * private guest browser, server/meetings): no page observation, no result
   * shaping, so a bounded eval answer (an audio segment) arrives whole. Never
   * for a bot's own browser, whose results must keep their shaping and
   * redaction. The session's gate still applies: a person holding the
   * browser pauses it. */
  async harnessCall(session: string, spec: BrowserSpawnSpec, name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    return this.withAgentAction(session, async () => {
      const entry = this.connect(session, spec);
      await entry.client.ready;
      return entry.client.rpc("tools/call", { name, arguments: args }, timeoutMs);
    });
  }

  /** This session's MCP client, started on first use. */
  private connect(session: string, spec: BrowserSpawnSpec): ClientEntry {
    const key = JSON.stringify([spec.command, spec.args, Object.entries(spec.env).sort(([a], [b]) => a.localeCompare(b))]);
    const existing = this.clients.get(session);
    if (existing && existing.key !== key) throw new Error("Browser launch settings changed. Close the browser before reconnecting.");
    if (existing) return existing;
    const client = new BrowserClient(spec, this.options.requestTimeoutMs, this.options.idleMs, this.options.maxPending, () => {
      if (this.clients.get(session)?.client === client) this.clients.delete(session);
    }, (params) => this.latchLostCall(session, toolNameOf(params) ?? "browser"));
    const entry: ClientEntry = { key, client };
    this.clients.set(session, entry);
    return entry;
  }

  /** An agent call lost its transport: the engine may still be running it.
   * Uncertainty already present keeps its cause, so one a person left behind
   * still needs a restart. */
  private latchLostCall(session: string, call: string): void {
    const gate = this.gate(session);
    if (gate.closing || gate.uncertain) return;
    gate.uncertain = true;
    gate.lostCall = call;
  }

  /** Recovery after an agent call lost its transport, in place of a restart
   * that would close every tab and lose page state. The engine runs one
   * command per session, also across connections (measured on agent-browser
   * 0.37.0: a read from a second connection waited for a daemon-side wait and
   * for a click on a frozen page), so a read that answers proves the lost call
   * has ended. It may have taken effect; it is never replayed. Resolves to the
   * page URL, or null while the engine still does not answer. */
  private recoverAfterLoss(session: string, spec: BrowserSpawnSpec): Promise<string | null> {
    let check = this.recoveries.get(session);
    if (!check) {
      check = this.checkEngine(session, spec).finally(() => this.recoveries.delete(session));
      this.recoveries.set(session, check);
    }
    return check;
  }

  private async checkEngine(session: string, spec: BrowserSpawnSpec): Promise<string | null> {
    const gate = this.gate(session);
    gate.agents++; // A takeover or restart waits for the check, as for any agent action.
    try {
      const { client } = this.connect(session, spec);
      await client.ready;
      const result = await client.rpc("tools/call", { name: "agent_browser_get_url", arguments: {} }, this.options.recoveryCheckMs);
      if (gate.closing || gate.owner !== null || !gate.uncertain || gate.lostCall === null) return null;
      gate.uncertain = false;
      gate.lostCall = null;
      return firstText(result).trim().slice(0, 500);
    } catch {
      return null;
    } finally {
      gate.agents--;
      this.changed(gate);
    }
  }

  /** Resolves true when the grant had to wait for a bot command the engine
   * received: the page may have changed since the person aimed. A wait for a
   * refused call or a preview frame is not one, so the person's input stands. */
  async take(session: string, owner: string): Promise<boolean> {
    if (!owner) throw new Error("Browser control requires an owner.");
    const gate = this.gate(session);
    if (gate.closing || gate.releasing) throw new Error("Browser control is changing. Try again shortly.");
    if (gate.owner !== null && gate.owner !== owner) throw new Error("Another person controls this browser.");
    gate.owner = owner; // synchronous: no new agent work slips in while draining.
    gate.ready = false;
    const waited = gate.dispatched > 0;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        gate.changed.delete(check);
        if (error) reject(error);
        else { gate.ready = true; resolve(); }
      };
      const check = () => {
        if (gate.owner !== owner || gate.releasing || gate.closing) finish(new Error("Browser control request was cancelled."));
        else if (gate.uncertain) finish(new Error("A browser action may still be running. Restart this browser before taking control."));
        else if (gate.agents === 0) finish();
      };
      const timer = setTimeout(() => finish(new Error("Browser action is still finishing. Control remains paused; retry taking control or hand it back.")), this.options.takeoverTimeoutMs);
      timer.unref();
      gate.changed.add(check);
      check();
    });
    return waited;
  }

  canControl(session: string, owner: string): boolean {
    const gate = this.gates.get(session);
    return Boolean(owner && gate?.owner === owner && gate.ready && !gate.releasing && !gate.closing && !gate.uncertain && gate.agents === 0);
  }

  heldBy(session: string): string | null { return this.gates.get(session)?.owner ?? null; }

  /** An interrupted action left the browser's state unknown; only a restart clears it. */
  interrupted(session: string): boolean { return this.gates.get(session)?.uncertain === true; }

  /** A disconnected viewer may leave a physical key/button pressed. Never
   * let an agent inherit that input state; explicit restart clears it. */
  abandonHumanInput(session: string, owner: string): void {
    const gate = this.gates.get(session);
    if (!owner || !gate || gate.owner !== owner) return;
    gate.uncertain = true;
    gate.lostCall = null;
    gate.ready = false;
    this.changed(gate);
  }

  release(session: string, owner: string): void {
    const gate = this.gates.get(session);
    if (!owner || !gate || gate.owner !== owner) return;
    gate.ready = false;
    gate.releasing = true;
    gate.lastUsed = Date.now();
    this.changed(gate); // don't admit agents until pending human input drains.
  }

  async withHumanAction<T>(session: string, owner: string, fn: () => Promise<T>): Promise<T> {
    if (!this.canControl(session, owner)) throw new Error("Take control of this browser before interacting.");
    const gate = this.gate(session);
    gate.humans++;
    try { return await fn(); }
    catch (error) {
      // Validation happens before entry. A failed accepted command might still
      // be executing in the daemon; hand-back must not race its completion.
      // One the engine answered as failed is over, and the browser stays usable.
      if (!isSettledBrowserFailure(error)) {
        gate.uncertain = true;
        gate.lostCall = null;
        gate.ready = false;
      }
      throw error;
    }
    finally { gate.humans--; gate.lastUsed = Date.now(); this.changed(gate); }
  }

  /** A live view opened on this browser: it stays open while watched, and
   * its idle time starts when the last view leaves. Call the returned
   * function once the view closes. */
  watch(session: string, spec: { command: string; args?: readonly string[]; env?: Record<string, string | undefined> }): () => void {
    const gate = this.gate(session);
    gate.watchers++;
    gate.spec = { command: spec.command, args: [...spec.args ?? []], env: { ...spec.env } } as BrowserSpawnSpec;
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      gate.watchers--;
      gate.lastUsed = Date.now();
    };
  }

  /** Resolves once an idle close of this browser in progress is over. */
  async settled(session: string): Promise<void> { await this.gates.get(session)?.idleClose; }

  /** Close a browser nothing has used for `idleMs`: no bot call, no person's
   * hold or input, no open live view (the caller checks that no turn holds
   * it). Saved sign-ins stay, and the next call opens it again. The same
   * barrier as a restart, so nothing reaches the browser while it closes.
   * A browser attached to the person's own Chrome is never closed. `spec`
   * is its launch settings for one nothing here has called yet (a turn
   * that has not used it): its idle time starts at this first look. */
  async closeIfIdle(session: string, idleMs: number, spec?: { command: string; args?: readonly string[]; env: Record<string, string | undefined> }): Promise<boolean> {
    const gate = spec ? this.gate(session) : this.gates.get(session);
    if (gate && !gate.spec && spec) gate.spec = { command: spec.command, args: [...spec.args ?? []], env: { ...spec.env } } as BrowserSpawnSpec;
    const launch = gate?.spec;
    if (!gate || !launch || launch.env.AGENT_BROWSER_CDP || launch.env.AGENT_BROWSER_AUTO_CONNECT || !(idleMs > 0) || Date.now() - gate.lastUsed < idleMs) return false;
    if (gate.calls || gate.agents || gate.humans || gate.owner !== null || gate.closing || gate.releasing || gate.watchers || gate.exclusive) return false;
    gate.closing = true;
    gate.ready = false;
    let finished!: () => void;
    gate.idleClose = new Promise((resolve) => { finished = resolve; });
    this.changed(gate);
    try {
      if (!await this.closeBrowser(session, launch)) return false;
      this.forgetSession(session);
      await this.clients.get(session)?.client.stop();
      await this.clients.get(session)?.client.stop(); // see restart()
      gate.uncertain = false;
      gate.lostCall = null;
      gate.idleClosed = true;
      return true;
    } catch {
      return false;
    } finally {
      gate.closing = false;
      gate.idleClose = undefined;
      finished();
      this.changed(gate);
    }
  }

  /** Exclusive recovery. Unlike take(), this never waits through active work
   * or admits human input; a successful native close is its safety barrier. */
  async restart(session: string, owner: string, closeBrowser: () => Promise<void>): Promise<void> {
    if (!owner) throw new Error("Browser recovery requires an owner.");
    const gate = this.gate(session);
    if (gate.closing || gate.releasing || gate.agents || gate.humans) throw new Error("The browser is busy. Wait for current work to finish before restarting.");
    if (gate.owner !== null && gate.owner !== owner) throw new Error("Another person controls this browser.");
    gate.owner = owner;
    gate.ready = false;
    gate.closing = true;
    this.changed(gate);
    try {
      await closeBrowser();
      this.forgetSession(session);
      await this.clients.get(session)?.client.stop();
      // A tools/list admitted before closing set in can register a client
      // while that stop awaits; registration is synchronous, so one re-check
      // is deterministic and no stray transport survives to idle expiry.
      await this.clients.get(session)?.client.stop();
      gate.uncertain = false;
      gate.lostCall = null;
      gate.owner = null;
      gate.releasing = false;
    } catch (error) {
      gate.owner = owner;
      gate.uncertain = true;
      gate.lostCall = null;
      throw error;
    } finally {
      gate.closing = false;
      this.changed(gate);
    }
  }

  /** The agent's own recovery, for a turn with no Browser panel to press
   * Restart in. The same barrier as restart() — the native browser must
   * close — but it never takes a person's hold, and a failed close leaves no
   * owner behind that would lock a person out of the panel. */
  async agentRestart(session: string, closeBrowser: () => Promise<boolean>): Promise<void> {
    // A person is signing in themselves here: a bot's restart would wipe
    // what keeps its scripts off (armForPerson), so it waits for Done.
    if (this.signingIn(session)) throw new Error(PERSON_SIGNING_IN);
    const gate = this.gate(session);
    if (gate.owner !== null) throw new Error(BROWSER_CONTROL_REFUSAL);
    if (gate.closing || gate.releasing || gate.agents || gate.humans) throw new Error("The browser is busy. Wait for current work to finish before restarting.");
    gate.ready = false;
    gate.closing = true;
    this.changed(gate);
    try {
      if (!await closeBrowser()) throw new Error("The browser could not be closed. Ask the person to press Restart in the Browser panel of Sagax on their computer, or to restart Sagax.");
      this.forgetSession(session);
      await this.clients.get(session)?.client.stop();
      await this.clients.get(session)?.client.stop(); // see restart()
      gate.uncertain = false;
      gate.lostCall = null;
    } catch (error) {
      gate.uncertain = true;
      gate.lostCall = null;
      throw error;
    } finally {
      gate.closing = false;
      this.changed(gate);
    }
  }

  /** Call after the underlying browser is closed when recovering an uncertain
   * action. This closes the MCP transport, not saved logins or profile files. */
  async close(session: string): Promise<void> {
    const gate = this.gate(session);
    gate.closing = true;
    gate.ready = false;
    // Clear before the awaited stop: any uncertain latch after this point must win.
    gate.uncertain = false;
    gate.lostCall = null;
    this.changed(gate);
    await this.clients.get(session)?.client.stop();
    gate.closing = false;
    this.changed(gate);
    if (!gate.owner && !gate.agents && !gate.humans && !gate.watchers && !gate.calls) { this.gates.delete(session); this.toolLists.delete(session); this.forgetSession(session); }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...new Set([...this.clients.keys(), ...this.gates.keys()])].map((session) => this.close(session)));
  }
}

function stuckBrowserToolError(): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text: BROWSER_INTERRUPTED }] };
}

function lostCallToolError(call: string): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text: `The browser did not answer this ${call} call. It may still be running, or it may already have taken effect. Do not repeat it yet: your next browser call first waits for the browser, then tells you where the page is. Call ${BROWSER_RESTART_TOOL} only if the browser stays busy, because ${RESTART_COST}.` }] };
}

function stillBusyToolError(call: string): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text: `The browser is still busy with an earlier ${call} call that did not answer. This call did not run. Try again in a moment. If the browser stays busy, call ${BROWSER_RESTART_TOOL}; ${RESTART_COST}.` }] };
}

function recoveredResult(call: string, url: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: `The browser answers again: the earlier ${call} call that did not answer has ended, and it may have taken effect. This call did not run. The current page is ${url || "unknown"}. Check the page before you repeat the earlier action, then call again what you need.` }] };
}

function toolNameOf(params: unknown): string | undefined {
  const name = (params as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : undefined;
}

function firstText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  const part = Array.isArray(content) ? content.find((item) => typeof (item as { text?: unknown } | null)?.text === "string") : undefined;
  return part ? (part as { text: string }).text : "";
}

/** The harness's own tools beside the engine's: restart_browser and
 * fill_credential. An engine tool with either name is replaced. */
function withRestartTool(result: unknown): unknown {
  if (!result || typeof result !== "object" || !Array.isArray((result as { tools?: unknown }).tools)) return result;
  const own = new Set<unknown>([BROWSER_RESTART_TOOL, FILL_CREDENTIAL_TOOL, REQUEST_PURCHASE_TOOL, RECORD_PURCHASE_TOOL]);
  const tools = ((result as { tools: unknown[] }).tools).filter((tool) => !own.has((tool as { name?: unknown } | null)?.name));
  return { ...result, tools: [...tools, BROWSER_RESTART_TOOL_SPEC, FILL_CREDENTIAL_TOOL_SPEC, REQUEST_PURCHASE_TOOL_SPEC, RECORD_PURCHASE_TOOL_SPEC] };
}
