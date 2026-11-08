// An enrolled unattended host the person marked "Use as a bot computer"
// (#2726): it shows as a choice in a bot's Computer menu, and the bot's shell
// and screen calls run there through the remote channel, without a Remote
// session card. Shared by the server store, the routes and the client.

export type BotComputerHostOs = "windows" | "macos" | "linux";
/** How a bot uses the host (#2727): a VM it provisions there, or the host itself. */
export type BotComputerHostMode = "isolated" | "as_is";
/** The host's own access rule (Always allow / Ask / Never), as the host row sets it. */
export type BotComputerHostAccess = "always" | "ask" | "never";
export type BotComputerVmEngine = "libvirt" | "tart" | "lima" | "hyperv";
export type BotComputerVmState = "provisioning" | "ready" | "failed" | "deleting";

/** The prefix of a Computer choice that is a host (the other choices are
 * "auto", "local", "cloud" and the shared computers). */
export const HOST_CHOICE_PREFIX = "host:";
/** A host is online when its last beat is this recent (it beats every 10 s). */
export const HOST_ONLINE_MS = 2 * 60_000;
export const MAX_HOST_TAGS = 12;
const TAG_MAX = 32;

export interface BotComputerVmView {
  engine: BotComputerVmEngine;
  state: BotComputerVmState;
  name: string;
  /** One short line for the chat's provisioning state ("Creating the disk"). */
  step?: string;
  /** Plain-text reason when it failed. */
  error?: string;
  updatedAt: number;
}

/** One host as the Computer menus and the host row show it. Never its id in text. */
export interface BotComputerHostView {
  hostId: string;
  name: string;
  os: BotComputerHostOs | null;
  online: boolean;
  botComputer: boolean;
  tags: string[];
  /** No desktop there (unRAID, a server): shell only, no screenshot. */
  shellOnly: boolean;
  access: BotComputerHostAccess;
  /** The answer per bot to "isolated or as-is" (#2727). */
  modes: Record<string, BotComputerHostMode>;
  vm: BotComputerVmView | null;
}

export function hostChoiceValue(hostId: string): string {
  return `${HOST_CHOICE_PREFIX}${hostId}`;
}

export function hostIdOfChoice(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith(HOST_CHOICE_PREFIX)) return null;
  const id = value.slice(HOST_CHOICE_PREFIX.length);
  return /^h_[0-9a-f]{32}$/.test(id) ? id : null;
}

/** Free-form tags: trimmed, lower case, no duplicates, short, at most twelve. */
export function cleanHostTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const tag = item.normalize("NFKC").replace(/[<>`]/g, "").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, TAG_MAX);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_HOST_TAGS) break;
  }
  return out;
}

export function hostOnline(lastSeenAt: string | null | undefined, now: number): boolean {
  if (!lastSeenAt) return false;
  const at = Date.parse(lastSeenAt);
  return Number.isFinite(at) && now - at <= HOST_ONLINE_MS;
}

export function parseHostOs(raw: unknown): BotComputerHostOs | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.startsWith("win")) return "windows";
  if (value === "macos" || value === "darwin" || value === "mac" || value === "osx") return "macos";
  if (value === "linux" || value === "unraid" || value === "ubuntu" || value === "debian") return "linux";
  return null;
}

export function osLabel(os: BotComputerHostOs | null): string {
  return os === "windows" ? "Windows" : os === "macos" ? "macOS" : os === "linux" ? "Linux" : "Unknown OS";
}

/** The Computer menu order: online hosts first, then by name; an offline
 * host stays a choice, last and greyed. */
export function sortHostChoices<T extends Pick<BotComputerHostView, "name" | "online">>(hosts: readonly T[]): T[] {
  return [...hosts].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1));
}

/** In Auto mode, the hosts whose tags a request mentions come first. A tag
 * matches a whole word of the text ("gpu", "unraid", "build"). */
export function hostsMatchingTags<T extends Pick<BotComputerHostView, "tags" | "online">>(hosts: readonly T[], text: string): T[] {
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean));
  const lower = text.toLowerCase();
  return hosts.filter((host) => host.online && host.tags.some((tag) => (tag.includes(" ") ? lower.includes(tag) : words.has(tag))));
}

export function modeLabel(mode: BotComputerHostMode): string {
  return mode === "isolated" ? "Isolated environment (VM on this host)" : "Use the host as-is";
}
