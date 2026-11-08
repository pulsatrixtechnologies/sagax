// Where one Sagax server keeps each person's bot computers (#2726, #2727):
// per enrolled host, "Use as a bot computer", its tags, what it is (OS,
// shell only), the isolated / as-is answer per bot and its VM; per bot, the
// host it works on. Per person: nobody reads or writes another person's
// entries. The file is 0600 and holds no address and no key.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  cleanHostTags,
  type BotComputerHostMode,
  type BotComputerHostOs,
  type BotComputerVmView,
} from "../../shared/bot-computer-host.ts";
import { parseUnattendedHostId } from "../../shared/remote-unattended-host.ts";

const FILE = "host-computers.json";
const PENDING_MS = 24 * 60 * 60 * 1000;

export interface HostComputerSettings {
  botComputer: boolean;
  tags: string[];
  /** Learned from the first session (uname / ver) or set by the person. */
  os?: BotComputerHostOs;
  /** No desktop: shell only, no screenshot (learned or set). */
  shellOnly?: boolean;
  /** The isolated / as-is answer, per bot id. */
  modes: Record<string, BotComputerHostMode>;
  /** The VM a bot works in when it chose isolated, one per host. */
  vm?: BotComputerVmView;
}

interface PersonEntry {
  hosts: Record<string, HostComputerSettings>;
  /** The host each bot works on (its Computer choice). */
  bots: Record<string, string>;
  /** Isolated / as-is questions waiting for an answer: requestId to host and bot. */
  pending: Record<string, { hostId: string; botId: string; threadId: string; at: number }>;
}

function emptyPerson(): PersonEntry {
  return { hosts: {}, bots: {}, pending: {} };
}

function emptySettings(): HostComputerSettings {
  return { botComputer: false, tags: [], modes: {} };
}

function norm(principalId: string): string {
  return principalId.trim().toLowerCase();
}

export function createHostComputerStore(deps: { dataDir: string; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  const file = path.join(deps.dataDir, FILE);
  let people: Record<string, PersonEntry> = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { people?: Record<string, PersonEntry> };
    if (parsed.people && typeof parsed.people === "object") people = parsed.people;
  } catch {
    people = {};
  }

  const persist = () => {
    mkdirSync(deps.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ people }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* windows */ }
  };

  const person = (principalId: string): PersonEntry => {
    const key = norm(principalId);
    const entry = people[key] ?? emptyPerson();
    entry.hosts ??= {};
    entry.bots ??= {};
    entry.pending ??= {};
    people[key] = entry;
    return entry;
  };

  const settingsOf = (principalId: string, hostId: string): HostComputerSettings => {
    const entry = person(principalId);
    const current = entry.hosts[hostId] ?? emptySettings();
    current.modes ??= {};
    current.tags ??= [];
    entry.hosts[hostId] = current;
    return current;
  };

  return {
    /** Every host this person set something on. */
    hosts(principalId: string): Record<string, HostComputerSettings> {
      return { ...people[norm(principalId)]?.hosts };
    },
    host(principalId: string, hostId: string): HostComputerSettings | null {
      return people[norm(principalId)]?.hosts?.[hostId] ?? null;
    },
    /** The host row's ⋯ menu: the toggle, the tags, the OS / shell-only facts. */
    update(principalId: string, rawHostId: string, patch: { botComputer?: boolean; tags?: unknown; os?: BotComputerHostOs | null; shellOnly?: boolean }): HostComputerSettings | null {
      const hostId = parseUnattendedHostId(rawHostId);
      if (!hostId) return null;
      const settings = settingsOf(principalId, hostId);
      if (typeof patch.botComputer === "boolean") settings.botComputer = patch.botComputer;
      if (patch.tags !== undefined) settings.tags = cleanHostTags(patch.tags);
      if (patch.os === null) delete settings.os;
      else if (patch.os) settings.os = patch.os;
      if (typeof patch.shellOnly === "boolean") settings.shellOnly = patch.shellOnly;
      // no longer a bot computer: the bots that worked there go back to Auto
      if (patch.botComputer === false) {
        const entry = person(principalId);
        for (const [botId, chosen] of Object.entries(entry.bots)) if (chosen === hostId) delete entry.bots[botId];
      }
      persist();
      return settings;
    },
    /** The host a bot works on, or null (Auto, local, cloud). */
    botHost(principalId: string, botId: string): string | null {
      return people[norm(principalId)]?.bots?.[botId] ?? null;
    },
    setBotHost(principalId: string, botId: string, hostId: string | null): void {
      const entry = person(principalId);
      if (hostId) entry.bots[botId] = hostId;
      else delete entry.bots[botId];
      persist();
    },
    /** Bot ids of this person that work on that host. */
    botsOn(principalId: string, hostId: string): string[] {
      return Object.entries(people[norm(principalId)]?.bots ?? {}).filter(([, chosen]) => chosen === hostId).map(([botId]) => botId);
    },
    mode(principalId: string, hostId: string, botId: string): BotComputerHostMode | null {
      return people[norm(principalId)]?.hosts?.[hostId]?.modes?.[botId] ?? null;
    },
    setMode(principalId: string, hostId: string, botId: string, mode: BotComputerHostMode | null): void {
      const settings = settingsOf(principalId, hostId);
      if (mode) settings.modes[botId] = mode;
      else delete settings.modes[botId];
      persist();
    },
    setVm(principalId: string, hostId: string, vm: BotComputerVmView | null): void {
      const settings = settingsOf(principalId, hostId);
      if (vm) settings.vm = vm;
      else delete settings.vm;
      persist();
    },
    /** Remember a question the bot's chat shows, until it is answered. */
    ask(principalId: string, requestId: string, target: { hostId: string; botId: string; threadId: string }): void {
      const entry = person(principalId);
      const cutoff = now() - PENDING_MS;
      for (const [id, row] of Object.entries(entry.pending)) if (row.at < cutoff) delete entry.pending[id];
      entry.pending[requestId] = { ...target, at: now() };
      persist();
    },
    /** The question this answer belongs to, across people (the answer hook
     * knows the request id only); removed once read. */
    takePending(requestId: string): { principalId: string; hostId: string; botId: string; threadId: string } | null {
      for (const [principalId, entry] of Object.entries(people)) {
        const row = entry.pending?.[requestId];
        if (!row) continue;
        delete entry.pending[requestId];
        persist();
        return { principalId, hostId: row.hostId, botId: row.botId, threadId: row.threadId };
      }
      return null;
    },
    /** A question is already waiting for this host and bot. */
    pendingFor(principalId: string, hostId: string, botId: string): string | null {
      const entry = people[norm(principalId)];
      if (!entry?.pending) return null;
      const cutoff = now() - PENDING_MS;
      const found = Object.entries(entry.pending).find(([, row]) => row.hostId === hostId && row.botId === botId && row.at >= cutoff);
      return found ? found[0] : null;
    },
  };
}

export type HostComputerStore = ReturnType<typeof createHostComputerStore>;
