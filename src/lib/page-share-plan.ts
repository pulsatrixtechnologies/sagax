// What one gesture in a page's Share popover sends (2026-10-28), shared by
// the app's popover (src/components/PageShare.tsx) and the reader's bar
// around a published page (src/page-reader/). Pure: no store, no i18n, so
// the reader's small bundle carries only this.
import type { OrgDirectory } from "@/lib/perspicax-org";
import type { PageAccess, PageInvites, PublishedPageSummary } from "../../shared/published-pages";

export interface ShareStep {
  method: "POST" | "PATCH";
  /** After /api/pages/<id>. */
  path: string;
  body: Record<string, unknown>;
}

export type ShareChange =
  | { kind: "access"; access: PageAccess }
  | { kind: "invites"; invites: PageInvites }
  | { kind: "link" }
  | { kind: "expiry"; hours: number }
  | { kind: "version" }
  | { kind: "stop" }
  | { kind: "bot"; shared: boolean };

/** The expiry a choice of hours stands for (0: never). Pure. */
export function expiryFromHours(hours: number, now = Date.now()): number | null {
  return hours > 0 ? now + hours * 60 * 60 * 1000 : null;
}

/** Switching a page to "anyone with the link" asks the same second press as
 * a first publish. Pure. */
export function needsLinkConfirm(current: PageAccess, next: PageAccess): boolean {
  return next === "link" && current !== "link";
}

/** A page's reading link (the server's `url`: <origin>/pages/view/<token>),
 * or null for anything else. Open in browser and Copy link take only this:
 * never the app's own address. Pure. */
export function pageReadingUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return /^\/pages\/view\/[^/]+$/.test(parsed.pathname) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The requests one gesture in the popover sends, in order. A page not
 * shared yet is published (the version on screen) by the gesture itself;
 * a shared one is changed in place. Pure. */
export function sharePlan(page: Pick<PublishedPageSummary, "status" | "access" | "expiresAt" | "currentVersion">, version: number, change: ShareChange, now = Date.now()): ShareStep[] {
  const shared = page.status === "published";
  const publish = (access: PageAccess): ShareStep => ({ method: "POST", path: "/publish", body: { version, access, expiresAt: page.expiresAt !== null && page.expiresAt > now ? page.expiresAt : null } });
  switch (change.kind) {
    case "access":
      if (!shared) return [publish(change.access)];
      return change.access === page.access ? [] : [{ method: "PATCH", path: "", body: { access: change.access } }];
    case "invites":
      return [{ method: "POST", path: "/invite", body: { people: change.invites.people, teams: change.invites.teams } }, ...(shared ? [] : [publish(page.access)])];
    case "link":
      return shared ? [] : [publish(page.access)];
    case "expiry":
      return shared ? [{ method: "PATCH", path: "", body: { expiresAt: expiryFromHours(change.hours, now) } }] : [];
    case "version":
      return shared && page.currentVersion !== version ? [publish(page.access)] : [];
    case "bot":
      // #3128: shared in the bot's Library, members read the published
      // version: sharing a page not published yet publishes it first
      return [...(change.shared && !shared ? [publish(page.access)] : []), { method: "PATCH", path: "", body: { botShared: change.shared } }];
    case "stop":
      return shared ? [{ method: "POST", path: "/revoke", body: {} }] : [];
  }
}

/** The invite lists with one more person or team, or one fewer. Pure. */
export function withInvite(invites: PageInvites | undefined, entry: { kind: "person" | "team"; id: string }, add: boolean): PageInvites {
  const current = { people: [...(invites?.people ?? [])], teams: [...(invites?.teams ?? [])] };
  const key = entry.kind === "person" ? "people" : "teams";
  const rest = current[key].filter((id) => id.toLowerCase() !== entry.id.toLowerCase());
  current[key] = add ? [...rest, entry.id] : rest;
  return current;
}

/** Teams whose name matches, not already invited. Pure. */
export function teamCandidates(teams: NonNullable<OrgDirectory["teams"]>, invited: readonly string[], query: string, limit = 8) {
  const taken = new Set(invited.map((id) => id.toLowerCase()));
  const q = query.trim().toLowerCase();
  return teams.filter((team) => !taken.has(team.id.toLowerCase()) && (!q || team.name.toLowerCase().includes(q))).slice(0, limit);
}

/** Initials for an avatar without a picture. Pure. */
export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}
