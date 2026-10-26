// Which computer a resource card samples, and whether this person may. The
// rules are the existing ones, never new ones:
// - this computer / the Sagax server: the solo operator, or an organization
//   admin for the server (the same people who open its terminal);
// - an SSH or unRAID host: terminalResourceAllowed, exactly as the in-chat
//   terminal (an admin, or a holder of host.commands);
// - a Tailcat session: only a connected session of this person and this bot,
//   and only while its tunnel resolves on this host (remote-sessions owned +
//   tunnelOf);
// - the bot's computer: its Local VM on this computer (solo).
// Reading is read-only, so no approval card (#875). Each `open` checks again:
// a Reprendre an hour later never outlives a right taken away.
import type { ResourceTargetKind, ResourceUsageView } from "../../shared/resource-usage.ts";
import type { RemoteSessionOs } from "../../shared/remote-session.ts";
import type { TerminalAccess } from "../terminal-resources/types.ts";
import { terminalResourceAllowed } from "../terminal-resources/registry.ts";
import type { OpenSource, SampleSource } from "./sampler.ts";

export const RESOURCE_TARGETS = ["this_computer", "sagax_server", "host", "remote_session", "bot_computer"] as const;
export type ResourceTargetArg = (typeof RESOURCE_TARGETS)[number];

export interface ResourceHostEntry {
  id: string;
  provider: "ssh" | "unraid";
  label: string;
  hostLabel: string;
  alias: string;
}

export interface ResourceSessionEntry {
  id: string;
  /** The 6-character support code: the session's label. */
  code: string;
  hostname?: string;
  os: RemoteSessionOs;
  focused?: boolean;
  threadId?: string;
}

export interface ResourceTargetDeps {
  /** An organization server (Perspicax sign-in). */
  organization(): boolean;
  /** The server is the Sagax app on the person's own computer. */
  desktopManaged(): boolean;
  access(principalId: string, botId: string): TerminalAccess;
  owner(botId: string, threadId: string): string;
  localHostname(): string;
  localSource(): SampleSource;
  /** The server's SSH and unRAID hosts (config). */
  hosts(): ResourceHostEntry[];
  sshSource(alias: string): SampleSource;
  /** This person's connected Tailcat sessions with this bot. */
  remoteSessions(principalId: string, botId: string): ResourceSessionEntry[];
  /** The session's tunnel as a source, or null when it no longer resolves here. */
  tailcatSource(entry: ResourceSessionEntry, principalId: string, botId: string): SampleSource | null;
  /** The bot's Local VM, when it runs on this computer. */
  botComputer?(botId: string, threadId: string): Promise<{ hostLabel: string; source: SampleSource } | null>;
}

export interface ResourceTargetRequest {
  principalId: string;
  botId: string;
  threadId: string;
  target: ResourceTargetArg;
  /** host: its label, host name, alias or id. */
  host?: string;
  /** remote_session: its support code or computer name. */
  session?: string;
}

export interface ResolvedResourceTarget {
  view: Omit<ResourceUsageView, "samplerId">;
  open: OpenSource;
}

const same = (a: string | undefined, b: string) => Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();
const compactCode = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();

function accessFor(deps: ResourceTargetDeps, request: ResourceTargetRequest): TerminalAccess {
  return {
    ...deps.access(request.principalId, request.botId),
    ownsConversation: deps.owner(request.botId, request.threadId).trim().toLowerCase() === request.principalId,
  };
}

/** The server's own computer is for whoever may run commands on it. */
function localAllowed(access: TerminalAccess): boolean {
  return access.admin === true;
}

function pickSession(list: ResourceSessionEntry[], wanted: string | undefined, threadId: string): ResourceSessionEntry | null {
  if (wanted?.trim()) {
    const code = compactCode(wanted);
    return list.find((entry) => compactCode(entry.code) === code || same(entry.hostname, wanted)) ?? null;
  }
  const here = list.filter((entry) => entry.threadId === threadId);
  const pool = here.length ? here : list;
  return pool.find((entry) => entry.focused) ?? pool[pool.length - 1] ?? null;
}

/** A sentence for the bot; it names things, never an id, an address or a key. */
export type ResourceTargetRefusal = { error: string; code: "forbidden" | "unavailable" | "unknown" };

export async function resolveResourceTarget(deps: ResourceTargetDeps, request: ResourceTargetRequest): Promise<ResolvedResourceTarget | ResourceTargetRefusal> {
  const access = accessFor(deps, request);
  const target = request.target;

  if (target === "this_computer" || target === "sagax_server") {
    const organization = deps.organization();
    if (target === "this_computer" && organization) {
      return { code: "unavailable", error: "On an organization server, the person's own computer cannot be sampled from here yet (it runs behind their Sagax app). Offer a terminal on their computer with offer_shell_terminal, or sample a remote session or a server host they have access to." };
    }
    if (!localAllowed(access)) {
      return { code: "forbidden", error: organization ? "Only an organization admin may read the Sagax server's own usage." : "Only the person who runs this Sagax may read this computer's usage." };
    }
    const kind: ResourceTargetKind = organization || !deps.desktopManaged() ? "server" : "this-computer";
    return {
      view: { target: kind, label: kind === "server" ? "Serveur Sagax" : "Ce poste", hostLabel: deps.localHostname() },
      open: async () => (localAllowed(accessFor(deps, request)) ? deps.localSource() : { error: "forbidden" }),
    };
  }

  if (target === "host") {
    const hosts = deps.hosts();
    const wanted = request.host?.trim() ?? "";
    const find = (list: ResourceHostEntry[]) => list.find((entry) => same(entry.id, wanted) || same(entry.label, wanted) || same(entry.hostLabel, wanted) || same(entry.alias, wanted))
      ?? (list.length === 1 && !wanted ? list[0]! : null);
    const allowed = (entry: ResourceHostEntry) => terminalResourceAllowed({ scope: "server" }, accessFor(deps, request)) && Boolean(entry);
    const entry = find(hosts);
    if (!terminalResourceAllowed({ scope: "server" }, access)) {
      return { code: "forbidden", error: "This person may not reach the organization's server hosts (that needs “Run commands on the organization's server”, which an admin gives in Perspicax)." };
    }
    if (!entry) {
      const names = hosts.map((item) => item.label === item.hostLabel ? item.label : `${item.label} (${item.hostLabel})`);
      return { code: "unknown", error: names.length ? `No host named “${wanted}”. Hosts this person may read: ${names.join(", ")}.` : "No server host is set up on this Sagax." };
    }
    return {
      view: { target: "host", label: entry.label, hostLabel: entry.hostLabel },
      open: async () => {
        const again = find(deps.hosts());
        if (!again || !allowed(again)) return { error: "forbidden" };
        return deps.sshSource(again.alias);
      },
    };
  }

  if (target === "remote_session") {
    const entry = pickSession(deps.remoteSessions(request.principalId, request.botId), request.session, request.threadId);
    if (!entry) {
      return { code: "unknown", error: request.session ? `No connected remote session “${request.session}” for this person with this bot.` : "No remote session is connected for this person with this bot. Open one with remote_support_open first." };
    }
    if (!deps.tailcatSource(entry, request.principalId, request.botId)) {
      return { code: "unavailable", error: "The tunnel for this remote computer is not on this server yet." };
    }
    return {
      view: { target: "remote-session", label: "Session à distance", hostLabel: entry.hostname || entry.code },
      open: async () => {
        // the session must still be this person's, with this bot, and connected
        const again = deps.remoteSessions(request.principalId, request.botId).find((row) => row.id === entry.id);
        if (!again) return { error: "gone" };
        return deps.tailcatSource(again, request.principalId, request.botId) ?? { error: "unreachable" };
      },
    };
  }

  // bot_computer
  if (!deps.botComputer) {
    return { code: "unavailable", error: "The bot's own computer cannot be sampled on this server. Sample this computer, a server host or a remote session instead." };
  }
  const ownsBot = access.ownsBot || access.admin;
  if (!ownsBot) return { code: "forbidden", error: "Only the bot's owner may read its computer's usage." };
  const computer = await deps.botComputer(request.botId, request.threadId);
  if (!computer) return { code: "unavailable", error: "The bot's Local VM is not running. Start it first, or sample another computer." };
  return {
    view: { target: "bot-computer", label: "Ordinateur du bot", hostLabel: computer.hostLabel },
    open: async () => {
      const again = accessFor(deps, request);
      if (!(again.ownsBot || again.admin)) return { error: "forbidden" };
      const live = await deps.botComputer!(request.botId, request.threadId);
      return live ? live.source : { error: "unreachable" };
    },
  };
}
