// A bot computer that is an enrolled host (#2726, #2727): the bot's shell and
// screen calls run there through the remote channel, without a Remote session
// card. The session opens on demand (through that bot's own Perspicax link),
// is reused, and closes when idle. The host's own access rule (Always allow /
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
import type { RemoteExecResult } from "./remote-sessions.ts";

export const HOST_COMPUTER_ACTIONS = ["exec", "screenshot", "vm_status", "vm_provision", "vm_delete", "vm_rebuild", "set_mode", "ask_mode"] as const;
export type HostComputerAction = typeof HOST_COMPUTER_ACTIONS[number];

/** Idle sessions close after this long without a call. */
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

export const HOST_SESSION_IDLE_MS = 10 * 60_000;
const CONNECT_WAIT_MS = 60_000;
const CONNECT_POLL_MS = 1_500;
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
}

export type HostComputerCallResult =
  | { text: string; isError?: boolean }
  | { image: Buffer; text: string };

interface SessionDeps {
  target(input: { principalId: string; botId: string; threadId: string; id?: string }): { id: string; os: string; osGuessed?: boolean; headless?: boolean } | null;
  exec(input: { principalId: string; botId: string; threadId: string; id?: string; command: string; timeoutMs?: number }): Promise<RemoteExecResult | { error: string }>;
  screen(principalId: string, botId: string, id: string): Promise<Buffer | null>;
  close(principalId: string, botId: string, id: string): Promise<unknown>;
  markQuiet(id: string): void;
}

interface HostsDeps {
  list(viewer: UnattendedHostsViewer): Promise<HostsListOutcome>;
  open(viewer: UnattendedHostsViewer, hostId: string, options: { seatFor?: UnattendedSeatTarget; onSession?: (id: string) => void }): Promise<HostOpenOutcome>;
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
  /** principal|bot|host: the quiet session this bot uses there. */
  const open = new Map<string, { sessionId: string; lastUsed: number; principalId: string; botId: string }>();
  const opening = new Map<string, Promise<{ sessionId: string } | { error: string }>>();
  const polling = new Set<string>();
  const key = (principalId: string, botId: string, hostId: string) => `${principalId.trim().toLowerCase()}|${botId}|${hostId}`;

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
    const hosts = sortHostChoices(rows.filter((row) => !vmNames.has(row.hostname ?? "")).map((row) => viewOf(principalId, row)));
    if (!error) lastViews.set(principalId.trim().toLowerCase(), hosts);
    return error ? { hosts, error } : { hosts };
  }

  /** The hosts marked "Use as a bot computer": the Computer menu choices. */
  async function choices(principalId: string): Promise<BotComputerHostView[]> {
    return (await views(principalId)).hosts.filter((host) => host.botComputer);
  }

  /** Open (or reuse) the quiet session of this bot on that host. */
  async function sessionOn(principalId: string, botId: string, hostId: string): Promise<{ sessionId: string } | { error: string }> {
    const k = key(principalId, botId, hostId);
    const known = open.get(k);
    if (known && deps.sessions.target({ principalId, botId, threadId: "", id: known.sessionId })) {
      known.lastUsed = now();
      return { sessionId: known.sessionId };
    }
    open.delete(k);
    const pending = opening.get(k);
    if (pending) return pending;
    const run = (async () => {
      const threadId = deps.botThread(botId);
      if (!threadId) return { error: "That bot has no conversation to open the session on." };
      const outcome = await deps.hosts.open({ principalId }, hostId, {
        seatFor: { botId, threadId },
        onSession: (id) => deps.sessions.markQuiet(id),
      });
      if (!outcome.ok) return { error: outcome.message };
      deps.sessions.markQuiet(outcome.session);
      const deadline = now() + CONNECT_WAIT_MS;
      while (now() < deadline) {
        if (deps.sessions.target({ principalId, botId, threadId, id: outcome.session })) {
          open.set(k, { sessionId: outcome.session, lastUsed: now(), principalId, botId });
          return { sessionId: outcome.session };
        }
        await sleep(CONNECT_POLL_MS);
      }
      return { error: "The host did not answer in time. It may be asleep or offline; try again in a moment." };
    })().finally(() => opening.delete(k));
    opening.set(k, run);
    return run;
  }

  const execOn = async (principalId: string, botId: string, hostId: string, command: string, timeoutMs?: number) => {
    const session = await sessionOn(principalId, botId, hostId);
    if ("error" in session) return session;
    return deps.sessions.exec({ principalId, botId, threadId: "", id: session.sessionId, command, ...(timeoutMs ? { timeoutMs } : {}) });
  };

  /** Close the sessions nobody used for a while. */
  async function sweep(): Promise<number> {
    let closed = 0;
    for (const [k, row] of open) {
      if (now() - row.lastUsed < HOST_SESSION_IDLE_MS) continue;
      open.delete(k);
      await deps.sessions.close(row.principalId, row.botId, row.sessionId).catch(() => null);
      closed += 1;
    }
    return closed;
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
    if (deps.store.mode(principalId, hostId, botId)) return { ok: true, asked: false };
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
    const k = key(principalId, botId, hostId);
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
    const hostId = deps.store.botHost(principalId, botId);
    if (!hostId) return { text: "This bot's computer is not a host. Pick one in the Computer menu, or use your usual computer tools.", isError: true };
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
    if (!deps.store.mode(principalId, hostId, botId)) {
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
      const image = await deps.sessions.screen(principalId, botId, session.sessionId);
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
    if ("error" in out) return { text: out.error, isError: true };
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
      const mode = chosen.modes[botId] ?? null;
      lines.push(`Your computer is the host "${chosen.name}" (${osLabel(chosen.os)}${chosen.online ? "" : ", offline"}). Run shell commands there with host_computer action exec${chosen.shellOnly ? "; it is shell only, no screenshot" : ", and look at it with action screenshot"}. No Remote session card is needed.`);
      if (!mode) lines.push("The person has not said yet whether you work in an isolated VM on it or on the host as-is: call host_computer action ask_mode before anything else.");
      else if (mode === "isolated") lines.push(`You work in an isolated VM on it${chosen.vm ? ` (${chosen.vm.name}, ${chosen.vm.state})` : " that you provision with action vm_provision"}.`);
      if (chosen.access === "ask") lines.push("Its access rule is Ask: a command that changes something waits for the person's yes.");
    }
    return lines.length ? lines.join(" ") : null;
  }

  /** The approval gate: this exec on the bot's host needs the person's yes
   * (its access rule is Ask and the command does more than read). */
  function needsCard(principalId: string, botId: string, command: string): boolean {
    const hostId = deps.store.botHost(principalId, botId);
    if (!hostId) return false;
    return accessSeen.get(`${principalId.trim().toLowerCase()}|${hostId}`) === "ask" && !isReadOnlyCommand(command);
  }

  /** The turn's workplace line about host computers, from the last list
   * (refreshed in the background for the next turn): the chosen host, or in
   * Auto the marked hosts with the ones whose tags the request names first. */
  function turnNote(principalId: string, botId: string, text: string, auto: boolean): string | null {
    const key = principalId.trim().toLowerCase();
    void views(principalId).catch(() => undefined);
    const marked = (lastViews.get(key) ?? []).filter((host) => host.botComputer);
    if (!marked.length) return null;
    const chosen = promptPart(principalId, botId, marked);
    if (chosen) return chosen;
    if (!auto) return null;
    const matching = hostsMatchingTags(marked, text);
    const ordered = [...matching, ...marked.filter((host) => !matching.includes(host))];
    const list = ordered.map((host) => `${host.name} (${osLabel(host.os)}${host.online ? "" : ", offline"}${host.shellOnly ? ", shell only" : ""}${host.tags.length ? `; tags: ${host.tags.join(", ")}` : ""})`).join("; ");
    const hint = matching.length ? ` The request names the tags of ${matching.map((host) => host.name).join(", ")}: prefer it.` : "";
    return `The person also marked these hosts as bot computers: ${list}.${hint} To work on one, the person picks it in the Computer menu; when a step clearly needs one, say which in one line and ask them to pick it.`;
  }

  return { views, choices, select, answer, ask, call, needsCard, turnNote, provision, refreshVm, sweep, promptPart, sessionOn };
}

function engineLabel(engine: BotComputerVmEngine): string {
  return engine === "libvirt" ? "KVM/libvirt" : engine === "hyperv" ? "Hyper-V" : engine;
}

export type HostComputerRouter = ReturnType<typeof createHostComputerRouter>;
