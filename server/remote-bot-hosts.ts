// Attach enrolled unattended hosts to a bot (Computer tab, 2026-11-01).
// The person adds endpoints so the bot has access by default. Person
// isolation: only the person's own enrolled hosts may be attached to bots
// they own (or can edit). Sharing across people is out of scope here.
import {
  attachRemoteHost,
  cleanRemoteHosts,
  detachRemoteHost,
} from "../shared/remote-bot-hosts.ts";
import {
  hostOwnedByPerson,
  parseUnattendedHostId,
  type UnattendedHostRow,
} from "../shared/remote-unattended-host.ts";
import type { UnattendedHosts } from "./remote-unattended-hosts.ts";

export type RemoteBotHostsOutcome =
  | { ok: true; remoteHosts: string[] }
  | { ok: false; error: "forbidden" | "invalid" | "unavailable" | "not_found"; message: string };

export function createRemoteBotHosts(deps: {
  /** Bots the person may edit. */
  bot(botId: string): { id: string; remoteHosts?: string[]; ownerPrincipalId?: string | null } | null;
  /** True when the principal may change this bot (owner or admin). */
  canEdit(principalId: string, botId: string): boolean;
  /** Persist the cleaned host list on the bot. */
  save(botId: string, remoteHosts: string[]): void;
  /** Enrolled hosts at Perspicax for this person. */
  hosts: Pick<UnattendedHosts, "list" | "open" | "revoke">;
  /** Perspicax subject for the Sagax principal (ownership via installed_by). */
  ownerSub?(principalId: string): string | null;
}) {
  function mine(principalId: string, hosts: UnattendedHostRow[]): UnattendedHostRow[] {
    const sub = deps.ownerSub?.(principalId) ?? null;
    return hosts.filter((row) => hostOwnedByPerson(row, sub));
  }

  async function available(principalId: string): Promise<{ available: boolean; hosts: UnattendedHostRow[]; reason?: string }> {
    const listed = await deps.hosts.list({ principalId });
    if (!listed.available) return { available: false, hosts: [], reason: listed.reason };
    // Person isolation: only enrolled hosts the person owns (not revoked).
    return { available: true, hosts: mine(principalId, listed.hosts).filter((row) => row.state !== "revoked") };
  }

  async function assertOwnHost(principalId: string, hostId: string): Promise<UnattendedHostRow | RemoteBotHostsOutcome> {
    const id = parseUnattendedHostId(hostId);
    if (!id) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
    const listed = await available(principalId);
    if (!listed.available) return { ok: false, error: "unavailable", message: listed.reason ?? "Enrolled hosts are not available." };
    const row = listed.hosts.find((host) => host.hostId === id);
    if (!row || row.state !== "enrolled") return { ok: false, error: "not_found", message: "That computer is not one of your enrolled hosts." };
    return row;
  }

  return {
    available,
    assertOwnHost,

    /** Attached hosts for this bot, plus the person's full enrolled catalog
     * so the Computer tab can offer "Add endpoint". */
    async forBot(principalId: string, botId: string): Promise<{
      available: boolean;
      hosts: UnattendedHostRow[];
      catalog: UnattendedHostRow[];
      attached: string[];
      reason?: string;
    }> {
      const bot = deps.bot(botId);
      if (!bot || !deps.canEdit(principalId, botId)) {
        return { available: false, hosts: [], catalog: [], attached: [], reason: "You cannot change that bot." };
      }
      const listed = await available(principalId);
      const attached = cleanRemoteHosts(bot.remoteHosts);
      if (!listed.available) return { available: false, hosts: [], catalog: [], attached, reason: listed.reason };
      const owned = new Map(listed.hosts.map((row) => [row.hostId, row]));
      return {
        available: true,
        attached,
        catalog: listed.hosts,
        // Attached ids that are no longer owned disappear from the offer.
        hosts: attached.map((id) => owned.get(id)).filter((row): row is UnattendedHostRow => Boolean(row)),
      };
    },

    async attach(principalId: string, botId: string, hostId: string): Promise<RemoteBotHostsOutcome> {
      const bot = deps.bot(botId);
      if (!bot || !deps.canEdit(principalId, botId)) {
        return { ok: false, error: "forbidden", message: "You cannot change that bot." };
      }
      const host = await assertOwnHost(principalId, hostId);
      if ("ok" in host && host.ok === false) return host;
      const next = attachRemoteHost(bot.remoteHosts, (host as UnattendedHostRow).hostId);
      if (!next) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      deps.save(botId, next);
      return { ok: true, remoteHosts: next };
    },

    async detach(principalId: string, botId: string, hostId: string): Promise<RemoteBotHostsOutcome> {
      const bot = deps.bot(botId);
      if (!bot || !deps.canEdit(principalId, botId)) {
        return { ok: false, error: "forbidden", message: "You cannot change that bot." };
      }
      const id = parseUnattendedHostId(hostId);
      if (!id) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      const next = detachRemoteHost(bot.remoteHosts, id);
      deps.save(botId, next);
      return { ok: true, remoteHosts: next };
    },

    /** Open an unattended session against an attached host for this bot.
     * Person isolation: the host must be theirs and attached to the bot. */
    async open(principalId: string, botId: string, hostId: string, options: { scope?: string; rights?: string } = {}) {
      const bot = deps.bot(botId);
      if (!bot || !deps.canEdit(principalId, botId)) {
        return { ok: false as const, error: "forbidden" as const, message: "You cannot change that bot." };
      }
      const id = parseUnattendedHostId(hostId);
      if (!id || !cleanRemoteHosts(bot.remoteHosts).includes(id)) {
        return { ok: false as const, error: "not_found" as const, message: "Add that computer to this bot first." };
      }
      const host = await assertOwnHost(principalId, id);
      if ("ok" in host && host.ok === false) return host;
      return deps.hosts.open({ principalId }, id, options);
    },
  };
}

export type RemoteBotHosts = ReturnType<typeof createRemoteBotHosts>;
