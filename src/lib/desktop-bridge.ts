// Where bots work for the signed-in person on an organization server: their
// own computer through this desktop app (the desktop bridge), or their server
// environment (server/desktop-bridge-routes.ts, shared/bot-workplace.ts).
// The preference is a synced localStorage key (src/lib/user-preferences-sync.ts
// saves it for the person); the status comes from GET /api/me/desktop-bridge,
// which a solo server answers 404 (then nothing here shows).
import { useEffect, useState } from "react";

import { BOT_WORKPLACE_PREFERENCE, parseBotWorkplace, serializeBotWorkplace, type BotWorkplace } from "../../shared/bot-workplace";

export interface DesktopBridgeActivity {
  at: number;
  target: string;
  kind: "tool" | "network" | "connect";
  detail: string;
  ok: boolean;
  error?: string;
}

/** Coarse facts the desktop app reports about itself (server/desktop-bridge.ts). */
export interface DesktopSystemInfo {
  os: string;
  arch: string;
  cpuModel?: string;
  cpus: number;
  cpuPercent?: number;
  memoryGb: number;
  memoryUsedGb?: number;
  diskGb?: number;
  diskFreeGb?: number;
}

export interface DesktopBridgeDesktop {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  busy: boolean;
  lastSeenAt: number;
  capabilities?: { localVm?: boolean };
  system?: DesktopSystemInfo;
}

export interface DesktopBridgeStatus {
  connected: boolean;
  tunnel: boolean;
  desktops: DesktopBridgeDesktop[];
  workplace: BotWorkplace;
  activity: DesktopBridgeActivity[];
}

/** Null where there is no bridge (a solo server, no person); throws when
 * the server could not be asked right now. */
export async function loadDesktopBridge(fetchImpl: typeof fetch = fetch): Promise<DesktopBridgeStatus | null> {
  const response = await fetchImpl("/api/me/desktop-bridge", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`desktop bridge status ${response.status}`);
  return await response.json() as DesktopBridgeStatus;
}

export function readWorkplace(storage: Pick<Storage, "getItem"> = localStorage): BotWorkplace {
  try { return parseBotWorkplace(storage.getItem(BOT_WORKPLACE_PREFERENCE)); } catch { return parseBotWorkplace(null); }
}

export function writeWorkplace(value: BotWorkplace, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(BOT_WORKPLACE_PREFERENCE, serializeBotWorkplace(value)); } catch { /* storage refused */ }
}

/** What the composer says about where this conversation's bot works: only
 * when it works on the person's own computer (Local VM or This computer),
 * on it or "not connected". Auto and Cloud use the server environment and
 * need no notice (src/lib/place.ts orgComputerFor). */
export type WorkplaceNoticeKind = "computer" | "fallback" | null;

export function workplaceNotice(status: DesktopBridgeStatus | null, computer: "server" | "computer" | null): WorkplaceNoticeKind {
  if (!status || computer !== "computer") return null;
  return status.connected ? "computer" : "fallback";
}

/** True when a refresh would not change what the composer already shows. */
export function sameDesktopBridgeStatus(previous: DesktopBridgeStatus | null, next: DesktopBridgeStatus | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return JSON.stringify(previous) === JSON.stringify(next);
}

/** The person's bridge status, refreshed while shown (organization only). */
export function useDesktopBridgeStatus(refreshMs = 20_000): DesktopBridgeStatus | null {
  const [status, setStatus] = useState<DesktopBridgeStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    const load = async () => {
      let next: DesktopBridgeStatus | null;
      try { next = await loadDesktopBridge(); } catch { return; /* keep the last answer */ }
      if (cancelled) return;
      setStatus((previous) => sameDesktopBridgeStatus(previous, next) ? previous : next);
      // A solo server has no bridge: stop asking.
      if (next === null) stopped = true;
    };
    void load();
    const timer = window.setInterval(() => { if (!stopped && document.visibilityState !== "hidden") void load(); }, refreshMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshMs]);
  return status;
}

/** The desktop bots use now: the most recently seen online one. */
export function currentDesktop(status: DesktopBridgeStatus | null): DesktopBridgeDesktop | null {
  const online = (status?.desktops ?? []).filter((desktop) => desktop.online);
  return online.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
}

/** One computer whose screen the bot's Computer tab can show: the person's
 * server environment ("Cloud"), or one of their own computers by its name
 * (the host name the desktop app registered), each with its Local VM. */
export type ComputerChoice =
  | { key: "server"; source: "server" }
  | { key: string; source: "local"; desktopId: string; name: string; platform: string };

/** The screens the person can look at, in order: Cloud, then each of their
 * online computers that can run a Local VM, the most recently seen first.
 * A person with two PCs sees both; looking is not where the bot works. */
export function computerChoices(status: DesktopBridgeStatus | null): ComputerChoice[] {
  const desktops = (status?.desktops ?? [])
    .filter((desktop) => desktop.online && desktop.capabilities?.localVm)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return [
    { key: "server", source: "server" },
    ...desktops.map((desktop): ComputerChoice => ({
      key: `desktop:${desktop.id}`, source: "local", desktopId: desktop.id, name: desktop.name.trim() || "Computer", platform: desktop.platform,
    })),
  ];
}

/** The screen shown first: the one the bot works on (Cloud, or the person's
 * current computer), unless they picked another still on offer. */
export function chosenComputer(choices: ComputerChoice[], source: "server" | "local", status: DesktopBridgeStatus | null, picked: string | null): ComputerChoice | null {
  const kept = picked ? choices.find((choice) => choice.key === picked) : undefined;
  if (kept) return kept;
  if (source === "server") return choices[0] ?? null;
  const current = currentDesktop(status);
  return choices.find((choice) => choice.source === "local" && choice.desktopId === current?.id) ?? null;
}

/** Settings > Computer > Other computers: the answer's code says why a
 * rename or a removal was refused (server/desktop-bridge.ts). */
export class ComputerChangeError extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

async function changeComputer(action: "rename" | "remove", body: Record<string, string>, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(`/api/me/desktop-bridge/computers/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const answer = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown };
  throw new ComputerChangeError(typeof answer.error === "string" ? answer.error : `computer ${action} ${response.status}`, typeof answer.code === "string" ? answer.code : undefined);
}

/** Give one of the person's computers another name (1 to 120 characters). */
export function renameComputer(id: string, name: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return changeComputer("rename", { computer: id, name }, fetchImpl);
}

/** Take one of the person's computers off the list; refused while it is online. */
export function removeComputer(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return changeComputer("remove", { computer: id }, fetchImpl);
}
