// The desktop bridge (organization server, server mode): a person's own Sagax
// desktop app, signed in to this server, is the bridge between the server and
// their PC. Bots in that person's conversations run their shell, file, search,
// fetch, browser, computer-use and Local VM tools ON THAT PC, the same tools
// as solo mode, behind the same approval prompts (the engine asks before each
// tool, per the bot's approval mode).
//
// Why Sagax-provided tools and not the engine CLI on the desktop: the engine,
// its credentials (the speaker's subscription, the organization key), the
// payer and the transcript stay on the server, where the organization's
// policies hold; the desktop only ever receives typed, validated operations
// (below) for the person it is signed in as, and executes them locally with
// its own last say (protected paths, its own size limits). The engines' own
// host tools stay denied on the server (server/drivers/host-tools.ts).
//
// Rendezvous only, like SharedComputers: the desktop connects OUT (HTTPS long
// poll), so no port opens on the PC. Every connection is bound to the signed-in
// person of the session that registered it, and every poll, lease and result
// checks again that this session is live AND still that same person: a session
// that changed hands, or another person's session holding a stolen id and
// secret, is refused.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import type { BotWorkplace } from "../shared/bot-workplace.ts";

const ABSOLUTE_PATH = /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/;
// oxlint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

export const desktopBridgeRegistration = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).regex(NO_CONTROL),
  platform: z.enum(["darwin", "win32", "linux"]),
  /** Where this desktop keeps the files people attach (its own temp folder). */
  attachmentsDir: z.string().min(2).max(1024).regex(ABSOLUTE_PATH).regex(NO_CONTROL),
  capabilities: z.object({
    shell: z.boolean(), files: z.boolean(), fetch: z.boolean(), browser: z.boolean(), computer: z.boolean(), localVm: z.boolean(),
    /** Optional so a desktop that predates local models still registers. */
    localModels: z.boolean().optional(),
  }).strict(),
  version: z.string().max(40).optional(),
}).strict();
export type DesktopBridgeRegistration = z.infer<typeof desktopBridgeRegistration>;

/** Coarse facts about the person's own computer for their Computer tab
 * (OS, CPU, memory, disk), sent by the desktop app now and then. Rounded on
 * the desktop; nothing that identifies files, apps or networks. */
export const desktopSystemInfo = z.object({
  os: z.string().min(1).max(80).regex(NO_CONTROL),
  arch: z.string().min(1).max(20).regex(NO_CONTROL),
  cpuModel: z.string().max(80).regex(NO_CONTROL).optional(),
  cpus: z.number().int().min(1).max(1024),
  cpuPercent: z.number().int().min(0).max(100).optional(),
  memoryGb: z.number().min(0).max(65536),
  memoryUsedGb: z.number().min(0).max(65536).optional(),
  diskGb: z.number().min(0).max(1_000_000).optional(),
  diskFreeGb: z.number().min(0).max(1_000_000).optional(),
}).strict();
export type DesktopSystemInfo = z.infer<typeof desktopSystemInfo>;

// Messages (iMessage) is intentionally not a bridge action. It runs only
// inside the solo Sagax process on the Mac where that process runs
// (server/imessage-mcp.ts). An organization server must not ask the
// signed-in desktop to read or send Messages.
export const DESKTOP_BRIDGE_ACTIONS = [
  "run_command", "read_file", "write_file", "list_files", "search_files", "fetch_url", "browse",
  "computer_tools", "computer_call", "vm_status", "vm_start", "vm_run_command", "vm_create", "stage_file",
  // Unpack a staged archive next to it (electron/archive-extract.mjs).
  "extract_archive",
  // The person's own Local VM from their Computer tab (desktop-bridge-routes.ts).
  "vm_stop", "vm_pause", "vm_resume", "vm_setup", "vm_install", "vm_screenshot", "vm_computer_call",
  // One allowlisted call to a loopback model the desktop published (endpoint id, never a URL).
  "local_model",
  // The in-chat terminal the person opened on their computer or its Local VM
  // (server/desktop-terminal.ts): the app connects back with the ticket.
  "terminal_open", "vm_terminal_open",
] as const;
export type DesktopBridgeAction = (typeof DESKTOP_BRIDGE_ACTIONS)[number];

export const desktopBridgeOperation = z.object({
  action: z.enum(DESKTOP_BRIDGE_ACTIONS),
  path: z.string().max(4096).optional(),
  content: z.string().max(1_500_000).optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  /** stage_file can carry the server's largest accepted video in chunks. */
  offset: z.number().int().min(0).max(1024 * 1024 * 1024).optional(),
  max_bytes: z.number().int().min(1).max(1_000_000).optional(),
  command: z.string().max(100_000).optional(),
  cwd: z.string().max(4096).optional(),
  timeout_seconds: z.number().min(1).max(600).optional(),
  pattern: z.string().max(1000).optional(),
  glob: z.string().max(400).optional(),
  url: z.string().max(4096).optional(),
  screenshot: z.boolean().optional(),
  tool_name: z.string().max(100).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  container: z.string().max(200).optional(),
  /** stage_file, extract_archive: the file name in the desktop's attachments folder. */
  name: z.string().max(255).optional(),
  final: z.boolean().optional(),
  /** local_model: an endpoint id the desktop published. Not a URL. */
  endpoint: z.string().max(40).optional(),
  http_method: z.enum(["GET", "POST"]).optional(),
  http_path: z.enum(["/models", "/chat/completions", "/messages"]).optional(),
  /** local_model JSON body. Never logged. */
  json: z.string().max(1_000_000).optional(),
  /** run_command, vm_run_command: the command variables the person exposed
   * to this bot (server/credential-command-env.ts), merged into the
   * command's environment on the desktop. Never logged. */
  env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), z.string().max(100_000)).optional(),
}).strict();
export type DesktopBridgeOperation = z.infer<typeof desktopBridgeOperation>;

/** Which capability an action needs; the desktop checks it again. */
export function desktopBridgeCapability(action: DesktopBridgeAction): keyof DesktopBridgeRegistration["capabilities"] {
  switch (action) {
    case "run_command": case "terminal_open": return "shell";
    case "read_file": case "write_file": case "list_files": case "search_files": case "stage_file": case "extract_archive": return "files";
    case "fetch_url": return "fetch";
    case "browse": return "browser";
    case "computer_tools": case "computer_call": return "computer";
    case "vm_status": case "vm_start": case "vm_run_command": case "vm_create":
    case "vm_stop": case "vm_pause": case "vm_resume": case "vm_setup": case "vm_install": case "vm_screenshot": case "vm_computer_call": case "vm_terminal_open": return "localVm";
    case "local_model": return "localModels";
  }
}

export type DesktopBridgeStatus = { id: string; name: string; platform: string; online: boolean; busy: boolean; lastSeenAt: number; capabilities: DesktopBridgeRegistration["capabilities"]; system?: DesktopSystemInfo };

type Job = { id: string; operation: DesktopBridgeOperation; active: () => boolean; sent: boolean; resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; progress?: (message: string) => void; progressCount: number };
type Bridge = { registration: DesktopBridgeRegistration; session: string; person: string; secret: string; seen: number; connectedAt: number; jobs: Map<string, Job>; wake?: () => void; system?: DesktopSystemInfo };

const failure = (message: string, status = 409, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || null;
/** Bounds memory: one entry per signed-in desktop. */
const TOTAL = 500;
/** A desktop that stopped polling this long ago is offline. */
const ONLINE_MS = 40_000;
const MAX_QUEUED = 8;
const POLL_MS = 20_000;

export const DESKTOP_BRIDGE_MESSAGES = {
  offline: "Your computer is not connected right now. Open the Sagax desktop app, signed in to this server, then try again. Nothing ran.",
  busy: "Your computer is busy with other bot actions. Wait for them to finish.",
  capability: "Your Sagax desktop app does not offer this on this computer.",
  ended: "The requesting turn ended.",
  chosenOffline: "That computer is not connected right now. Open the Sagax desktop app on it, signed in to this server, or pick another computer. Nothing ran.",
} as const;

export class DesktopBridges {
  private bridges = new Map<string, Bridge>();
  /** The name a person gave one of their computers (Settings > Computer),
   * by person and desktop id. It outlives the bridge's own entry, so an app
   * restart keeps it, and with a labels file it survives a server restart. */
  private labels = new Map<string, string>();
  private removals = new Map<string, number[]>();
  private sessionPerson: (sessionId: string) => string | null;
  private now: () => number;
  /** `sessionPerson`: the person a live session is signed in as right now,
   * null when the session ended. */
  private labelsFile: string | undefined;
  constructor(sessionPerson: (sessionId: string) => string | null, now: () => number = Date.now, labelsFile?: string) {
    this.sessionPerson = sessionPerson;
    this.now = now;
    this.labelsFile = labelsFile;
    if (!labelsFile) return;
    try {
      const stored = JSON.parse(readFileSync(labelsFile, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(stored)) if (typeof value === "string" && value.length <= 120) this.labels.set(key, value);
    } catch { /* none yet, or unreadable: no names */ }
  }

  /** Temp-and-rename, so a crash never leaves a truncated file. A failed
   * write keeps the name for this run. */
  private saveLabels(): void {
    if (!this.labelsFile) return;
    const temporary = `${this.labelsFile}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.labelsFile), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(Object.fromEntries(this.labels))}\n`, { mode: 0o600 });
      renameSync(temporary, this.labelsFile);
    } catch { /* the name still holds in memory */ }
  }
  private static key(session: string, id: string) { return `${session}\n${id}`; }

  /** Connect (or reconnect) one desktop for the person signed in on
   * `session`. The person comes from the session, never from the body. */
  register(registration: DesktopBridgeRegistration, session: string, secret: string) {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw failure("Invalid desktop credential", 400);
    const person = normalize(this.sessionPerson(session));
    if (!person) throw failure("Sign in to this server first", 401);
    const key = DesktopBridges.key(session, registration.id);
    const old = this.bridges.get(key);
    if (old) {
      this.authorize(registration.id, session, secret);
      old.registration = registration; old.seen = this.now();
      return;
    }
    this.reap();
    // One bridge per desktop session: a new id from the same session
    // replaces its earlier one (an app restart), never another session's.
    for (const [stale, entry] of this.bridges) {
      if (entry.session !== session) continue;
      this.drop(stale, entry, "Your desktop app reconnected. An action in flight may have completed; check before repeating it.");
    }
    if (this.bridges.size >= TOTAL) throw failure("Too many connected desktops", 503);
    const at = this.now();
    this.bridges.set(key, { registration, session, person, secret, seen: at, connectedAt: at, jobs: new Map() });
  }

  private drop(key: string, entry: Bridge, message: string) {
    this.bridges.delete(key); entry.wake?.();
    for (const job of entry.jobs.values()) this.finish(entry, job, failure(message));
  }

  private reap() {
    for (const [key, entry] of this.bridges) {
      if (normalize(this.sessionPerson(entry.session)) !== entry.person) this.drop(key, entry, DESKTOP_BRIDGE_MESSAGES.offline);
      else if (entry.jobs.size === 0 && this.now() - entry.seen > 24 * 60 * 60_000) this.bridges.delete(key);
    }
  }

  /** Live, authenticated and still the same person. */
  private online(entry: Bridge) {
    return normalize(this.sessionPerson(entry.session)) === entry.person && this.now() - entry.seen < ONLINE_MS;
  }

  private authorize(id: string, session: string, secret: string) {
    const key = DesktopBridges.key(session, id);
    const entry = this.bridges.get(key);
    const ok = entry && /^[a-f0-9]{64}$/.test(secret) && timingSafeEqual(Buffer.from(secret), Buffer.from(entry.secret));
    if (!entry || !ok) throw failure("This desktop is not connected or not authorized", 403);
    // The session must still be signed in as the person who connected: a
    // relay for anyone else is refused, and the bridge is closed.
    if (normalize(this.sessionPerson(session)) !== entry.person) {
      this.drop(key, entry, DESKTOP_BRIDGE_MESSAGES.offline);
      throw failure("This desktop is signed in as someone else now; connect again", 403);
    }
    return entry;
  }

  /** Whether `id` is registered by this session with this secret, and the
   * session is still that person (the tunnel's check). */
  owns(id: string, session: string, secret: string): boolean {
    try { this.authorize(id, session, secret); return true; } catch { return false; }
  }

  /** The desktop a person's bots use right now: their most recently
   * connected online desktop. */
  current(person: string | null): DesktopBridgeRegistration | null {
    const key = normalize(person);
    if (!key) return null;
    let best: Bridge | null = null;
    for (const entry of this.bridges.values()) {
      if (entry.person !== key || !this.online(entry)) continue;
      if (!best || entry.connectedAt > best.connectedAt) best = entry;
    }
    return best?.registration ?? null;
  }

  connected(person: string | null): boolean { return this.current(person) !== null; }

  /** What a person sees about their own desktops. No secret, no session. */
  status(person: string | null): DesktopBridgeStatus[] {
    const key = normalize(person);
    if (!key) return [];
    this.reap();
    return [...this.bridges.values()].filter(entry => entry.person === key).map(entry => ({
      id: entry.registration.id, name: this.labels.get(`${key}\n${entry.registration.id}`) ?? entry.registration.name, platform: entry.registration.platform,
      online: this.online(entry), busy: entry.jobs.size > 0, lastSeenAt: entry.seen, capabilities: { ...entry.registration.capabilities },
      ...(entry.system ? { system: { ...entry.system } } : {}),
    }));
  }

  /** The person's computer named by `which` (its id, or its name, upper or
   * lower case), among the ones this server knows. */
  private pick(person: string, which: string): Bridge[] {
    const wanted = which.trim();
    if (!wanted) throw failure("Name the computer", 400, "computer_missing");
    const mine = [...this.bridges.values()].filter(entry => entry.person === person);
    const byId = mine.filter(entry => entry.registration.id === wanted);
    const found = byId.length ? byId : mine.filter(entry => [this.labels.get(`${person}\n${entry.registration.id}`), entry.registration.name].some(name => name?.toLowerCase() === wanted.toLowerCase()));
    if (found.length === 0) throw failure("That computer is not in your list", 404, "computer_unknown");
    if (new Set(found.map(entry => entry.registration.id)).size > 1) throw failure("Several computers have that name; use another name or its id", 409, "computer_ambiguous");
    return found;
  }

  /** Give a computer of the person's another name (1 to 120 characters). */
  rename(person: string | null, which: string, name: string): { id: string; name: string } {
    const key = normalize(person);
    if (!key) throw failure("Sign in to this server first", 401);
    const label = name.trim();
    if (label.length < 1 || label.length > 120 || !NO_CONTROL.test(label)) throw failure("A computer's name is 1 to 120 characters", 400, "computer_name");
    this.reap();
    const id = this.pick(key, which)[0]!.registration.id;
    this.labels.set(`${key}\n${id}`, label);
    this.saveLabels();
    return { id, name: label };
  }

  /** Take a computer off the person's list. Refused while it is online (it
   * would be back on its next poll), and at most 10 a minute. */
  remove(person: string | null, which: string): { id: string } {
    const key = normalize(person);
    if (!key) throw failure("Sign in to this server first", 401);
    this.reap();
    const found = this.pick(key, which);
    if (found.some(entry => this.online(entry))) throw failure("A computer cannot be removed while it is online", 409, "computer_online");
    const at = this.now();
    const recent = (this.removals.get(key) ?? []).filter(time => at - time < 60_000);
    if (recent.length >= 10) throw failure("Too many removals; try again in a minute", 429, "computer_rate");
    this.removals.set(key, [...recent, at]);
    const id = found[0]!.registration.id;
    for (const [bridgeKey, entry] of this.bridges) if (entry.person === key && entry.registration.id === id) this.drop(bridgeKey, entry, DESKTOP_BRIDGE_MESSAGES.offline);
    if (this.labels.delete(`${key}\n${id}`)) this.saveLabels();
    return { id };
  }

  /** Every connected desktop and its person, for the organization admin
   * API's Computers (2026-10-11): what a desktop is called, its platform,
   * whether it is online and when it was last seen. No secret, no session,
   * no system facts. */
  inventory(): Array<{ person: string; id: string; name: string; platform: string; online: boolean; lastSeenAt: number; localVm: boolean; version: string | null }> {
    this.reap();
    return [...this.bridges.values()].map(entry => ({
      person: entry.person, id: entry.registration.id, name: this.labels.get(`${entry.person}\n${entry.registration.id}`) ?? entry.registration.name, platform: entry.registration.platform,
      online: this.online(entry), lastSeenAt: entry.seen, localVm: entry.registration.capabilities.localVm, version: entry.registration.version ?? null,
    }));
  }

  /** The desktop's coarse system facts, for its own person only. */
  setSystem(id: string, session: string, secret: string, system: DesktopSystemInfo): void {
    const entry = this.authorize(id, session, secret);
    entry.system = system;
  }

  /** `listening`: the desktop's request is still open. A poll the desktop
   * gave up on (app closed, network gone) does not count as seen. */
  async poll(id: string, session: string, secret: string, wait = POLL_MS, listening: () => boolean = () => true) {
    const entry = this.authorize(id, session, secret);
    if (entry.wake) throw failure("A poll is already running for this desktop");
    entry.seen = this.now();
    const next = () => {
      for (const job of entry.jobs.values()) {
        if (!job.active()) { this.finish(entry, job, failure(DESKTOP_BRIDGE_MESSAGES.ended)); continue; }
        if (!job.sent) { job.sent = true; return { id: job.id, operation: job.operation }; }
      }
      return null;
    };
    const queued = next();
    if (queued) return queued;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { entry.wake = undefined; resolve(); }, wait);
      entry.wake = () => { clearTimeout(timer); entry.wake = undefined; resolve(); };
    });
    this.authorize(id, session, secret);
    if (!listening()) return null;
    entry.seen = this.now();
    return next();
  }

  /** A job handed to a poll whose desktop was gone before the answer left:
   * it was never seen, so it may be handed out again. */
  requeue(id: string, session: string, secret: string, jobId: string) {
    try {
      const entry = this.authorize(id, session, secret);
      const job = entry.jobs.get(jobId);
      if (job) job.sent = false;
    } catch { /* the bridge is gone; its jobs fail with it */ }
  }

  liveJob(id: string, session: string, secret: string, jobId: string) {
    const entry = this.authorize(id, session, secret);
    entry.seen = this.now();
    const job = entry.jobs.get(jobId);
    return job?.sent === true && job.active();
  }

  /** A step of a running job (Local VM creation), for the turn. Bounded,
   * plain text; a job that is not this desktop's, not handed out or no
   * longer wanted is ignored. */
  progress(id: string, session: string, secret: string, jobId: string, message: unknown): boolean {
    const entry = this.authorize(id, session, secret);
    entry.seen = this.now();
    const job = entry.jobs.get(jobId);
    if (!job?.sent || !job.active() || !job.progress || typeof message !== "string") return false;
    // oxlint-disable-next-line no-control-regex
    const clean = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
    if (!clean || job.progressCount >= 50) return false;
    job.progressCount++;
    try { job.progress(clean); } catch { /* the turn's display only */ }
    return true;
  }

  complete(id: string, session: string, secret: string, jobId: string, result: unknown) {
    const entry = this.authorize(id, session, secret);
    entry.seen = this.now();
    const job = entry.jobs.get(jobId);
    if (!job || !job.sent) throw failure("This action expired; it will not be replayed");
    this.finish(entry, job, job.active() ? null : failure(DESKTOP_BRIDGE_MESSAGES.ended), result);
  }

  disconnect(id: string, session: string, secret: string) {
    const entry = this.authorize(id, session, secret);
    this.drop(DesktopBridges.key(session, id), entry, "Your desktop app disconnected. An action in flight may have completed; check before repeating it.");
  }

  /** The person signed out or their session ended: close their bridges. */
  closeSession(session: string) {
    for (const [key, entry] of this.bridges) if (entry.session === session) this.drop(key, entry, DESKTOP_BRIDGE_MESSAGES.offline);
  }

  /** One operation on `person`'s own connected desktop. Another person's
   * desktop is never reachable from here: the lookup is by person. With
   * `desktopId` (a person with several computers picking one by its name,
   * from their Computer tab) it is that desktop of theirs or nothing;
   * without it, their most recently connected online desktop. */
  request(person: string | null, operation: DesktopBridgeOperation, active: () => boolean, onProgress?: (message: string) => void, desktopId?: string): Promise<unknown> {
    const key = normalize(person);
    if (!key) return Promise.reject(failure("No person asked in this turn, so no one's computer can be used.", 403, "no_person"));
    let entry: Bridge | null = null;
    for (const candidate of this.bridges.values()) {
      if (candidate.person !== key || !this.online(candidate)) continue;
      if (desktopId !== undefined && candidate.registration.id !== desktopId) continue;
      if (!entry || candidate.connectedAt > entry.connectedAt) entry = candidate;
    }
    if (!entry && desktopId !== undefined) return Promise.reject(failure(DESKTOP_BRIDGE_MESSAGES.chosenOffline, 409, "not_connected"));
    if (!entry) return Promise.reject(failure(DESKTOP_BRIDGE_MESSAGES.offline, 409, "not_connected"));
    if (!entry.registration.capabilities[desktopBridgeCapability(operation.action)]) return Promise.reject(failure(DESKTOP_BRIDGE_MESSAGES.capability, 403, "capability"));
    if (entry.jobs.size >= MAX_QUEUED) return Promise.reject(failure(DESKTOP_BRIDGE_MESSAGES.busy, 429, "busy"));
    if (!active()) return Promise.reject(failure(DESKTOP_BRIDGE_MESSAGES.ended, 401));
    const bridge = entry;
    const timeoutMs = Math.min(660_000, ((operation.timeout_seconds ?? 120) + 60) * 1000);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const job: Job = { id, operation, active, sent: false, resolve, reject, progress: onProgress, progressCount: 0, timer: setTimeout(() => this.finish(bridge, job, failure("Your computer did not answer in time. The action's outcome is unknown; check before repeating it.")), timeoutMs) };
      bridge.jobs.set(id, job); bridge.wake?.();
    });
  }

  close() {
    for (const [key, entry] of this.bridges) this.drop(key, entry, "The server is stopping. Check any action in flight before repeating it.");
  }

  private finish(entry: Bridge, job: Job, error: Error | null, result?: unknown) {
    clearTimeout(job.timer);
    if (!entry.jobs.delete(job.id)) return;
    if (error) job.reject(error); else job.resolve(result);
  }
}

// ── where a turn's tools run ──────────────────────────────────────────

export type WorkplaceTarget = "user-desktop" | "user-sandbox" | "host" | "none";
export type WorkplaceReason =
  | "solo"                    // a solo server: its own machine, unchanged
  | "desktop"                 // the person's connected desktop
  | "pinned-desktop"          // Works on (or the pin) is their computer, not connected
  | "server-default"          // Auto or Cloud: their server environment
  | "routine-not-allowed"     // a routine, and the owner did not allow their PC
  | "no-person"               // nobody asked: a room follow-up, ...
  | "unknown";                // nobody known at all

export interface WorkplaceDecision {
  target: WorkplaceTarget;
  /** Whose computer or environment, fixed for the whole turn. */
  principal: string | null;
  reason: WorkplaceReason;
  /** The person wanted their computer and gets their server environment
   * instead: the UI and the bot say so. */
  fallback: boolean;
}

/** Where one turn's shell, file and browser tools run on an organization
 * server, and for whom. Pure: tested on its own (desktop-bridge.test.ts).
 *
 * The bot's Works on (or the conversation's pin) decides, never a
 * per-person switch (2026-10-02):
 * - Auto and Cloud: the person's server environment (the default).
 * - Local VM and This computer (`desktopTargeted`): the person's own
 *   computer through their Sagax desktop app, when it is connected; else
 *   nothing runs there and the bot is told why (reason "pinned-desktop").
 * - Conversation (1:1, private thread, a teammate's bot): the SPEAKER's.
 * - Room: the person whose message triggered the turn; a follow-up no
 *   person asked for never reaches anyone's computer.
 * - Routine (runs as the bot owner, unattended): the owner's server
 *   environment, unless the bot works on their computer, it is connected
 *   AND they allowed routines on it. */
export function resolveBotWorkplace(input: {
  organization: boolean;
  sandboxConfigured: boolean;
  /** Works on (or the conversation's pin) is the person's own computer:
   * Local VM or This computer. */
  desktopTargeted: boolean;
  /** The turn belongs to a routine (directly or through hops). */
  routine: boolean;
  /** sandboxPrincipalForTurn: speaker, routine owner or room creator. */
  principal: string | null;
  /** A person's own message (or a hop carrying it) started this turn. */
  personAsked: boolean;
  /** The principal's preference. */
  preference: BotWorkplace;
  /** The principal's desktop app is connected and signed in right now. */
  desktopConnected: boolean;
}): WorkplaceDecision {
  if (!input.organization) return { target: "host", principal: null, reason: "solo", fallback: false };
  const principal = input.principal?.trim().toLowerCase() || null;
  const server = (reason: WorkplaceReason, fallback = false): WorkplaceDecision =>
    ({ target: input.sandboxConfigured && principal ? "user-sandbox" : "none", principal, reason, fallback });
  if (!principal) return { target: "none", principal: null, reason: "unknown", fallback: false };
  if (input.routine) {
    if (input.desktopTargeted && input.desktopConnected && input.preference.routines) {
      return { target: "user-desktop", principal, reason: "desktop", fallback: false };
    }
    return server("routine-not-allowed");
  }
  if (!input.personAsked) return server("no-person");
  if (input.desktopTargeted) return { target: "user-desktop", principal, reason: input.desktopConnected ? "desktop" : "pinned-desktop", fallback: false };
  return server("server-default");
}
