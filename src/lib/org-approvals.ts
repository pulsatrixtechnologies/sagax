// The approvals waiting for an organization admin (2026-10-08), as an
// admin's app knows them: a count for the badge on the account row, a
// version the Settings > Organization list reloads on, and a desktop
// notification when a request arrives. The server sends `org.approvals`
// frames to admins' streams only (server/index.ts, orgAdminStream); the
// first count comes from GET /api/org/approvals, which answers admins only.
import { useEffect, useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { notificationSoundsEnabled } from "./notification-preferences";
import { notificationSoundPlan, playNotificationSound, toneReady } from "./notification-sound";
import type { ServerFrame } from "../../shared/wire";

type OrgApprovalsFrame = Extract<ServerFrame, { kind: "org.approvals" }>;

let count = 0;
let version = 0;
let loaded = false;
const listeners = new Set<() => void>();
/** `changed`: the server says the list changed, so open lists reload. */
const emit = (changed: boolean) => { if (changed) version += 1; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** A frame from the server: the new count, and a notification per arrival. */
export function receiveOrgApprovalsFrame(frame: OrgApprovalsFrame, openApprovals: () => void): void {
  count = Math.max(0, Number(frame.count) || 0);
  loaded = true;
  emit(true);
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const plan = notificationSoundPlan(notificationSoundsEnabled());
  for (const added of frame.added ?? []) {
    const body = [added.requestedBy ? t("organization.adminApprovals.requestedBy", { bot: added.botName, person: added.requestedBy }) : added.botName, added.summary ?? added.tool ?? ""]
      .filter(Boolean).join("\n");
    const banner = new Notification(t("organization.adminApprovals.notifyTitle", { bot: added.botName }), {
      body,
      tag: `sagax:org-approval:${added.requestId}`,
      ...(plan.platformSound || (plan.tone && !toneReady()) ? {} : { silent: true }),
    });
    banner.onclick = () => { window.focus(); openApprovals(); };
  }
  // one tone for the whole frame, not one per approval
  if (plan.tone && (frame.added?.length ?? 0) > 0) playNotificationSound(plan.tone);
}

/** The count as the list just read it (Settings > Organization). */
export function setOrgApprovalsCount(next: number): void {
  loaded = true;
  if (next === count) return;
  count = next;
  emit(false);
}

/** How many approvals wait for an admin; 0 for everyone else. Loads the
 * first count once when `admin` is true. */
export function useOrgApprovalsCount(admin: boolean): number {
  useEffect(() => {
    if (!admin || loaded) return;
    loaded = true;
    void api<{ approvals?: unknown[] }>("/api/org/approvals")
      .then((body) => setOrgApprovalsCount(Array.isArray(body.approvals) ? body.approvals.length : 0))
      .catch(() => { loaded = false; });
  }, [admin]);
  const value = useSyncExternalStore(subscribe, () => count, () => 0);
  return admin ? value : 0;
}

/** Changes whenever the server says the waiting list changed. */
export function useOrgApprovalsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
