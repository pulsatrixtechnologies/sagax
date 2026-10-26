// Live Tailcat sessions for one Sagax server. The tunnel address stays in
// the session folder on disk (0600). This store and every API answer carry
// only what the chat may show.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  formatDisk,
  formatGigabytes,
  parseInventory,
  publicText,
  remoteSessionSuggestions,
  safeRemotePath,
  safeUploadName,
  type RemoteInventoryState,
  type RemoteSessionFacts,
  type RemoteSessionOs,
  type RemoteSessionView,
} from "../shared/remote-session.ts";
import { TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS, terminalResourceKey } from "../shared/terminal-resources.ts";
import type { Store } from "./store.ts";
import type { TerminalAccess } from "./terminal-resources/types.ts";
import type { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import type { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTailcatAdapter } from "./terminal-resources/adapters/tailcat.ts";
import { resolveSystemSsh, resolveTailcatBinary } from "./tailcat-bin.ts";
import { markSessionClosed } from "./remote-support-local.ts";
import { createRemoteControlSessions, type ControlAuditEvent, type ControlHandle, type OpenControl, type SpawnControl } from "./remote-control-session.ts";
import { createRemoteControlAudit } from "./remote-control-audit.ts";
import {
  bindFlowOwner,
  deleteRemoteCommand,
  flowHome as defaultFlowHome,
  inventoryCommand,
  normPrincipal,
  OS_PROBE_UNIX,
  OS_PROBE_WINDOWS,
  osFromProbe,
  pruneSupportSessions,
  readTunnel,
  runCommand,
  screenshotPlan,
  SCREEN_PERMISSION,
  sessionDir,
  snapshotCommand,
  stopCommand,
  supportOwnersOfId,
  tailcatCopyArgv,
  tailcatSshArgv,
  TRANSPORT_FAILED,
  transferDirCommand,
  type CommandResult,
  type RunCommand,
} from "./remote-session-probe.ts";
import { existsCommand, LIST_TIMEOUT_MS, listDirCommand, readExists, readListing, type ListResult } from "./remote-session-files.ts";
import { remoteJoin, safeRemoteDir, scpSafePath, sensitiveRemoteDir } from "../shared/remote-files.ts";
import type { AdminSessionInput } from "../shared/remote-session-admin.ts";
import type { RemoteSessionActionEvent } from "./remote-session-actions-audit.ts";
import { remoteCommandReadOnly } from "./remote-session-exec.ts";

const FILE = "remote-sessions.json";
const UPLOAD_MAX = 8 * 1024 * 1024;
const DOWNLOAD_MAX = 32 * 1024 * 1024;

interface StoredSession {
  id: string;
  botId: string;
  threadId: string;
  principalId: string;
  code: string;
  os: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  state: "connected" | "ended";
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  ram?: string;
  disk?: string;
  diskFreePercent?: number;
  ramGb?: number;
  messageId?: string;
  focused?: boolean;
  /** The OS was not given: ask the computer once the tunnel is here. */
  osGuessed?: boolean;
  /** Where reading the computer stands (shared/remote-session.ts). */
  inventory?: RemoteInventoryState;
  /** No desktop on that computer: shell only, no screen. */
  headless?: boolean;
  /** macOS refused the screenshot (Screen Recording permission). */
  screenDenied?: boolean;
  /** When Sagax last tried to read the computer. */
  checkedAt?: number;
  createdAt: number;
}

export interface PublishedRemoteSession {
  view: RemoteSessionView;
  /** The tunnel folder is on this host. Never the address itself. */
  reachable: boolean;
}

export interface PublishRemoteSession {
  id: string;
  botId: string;
  threadId: string;
  principalId: string;
  code: string;
  /** Absent when nobody named it (the support page detected it): Sagax asks
   * the computer through the tunnel, and says Windows when it cannot. */
  os?: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  facts?: RemoteSessionFacts;
}

/** How long a computer that did not answer waits before Sagax asks again. */
export const INVENTORY_RETRY_MS = 30_000;
/** The most a command run for the bot gives back, per stream. */
export const EXEC_OUTPUT_MAX = 64 * 1024;
export const EXEC_TIMEOUT_DEFAULT_MS = 30_000;
export const EXEC_TIMEOUT_MAX_MS = 120_000;

/** `uname -s` answers Darwin or Linux. Anything else is not an answer: the
 * OS stays unknown (null) and is asked again, never Windows by default. */
export function osFromUname(stdout: string | undefined): RemoteSessionOs | null {
  return osFromProbe({ code: 0, stdout: stdout ?? "", stderr: "" }, null);
}

function capped(text: string): string {
  return text.length > EXEC_OUTPUT_MAX ? `${text.slice(0, EXEC_OUTPUT_MAX)}\n[cut at ${EXEC_OUTPUT_MAX / 1024} KB]` : text;
}

/** The answer of a command run for the bot. Never carries the address. */
export interface RemoteExecResult {
  host: string;
  os: RemoteSessionOs;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function viewOf(session: StoredSession): RemoteSessionView {
  const text = (value: string | undefined) => publicText(value);
  const facts: RemoteSessionFacts = {
    hostname: text(session.hostname),
    osName: text(session.osName),
    user: text(session.user),
    model: text(session.model),
    serial: text(session.serial),
    cpu: text(session.cpu),
    ram: text(session.ram),
    disk: text(session.disk),
    diskFreePercent: session.diskFreePercent,
    ramGb: session.ramGb,
  };
  return {
    id: session.id,
    code: session.code,
    state: session.state,
    os: session.os,
    elevated: session.elevated,
    endAt: session.endAt,
    ...(facts.hostname ? { hostname: facts.hostname } : {}),
    ...(facts.osName ? { osName: facts.osName } : {}),
    ...(facts.user ? { user: facts.user } : {}),
    ...(facts.model ? { model: facts.model } : {}),
    ...(facts.serial ? { serial: facts.serial } : {}),
    ...(facts.cpu ? { cpu: facts.cpu } : {}),
    ...(facts.ram ? { ram: facts.ram } : {}),
    ...(facts.disk ? { disk: facts.disk } : {}),
    ...(session.focused ? { focused: true } : {}),
    inventory: session.inventory ?? (session.osGuessed ? "pending" : "ready"),
    ...(session.osGuessed ? { osKnown: false } : {}),
    ...(session.headless ? { headless: true } : {}),
    ...(session.screenDenied ? { screenDenied: true } : {}),
    suggestions: session.state === "connected" ? remoteSessionSuggestions(facts, session.elevated) : [],
  };
}

function applyFacts(session: StoredSession, facts: RemoteSessionFacts | undefined) {
  if (!facts) return;
  const text = (value: string | undefined) => publicText(value);
  if (text(facts.hostname)) session.hostname = text(facts.hostname);
  if (text(facts.osName)) session.osName = text(facts.osName);
  if (text(facts.user)) session.user = text(facts.user);
  if (text(facts.model)) session.model = text(facts.model);
  if (text(facts.serial)) session.serial = text(facts.serial);
  if (text(facts.cpu)) session.cpu = text(facts.cpu);
  if (text(facts.ram)) session.ram = text(facts.ram);
  if (text(facts.disk)) session.disk = text(facts.disk);
  if (typeof facts.diskFreePercent === "number" && facts.diskFreePercent >= 0 && facts.diskFreePercent <= 100) {
    session.diskFreePercent = facts.diskFreePercent;
  }
  if (typeof facts.ramGb === "number" && facts.ramGb > 0 && facts.ramGb < 4096) session.ramGb = facts.ramGb;
}

export function createRemoteSessionService(deps: {
  dataDir: string;
  store: Store;
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  access(principalId: string, botId: string): TerminalAccess;
  owner(botId: string, threadId: string): string;
  now?: () => number;
  run?: RunCommand;
  home?: () => string;
  /** The folder where remote_support_open keeps the sessions Sagax opened. */
  supportDir?: () => string;
  /** remote_support_close at Perspicax for a session Sagax opened, as the
   * person closing it (their own credentials). Best effort. */
  closeRemote?(input: { principalId: string; botId: string; threadId: string; code: string }): Promise<unknown>;
  /** The live-control audit sink (default: a JSONL file in dataDir). */
  controlAudit?: { write(event: ControlAuditEvent): void };
  /** How the control helper is spawned (default: tailcat ssh over the tunnel). Tests inject a fake. */
  controlSpawn?: SpawnControl;
  /** The system ssh client tailcat execs (default: looked up on this host). */
  systemSsh?: () => string | null;
  /** The per-session action audit (exec, file transfers), for the Remote
   * Sessions logs view. The command is redacted again at the sink. */
  actionsAudit?: { write(event: RemoteSessionActionEvent): void };
}) {
  const systemSsh = deps.systemSsh ?? (() => resolveSystemSsh());
  const actionsAudit = deps.actionsAudit;
  const now = deps.now ?? (() => Date.now());
  const run = deps.run ?? runCommand;
  const home = deps.home ?? defaultFlowHome;
  const supportDir = deps.supportDir;
  const controls = createRemoteControlSessions({
    audit: deps.controlAudit ?? createRemoteControlAudit(deps.dataDir),
    now,
    ...(deps.controlSpawn ? { spawn: deps.controlSpawn } : {}),
  });
  // The tunnel of a row: its Flow folder, or the support folder of its code
  // when that folder names the row's person and bot as the opener.
  const tunnelOf = (row: Pick<StoredSession, "id" | "code" | "principalId" | "botId">) => readTunnel(home(), row, supportDir?.());
  /** Sagax opened it (its support folder names this row's owner). */
  const sagaxOpened = (row: StoredSession) => {
    const dir = supportDir?.();
    if (!dir) return false;
    return supportOwnersOfId(dir, row.id).some((owner) => owner.code === row.code && owner.principalId === row.principalId && owner.botId === row.botId);
  };
  const file = path.join(deps.dataDir, FILE);
  let rows: StoredSession[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { sessions?: StoredSession[] };
    if (Array.isArray(parsed.sessions)) rows = parsed.sessions.filter((row) => row && typeof row.id === "string");
  } catch {
    rows = [];
  }
  // An ended row older than 48 hours, and a support folder untouched that long,
  // are dropped so neither grows without bound.
  const PRUNE_MS = 48 * 60 * 60 * 1000;
  let lastSweep = 0;
  const prune = (): boolean => {
    const cutoff = now() - PRUNE_MS;
    const kept = rows.filter((row) => !(row.state === "ended" && row.createdAt < cutoff));
    const changed = kept.length !== rows.length;
    rows = kept;
    if (now() - lastSweep > 60_000) {
      lastSweep = now();
      const dir = supportDir?.();
      if (dir) pruneSupportSessions(dir, now(), PRUNE_MS);
    }
    return changed;
  };
  prune();
  let chain: Promise<unknown> = Promise.resolve();
  const persist = () => {
    mkdirSync(deps.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ sessions: rows }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* windows */ }
  };
  const exclusive = <T>(work: () => Promise<T> | T): Promise<T> => {
    const runWork = chain.then(work, work);
    chain = runWork.then(() => undefined, () => undefined);
    return runWork;
  };

  const owned = (principalId: string, botId: string, id: string) =>
    rows.find((row) => row.id === id && row.botId === botId && row.principalId === principalId) ?? null;

  const hostLabel = (session: StoredSession) => session.hostname || session.code;

  const tailcatBin = () => resolveTailcatBinary() ?? "tailcat";

  async function ssh(session: StoredSession, command: string, timeoutMs: number) {
    const tunnel = tunnelOf(session);
    if (!tunnel) return null;
    return run(tailcatSshArgv(tailcatBin(), tunnel.keyPath, tunnel.address, command), timeoutMs);
  }

  /** Ask the computer its OS: uname, then PowerShell. Sets osGuessed off only
   * on a clear answer. Returns the inventory state when it could not tell. */
  async function detectOs(session: StoredSession): Promise<RemoteInventoryState | null> {
    const unix = await ssh(session, OS_PROBE_UNIX, 20_000);
    if (!unix) return "no-tunnel";
    if (unix.code === TRANSPORT_FAILED || unix.timedOut) return "no-answer";
    let os = osFromProbe(unix, null);
    let windows: CommandResult | null = null;
    if (!os) {
      windows = await ssh(session, OS_PROBE_WINDOWS, 20_000);
      os = osFromProbe(unix, windows);
    }
    if (!os) return windows && (windows.code === TRANSPORT_FAILED || windows.timedOut) ? "no-answer" : "os-unknown";
    session.os = os;
    delete session.osGuessed;
    return null;
  }

  async function probe(session: StoredSession): Promise<RemoteInventoryState> {
    const result = await ssh(session, inventoryCommand(session.os), 30_000);
    if (!result) return "no-tunnel";
    if (result.code === TRANSPORT_FAILED || result.timedOut) return "no-answer";
    if (!result.stdout.trim()) return "no-answer";
    const parsed = parseInventory(result.stdout);
    if (parsed.gui !== undefined) session.headless = !parsed.gui;
    if (parsed.hostname) session.hostname = parsed.hostname;
    if (parsed.user) session.user = parsed.user;
    if (parsed.model) session.model = parsed.model;
    if (parsed.serial) session.serial = parsed.serial;
    if (parsed.cpu) session.cpu = parsed.cpu;
    if (parsed.osName) session.osName = parsed.osName;
    if (parsed.ramGb) {
      session.ramGb = parsed.ramGb;
      session.ram = formatGigabytes(parsed.ramGb);
    }
    if (parsed.diskFreeGb !== undefined && parsed.diskTotalGb !== undefined) {
      const disk = formatDisk(parsed.diskFreeGb, parsed.diskTotalGb);
      if (disk.text) session.disk = disk.text;
      if (disk.freePercent !== undefined) session.diskFreePercent = disk.freePercent;
    }
    return parsed.hostname || parsed.osName || parsed.cpu ? "ready" : "no-answer";
  }

  /** Read the computer (its OS when unknown, then the inventory) on a copy,
   * outside the critical section, and fold the answer back in. */
  const reading = new Map<string, Promise<void>>();
  const READ_FIELDS = ["os", "osGuessed", "hostname", "user", "model", "serial", "cpu", "osName", "ramGb", "ram", "disk", "diskFreePercent", "headless", "inventory", "checkedAt"] as const;
  function inspect(session: StoredSession): Promise<void> {
    const running = reading.get(session.id);
    if (running) return running;
    const job = (async () => {
      const work: StoredSession = { ...session };
      work.checkedAt = now();
      try {
        if (!tunnelOf(work)) work.inventory = "no-tunnel";
        else if (!systemSsh()) work.inventory = "no-client";
        else {
          const unknown = work.osGuessed ? await detectOs(work) : null;
          work.inventory = unknown ?? await probe(work);
        }
      } catch {
        work.inventory = "no-answer";
      }
      await exclusive(() => {
        if (session.state !== "connected") return;
        for (const field of READ_FIELDS) {
          if (work[field] !== undefined) (session as unknown as Record<string, unknown>)[field] = work[field];
          else if (field === "osGuessed") delete session.osGuessed;
        }
        writeCard(session);
        persist();
      });
    })().finally(() => reading.delete(session.id));
    reading.set(session.id, job);
    return job;
  }

  /** A card not read yet (the tunnel came after the card, the computer was
   * slow, the OS was unknown) is read again, at most every INVENTORY_RETRY_MS. */
  function refresh(session: StoredSession) {
    if (session.state !== "connected" || session.inventory === "ready" || reading.has(session.id)) return;
    if (session.checkedAt !== undefined && now() - session.checkedAt < INVENTORY_RETRY_MS) return;
    void inspect(session).catch(() => {});
  }

  function writeCard(session: StoredSession) {
    const view = viewOf(session);
    const bot = deps.store.bot(session.botId);
    const from = bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined;
    if (session.messageId) {
      deps.store.patchMessage(session.threadId, session.messageId, { remoteSession: view });
      return;
    }
    const message = deps.store.appendMessage(session.threadId, {
      role: "bot",
      kind: "text",
      text: "",
      ...(from ? { from } : {}),
      remoteSession: view,
    });
    session.messageId = message.id;
  }

  deps.registry.register(createTailcatAdapter({
    targets(principalId, botId) {
      return rows
        .filter((row) => row.state === "connected" && row.principalId === principalId && (!botId || row.botId === botId))
        .filter((row) => tunnelOf(row))
        .map((row) => ({ id: row.id, hostLabel: hostLabel(row), label: "Session à distance" }));
    },
    tunnel(principalId, botId, id) {
      const row = rows.find((candidate) => candidate.id === id && candidate.state === "connected" && candidate.principalId === principalId && (!botId || candidate.botId === botId));
      return row ? tunnelOf(row) : null;
    },
  }));

  return {
    viewOf,
    principalFor(botId: string, threadId: string): string {
      return deps.owner(botId, threadId).trim().toLowerCase();
    },
    list(principalId: string, botId: string): RemoteSessionView[] {
      const mine = rows.filter((row) => row.principalId === principalId && row.botId === botId && row.state === "connected");
      for (const row of mine) refresh(row);
      return mine.map(viewOf);
    },
    active(principalId: string, botId: string, threadId: string): StoredSession | null {
      const mine = rows.filter((row) => row.principalId === principalId && row.botId === botId && row.threadId === threadId && row.state === "connected");
      return mine.find((row) => row.focused) ?? mine[mine.length - 1] ?? null;
    },
    async publish(input: PublishRemoteSession): Promise<PublishedRemoteSession> {
      const principalId = normPrincipal(input.principalId);
      const session = await exclusive(() => {
        prune();
        // The id is on the chat card: it never gives a session to someone
        // other than the person (and bot) who opened it.
        const theirs = rows.find((row) => row.id === input.id && (row.principalId !== principalId || row.botId !== input.botId));
        const dir = supportDir?.();
        const foreign = dir
          ? supportOwnersOfId(dir, input.id).some((owner) => owner.principalId !== principalId || owner.botId !== input.botId)
          : false;
        if (theirs || foreign) {
          throw Object.assign(new Error("That remote session belongs to someone else."), { status: 403 });
        }
        // A Flow session folder has no owner until its first publish: bind it
        // to this person and bot now, and refuse a later publish by anyone else.
        if (bindFlowOwner(home(), input.id, { principalId, botId: input.botId }) === "other") {
          throw Object.assign(new Error("That remote session belongs to someone else."), { status: 403 });
        }
        let row = rows.find((candidate) => candidate.id === input.id && candidate.botId === input.botId);
        if (row && row.state === "ended") {
          // closed from the panel or by remote_support_close: a late or
          // repeated "connected" never re-opens the card
          throw Object.assign(new Error("That remote session was closed."), { status: 409 });
        }
        if (!row) {
          row = {
            id: input.id,
            botId: input.botId,
            threadId: input.threadId,
            principalId,
            code: input.code,
            os: input.os ?? "windows",
            ...(input.os ? {} : { osGuessed: true }),
            elevated: input.elevated,
            endAt: input.endAt,
            state: "connected",
            inventory: "pending",
            createdAt: now(),
            focused: false,
          };
          rows.push(row);
        } else {
          row.threadId = input.threadId;
          row.code = input.code;
          if (input.os) {
            row.os = input.os;
            delete row.osGuessed;
          }
          row.elevated = input.elevated;
          row.endAt = input.endAt;
          row.state = "connected";
          // a refresh reads the computer again at once
          if (row.inventory !== "ready") delete row.checkedAt;
        }
        for (const other of rows) {
          if (other.threadId === input.threadId) other.focused = other.id === row.id;
        }
        applyFacts(row, input.facts);
        writeCard(row);
        persist();
        return row;
      });
      const reachable = Boolean(tunnelOf(session));
      // Asking the remote computer happens outside the critical section, so a
      // slow or dead tunnel never holds another publish or a close. Without
      // the tunnel yet, the card says so and is read again once it is here.
      await inspect(session);
      return { view: viewOf(session), reachable };
    },
    async close(principalId: string, botId: string, id: string): Promise<RemoteSessionView | null> {
      const closing = await exclusive(() => {
        prune();
        const session = owned(principalId, botId, id);
        if (!session) return null;
        const wasConnected = session.state === "connected";
        session.state = "ended";
        session.focused = false;
        writeCard(session);
        persist();
        return { session, wasConnected };
      });
      if (!closing) return null;
      const { session, wasConnected } = closing;
      controls.closeSession(session.id);
      if (wasConnected) {
        const ours = sagaxOpened(session);
        try { if (!session.osGuessed) await ssh(session, stopCommand(session.id, session.os), 8_000); } catch { /* the screen still closes */ }
        if (ours) {
          // Delete the address and leave a `closed` marker first, so even if
          // Perspicax cannot be reached the tunnel no longer resolves here and
          // a late "connected" status cannot write the address back.
          const dir = supportDir?.();
          if (dir) await markSessionClosed(dir, session.code).catch(() => {});
          try {
            await deps.closeRemote?.({ principalId: session.principalId, botId: session.botId, threadId: session.threadId, code: session.code });
          } catch { /* Perspicax ends it at its end time; the address is already gone */ }
        }
      }
      return viewOf(session);
    },
    /** The session behind a support code was closed elsewhere (remote_support_close):
     * mark its card closed. The end user's script already stops by itself. */
    async endByCode(principalId: string, botId: string, code: string): Promise<RemoteSessionView | null> {
      return exclusive(async () => {
        const session = rows.find((row) => row.code === code && row.botId === botId && row.principalId === principalId && row.state === "connected");
        if (!session) return null;
        session.state = "ended";
        session.focused = false;
        controls.closeSession(session.id);
        writeCard(session);
        persist();
        return viewOf(session);
      });
    },
    /** Every session this server knows, for the admin Remote Sessions page
     * (server/remote-sessions-admin.ts). The page, not this store, decides who
     * may see each row. No address or key leaves here. */
    adminRows(): AdminSessionInput[] {
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        os: row.os,
        ...(row.osGuessed ? { osGuessed: true } : {}),
        elevated: row.elevated,
        endAt: row.endAt,
        state: row.state,
        createdAt: row.createdAt,
        ...(row.hostname ? { hostname: row.hostname } : {}),
        ...(row.user ? { user: row.user } : {}),
        ...(row.serial ? { serial: row.serial } : {}),
        ownerId: row.principalId,
        openedBy: row.principalId,
        botId: row.botId,
        ...(row.inventory ? { inventory: row.inventory } : {}),
        reachable: Boolean(tunnelOf(row)),
      }));
    },
    /** End any session by id, for the admin page (a workspace admin ends a
     * session they do not own). Cuts live control and the tunnel, like close. */
    async adminClose(id: string): Promise<boolean> {
      const closing = await exclusive(() => {
        prune();
        const session = rows.find((row) => row.id === id);
        if (!session) return null;
        const wasConnected = session.state === "connected";
        session.state = "ended";
        session.focused = false;
        writeCard(session);
        persist();
        return { session, wasConnected };
      });
      if (!closing) return false;
      const { session, wasConnected } = closing;
      controls.closeSession(session.id);
      if (wasConnected) {
        try { if (!session.osGuessed) await ssh(session, stopCommand(session.id, session.os), 8_000); } catch { /* the screen still closes */ }
        if (sagaxOpened(session)) {
          const dir = supportDir?.();
          if (dir) await markSessionClosed(dir, session.code).catch(() => {});
          try { await deps.closeRemote?.({ principalId: session.principalId, botId: session.botId, threadId: session.threadId, code: session.code }); } catch { /* Perspicax ends it at its end time */ }
        }
      }
      return true;
    },
    /** Open live control (screen + mouse + keyboard) for a session this
     * person owns and that is connected and reachable. Windows only for now;
     * the control manager answers an error otherwise. */
    openControl(input: {
      principalId: string;
      botId: string;
      id: string;
      technician?: string;
      onMeta: OpenControl["onMeta"];
      onFrame: OpenControl["onFrame"];
      onClosed: OpenControl["onClosed"];
    }): ControlHandle | { error: string } {
      const session = owned(input.principalId, input.botId, input.id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      const tunnel = tunnelOf(session);
      if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
      return controls.open({
        session: { id: session.id, os: session.os, endAt: session.endAt },
        tunnel,
        bin: tailcatBin(),
        principalId: input.principalId,
        botId: input.botId,
        ...(input.technician ? { technician: input.technician } : {}),
        onMeta: input.onMeta,
        onFrame: input.onFrame,
        onClosed: input.onClosed,
      });
    },
    focus(principalId: string, botId: string, id: string): RemoteSessionView | null {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return null;
      for (const row of rows) {
        if (row.botId === botId && row.principalId === principalId) row.focused = row.id === id;
      }
      persist();
      return viewOf(session);
    },
    async openShell(args: { principalId: string; botId: string; threadId: string; id?: string }): Promise<{ hostLabel: string; messageId: string } | { error: string } | null> {
      const session = args.id
        ? owned(args.principalId, args.botId, args.id)
        : this.active(args.principalId, args.botId, args.threadId);
      if (!session || session.state !== "connected") return null;
      if (!tunnelOf(session)) return { error: "The tunnel for this remote computer is not on this server yet." };
      const access: TerminalAccess = {
        ...deps.access(args.principalId, args.botId),
        ownsConversation: deps.owner(args.botId, args.threadId).trim().toLowerCase() === args.principalId || session.principalId === args.principalId,
      };
      try {
        const opened = await deps.sessions.open({
          principalId: args.principalId,
          botId: args.botId,
          threadId: session.threadId,
          resourceKey: terminalResourceKey("tailcat", session.id),
          label: "Session à distance",
          hostLabel: hostLabel(session),
          access,
          cols: TERMINAL_DEFAULT_COLS,
          rows: TERMINAL_DEFAULT_ROWS,
        });
        const bot = deps.store.bot(args.botId);
        const message = deps.store.appendMessage(session.threadId, {
          role: "bot",
          kind: "text",
          text: "",
          ...(bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
          terminalEmbed: {
            sessionId: opened.id,
            resourceId: session.id,
            provider: "tailcat",
            hostLabel: hostLabel(session),
            label: "Session à distance",
            status: opened.status,
          },
        });
        return { hostLabel: hostLabel(session), messageId: message.id };
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        if (text === "session_limit") return { error: "Three terminals are already open. Close one, then ask again." };
        return { error: "This remote computer did not open a shell." };
      }
    },
    /** `dir`: the folder the person chose in the remote file browser; without
     * it the file goes to the transfer folder. A file already there is never
     * replaced unless `overwrite` says so (the person confirmed it). System
     * folders (shared/remote-files.ts sensitiveRemoteDir) are refused. */
    async upload(principalId: string, botId: string, id: string, name: string, bytes: Buffer, options: { dir?: string; overwrite?: boolean } = {}): Promise<{ name: string } | { error: string; code?: "exists" | "sensitive" }> {
      const safeName = safeUploadName(name);
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      if (!safeName) return { error: "Choose a simple file name." };
      if (bytes.length === 0 || bytes.length > UPLOAD_MAX) return { error: "The file must be under 8 MB." };
      const chosen = options.dir === undefined ? "" : safeRemoteDir(options.dir, session.os);
      if (chosen === null || (chosen && !scpSafePath(chosen))) return { error: "That folder cannot receive a file. Choose a folder whose name has no quotes or symbols." };
      if (chosen && sensitiveRemoteDir(chosen, session.os)) return { error: "Sagax does not send files into this system folder.", code: "sensitive" };
      if (!tunnelOf(session)) return { error: "The tunnel for this remote computer is not on this server yet." };
      let remoteDir = chosen;
      if (!remoteDir) {
        const listed = await ssh(session, transferDirCommand(session.os), 15_000);
        remoteDir = safeRemotePath(listed?.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "") ?? "";
        if (!listed || listed.code !== 0 || !remoteDir || !scpSafePath(remoteDir)) return { error: "The remote computer did not accept a folder for the file." };
      }
      const remotePath = remoteJoin(remoteDir, safeName, session.os);
      if (!options.overwrite) {
        const there = readExists(await ssh(session, existsCommand(session.os, remotePath), 15_000));
        if (there === null) return { error: "The remote computer did not say whether that file already exists, so nothing was sent." };
        if (there) return { error: `${safeName} is already in that folder.`, code: "exists" };
      }
      const localDir = path.join(deps.dataDir, "remote-session-transfers");
      mkdirSync(localDir, { recursive: true, mode: 0o700 });
      const local = path.join(localDir, `${randomBytes(8).toString("hex")}-${safeName.replaceAll(" ", "_")}`);
      writeFileSync(local, bytes, { mode: 0o600 });
      try {
        const tunnel = tunnelOf(session);
        if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
        const copied = await run(tailcatCopyArgv(tailcatBin(), tunnel.keyPath, local, `${tunnel.address}:${remotePath}`), 60_000);
        if (copied.code !== 0) return { error: "The file did not arrive on the remote computer." };
        actionsAudit?.write({ at: now(), sessionId: session.id, principalId: session.principalId, botId: session.botId, kind: "transfer", direction: "upload", file: safeName });
        return { name: safeName };
      } finally {
        rmSync(local, { force: true });
      }
    },
    async download(principalId: string, botId: string, id: string, remotePath: string): Promise<{ name: string; bytes: Buffer } | { error: string }> {
      const safe = safeRemotePath(remotePath);
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { error: "That remote session is not open." };
      if (!safe || !scpSafePath(safe)) return { error: "That path cannot be downloaded." };
      const tunnel = tunnelOf(session);
      if (!tunnel) return { error: "The tunnel for this remote computer is not on this server yet." };
      const localDir = path.join(deps.dataDir, "remote-session-transfers");
      mkdirSync(localDir, { recursive: true, mode: 0o700 });
      const name = safe.split(/[\\/]/).pop() || "download";
      const local = path.join(localDir, `${randomBytes(8).toString("hex")}`);
      const copied = await run(tailcatCopyArgv(tailcatBin(), tunnel.keyPath, `${tunnel.address}:${safe}`, local), 60_000);
      try {
        if (copied.code !== 0) return { error: "That file could not be read on the remote computer." };
        const bytes = readFileSync(local);
        if (bytes.length > DOWNLOAD_MAX) return { error: "That file is over 32 MB." };
        // A real download is audited; the internal screenshot pull is not noise.
        if (!safe.endsWith("px-sagax-shot.png")) {
          actionsAudit?.write({ at: now(), sessionId: session.id, principalId: session.principalId, botId: session.botId, kind: "transfer", direction: "download", file: name });
        }
        return { name, bytes };
      } catch {
        return { error: "That file could not be read on the remote computer." };
      } finally {
        rmSync(local, { force: true });
      }
    },
    /** One folder of the remote computer, read only, for its owner. */
    async listDir(principalId: string, botId: string, id: string, requested: unknown): Promise<ListResult> {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return { status: 403, error: "That remote session is not open for you." };
      const dir = safeRemoteDir(requested, session.os);
      if (dir === null) return { status: 400, error: "That folder path cannot be listed." };
      if (!tunnelOf(session)) return { status: 409, error: "The tunnel for this remote computer is not on this server yet." };
      const result = await ssh(session, listDirCommand(session.os, dir), LIST_TIMEOUT_MS);
      return readListing(result, session.os);
    },
    async screen(principalId: string, botId: string, id: string): Promise<Buffer | null> {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return null;
      refresh(session);
      // never a Windows screenshot on a computer whose OS is not known yet
      if (session.osGuessed || session.headless) return null;
      const plan = screenshotPlan(session.os);
      const shot = await ssh(session, plan.command, 20_000);
      if (shot && shot.stdout.includes(SCREEN_PERMISSION)) {
        if (!session.screenDenied) {
          await exclusive(() => { session.screenDenied = true; writeCard(session); persist(); });
        }
        return null;
      }
      const remotePath = safeRemotePath(shot?.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "");
      if (!shot || shot.code !== 0 || !remotePath || !remotePath.endsWith("px-sagax-shot.png")) return null;
      const pulled = await this.download(principalId, botId, id, remotePath);
      try { await ssh(session, deleteRemoteCommand(session.os, remotePath), 8_000); } catch { /* the png is already local */ }
      if ("error" in pulled) return null;
      if (pulled.bytes.length < 8 || pulled.bytes[0] !== 0x89) return null;
      if (session.screenDenied) await exclusive(() => { delete session.screenDenied; writeCard(session); persist(); });
      return pulled.bytes;
    },
    /** The technician says which OS it is (the computer could not tell, or it
     * told wrong): the card is read again with that OS's commands. */
    async setOs(principalId: string, botId: string, id: string, os: RemoteSessionOs): Promise<RemoteSessionView | null> {
      const session = owned(principalId, botId, id);
      if (!session || session.state !== "connected") return null;
      await exclusive(() => {
        session.os = os;
        delete session.osGuessed;
        delete session.screenDenied;
        session.inventory = "pending";
        delete session.checkedAt;
        writeCard(session);
        persist();
      });
      void inspect(session).catch(() => {});
      return viewOf(session);
    },
    /** Run one command on the connected computer for the bot, through the
     * tunnel, and give back its exit code and output (capped). `id` names
     * the session; without it, the session in focus in this conversation.
     * The approval gate decides before this runs (server/remote-session-exec.ts). */
    async exec(input: { principalId: string; botId: string; threadId: string; id?: string; command: string; timeoutMs?: number }): Promise<RemoteExecResult | { error: string }> {
      const session = this.target(input);
      if (!session) return { error: "No remote session is connected in this conversation." };
      if (!tunnelOf(session)) return { error: "This server does not have the tunnel of that session (it was opened outside Sagax). Open it with remote_support_open." };
      if (!systemSsh()) return { error: "This Sagax server has no ssh client (openssh-client), so it cannot reach the remote computer. Tell the person; an administrator installs it on the server." };
      if (session.osGuessed) await inspect(session);
      // never a command written for a guessed OS (review of #965)
      if (session.osGuessed) return { error: "The OS of that computer is not known yet, so no command runs there. Ask the person which OS it is (the card has Windows, macOS and Linux buttons), or try again in a moment." };
      const command = input.command.trim();
      if (!command || command.length > 8000) return { error: "command: one command line, under 8,000 characters." };
      const timeout = Math.min(EXEC_TIMEOUT_MAX_MS, Math.max(1000, input.timeoutMs ?? EXEC_TIMEOUT_DEFAULT_MS));
      const result = await ssh(session, command, timeout);
      if (!result) return { error: "This server does not have the tunnel of that session." };
      if (result.code === TRANSPORT_FAILED && !result.stdout) return { error: "The remote computer did not answer (the tunnel is down or the session ended)." };
      // Audit what ran (never the output): a read-only command needs no card;
      // a write that reached here was approved (the route gates it first).
      const readOnly = remoteCommandReadOnly(command, { os: session.os, known: !session.osGuessed });
      actionsAudit?.write({ at: now(), sessionId: session.id, principalId: session.principalId, botId: session.botId, kind: "exec", command, readOnly, approved: !readOnly, exitCode: result.code });
      return {
        host: hostLabel(session),
        os: session.os,
        exitCode: result.code,
        stdout: capped(result.stdout),
        stderr: capped(result.stderr),
        timedOut: Boolean(result.timedOut),
      };
    },
    /** OS, uptime, CPU, memory, disk and the busiest processes in one call. */
    async snapshot(input: { principalId: string; botId: string; threadId: string; id?: string }): Promise<RemoteExecResult | { error: string }> {
      const session = this.target(input);
      if (!session) return { error: "No remote session is connected in this conversation." };
      if (session.osGuessed && tunnelOf(session)) await inspect(session);
      if (session.osGuessed) return { error: "The OS of that computer is not known yet, so Sagax does not guess its commands. Ask the person which OS it is, or try again in a moment." };
      return this.exec({ ...input, id: session.id, command: snapshotCommand(session.os), timeoutMs: 45_000 });
    },
    /** The connected session a turn would reach, for the turn's reach line
     * (server/remote-session-reach.ts): its name and OS, never the address. */
    reachFor(input: { principalId: string; botId: string; threadId: string }): { host: string; os: RemoteSessionOs; known: boolean } | null {
      const session = this.target(input);
      return session ? { host: publicText(hostLabel(session)) ?? session.code, os: session.os, known: !session.osGuessed } : null;
    },
    /** The OS of the session a bot tool means, for the approval rule
     * (server/remote-session-exec.ts); `known` false while it is guessed. */
    osFor(input: { principalId: string; botId: string; threadId: string; id?: string }): { os: RemoteSessionOs; known: boolean } | null {
      const session = this.target(input);
      return session ? { os: session.os, known: !session.osGuessed } : null;
    },
    /** The session a bot tool means: by id (12 hex) or code, else the one in
     * focus in this conversation, else this bot's only connected one. */
    target(input: { principalId: string; botId: string; threadId: string; id?: string }): StoredSession | null {
      const principalId = normPrincipal(input.principalId);
      const wanted = input.id?.trim();
      const mine = rows.filter((row) => row.principalId === principalId && row.botId === input.botId && row.state === "connected");
      if (wanted) return mine.find((row) => row.id === wanted.toLowerCase() || row.code === wanted.toUpperCase().replace(/-/g, "")) ?? null;
      const here = mine.filter((row) => row.threadId === input.threadId);
      return here.find((row) => row.focused) ?? here[here.length - 1] ?? (mine.length === 1 ? mine[0]! : null);
    },
    sessionDir(id: string) {
      return sessionDir(home(), id);
    },
  };
}

export type RemoteSessionService = ReturnType<typeof createRemoteSessionService>;
