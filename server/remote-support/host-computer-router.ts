// A bot computer that is an enrolled host (#2726, #2727): the bot's shell and
// screen calls run there through the remote channel, without a Remote session
// card. The session opens on demand (through the calling bot's own Perspicax
// link), is shared by every bot of the same person on that host (#3393), is
// opened again once it ended, and closes when idle. The host's own access rule (Always allow /
// Ask / Never) holds. When the person chose "Isolated environment", the calls
// go to a VM the bot provisioned on that host, enrolled as a host of its own.
import {
  hostOnline,
  modeLabel,
  osLabel,
  parseHostOs,
  sortHostChoices,
  hostsMatchingTags,
  type BotComputerHostAccess,
  type BotComputerHostMode,
  type BotComputerHostOs,
  type BotComputerHostView,
  type BotComputerVmEngine,
  type BotComputerVmView,
} from "../../shared/bot-computer-host.ts";
import { hostUsableByPerson, type UnattendedHostRow } from "../../shared/remote-unattended-host.ts";
import { isReadOnlyCommand, runCommandOf } from "../../shared/read-only-command.ts";
import { builtinAgentToolName } from "../people/member-tool-scope.ts";
import type { HostComputerStore } from "./host-computer-store.ts";
import {
  AGENT_INSTALLER_URL,
  DEFAULT_VM,
  deleteCommand,
  detectEngineCommand,
  parseEngine,
  parseVmStatus,
  provisionCommand,
  statusCommand,
  vmName,
} from "./host-computer-vm.ts";
import type { HostOpenOutcome, HostCodeOutcome, HostsListOutcome, UnattendedHostsViewer, UnattendedSeatTarget } from "./remote-unattended-hosts.ts";
import { KILL_GRACE_MS, KILL_RELEASE_MS } from "./remote-session-probe.ts";
import type { RemoteExecResult } from "./remote-sessions.ts";
import { SESSION_STOP_TIME_MS, TUNNEL_PROBE_TIME_MS, TUNNEL_PROBE_WAIT_MAX_MS, TUNNEL_QUEUE_WAIT_MAX_MS } from "./tunnel-queue.ts";

export const HOST_COMPUTER_ACTIONS = ["exec", "screenshot", "vm_status", "vm_provision", "vm_delete", "vm_rebuild", "set_mode", "ask_mode"] as const;
export type HostComputerAction = typeof HOST_COMPUTER_ACTIONS[number];

/** The command of a host_computer exec call, for the approval gate
 * (server/runtime-events/request-opened.ts); undefined for any other call. */
export function hostComputerExecCommand(tool: string | undefined, input: string | undefined): string | undefined {
  if (builtinAgentToolName(tool?.trim()) !== "host_computer") return undefined;
  try {
    const args = JSON.parse(input ?? "") as Record<string, unknown> | null;
    const action = args && typeof args === "object" ? (args.action ?? (args.arguments as Record<string, unknown> | undefined)?.action) : undefined;
    if (action !== "exec") return undefined;
  } catch {
    return undefined;
  }
  return runCommandOf(input)?.trim() || undefined;
}

/** The host a host_computer call names (its `host` argument), if any. */
export function hostComputerHostName(input: string | undefined): string | undefined {
  try {
    const args = JSON.parse(input ?? "") as Record<string, unknown> | null;
    const raw = args && typeof args === "object" ? (args.host ?? (args.arguments as Record<string, unknown> | undefined)?.host) : undefined;
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The answers of server/remote-support/remote-sessions.ts exec given
 * before the command is sent (no live row, no tunnel here): nothing ran, and
 * a new session is the cure. */
const NOT_SENT = /No remote session is connected|does not have the tunnel/;
/** ssh exit 255 with no output. The session may have ended, but the command
 * itself may also have exited 255, or the tunnel dropped while it ran: it
 * may have run, so it is never run again. */
const TRANSPORT_FAILED = /did not answer \(the tunnel is down or the session ended\)/;

/** Idle sessions close after this long without a call. */
export const HOST_SESSION_IDLE_MS = 10 * 60_000;
/** How long a quiet session lives on the host, counted from the moment
 * Sagax asked for it (#3492). The end time kept here is the one Sagax asked
 * Perspicax for (2 hours), but the host ends the session at its first grant
 * renewal: the grant lives 1 hour (Perspicax `GRANT_TTL_SECONDS`), the host
 * asks to renew it 30 minutes before its end (sagax-remote-access
 * `DefaultRenewBefore`), and Perspicax refuses that renewal (the status
 * call carries no host assertion), so the host stops serving 30 minutes
 * after it took the session ("closed by the server"), while the row here
 * still says connected. The session therefore counts as ended at the
 * earlier of its end time and this. Fixed at the open: a use never pushes
 * it back. */
export const HOST_SESSION_LIFE_MS = 30 * 60_000;
/** A session that answered a command (or connected) this recently is sent
 * the next command without asking its tunnel first (#3492). */
export const HOST_SESSION_FRESH_MS = 60_000;
/** The time a command is given when the call names none: the default of
 * server/remote-support/remote-sessions.ts exec, and its ceiling. */
const COMMAND_TIME_DEFAULT_MS = 30_000;
export const HOST_COMMAND_TIME_MAX_MS = 120_000;
/** How long a new session is given to connect (the host takes it at its
 * next beat), asked every `CONNECT_POLL_MS`. */
export const HOST_CONNECT_WAIT_MS = 60_000;
const CONNECT_POLL_MS = 1_500;

/** The longest one exec call (`execOn`) can take, from the constants
 * (#3505). It must stay well under the bot's tool timeout (10 min,
 * `MCP_TOOL_TIMEOUT_MS` in server/drivers/pi-mcp-extension.ts); a test
 * holds it at least 90 s under.
 *
 * The steps, with today's values:
 * - stop: a tailcat call past its time, or stopped, gives its slot back
 *   within the kill grace, 5 + 2 = 7 s;
 * - probe: 5 s for its turn + 12 s of ping + stop = 24 s;
 * - close: the running call stopped (stop) + the session's stop command
 *   (8 s + stop) = 22 s;
 * - connect: 60 s + one last poll of 1.5 s = 61.5 s;
 * - command: 90 s for its turn + 120 s + stop = 217 s.
 *
 * The longest path. A command is sent at most once, and a second try
 * happens only when the first was never sent:
 * 1. first try on the session already open: probe (24), then 90 s for its
 *    turn, refused because the session ended meanwhile (never sent), and
 *    that session is closed (22): 136 s;
 * 2. second try: the session another bot opened meanwhile is probed (24),
 *    does not answer, is closed (22), and a new one connects (61.5): 107.5 s;
 * 3. the command waits and runs (217), ends on a 255, the tunnel is probed
 *    (24) and the session closed (22): 263 s.
 * Total 506.5 s, 93.5 s under the 600 s. Before #3505 a probe waited up to
 * 90 s for its turn, like a command.
 *
 * Not in this count: the gateway calls (host list, open, close), which the
 * 93.5 s are for; the first read of a computer whose OS is not known yet;
 * the VM actions, which run more than one command per call. */
export function hostExecWorstCaseMs(commandMs: number = HOST_COMMAND_TIME_MAX_MS): number {
  const stop = KILL_GRACE_MS + KILL_RELEASE_MS;
  const probe = TUNNEL_PROBE_WAIT_MAX_MS + TUNNEL_PROBE_TIME_MS + stop;
  const close = stop + SESSION_STOP_TIME_MS + stop;
  const connect = HOST_CONNECT_WAIT_MS + CONNECT_POLL_MS;
  const command = TUNNEL_QUEUE_WAIT_MAX_MS + commandMs + stop;
  const firstTry = probe + TUNNEL_QUEUE_WAIT_MAX_MS + close;
  const secondSession = probe + close + connect;
  const sent = command + probe + close;
  return firstTry + secondSession + sent;
}
const VM_POLL_MS = 15_000;
const VM_POLL_MAX_MS = 25 * 60_000;

export const NO_HYPERVISOR = "This host has no hypervisor I can use (KVM/libvirt, tart, lima or Hyper-V), so I cannot make an isolated VM there. I can use the host as-is instead.";

export interface HostComputerCallInput {
  principalId: string;
  botId: string;
  /** The conversation the tool call came from (approval cards land there). */
  threadId: string;
  action: HostComputerAction;
  command?: string;
  timeoutMs?: number;
  mode?: BotComputerHostMode;
  /** The host by name (or id) when the bot may use several. */
  host?: string;
}

/** The person's session on a host: `botId` is the bot that opened it (its
 * row), `reused` when an earlier call opened it. */
interface HostSession { sessionId: string; botId: string; reused: boolean }
/** A command that failed; `mayHaveRun` when it may have reached the host. */
interface HostExecError { error: string; mayHaveRun?: boolean }

export type HostComputerCallResult =
  | { text: string; isError?: boolean }
  | { image: Buffer; text: string };

interface SessionDeps {
  target(input: { principalId: string; botId: string; threadId: string; id?: string }): { id: string; os: string; osGuessed?: boolean; headless?: boolean; endAt?: string } | null;
  /** `botId` owns the session row; `actor` is the bot that asked for the
   * command (the audit names it). */
  exec(input: { principalId: string; botId: string; threadId: string; id?: string; command: string; timeoutMs?: number; actor?: string }): Promise<RemoteExecResult | { error: string }>;
  screen(principalId: string, botId: string, id: string): Promise<Buffer | null>;
  close(principalId: string, botId: string, id: string): Promise<unknown>;
  markQuiet(id: string): void;
  /** Whether the session's tunnel still answers (one ping in the tunnel's
   * queue, #3492): null when it could not be asked. */
  reachable?(input: { principalId: string; botId: string; id: string }): Promise<boolean | null>;
}

interface HostsDeps {
  list(viewer: UnattendedHostsViewer): Promise<HostsListOutcome>;
  open(viewer: UnattendedHostsViewer, hostId: string, options: { seatFor?: UnattendedSeatTarget; onSession?: (id: string) => void }): Promise<HostOpenOutcome>;
  /** Close at the gateway a session opened here that the host never took (#3505). */
  closeUnconnected?(viewer: UnattendedHostsViewer, sessionId: string): Promise<unknown>;
  installCode(viewer: UnattendedHostsViewer, options?: { org?: string; scope?: string }): Promise<HostCodeOutcome>;
}

export function createHostComputerRouter(deps: {
  store: HostComputerStore;
  hosts: HostsDeps;
  sessions: SessionDeps;
  /** The bot's own conversation: its Perspicax seat opens the session there. */
  botThread(botId: string): string | null;
  botName(botId: string): string;
  ownerSub?(principalId: string): string | null;
  /** The bots the person allowed on one of their hosts (Remote sessions,
   * "Which bots"): null = All bots. Default: All bots. */
  botScope?(principalId: string, hostId: string): string[] | null;
  /** The bot is this person's own (All bots means their bots). Default: yes. */
  ownsBot?(principalId: string, botId: string): boolean;
  /** The host's access rule; default: the row's own `access`, else Always allow. */
  access?(principalId: string, hostId: string, row: UnattendedHostRow | null): BotComputerHostAccess;
  /** The person's yes for this exact command in that conversation, once. */
  consumeApproval(threadId: string, command: string): boolean;
  /** Post the isolated / as-is question card in the bot's chat; its request id. */
  raiseQuestion(threadId: string, question: { title: string; question: string; options: { id: BotComputerHostMode; label: string; description: string }[] }): string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
  const log = deps.log ?? (() => undefined);
  /** principal|host: the quiet session the person's bots use there (#3393).
   * `botId` is the bot that opened it: the session row is its own, so every
   * later call of any bot of that person goes through that row. Another
   * person never shares it (the key and the row both carry the principal). */
  const open = new Map<string, { sessionId: string; lastUsed: number; principalId: string; botId: string; askedAt: number; answeredAt: number }>();
  const opening = new Map<string, Promise<HostSession | { error: string }>>();
  const polling = new Set<string>();
  /** principal|host: commands running (or queued) on the person's session. */
  const busy = new Map<string, number>();
  const key = (principalId: string, hostId: string) => `${principalId.trim().toLowerCase()}|${hostId}`;
  const vmKey = (principalId: string, botId: string, hostId: string) => `${principalId.trim().toLowerCase()}|${botId}|${hostId}`;
  /** How long the session still has: up to its end time, and never past
   * its life on the host (#3492). Zero or less: it ended, never reused. */
  const timeLeft = (known: { askedAt: number }, endAt: string | undefined) => {
    const end = endAt ? Date.parse(endAt) : Number.NaN;
    const life = known.askedAt + HOST_SESSION_LIFE_MS;
    return (Number.isFinite(end) ? Math.min(end, life) : life) - now();
  };
  /** Whether the session's tunnel answers: false when it was asked and did
   * not. Could not ask (no probe, the queue refused) is null, not a no. */
  const tunnelAnswers = async (principalId: string, botId: string, sessionId: string): Promise<boolean | null> =>
    (await deps.sessions.reachable?.({ principalId, botId, id: sessionId }).catch(() => null)) ?? null;

  const ownedRows = async (principalId: string): Promise<{ rows: UnattendedHostRow[]; error?: string }> => {
    const listed = await deps.hosts.list({ principalId });
    if (!listed.available) return { rows: [], error: listed.reason };
    const sub = deps.ownerSub?.(principalId) ?? null;
    return { rows: listed.hosts.filter((row) => row.state === "enrolled" && hostUsableByPerson(row, sub)) };
  };

  const accessOf = (principalId: string, hostId: string, row: UnattendedHostRow | null): BotComputerHostAccess => {
    if (deps.access) return deps.access(principalId, hostId, row);
    const raw = (row as unknown as { access?: unknown } | null)?.access;
    return raw === "ask" || raw === "never" ? raw : "always";
  };

  // the last host list per person, for the turn's prompt (synchronous)
  const lastViews = new Map<string, BotComputerHostView[]>();
  // the hosts in that list that the person owns (not shared with them by a colleague)
  const lastOwned = new Map<string, Set<string>>();
  // the last access rule seen per host, for the approval gate (synchronous)
  const accessSeen = new Map<string, BotComputerHostAccess>();
  const viewOf = (principalId: string, row: UnattendedHostRow): BotComputerHostView => {
    const settings = deps.store.host(principalId, row.hostId);
    const access = accessOf(principalId, row.hostId, row);
    accessSeen.set(`${principalId.trim().toLowerCase()}|${row.hostId}`, access);
    const rowOs = parseHostOs((row as unknown as { os?: unknown }).os);
    return {
      hostId: row.hostId,
      name: row.hostname ?? "Unnamed computer",
      os: settings?.os ?? rowOs,
      online: hostOnline(row.lastSeenAt, now()),
      botComputer: Boolean(settings?.botComputer),
      tags: settings?.tags ?? [],
      shellOnly: Boolean(settings?.shellOnly),
      access,
      modes: { ...settings?.modes },
      vm: settings?.vm ?? null,
    };
  };

  /** Every enrolled host of this person, with their settings. */
  async function views(principalId: string): Promise<{ hosts: BotComputerHostView[]; error?: string }> {
    const { rows, error } = await ownedRows(principalId);
    // a VM a bot made is a sub-computer of its host: not a choice of its own
    const vmNames = new Set(Object.values(deps.store.hosts(principalId)).map((s) => s.vm?.name).filter(Boolean));
    const kept = rows.filter((row) => !vmNames.has(row.hostname ?? ""));
    const hosts = sortHostChoices(kept.map((row) => viewOf(principalId, row)));
    if (!error) {
      lastViews.set(principalId.trim().toLowerCase(), hosts);
      lastOwned.set(principalId.trim().toLowerCase(), new Set(kept.filter((row) => !row.sharedBy).map((row) => row.hostId)));
    }
    return error ? { hosts, error } : { hosts };
  }

  /** The hosts marked "Use as a bot computer": the Computer menu choices. */
  async function choices(principalId: string): Promise<BotComputerHostView[]> {
    return (await views(principalId)).hosts.filter((host) => host.botComputer);
  }

  /** True when this bot may work on that host of the person without anyone
   * picking it: the person's own host, marked as a bot computer, shared with
   * All bots (and the bot is theirs) or with this bot by name. A host a
   * colleague shared with the person never qualifies. */
  const botMayUse = (principalId: string, botId: string, host: BotComputerHostView, owned: ReadonlySet<string>): boolean => {
    if (!host.botComputer || !owned.has(host.hostId)) return false;
    const scope = deps.botScope?.(principalId, host.hostId) ?? null;
    if (scope) return scope.includes(botId);
    return deps.ownsBot?.(principalId, botId) ?? true;
  };

  /** The hosts this bot may use without a pick (fresh list). */
  async function botHosts(principalId: string, botId: string): Promise<{ hosts: BotComputerHostView[]; error?: string }> {
    const out = await views(principalId);
    const owned = lastOwned.get(principalId.trim().toLowerCase()) ?? new Set<string>();
    const hosts = out.hosts.filter((host) => botMayUse(principalId, botId, host, owned));
    return out.error ? { hosts, error: out.error } : { hosts };
  }

  /** The same, from the last list (synchronous: prompt and approval gate). */
  const botHostsSeen = (principalId: string, botId: string): BotComputerHostView[] => {
    const key = principalId.trim().toLowerCase();
    const owned = lastOwned.get(key) ?? new Set<string>();
    return (lastViews.get(key) ?? []).filter((host) => botMayUse(principalId, botId, host, owned));
  };

  const sameHost = (host: Pick<BotComputerHostView, "hostId" | "name">, wanted: string) =>
    host.hostId === wanted.trim() || host.name.trim().toLowerCase() === wanted.trim().toLowerCase();
  const namesOf = (hosts: readonly Pick<BotComputerHostView, "name">[]) => hosts.map((host) => host.name).join(", ");

  /** Which host a call goes to: the one it names, else the one picked in the
   * Computer menu, else the only host this bot may use. */
  function pickHost(principalId: string, botId: string, usable: BotComputerHostView[], wanted: string | undefined, all: BotComputerHostView[]): { hostId: string } | { error: string } {
    const picked = deps.store.botHost(principalId, botId);
    if (wanted) {
      const pickedView = picked ? all.find((host) => host.hostId === picked) : undefined;
      const match = usable.find((host) => sameHost(host, wanted)) ?? (pickedView && sameHost(pickedView, wanted) ? pickedView : undefined);
      if (match) return { hostId: match.hostId };
      return { error: usable.length ? `No host named "${wanted}" is a bot computer you may use. Use one of: ${namesOf(usable)}.` : `No host named "${wanted}" is a bot computer you may use.` };
    }
    if (picked) return { hostId: picked };
    if (usable.length === 1) return { hostId: usable[0]!.hostId };
    if (usable.length > 1) return { error: `Several hosts are bot computers you may use: ${namesOf(usable)}. Call host_computer again with host set to one of these names.` };
    return { error: "No host is a bot computer for this bot. The person marks a host \"Use as a bot computer\" in Remote sessions and shares it with All bots or with this bot; then call host_computer again." };
  }

  /** The bot switches its own computer to one of the hosts it may use: the
   * same effect as the person picking it in the Computer menu. */
  async function selectByBot(principalId: string, botId: string, wanted: string): Promise<{ ok: true; host: BotComputerHostView; asked: boolean } | { ok: false; error: string; hosts: string[] }> {
    const { hosts, error } = await botHosts(principalId, botId);
    const host = hosts.find((candidate) => sameHost(candidate, wanted));
    if (!host) {
      const names = hosts.map((candidate) => candidate.name);
      return { ok: false, hosts: names, error: error ?? (names.length ? `No host named "${wanted}" is a bot computer you may use. Use one of: ${names.join(", ")}.` : "No host is a bot computer for this bot.") };
    }
    deps.store.setBotHost(principalId, botId, host.hostId);
    const asked = modeOf(principalId, botId, host.hostId, host.access) ? false : ask(principalId, botId, host.hostId, host.name).asked;
    return { ok: true, host, asked };
  }

  /** Forget the person's session on that host and close it (it ended, or
   * its tunnel no longer answers): the next call opens a new one. */
  async function drop(principalId: string, hostId: string, sessionId: string): Promise<void> {
    const k = key(principalId, hostId);
    const known = open.get(k);
    if (!known || known.sessionId !== sessionId) return;
    open.delete(k);
    await deps.sessions.close(known.principalId, known.botId, known.sessionId).catch(() => null);
  }

  /** Open (or reuse) the person's quiet session on that host. Any bot of
   * theirs reuses it; one that ended is closed and a new one opens. Checked
   * before anything is sent (#3492): a session with less time left than the
   * command may take (`needMs`), or whose tunnel no longer answers, is
   * replaced too. Neither is asked of a session running another command:
   * closing it would stop that command, and the tunnel is in use. A command
   * that came while the tunnel was asked counts too (#3505): the session is
   * kept after a no, and that command's own answer decides. */
  async function sessionOn(principalId: string, botId: string, hostId: string, needMs = 0): Promise<HostSession | { error: string }> {
    const k = key(principalId, hostId);
    const known = open.get(k);
    if (known) {
      const live = deps.sessions.target({ principalId, botId: known.botId, threadId: "", id: known.sessionId });
      const left = live ? timeLeft(known, live.endAt) : 0;
      const inUse = busy.has(k);
      let usable = left > 0 && (inUse || left > needMs);
      if (usable && !inUse && now() - known.answeredAt >= HOST_SESSION_FRESH_MS) {
        const answers = await tunnelAnswers(principalId, known.botId, known.sessionId);
        // a no on a slow host must not stop the command another bot sent
        // during the ping: `busy` is read again, after the answer
        if (answers === false) usable = busy.has(k);
        else known.answeredAt = now();
      }
      if (usable) {
        known.lastUsed = now();
        return { sessionId: known.sessionId, botId: known.botId, reused: true };
      }
      await drop(principalId, hostId, known.sessionId);
    }
    const pending = opening.get(k);
    if (pending) return pending;
    const run = (async () => {
      const threadId = deps.botThread(botId);
      if (!threadId) return { error: "That bot has no conversation to open the session on." };
      // the host takes the session after this: its life there ends no earlier
      const askedAt = now();
      const outcome = await deps.hosts.open({ principalId }, hostId, {
        seatFor: { botId, threadId },
        onSession: (id) => deps.sessions.markQuiet(id),
      });
      if (!outcome.ok) return { error: outcome.message };
      deps.sessions.markQuiet(outcome.session);
      const deadline = now() + HOST_CONNECT_WAIT_MS;
      while (now() < deadline) {
        if (deps.sessions.target({ principalId, botId, threadId, id: outcome.session })) {
          open.set(k, { sessionId: outcome.session, lastUsed: now(), principalId, botId, askedAt, answeredAt: now() });
          return { sessionId: outcome.session, botId, reused: false };
        }
        await sleep(CONNECT_POLL_MS);
      }
      // The host never took it: closed at the gateway, so it does not count
      // in the gateway's limit of waiting sessions (#3505), and here in case
      // its row came just now.
      await deps.hosts.closeUnconnected?.({ principalId }, outcome.session).catch(() => null);
      await deps.sessions.close(principalId, botId, outcome.session).catch(() => null);
      return { error: "The host did not answer in time. It may be asleep or offline; try again in a moment." };
    })().finally(() => opening.delete(k));
    opening.set(k, run);
    return run;
  }

  /** Run one command on the person's session there, for the bot `botId`.
   * A reused session that refused the command before sending it (no live
   * row, no tunnel here) is closed and the command goes once through a new
   * session. A transport failure (ssh 255) is never run again: the command
   * may have run. The session is closed then only if it is dead, ended or
   * its tunnel no longer answers (#3492); a live one (maybe running another
   * bot's command) stays open, and its tunnel is not even asked while
   * another command is on it (#3505). */
  const execOn = async (principalId: string, botId: string, hostId: string, command: string, timeoutMs?: number): Promise<RemoteExecResult | HostExecError> => {
    const needMs = Math.min(HOST_COMMAND_TIME_MAX_MS, Math.max(1000, timeoutMs ?? COMMAND_TIME_DEFAULT_MS));
    const run = async (): Promise<{ out: RemoteExecResult | { error: string }; session: HostSession | null }> => {
      const session = await sessionOn(principalId, botId, hostId, needMs);
      if ("error" in session) return { out: session, session: null };
      // in flight (or waiting its turn on the tunnel, #3430): the idle sweep
      // never closes the session under it, and its end counts as a use
      const k = key(principalId, hostId);
      busy.set(k, (busy.get(k) ?? 0) + 1);
      try {
        const out = await deps.sessions.exec({ principalId, botId: session.botId, threadId: "", id: session.sessionId, command, actor: botId, ...(timeoutMs ? { timeoutMs } : {}) });
        // an exit code came back through the tunnel: it answers
        const known = open.get(k);
        if (!("error" in out) && known && known.sessionId === session.sessionId) known.answeredAt = now();
        return { out, session };
      } finally {
        const left = (busy.get(k) ?? 1) - 1;
        if (left > 0) busy.set(k, left); else busy.delete(k);
        const known = open.get(k);
        if (known && known.sessionId === session.sessionId) known.lastUsed = now();
      }
    };
    const first = await run();
    if (!("error" in first.out) || !first.session) return first.out;
    const session = first.session;
    if (TRANSPORT_FAILED.test(first.out.error)) {
      // The session was live when the command was sent: dead now means it
      // died during the command, which may have run. Never run it again; a
      // dead or ended session is closed so the next call opens a new one.
      // The row alone does not say it (#3492: it stays connected after the
      // host ended the session), so the tunnel is asked too.
      const live = deps.sessions.target({ principalId, botId: session.botId, threadId: "", id: session.sessionId });
      const k = key(principalId, hostId);
      const known = open.get(k);
      const ended = !live || (known?.sessionId === session.sessionId && timeLeft(known, live.endAt) <= 0);
      // Another command on the session (#3505): the tunnel is in use, so it
      // is not asked, and a no that came while a command arrived does not
      // close the session under it. That command's own answer decides.
      const gone = ended || (!busy.has(k) && (await tunnelAnswers(principalId, session.botId, session.sessionId)) === false && !busy.has(k));
      if (gone) await drop(principalId, hostId, session.sessionId);
      return { error: first.out.error, mayHaveRun: true };
    }
    if (!NOT_SENT.test(first.out.error)) return first.out;
    // refused before it was sent: the command never reached the host
    await drop(principalId, hostId, session.sessionId);
    if (!session.reused) return first.out;
    return (await run()).out;
  };

  /** Close the sessions nobody used for a while, and the ones that ended. */
  async function sweep(): Promise<number> {
    let closed = 0;
    for (const [k, row] of open) {
      const live = deps.sessions.target({ principalId: row.principalId, botId: row.botId, threadId: "", id: row.sessionId });
      if (live && timeLeft(row, live.endAt) > 0 && (busy.has(k) || now() - row.lastUsed < HOST_SESSION_IDLE_MS)) continue;
      open.delete(k);
      await deps.sessions.close(row.principalId, row.botId, row.sessionId).catch(() => null);
      closed += 1;
    }
    return closed;
  }

  /** This bot's answer to "isolated or as-is" on that host. A host on Always
   * allow already says "work on it": no question, as-is is recorded as if
   * the person had answered it (an earlier answer is kept). */
  function modeOf(principalId: string, botId: string, hostId: string, access: BotComputerHostAccess): BotComputerHostMode | null {
    const known = deps.store.mode(principalId, hostId, botId);
    if (known || access !== "always") return known;
    deps.store.setMode(principalId, hostId, botId, "as_is");
    return "as_is";
  }

  /** Post the isolated / as-is question in the bot's chat (once per host and bot). */
  function ask(principalId: string, botId: string, hostId: string, hostName: string): { asked: boolean; requestId: string | null } {
    const waiting = deps.store.pendingFor(principalId, hostId, botId);
    if (waiting) return { asked: false, requestId: waiting };
    const threadId = deps.botThread(botId);
    if (!threadId) return { asked: false, requestId: null };
    const requestId = deps.raiseQuestion(threadId, {
      title: "Bot computer",
      question: `How should I work on ${hostName}?`,
      options: [
        { id: "isolated", label: modeLabel("isolated"), description: "I make a light Linux VM on that host and work only inside it." },
        { id: "as_is", label: modeLabel("as_is"), description: "I work directly on the host, with its own access rule." },
      ],
    });
    if (!requestId) return { asked: false, requestId: null };
    deps.store.ask(principalId, requestId, { hostId, botId, threadId });
    return { asked: true, requestId };
  }

  /** The Computer menu changed: a host, or null (Auto, local, cloud). */
  async function select(principalId: string, botId: string, hostId: string | null): Promise<{ ok: true; asked: boolean } | { ok: false; error: string }> {
    if (!hostId) {
      deps.store.setBotHost(principalId, botId, null);
      return { ok: true, asked: false };
    }
    const host = (await choices(principalId)).find((row) => row.hostId === hostId);
    if (!host) return { ok: false, error: "That computer is not one of your bot computers." };
    deps.store.setBotHost(principalId, botId, hostId);
    if (modeOf(principalId, botId, hostId, host.access)) return { ok: true, asked: false };
    return { ok: true, asked: ask(principalId, botId, hostId, host.name).asked };
  }

  /** The person answered the question card. Null when the request is not ours. */
  function answer(requestId: string, picked: string): { principalId: string; hostId: string; botId: string; mode: BotComputerHostMode } | null {
    const pending = deps.store.takePending(requestId);
    if (!pending) return null;
    const text = picked.trim().toLowerCase();
    const mode: BotComputerHostMode = text === "isolated" || text.startsWith("isolated") ? "isolated" : "as_is";
    deps.store.setMode(pending.principalId, pending.hostId, pending.botId, mode);
    if (mode === "isolated") void provision(pending.principalId, pending.botId, pending.hostId).catch((error) => log(`host-computer provision: ${String(error)}`));
    return { principalId: pending.principalId, hostId: pending.hostId, botId: pending.botId, mode };
  }

  const setVm = (principalId: string, hostId: string, vm: BotComputerVmView | null) => deps.store.setVm(principalId, hostId, vm);

  /** Make the VM on the host (background script), then follow it. */
  async function provision(principalId: string, botId: string, hostId: string): Promise<{ text: string; isError?: boolean }> {
    const settings = deps.store.host(principalId, hostId);
    if (settings?.vm && (settings.vm.state === "provisioning" || settings.vm.state === "ready")) {
      return { text: settings.vm.state === "ready" ? `The VM ${settings.vm.name} is ready.` : `The VM ${settings.vm.name} is being made: ${settings.vm.step ?? "starting"}.` };
    }
    const { rows } = await ownedRows(principalId);
    const row = rows.find((candidate) => candidate.hostId === hostId) ?? null;
    const os: BotComputerHostOs = settings?.os ?? parseHostOs((row as unknown as { os?: unknown } | null)?.os) ?? "linux";
    const detected = await execOn(principalId, botId, hostId, detectEngineCommand(os), 30_000);
    if ("error" in detected) return { text: detected.error, isError: true };
    const engine = parseEngine(detected.stdout);
    if (!engine) {
      setVm(principalId, hostId, null);
      return { text: NO_HYPERVISOR, isError: true };
    }
    const name = vmName(deps.botName(botId));
    const code = await deps.hosts.installCode({ principalId }, { scope: "full-control" });
    if (!code.ok) {
      setVm(principalId, hostId, { engine, state: "failed", name, error: code.message, updatedAt: now() });
      return { text: `I could not get an install code for the VM's remote agent: ${code.message}`, isError: true };
    }
    const agentInstall = `curl -fsSL ${AGENT_INSTALLER_URL} | sh && ${code.installCommands?.linux ?? code.installCommand}`;
    const command = provisionCommand(engine, { ...DEFAULT_VM, name, agentInstall });
    setVm(principalId, hostId, { engine, state: "provisioning", name, step: "Starting", updatedAt: now() });
    const started = await execOn(principalId, botId, hostId, command, 60_000);
    if ("error" in started || started.exitCode !== 0) {
      const why = "error" in started ? started.error : (started.stderr.trim().split("\n").pop() || "The host refused the provisioning script.");
      setVm(principalId, hostId, { engine, state: "failed", name, error: why, updatedAt: now() });
      return { text: `The VM could not start: ${why}`, isError: true };
    }
    void follow(principalId, botId, hostId).catch((error) => log(`host-computer follow: ${String(error)}`));
    return { text: `I am making a light Linux VM (${name}) on that host with ${engineLabel(engine)}. It takes a few minutes; I will work inside it once it is ready.` };
  }

  /** Read where provisioning stands, once. */
  async function refreshVm(principalId: string, botId: string, hostId: string): Promise<BotComputerVmView | null> {
    const vm = deps.store.host(principalId, hostId)?.vm ?? null;
    if (!vm || vm.state !== "provisioning") return vm;
    const out = await execOn(principalId, botId, hostId, statusCommand(vm.engine, vm.name), 20_000);
    if ("error" in out) return vm;
    const status = parseVmStatus(out.stdout);
    if (status.failed) {
      const failed: BotComputerVmView = { ...vm, state: "failed", error: status.failed, updatedAt: now() };
      setVm(principalId, hostId, failed);
      return failed;
    }
    // ready once the VM's own agent enrolled (its hostname is the VM name)
    const { rows } = await ownedRows(principalId);
    const child = rows.find((row) => row.hostname === vm.name);
    const next: BotComputerVmView = child
      ? { ...vm, state: "ready", step: "Ready", updatedAt: now() }
      : { ...vm, step: status.step ?? (status.done ? "Waiting for the VM's remote agent" : vm.step), updatedAt: now() };
    setVm(principalId, hostId, next);
    return next;
  }

  async function follow(principalId: string, botId: string, hostId: string): Promise<void> {
    const k = vmKey(principalId, botId, hostId);
    if (polling.has(k)) return;
    polling.add(k);
    try {
      const until = now() + VM_POLL_MAX_MS;
      while (now() < until) {
        await sleep(VM_POLL_MS);
        const vm = await refreshVm(principalId, botId, hostId);
        if (!vm || vm.state !== "provisioning") return;
      }
      const vm = deps.store.host(principalId, hostId)?.vm;
      if (vm?.state === "provisioning") setVm(principalId, hostId, { ...vm, state: "failed", error: "The VM did not enroll in time.", updatedAt: now() });
    } finally {
      polling.delete(k);
    }
  }

  async function removeVm(principalId: string, botId: string, hostId: string): Promise<{ text: string; isError?: boolean }> {
    const vm = deps.store.host(principalId, hostId)?.vm;
    if (!vm) return { text: "There is no VM on that host." };
    setVm(principalId, hostId, { ...vm, state: "deleting", step: "Deleting", updatedAt: now() });
    const out = await execOn(principalId, botId, hostId, deleteCommand(vm.engine, vm.name), 60_000);
    if ("error" in out) {
      setVm(principalId, hostId, { ...vm, updatedAt: now() });
      return { text: out.error, isError: true };
    }
    setVm(principalId, hostId, null);
    return { text: `The VM ${vm.name} was deleted.` };
  }

  /** Where the bot's calls go: the host, or its ready VM. */
  async function routeOf(principalId: string, botId: string, hostId: string): Promise<{ hostId: string } | { text: string; isError?: boolean }> {
    const mode = deps.store.mode(principalId, hostId, botId);
    if (mode !== "isolated") return { hostId };
    const vm = await refreshVm(principalId, botId, hostId);
    if (!vm) return { text: "The person chose an isolated environment and there is no VM yet. Call host_computer with action vm_provision.", isError: true };
    if (vm.state === "failed") return { text: `The VM failed: ${vm.error ?? "unknown reason"}. Call vm_rebuild, or set_mode as_is if the person agrees.`, isError: true };
    if (vm.state !== "ready") return { text: `The VM ${vm.name} is not ready yet: ${vm.step ?? "starting"}. Check again with vm_status in a minute.` };
    const { rows } = await ownedRows(principalId);
    const child = rows.find((row) => row.hostname === vm.name);
    if (!child) return { text: `The VM ${vm.name} is not enrolled as a host yet.`, isError: true };
    return { hostId: child.hostId };
  }

  /** One host_computer tool call. */
  async function call(input: HostComputerCallInput): Promise<HostComputerCallResult> {
    const { principalId, botId } = input;
    const usable = await botHosts(principalId, botId);
    const target = pickHost(principalId, botId, usable.hosts, input.host, lastViews.get(principalId.trim().toLowerCase()) ?? []);
    if ("error" in target) return { text: usable.error ?? target.error, isError: true };
    const hostId = target.hostId;
    const { rows, error } = await ownedRows(principalId);
    const row = rows.find((candidate) => candidate.hostId === hostId) ?? null;
    if (!row) return { text: error ?? "That host is no longer enrolled for you.", isError: true };
    const view = viewOf(principalId, row);
    if (input.action === "set_mode") {
      if (input.mode !== "isolated" && input.mode !== "as_is") return { text: "mode: isolated or as_is.", isError: true };
      deps.store.setMode(principalId, hostId, botId, input.mode);
      if (input.mode === "isolated") return provision(principalId, botId, hostId);
      return { text: `I will use ${view.name} as-is.` };
    }
    if (input.action === "ask_mode") {
      const asked = ask(principalId, botId, hostId, view.name);
      return { text: asked.requestId ? "The question is in the chat. Wait for the person's answer." : "The question could not be posted.", ...(asked.requestId ? {} : { isError: true }) };
    }
    if (input.action === "vm_provision") return provision(principalId, botId, hostId);
    if (input.action === "vm_delete") return removeVm(principalId, botId, hostId);
    if (input.action === "vm_rebuild") {
      const removed = await removeVm(principalId, botId, hostId);
      if (removed.isError) return removed;
      return provision(principalId, botId, hostId);
    }
    if (input.action === "vm_status") {
      const vm = await refreshVm(principalId, botId, hostId);
      return { text: vm ? JSON.stringify({ name: vm.name, engine: vm.engine, state: vm.state, step: vm.step ?? null, error: vm.error ?? null }) : "No VM on that host." };
    }
    // exec and screenshot: the answer to "isolated or as-is" comes first
    // (a host on Always allow answers as-is itself)
    if (!modeOf(principalId, botId, hostId, view.access)) {
      const asked = ask(principalId, botId, hostId, view.name);
      return { text: asked.requestId ? `I asked the person whether to work in an isolated VM on ${view.name} or on the host as-is. Wait for their answer.` : "Ask the person whether to use an isolated VM or the host as-is (action ask_mode).", isError: !asked.requestId };
    }
    if (!view.online) return { text: `${view.name} is offline. It works again once it is back online.`, isError: true };
    if (view.access === "never") return { text: `${view.name} does not allow bots to act on it (its access rule is Never).`, isError: true };
    const route = await routeOf(principalId, botId, hostId);
    if (!("hostId" in route)) return route;
    if (input.action === "screenshot") {
      if (view.shellOnly && route.hostId === hostId) return { text: `${view.name} is shell only (no desktop), so there is no screenshot. Use action exec.`, isError: true };
      const session = await sessionOn(principalId, botId, route.hostId);
      if ("error" in session) return { text: session.error, isError: true };
      const image = await deps.sessions.screen(principalId, session.botId, session.sessionId);
      if (!image) {
        if (route.hostId === hostId) deps.store.update(principalId, hostId, { shellOnly: true });
        return { text: `${view.name} has no screen to capture (shell only). Use action exec.`, isError: true };
      }
      return { image, text: `Screenshot of ${view.name}.` };
    }
    const command = input.command?.trim();
    if (!command) return { text: "command: the command line to run on the host.", isError: true };
    if (view.access === "ask" && !isReadOnlyCommand(command) && !deps.consumeApproval(input.threadId, command)) {
      return { text: `${view.name} asks before any change and the person has not allowed this command. Call host_computer again so Sagax asks them; never work around the card.`, isError: true };
    }
    const out = await execOn(principalId, botId, route.hostId, command, input.timeoutMs);
    if ("error" in out) {
      const lead = "mayHaveRun" in out && out.mayHaveRun
        ? `The connection to ${view.name} dropped during the command, so it may have run: ${out.error} Check its effect before running it again.`
        : `The command did not run on ${view.name}: ${out.error}`;
      return { text: lead, isError: true };
    }
    if (!view.os && route.hostId === hostId) {
      const learned = parseHostOs(out.os);
      if (learned) deps.store.update(principalId, hostId, { os: learned });
    }
    const where = route.hostId === hostId ? view.name : `${deps.store.host(principalId, hostId)?.vm?.name ?? "VM"} on ${view.name}`;
    return { text: JSON.stringify({ where, os: osLabel(parseHostOs(out.os)), exitCode: out.exitCode, timedOut: out.timedOut, stdout: out.stdout, stderr: out.stderr }), ...(out.exitCode !== 0 || out.timedOut ? { isError: true } : {}) };
  }

  /** A short line for the bot's prompt: its computer is this host. */
  function promptPart(principalId: string, botId: string, hosts: BotComputerHostView[]): string | null {
    const hostId = deps.store.botHost(principalId, botId);
    const lines: string[] = [];
    const chosen = hostId ? hosts.find((host) => host.hostId === hostId) : null;
    if (chosen) {
      const mode = chosen.modes[botId] ?? (chosen.access === "always" ? "as_is" : null);
      lines.push(`Your computer is the host "${chosen.name}" (${osLabel(chosen.os)}${chosen.online ? "" : ", offline"}). Run shell commands there with host_computer action exec${chosen.shellOnly ? "; it is shell only, no screenshot" : ", and look at it with action screenshot"}. No Remote session card is needed.`);
      if (!mode) lines.push("The person has not said yet whether you work in an isolated VM on it or on the host as-is: call host_computer action ask_mode before anything else.");
      else if (mode === "isolated") lines.push(`You work in an isolated VM on it${chosen.vm ? ` (${chosen.vm.name}, ${chosen.vm.state})` : " that you provision with action vm_provision"}.`);
      if (chosen.access === "ask") lines.push("Its access rule is Ask: a command that changes something waits for the person's yes.");
    }
    return lines.length ? lines.join(" ") : null;
  }

  /** The approval gate: this exec on the bot's host needs the person's yes
   * (its access rule is Ask and the command does more than read). */
  function needsCard(principalId: string, botId: string, command: string, hostName?: string): boolean {
    const usable = botHostsSeen(principalId, botId);
    const target = pickHost(principalId, botId, usable, hostName, lastViews.get(principalId.trim().toLowerCase()) ?? []);
    if ("error" in target) return false;
    const hostId = target.hostId;
    return accessSeen.get(`${principalId.trim().toLowerCase()}|${hostId}`) === "ask" && !isReadOnlyCommand(command);
  }

  /** The turn's workplace line about host computers, from the last list
   * (refreshed in the background for the next turn): the chosen host, or the
   * hosts this bot may use without a pick, the ones whose tags the request
   * names first (whatever the Computer setting: the host is extra). */
  function turnNote(principalId: string, botId: string, text: string, _auto: boolean): string | null {
    const key = principalId.trim().toLowerCase();
    void views(principalId).catch(() => undefined);
    const marked = (lastViews.get(key) ?? []).filter((host) => host.botComputer);
    if (!marked.length) return null;
    const chosen = promptPart(principalId, botId, marked);
    if (chosen) return chosen;
    const usable = botHostsSeen(principalId, botId);
    if (!usable.length) return null;
    const matching = hostsMatchingTags(usable, text);
    const ordered = [...matching, ...usable.filter((host) => !matching.includes(host))];
    const list = ordered.map((host) => `${host.name} (${osLabel(host.os)}${host.online ? "" : ", offline"}${host.shellOnly ? ", shell only" : ""}${host.access === "ask" ? ", asks before a change" : ""}${host.tags.length ? `; tags: ${host.tags.join(", ")}` : ""})`).join("; ");
    const hint = matching.length ? ` The request names the tags of ${matching.map((host) => host.name).join(", ")}: prefer it.` : "";
    const how = usable.length === 1
      ? "Run shell commands there with host_computer action exec; nobody needs to pick it first."
      : "Run shell commands on one with host_computer action exec and host set to its name; nobody needs to pick it first.";
    return `The person shared these hosts with you as bot computers: ${list}.${hint} ${how} select_computer with host makes one your computer.`;
  }

  return { views, choices, botHosts, select, selectByBot, answer, ask, call, needsCard, turnNote, provision, refreshVm, sweep, promptPart, sessionOn };
}

function engineLabel(engine: BotComputerVmEngine): string {
  return engine === "libvirt" ? "KVM/libvirt" : engine === "hyperv" ? "Hyper-V" : engine;
}

export type HostComputerRouter = ReturnType<typeof createHostComputerRouter>;
