// One look for every OS permission Sagax needs (#2614): the row of
// Settings > Permissions, the banner where a feature needs it (Voice,
// Computer, Notifications, the live screen) and the button a bot puts in a
// reply (sagax://permission/<id>). All three run the same action through
// useOsPermissions, so a missing permission is always one click away and
// never a sentence that says where to look.
import type { ReactNode } from "react";
import { Accessibility, AudioLines, Bell, HardDrive, Loader2, Mic, MonitorUp, Workflow } from "lucide-react";

import type { OsPermissionAction } from "../../../electron/os-permissions.mjs";
import { DescribedRow, PILL, SettingsGroup, SettingsNotice } from "@/components/SettingsPrimitives";
import { StatusText } from "@/components/settings/SettingsPatterns";
import { t } from "@/lib/i18n";
import { useOsPermissions, type OsPermissionId, type OsPermissionView } from "@/lib/os-permissions";
import type { LocaleKey } from "@/locales";

const ICONS: Record<OsPermissionId, ReactNode> = {
  microphone: <Mic size={14} />,
  screen: <MonitorUp size={14} />,
  accessibility: <Accessibility size={14} />,
  notifications: <Bell size={14} />,
  speech: <AudioLines size={14} />,
  automation: <Workflow size={14} />,
  fullDisk: <HardDrive size={14} />,
};

export const PERMISSION_LABEL: Record<OsPermissionId, LocaleKey> = {
  microphone: "osPermission.microphone.label",
  screen: "osPermission.screen.label",
  accessibility: "osPermission.accessibility.label",
  notifications: "osPermission.notifications.label",
  speech: "osPermission.speech.label",
  automation: "osPermission.automation.label",
  fullDisk: "osPermission.fullDisk.label",
};

const PERMISSION_WHY: Record<OsPermissionId, LocaleKey> = {
  microphone: "osPermission.microphone.why",
  screen: "osPermission.screen.why",
  accessibility: "osPermission.accessibility.why",
  notifications: "osPermission.notifications.why",
  speech: "osPermission.speech.why",
  automation: "osPermission.automation.why",
  fullDisk: "osPermission.fullDisk.why",
};

/** The words of a button, from the action main computed. */
export function permissionActionLabel(kind: OsPermissionAction["kind"] | "settings" | "relaunch", platform: string): string {
  if (kind === "prompt") return t("osPermission.action.allow");
  if (kind === "relaunch") return t("osPermission.action.relaunch");
  if (kind === "reset") return t("osPermission.action.reset");
  return platform === "win32" ? t("osPermission.action.openWindowsSettings") : t("osPermission.action.openSystemSettings");
}

function statusLine(view: OsPermissionView): ReactNode {
  if (view.status === "granted") {
    return view.action.kind === "relaunch"
      ? <StatusText tone="warning">{t("osPermission.status.needsRelaunch")}</StatusText>
      : <StatusText tone="success">{t("osPermission.status.granted")}</StatusText>;
  }
  if (view.status === "denied") return <StatusText tone="warning">{t("osPermission.status.denied")}</StatusText>;
  if (view.status === "not-determined") return <StatusText tone="neutral">{t("osPermission.status.notAsked")}</StatusText>;
  return <StatusText tone="neutral">{t("osPermission.status.unreadable")}</StatusText>;
}

/** The next step in words, when the button alone does not say it (Screen
 * Recording after a visit to System Settings, a stale entry). */
function stepHint(view: OsPermissionView): string | null {
  if (view.id !== "screen") return null;
  if (view.action.kind === "relaunch") return t(view.status === "granted" ? "osPermission.screen.hintGrantedEmpty" : "osPermission.screen.hintRelaunch");
  if (view.action.kind === "reset") return t("osPermission.screen.hintReset");
  if (view.action.secondary?.kind === "relaunch") return t("osPermission.screen.hintAlreadyOn");
  return null;
}

/** The primary button and, when there is one, the second (Relaunch next to
 * Open System Settings for Screen Recording). Nothing once allowed. */
export function OsPermissionButtons({ view, platform, busy, onAct, tone = "settings" }: {
  view: OsPermissionView;
  platform: string;
  busy: boolean;
  onAct: (secondary: boolean) => void;
  /** "settings": the app's pills; "dark": the live screen's black window. */
  tone?: "settings" | "dark";
}) {
  if (view.action.kind === "none") return null;
  const primaryClass = tone === "dark" ? "rounded-lg bg-white/15 px-3 py-1.5 text-[12px] text-white hover:bg-white/20 disabled:opacity-50" : PILL;
  const secondaryClass = tone === "dark" ? "rounded-lg px-3 py-1.5 text-[12px] text-white/80 hover:bg-white/10 disabled:opacity-50" : PILL;
  return (
    <>
      {view.action.secondary && (
        <button type="button" data-os-permission-secondary={view.action.secondary.kind} disabled={busy} className={secondaryClass} onClick={() => onAct(true)}>
          {permissionActionLabel(view.action.secondary.kind, platform)}
        </button>
      )}
      <button type="button" data-os-permission-action={view.action.kind} disabled={busy} className={primaryClass} onClick={() => onAct(false)}>
        {busy && <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden="true" />}
        {permissionActionLabel(view.action.kind, platform)}
      </button>
    </>
  );
}

export function OsPermissionRow({ view, platform, busy, onAct }: {
  view: OsPermissionView;
  platform: string;
  busy: boolean;
  onAct: (secondary: boolean) => void;
}) {
  const hint = stepHint(view);
  return (
    <DescribedRow
      rowId={`osPermission.${view.id}`}
      icon={ICONS[view.id]}
      label={t(PERMISSION_LABEL[view.id])}
      description={<>{statusLine(view)} · {t(PERMISSION_WHY[view.id])}{hint && <span className="block">{hint}</span>}</>}
    >
      <OsPermissionButtons view={view} platform={platform} busy={busy} onAct={onAct} />
    </DescribedRow>
  );
}

/** Settings > Permissions: every permission of this computer, one row each. */
export function OsPermissionsSection() {
  const { answer, act, busy } = useOsPermissions();
  if (!answer) return null;
  return (
    <div data-settings-card="osPermissions">
      <SettingsGroup groupId="osPermissions">
        {answer.permissions.map((view) => (
          <OsPermissionRow key={view.id} view={view} platform={answer.platform} busy={busy === view.id} onAct={(secondary) => void act(view.id, secondary)} />
        ))}
      </SettingsGroup>
    </div>
  );
}

/** Where a feature needs a permission: a banner with the same button, shown
 * only while it is missing. */
export function OsPermissionBanner({ id, message }: { id: OsPermissionId; message?: string }) {
  const { answer, view, act, busy } = useOsPermissions();
  const current = view(id);
  // only what the system really says: an unreadable status is no warning
  if (!answer || !current || current.action.kind === "none" || current.status === "unknown") return null;
  const hint = stepHint(current);
  return (
    <div data-os-permission-banner={id}>
      <SettingsNotice
        tone="warning"
        action={<OsPermissionButtons view={current} platform={answer.platform} busy={busy === id} onAct={(secondary) => void act(id, secondary)} />}
      >
        {message ?? t("osPermission.banner", { permission: t(PERMISSION_LABEL[id]) })}
        {hint && <span className="block text-ink-secondary">{hint}</span>}
      </SettingsNotice>
    </div>
  );
}

/** A bot's `[text](sagax://permission/<id>)` in a reply: the same action as
 * a button. Allowed already: the label stays plain text with a check. */
export function OsPermissionChatButton({ id, children }: { id: OsPermissionId; children: ReactNode }) {
  const { answer, view, act, busy } = useOsPermissions();
  const current = view(id);
  if (!answer || !current) return <span className="break-words">{children}</span>;
  if (current.action.kind === "none") {
    return <span data-os-permission-chat={id} data-os-permission-done="" className="break-words">{children} ({t("osPermission.status.granted")})</span>;
  }
  return (
    <button
      type="button"
      data-os-permission-chat={id}
      data-os-permission-action={current.action.kind}
      disabled={busy === id}
      onClick={() => void act(id)}
      className="text-accent underline decoration-accent/40 hover:decoration-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** The Computer panel's own screen when no picture came yet: the Screen
 * Recording action (Relaunch Sagax first, it is allowed but this run sees the
 * old answer), never "relaunch the app" in words alone. An older app keeps its
 * plain Open Settings button. */
export function ScreenPermissionActions({ fallback }: { fallback: ReactNode }) {
  const { answer, view, act, busy } = useOsPermissions({ captureFailed: true });
  const current = view("screen");
  if (!answer || !current) return <>{fallback}</>;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2" data-screen-permission-actions="">
      <OsPermissionButtons view={current} platform={answer.platform} busy={busy === "screen"} onAct={(secondary) => void act("screen", secondary)} />
    </div>
  );
}
