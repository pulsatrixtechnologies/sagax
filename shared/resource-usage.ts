// Resource usage card (CPU, memory, disk, network) shown only when the
// person asks for it (#876). The server samples read-only and streams frames
// to the card; this file holds what both sides share: the frame shape, the
// message field, the bounds and the formatting.

import { formatBytes } from "./format-bytes.ts";

export { formatBytes };

/** One sample every two seconds. */
export const RESOURCE_CADENCE_MS = 2_000;
/** The charts show the last minute. */
export const RESOURCE_WINDOW_MS = 60_000;
export const RESOURCE_WINDOW_FRAMES = RESOURCE_WINDOW_MS / RESOURCE_CADENCE_MS + 1;
/** A run lasts five minutes, then pauses until the person taps Reprendre. */
export const RESOURCE_RUN_MS = 5 * 60_000;
/** Samplers running at once for one person; a new one pauses the oldest. */
export const RESOURCE_MAX_LIVE_PER_PERSON = 2;
/** Nobody watches the card (it left the screen, the tab closed): pause after this. */
export const RESOURCE_IDLE_MS = 20_000;

export type ResourceTargetKind = "this-computer" | "server" | "host" | "remote-session" | "bot-computer";

export type ResourceState = "starting" | "live" | "paused" | "stopped" | "error";

/** Why a run paused: the time ran out, nobody watched, another run took its place. */
export type ResourcePauseReason = "time" | "idle" | "replaced" | "person";

export interface ResourceVolume {
  /** Mount point or drive letter ("/", "C:", "Macintosh HD"). */
  name: string;
  used: number;
  total: number;
}

export interface ResourceFrame {
  /** Epoch milliseconds when the sample arrived. */
  t: number;
  /** Percent busy, 0-100. `cores` when the computer gives them. Null on the first sample of a counter-based computer. */
  cpu: { total: number; cores?: number[] } | null;
  /** Bytes. */
  mem: { used: number; total: number; swapUsed?: number; swapTotal?: number } | null;
  /** Bytes per second across the computer's disks. */
  disk: { readBps: number; writeBps: number } | null;
  /** Bytes per second across its network interfaces. */
  net: { rxBps: number; txBps: number } | null;
  volumes?: ResourceVolume[];
}

export interface ResourceHost {
  hostname?: string;
  /** "macOS 26.1", "Ubuntu 24.04.1 LTS", "Microsoft Windows 11 Pro". */
  os?: string;
  uptimeSec?: number;
  cores?: number;
}

/** The card's state, from GET /api/resource-usage/:id and the live stream. */
export interface ResourceUsageSnapshot {
  id: string;
  state: ResourceState;
  reason?: ResourcePauseReason;
  host: ResourceHost;
  frames: ResourceFrame[];
  /** When the current run pauses on its own (epoch ms). */
  endsAt?: number;
  /** A sentence for the person; never a path, an address or a key. */
  error?: string;
}

/** What the chat message carries. Labels only: never an address, a key or an id on screen. */
export interface ResourceUsageView {
  samplerId: string;
  target: ResourceTargetKind;
  /** "Ce poste", "Session à distance", the host's label. */
  label: string;
  hostLabel: string;
}

/** Frames on the live stream. */
export type ResourceStreamEvent =
  | { kind: "snapshot"; snapshot: ResourceUsageSnapshot }
  | { kind: "frame"; frame: ResourceFrame; host?: ResourceHost }
  | { kind: "state"; state: ResourceState; reason?: ResourcePauseReason; endsAt?: number; error?: string };

/** The last minute, oldest first. */
export function windowFrames(frames: readonly ResourceFrame[]): ResourceFrame[] {
  return frames.slice(-RESOURCE_WINDOW_FRAMES);
}

/** Words that ask for usage by themselves. */
const USAGE = /\b(?:consommations?|resource usage|usage des ressources|utilisation des ressources|resources? (?:are|is) (?:used|in use))\b/iu;
/** A resource named explicitly... */
const METRIC = /\b(?:cpu|processeurs?|ram|m[ée]moire|memory|swap|disques?|disks?|r[ée]seau|network|bande passante|bandwidth|iops)\b/iu;
/** ...with a usage or a view intent. A resource word alone ("la charge", "load",
 * "storage", "le réseau de distribution") opens nothing. */
const INTENT = /\b(?:usage|utilisation|utilis[ée]e?s?|using|used|consomm\w*|occup\w*|graph(?:ique|e)?s?|charts?|courbes?|en direct|live|combien|how much|monitor\w*|surveill\w*|niveau|level)\b/iu;

/** True when the person's message asks to see a computer's usage. The card
 * is a view: it shows only when asked (#876). */
export function askedForResources(text: string | undefined | null): boolean {
  if (!text) return false;
  const value = text.normalize("NFC");
  return USAGE.test(value) || (METRIC.test(value) && INTENT.test(value));
}

const french = (locale: string) => locale === "fr" || locale.startsWith("fr-");

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(french(locale) ? "fr-CA" : "en-US", { maximumFractionDigits: digits }).format(value)
    // fr-CA groups with no-break spaces; the card uses plain ones and nowrap
    .replace(/[\u202f\u00a0]/g, " ");
}

export function formatRate(bytesPerSecond: number, locale: string): string {
  return `${formatBytes(bytesPerSecond, locale)}/s`;
}

export function formatPercent(value: number, locale: string): string {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const text = number(clamped, locale, clamped < 10 ? 1 : 0);
  return french(locale) ? `${text} %` : `${text}%`;
}

export function formatUptime(seconds: number, locale: string): string {
  const day = french(locale) ? "j" : "d";
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return "< 1 min";
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} ${day} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
