// The sidebar's avatar menu, after the reference design's (2026-10-16, for 0.5.7):
//
//   Usage · N% used ›      (the person's own plan; no percent without one)
//   Get Sagax on mobile    (only once there is a public link to send)
//   Help ›                 (Keyboard shortcuts, Release notes, Check for updates, About)
//   Settings
//   Tools ›                (Automations, Memory, Team map, Remote sessions, Achievements)
//   ──────────
//   Switch organization ›  (this computer and the saved organization servers)
//   Switch account ›       (a business session: the account in use, then any
//                           saved personal or organization account)
//   Sign out               (an organization server only)
//
// Browse bots left for Connect apps' header, Automations for Settings, and
// Check for updates, Keyboard shortcuts and About for Help. Pure helpers,
// so the menu's rules are tested without a store or a bridge.
import { formatResetDistance, type PlanRow } from "./plan-usage";

/** No public App Store or TestFlight link for Sagax exists yet: "Get Sagax
 * on mobile" stays out of the menu until one does. */
export const SAGAX_MOBILE_URL: string | null = null;

/** One plan's figure: its weekly window, else its 5-hour window when it
 * reports no weekly one, rounded and clamped; null when neither is reported. */
function planPercent(row: PlanRow): number | null {
  if (row.state !== "windows") return null;
  const window = row.weekly.available && row.weekly.usedPercent != null ? row.weekly : row.fiveHour;
  if (!window.available || window.usedPercent == null || !Number.isFinite(window.usedPercent)) return null;
  return Math.round(Math.min(100, Math.max(0, window.usedPercent)));
}

/** The figure beside Usage with no favorite (the rule since 0.5.7): the
 * HIGHEST of the person's plans, each read on its weekly window (a 5-hour
 * window when a plan reports no weekly one), rounded; null without a plan
 * that reports one. The highest, not the first: the plan closest to its
 * limit is the one worth seeing. */
export function usagePercent(rows: readonly PlanRow[]): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const used = planPercent(row);
    if (used !== null) best = best === null ? used : Math.max(best, used);
  }
  return best;
}

export interface UsageSummary {
  percent: number | null;
  /** the starred plan's short name ("Grok"), only while it drives the
   * figure; null with the usual rule */
  name: string | null;
}

/** The figure beside Usage (2026-11-03): the starred plan's own figure, with
 * its name, while that plan is connected and reports a window. Without a
 * favorite, or once it is gone (signed out, no window), the usual rule
 * (usagePercent: the highest plan). */
export function usageSummary(rows: readonly PlanRow[], favorite: string | null): UsageSummary {
  if (favorite) {
    const row = rows.find((candidate) => candidate.id === favorite);
    const percent = row ? planPercent(row) : null;
    if (row && percent !== null) return { percent, name: row.name };
  }
  return { percent: usagePercent(rows), name: null };
}

export interface UsageLine {
  key: string;
  /** the plan row this line belongs to (a favorite names it) */
  planId?: string;
  /** that plan as people read it ("Grok SuperGrok Heavy") */
  planName?: string;
  label: string;
  subtitle?: string;
  value: string;
}

/** The second level's figures: one row per window of each plan: its name and
 * plan, then the window and when it resets, and the percent used. */
export function usageLines(
  rows: readonly PlanRow[],
  labels: { weekly: string; fiveHour: string; used: (percent: number) => string; resetsIn: (when: string) => string },
  now = Date.now(),
): UsageLine[] {
  const lines: UsageLine[] = [];
  for (const row of rows) {
    if (row.state !== "windows") continue;
    const name = row.plan ? `${row.name} ${row.plan}` : row.name;
    for (const [key, label, window] of [["weekly", labels.weekly, row.weekly], ["five-hour", labels.fiveHour, row.fiveHour]] as const) {
      if (!window.available || window.usedPercent == null) continue;
      const when = formatResetDistance(window.resetsAt, now);
      // #4157: the engine and its plan on the first line, the window and
      // its reset on the second; the window is never the part that is cut
      lines.push({
        key: `${row.id}:${key}`,
        planId: row.id,
        planName: name,
        label: name,
        subtitle: when ? `${label} · ${labels.resetsIn(when)}` : label,
        value: labels.used(Math.round(Math.min(100, Math.max(0, window.usedPercent)))),
      });
    }
  }
  return lines;
}

/** This person's own space on this computer (the solo server). Switch
 * account always lists it, even while signed into an organization server. */
export const PERSONAL_ID = "local";

/** The desktop bridges a switch may use: Personal's page has the saved
 * servers (`environments`), an organization server's page only opens
 * Personal (`accounts`). Neither signs anyone out. */
export interface SwitchBridges {
  environments?: { switch: (id: string) => Promise<unknown> | unknown };
  accounts?: { openPersonal: () => Promise<unknown> | unknown };
}

/**
 * Switch account › and Switch organization ›: show that account. A switch
 * is never a sign-out (Sign out is its own item): each account keeps its
 * session and its page in the desktop, so the switch is at once. From an
 * organization server's page, Personal opens through the desktop; that page
 * names no other destination.
 */
export function switchAccount(id: string, bridges: SwitchBridges | undefined): Promise<unknown> {
  if (bridges?.environments?.switch) return Promise.resolve(bridges.environments.switch(id));
  if (id === PERSONAL_ID && bridges?.accounts?.openPersonal) return Promise.resolve(bridges.accounts.openPersonal());
  return Promise.resolve();
}

/** The name shown for a server: the one the person gave it, else the
 * organization name it announced, else its host (the saved name). */
export function serverDisplayName(entry: { name: string; label?: string | null; orgName?: string | null }): string {
  return entry.label?.trim() || entry.orgName?.trim() || entry.name.trim();
}

/** A server's host, for the quiet line under its name; "" when the origin
 * does not parse. */
export function serverHost(origin: string | null | undefined): string {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

export interface SwitchTarget {
  id: string;
  name: string;
  /** this computer's own server (solo) */
  local: boolean;
  active: boolean;
  /** the server's host, shown as a quiet line (a server, never this computer) */
  host?: string;
  /** the name used when the person has not set their own */
  defaultName?: string;
  /** the person gave this server its own name */
  custom?: boolean;
}

/** The account this page is signed into, when it is not one of the saved
 * servers. The menu shows its name; the id stays off the screen. */
export const CURRENT_ACCOUNT_ID = "current";

export interface AccountChoice {
  id: string;
  name: string;
  local: boolean;
  active: boolean;
  /** The desktop can open this saved server. The account in use, when it
   * is not one of those servers, is shown and checked, and picking it
   * does nothing. */
  switchable: boolean;
  /** the server's host, for a tooltip and a quiet line under the name */
  host?: string;
  /** the name used when the person has not set their own */
  defaultName?: string;
  /** the person gave this server its own name */
  custom?: boolean;
  /** a server the person may rename (never their personal space) */
  renamable?: boolean;
}

/** The account a business session is signed into: the desktop's locked
 * server when it names one, otherwise the organization's own name. */
export function businessAccount(
  server: { active: true; id: string; name: string; origin?: string; label?: string; orgName?: string } | { active: false } | null,
  organizationName: string | null | undefined,
): { id: string; name: string; local: false; host?: string; defaultName?: string; custom?: boolean } | null {
  const announced = organizationName?.trim() || undefined;
  if (server?.active) {
    const id = server.id.trim();
    const host = serverHost(server.origin);
    const defaultName = serverDisplayName({ name: server.name, orgName: announced ?? server.orgName });
    const name = serverDisplayName({ name: server.name, label: server.label, orgName: announced ?? server.orgName });
    if (id && name) return { id, name, local: false, ...(host ? { host } : {}), defaultName, custom: Boolean(server.label?.trim()) };
  }
  if (!announced) return null;
  return { id: CURRENT_ACCOUNT_ID, name: announced, local: false };
}

/** Switch account ›: the person's Personal space first (always), then the
 * saved organization accounts, with the one in use checked. A current
 * account the saved list does not already name is added, still checked,
 * and is not a switch target. */
export function accountChoices(
  saved: readonly SwitchTarget[],
  current: { id: string; name: string; local?: boolean; host?: string; defaultName?: string; custom?: boolean } | null,
  personalName = "Personal",
): AccountChoice[] {
  const servers: AccountChoice[] = saved
    .filter((entry) => !entry.local && entry.id.trim().length > 0 && entry.name.trim().length > 0)
    .map((entry) => ({
      id: entry.id,
      name: entry.name.trim(),
      local: false,
      active: entry.active,
      switchable: true,
      renamable: true,
      ...(entry.host ? { host: entry.host } : {}),
      ...(entry.defaultName ? { defaultName: entry.defaultName } : {}),
      ...(entry.custom ? { custom: true } : {}),
    }));
  const personalActive = saved.some((entry) => entry.local && entry.active);
  const rows: AccountChoice[] = [
    { id: PERSONAL_ID, name: personalName, local: true, active: personalActive, switchable: true, renamable: false },
    ...servers,
  ];
  const id = current?.id.trim() ?? "";
  const name = current?.name.trim() ?? "";
  if (!id || !name) return rows;
  const known = rows.findIndex((entry) => entry.id === id);
  if (known >= 0) return rows.map((entry, index) => ({ ...entry, active: index === known }));
  if (id === CURRENT_ACCOUNT_ID) {
    const byName = rows.findIndex((entry) => entry.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (byName >= 0) return rows.map((entry, index) => ({ ...entry, active: index === byName }));
    if (rows.some((entry) => entry.active)) return rows;
  }
  return [
    ...rows.map((entry) => ({ ...entry, active: false })),
    {
      id, name, local: current?.local === true, active: true, switchable: false,
      renamable: current?.local !== true && id !== CURRENT_ACCOUNT_ID,
      ...(current?.host ? { host: current.host } : {}),
      ...(current?.defaultName ? { defaultName: current.defaultName } : {}),
      ...(current?.custom ? { custom: true } : {}),
    },
  ];
}

/** Switch organization ›: this computer first, then the organization
 * servers saved on it, the active one checked. Missing folders and other
 * computers' remote servers that are not organizations stay in Settings.
 * Each server shows the name the person gave it, else the organization
 * name it announced, else its host. */
export function switchTargets(state: {
  activeId: string;
  environments: Array<{ id: string; kind?: "local" | "remote"; name: string; origin?: string; label?: string; orgName?: string; org?: boolean; missing?: boolean }>;
} | null, soloName: string): SwitchTarget[] {
  if (!state) return [];
  const local = state.environments.find((entry) => entry.id === "local");
  const orgs = state.environments.filter((entry) => entry.id !== "local" && entry.org === true && !entry.missing);
  return [
    { id: "local", name: local?.name?.trim() || soloName, local: true, active: state.activeId === "local" },
    ...orgs.map((entry) => {
      const host = serverHost(entry.origin);
      return {
        id: entry.id,
        name: serverDisplayName(entry),
        local: false,
        active: state.activeId === entry.id,
        ...(host ? { host } : {}),
        defaultName: serverDisplayName({ name: entry.name, orgName: entry.orgName }),
        ...(entry.label?.trim() ? { custom: true } : {}),
      };
    }),
  ];
}
