// The profile row at the very bottom of the sidebar, and the menu it opens.
//
// The row is an avatar and a full name. Under the name, the viewer's own
// title and points, each only while "Show my title" / "Show my points" is on;
// with both off the name sits centred beside the avatar. While the sidebar
// shortcuts (Connected apps, Browse Bots) sit above the row, the line is gone
// for lack of room (`memberLine` false); Settings > Achievements and the
// person panel still show both. The routines badge
// (icon and count of active routines) sits at the right edge of the row and
// opens Automations. Other people's rows never show title or points: those
// live in a person's detail and on Settings > Achievements. The menu leads with
// Usage, Help and Settings, then Tools (Automations, Team map, Remote
// sessions, Achievements), then a hairline. Team map left the Automations
// header for Tools (owner, 2026-10-27); the command palette opens it too.
// Archived bots, when there
// are any, sit above that pair with their own hairline. Your phone and
// Help Center are not in this menu: the phone stays in Settings and on
// the collapsed rail, and docs stay on About. Connected apps and Browse Bots
// stay rows above this one while Sidebar shortcuts is on (SidebarPlaces). It opens on
// click. The collapsed rail keeps its own avatar button.
//
// The update entry is the one item that reports progress in place, so it
// keeps the menu open and re-labels itself as it works. Once an update has
// downloaded, a round cloud button sits at the right of the row; it widens
// into a pill on hover or focus (and for a few seconds when the update
// lands) while the name folds away to the avatar, and it opens the
// "Update ready" dialog (UpdateBanner, openUpdatePrompt). That button needs
// the name beside it, so the reference design's foot (avatar only, then Connect apps)
// carries its own instead, SidebarUpdatePill. The Automations
// item in the menu carries no dot (2026-10-18): a failed run not seen
// yet shows on the Automations page (the problem runs pill in its header,
// a dot on the run in Logs) and in the routines count's label.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  CloudDownload,
  CalendarDays,
  Gauge,
  Info,
  Keyboard,
  Laptop,
  Loader2,
  LogOut,
  Monitor as MonitorIcon,
  Network,
  Plus,
  RefreshCw,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Trophy,
  Wrench,
} from "lucide-react";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOrgApprovalsCount } from "@/lib/org-approvals";

import { InitialsAvatar } from "./Avatar";
import { AboutDialog } from "./AboutDialog";
import { RenameServerDialog } from "./RenameServerDialog";
import { SidebarPopoverMenu, type SidebarMenuItem, type SidebarSubmenuEntry } from "./SidebarPopoverMenu";
import { useServerMode } from "./ServerModeSettings";
import { api } from "@/state/store";
import { accountChoices, businessAccount, SAGAX_MOBILE_URL, switchAccount, switchTargets as listSwitchTargets, usageLines as planUsageLines, usagePercent as planUsagePercent, type AccountChoice, type SwitchTarget, type UsageLine } from "@/lib/account-menu";
import { connectedPlanRows, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { costOf, formatCost, personalUsagePeriods, usageQuery, type PersonalUsageSummary } from "@/lib/usage-personal";
import { requestReleaseNotes } from "@/lib/release-notes-ui";
import { serverModeBridge } from "@/lib/launch";
import { openExternalLink } from "@/lib/app-links";
import { canViewUsage } from "@/lib/viewer";
import { ShortcutHint } from "./ShortcutHint";
import { useStore } from "@/state/store";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { openUpdatePrompt, requestUpdateCheck } from "@/lib/update-prompt";
import { brand } from "../lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAchievements } from "@/lib/achievements";
import { isRoutineProblemRun } from "@/lib/routines";
import { useShowRoutinesBadge } from "@/lib/routines-badge-preferences";
import { activeRoutineCount } from "@/lib/active-routines";
import { viewerActorId } from "@/lib/viewer";
import { achievementTitleName } from "./achievements/MemberCard";
import { formatPoints } from "./achievements/AchievementsPage";
import "./achievements/achievements.css";

/** "Milind Soni" → "MS", "milind" → "M", "you@x.dev" → "Y", unset → "?" */
export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

/** The name shown on the row: the profile name, else the email, else "You". */
export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

export type UpdatePhase =
  | UpdaterState["status"]
  /** a check came back with nothing — acknowledged for three seconds so the
   * click is never silent */
  | "up-to-date";

/** One state machine for the update entry, kept pure so the label/verb pairs
 * can be tested without a bridge. `upToDate` is the 3s acknowledgement after
 * a check that found nothing — otherwise a check is silent. */
export function updatePhase(state: UpdaterState | null, upToDate: boolean): UpdatePhase {
  const status = state?.status ?? "idle";
  if (status !== "idle") return status;
  return upToDate ? "up-to-date" : "idle";
}

export function updateLabel(phase: UpdatePhase, state: UpdaterState | null): string {
  switch (phase) {
    case "downloading":
      return state?.percent == null
        ? t("sidebar.update.startingDownload")
        : t("sidebar.update.downloading", { percent: Math.round(state.percent) });
    case "preparing":
      return t("sidebar.update.preparing");
    case "downloaded":
      // Named: on My Cloud's page it is this app that restarts, not the Cloud.
      // An unknown version leaves a double space behind, in every language.
      return (
        state?.installMode === "handoff"
          ? t("sidebar.update.readyInstall", { app: brand().name, version: state?.version ?? "" })
          : t("sidebar.update.ready", { app: brand().name, version: state?.version ?? "" })
      ).replace("  ", " ");
    case "installing":
      return (
        state?.message ||
        (state?.installMode === "handoff"
          ? t("sidebar.update.openingTerminal")
          : t("sidebar.update.installing"))
      );
    case "checking":
      return t("sidebar.update.checking");
    case "handed-off":
      return t("sidebar.update.handedOff");
    case "error":
      return state?.message?.trim() || t("sidebar.update.failed");
    case "up-to-date":
      return t("sidebar.update.upToDate");
    default:
      return t("sidebar.update.check");
  }
}

/** A phase that is mid-flight takes no further clicks. `pending` covers the
 * gap between the click and the bridge reporting the state it started: a
 * check and an install round-trip through main first, and without this the
 * row would sit there looking clickable. */
export function updateBusy(phase: UpdatePhase, pending = false): boolean {
  return pending || phase === "checking" || phase === "downloading" || phase === "preparing" || phase === "installing";
}

function UpdateIcon({ phase, pending, size = 18 }: { phase: UpdatePhase; pending: boolean; size?: number }) {
  if (updateBusy(phase, pending)) return <Loader2 size={size} className="animate-spin" />;
  if (phase === "up-to-date") return <Check size={size} />;
  if (phase === "downloaded") return <ArrowDownToLine size={size} />;
  return <RefreshCw size={size} />;
}

/** Whether the updater has something the profile row should say out loud.
 * An idle updater, and the three-second "up to date" tick that follows a
 * check the user asked for from inside the menu, both stay in the menu. */
export function updateNoteworthy(phase: UpdatePhase, pending = false): boolean {
  return pending || (phase !== "idle" && phase !== "up-to-date" && phase !== "checking");
}

interface UpdateEntry {
  item: SidebarMenuItem;
  phase: UpdatePhase;
  pending: boolean;
  label: string;
}

/** The updater bridge exists only in the packaged app; in dev the entry is
 * absent rather than dead. The desktop app answers only this computer's page
 * and the person's own Cloud page, so until it does there is no entry. */
export function useUpdateItem(): UpdateEntry | null {
  const state = useUpdaterState();
  const updater = window.ogb?.updater;
  const [pending, setPending] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const status = state?.status ?? "idle";

  // a check and an install both round-trip through main before the status
  // changes — spin on the click itself, and let the new status clear it
  useEffect(() => setPending(false), [status]);

  // a check that found nothing lands back on idle — acknowledge it for 3s
  const upToDate = Boolean(checkedAt) && (!state || state.status === "idle") && Date.now() - checkedAt < 3000;
  useEffect(() => {
    if (!upToDate) return;
    const timer = setTimeout(() => setCheckedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [upToDate]);

  if (!updater || !state) return null;

  const phase = updatePhase(state, upToDate);
  const label = updateLabel(phase, state);
  return {
    phase,
    pending,
    label,
    item: {
      key: "update",
      label,
      icon: <UpdateIcon phase={phase} pending={pending} />,
      // Open while an update checks, downloads or waits: the dialog shows
      // where it stands. Only a started install takes no click.
      disabled: phase === "installing",
      attention: phase === "downloaded" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      // Never installs (2026-10-19: on Windows "Check for updates" on a
      // downloaded update quit straight into a silent install). It opens
      // the update dialog, which follows the check and asks before any
      // restart: "Restart to install" or "Later".
      onSelect: () => {
        setCheckedAt(Date.now());
        requestUpdateCheck();
      },
    },
  };
}

/** The phases the foot's update button (SidebarUpdatePill, beside Connect
 * apps) shows itself, so the avatar adds no dot for them. */
export function footPillCovers(phase: UpdatePhase): boolean {
  return phase === "downloading" || phase === "preparing" || phase === "downloaded" || phase === "installing";
}

/** How long the update button stays wide after an update lands. */
export const UPDATE_BUTTON_ANNOUNCE_MS = 5000;

/** The footer's update button is shown for a downloaded update only; while
 * one checks, downloads or fails, the row's small badge speaks instead. */
export function showsUpdateButton(phase: UpdatePhase | undefined): boolean {
  return phase === "downloaded";
}

/** Wide while hovered or focused, and for a moment after the update lands
 * (once per version), then the round button. */
function useUpdateButtonWide(version: string | null): [boolean, (on: boolean) => void] {
  const [pointer, setPointer] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (version === null) {
      setAnnouncing(false);
      return;
    }
    if (announced.current === version) return;
    announced.current = version;
    setAnnouncing(true);
    const timer = setTimeout(() => setAnnouncing(false), UPDATE_BUTTON_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [version]);
  return [pointer || announcing, setPointer];
}

/** The footer menu: the profile items with the account-level places
 * (Archived bots) added just above the hairline. Without places it is
 * the profile menu alone. */
export function footerMenuItems(places: SidebarMenuItem[], profileItems: SidebarMenuItem[]): SidebarMenuItem[] {
  if (places.length === 0) return profileItems;
  const at = profileItems.findIndex((item) => item.separatorBefore);
  if (at < 0) return [...profileItems, ...places];
  return [...profileItems.slice(0, at), ...places, ...profileItems.slice(at)];
}

export interface ProfileMenuHandlers {
  onAutomations: () => void;
  onTeamMap: () => void;
  onRemoteSessions: () => void;
  onSettings: () => void;
  onAchievements: () => void;
  onShortcuts: () => void;
  onReleaseNotes: () => void;
  onAbout: () => void;
  onViewUsage: () => void;
  onSwitch: (id: string) => void;
  /** Rename a server (Switch account ›): opens the rename dialog for it */
  onRename: (account: { id: string; name: string; defaultName: string }) => void;
  onAddOrganization: () => void;
  onSignOut: () => void;
  onMobile: () => void;
}

/** The reference design's account menu (2026-10-16; src/lib/account-menu.ts):
 * Usage ›, Get Sagax on mobile, Help ›, Settings, Tools › (Automations,
 * Team map, Remote sessions, Achievements), a hairline, Switch
 * organization › (a business session: Switch account ›), Sign out.
 * Automations came back here from the settings nav (2026-10-16) and sits
 * under Tools with Remote sessions and Achievements. Team map moved from
 * the Automations header to Tools (owner, 2026-10-27); the command palette
 * opens it too. */
export function profileMenuItems(input: {
  /** null: no plan reports a window, so Usage carries no percent */
  usagePercent: number | null;
  usageLines: UsageLine[];
  /** this month's cost of the person's own turns, formatted; null unknown */
  monthCost: string | null;
  mobile: boolean;
  achievementsLabel: string | null;
  automationsActive: boolean;
  /** Team map is the page on screen */
  teamMapActive?: boolean;
  /** false in the remote client (it has no Team map): no Team map row. */
  teamMap?: boolean;
  remoteSessionsActive: boolean;
  /** false on a solo server (no Perspicax organization): no remote sessions row. */
  remoteSessions?: boolean;
  shortcutsTrailing?: ReactNode;
  /** Check for updates, where the desktop app answers */
  updateItem: SidebarMenuItem | null;
  /** Switch organization ›: empty where this app has no saved servers */
  switchTargets: SwitchTarget[];
  /** Business mode: Switch account ›. Null keeps Switch organization ›. */
  accounts?: AccountChoice[] | null;
  canAddOrganization: boolean;
  /** Sign out: an organization server only */
  signOut: boolean;
  handlers: ProfileMenuHandlers;
}): SidebarMenuItem[] {
  const usage: SidebarSubmenuEntry[] = [
    ...input.usageLines.map((line) => ({ key: line.key, label: line.label, subtitle: line.subtitle, value: line.value, info: true })),
    ...(input.monthCost !== null ? [{ key: "month-cost", label: t("sidebar.account.monthCost"), value: input.monthCost, info: true }] : []),
  ];
  const help: SidebarSubmenuEntry[] = [
    { key: "shortcuts", label: t("sidebar.menu.shortcuts"), icon: <Keyboard size={16} />, trailing: input.shortcutsTrailing, onSelect: input.handlers.onShortcuts },
    { key: "release-notes", label: t("releaseNotes.menu"), icon: <ScrollText size={16} />, onSelect: input.handlers.onReleaseNotes },
    ...(input.updateItem ? [{
      key: "update",
      label: input.updateItem.label,
      icon: <RefreshCw size={16} />,
      disabled: input.updateItem.disabled,
      onSelect: input.updateItem.onSelect,
    }] : []),
    { key: "about", label: t("sidebar.menu.about"), icon: <Info size={16} />, onSelect: input.handlers.onAbout },
  ];
  const switching: SidebarSubmenuEntry[] = [
    ...input.switchTargets.map((target) => ({
      key: `switch:${target.id}`,
      label: target.name,
      title: target.host,
      icon: target.local ? <Laptop size={16} /> : <Building2 size={16} />,
      checked: target.active,
      onSelect: target.active ? undefined : () => input.handlers.onSwitch(target.id),
    })),
    ...(input.canAddOrganization ? [{
      key: "add-organization",
      label: t("sidebar.account.addOrganization"),
      icon: <Plus size={16} />,
      separatorBefore: input.switchTargets.length > 0,
      onSelect: input.handlers.onAddOrganization,
    }] : []),
  ];
  const accountEntries: SidebarSubmenuEntry[] = (input.accounts ?? []).map((account) => ({
    key: `switch:${account.id}`,
    label: account.name,
    icon: account.local ? <Laptop size={16} /> : <Building2 size={16} />,
    checked: account.active,
    // the address stays visible, quiet, under a server's name
    subtitle: account.host && account.host !== account.name ? account.host : undefined,
    title: account.host || undefined,
    rename: account.renamable ? {
      label: t("sidebar.account.rename"),
      onRename: () => input.handlers.onRename({ id: account.id, name: account.name, defaultName: account.defaultName ?? account.host ?? account.name }),
    } : undefined,
    onSelect: account.active || !account.switchable ? undefined : () => input.handlers.onSwitch(account.id),
  }));
  const accountMenu = input.accounts != null;
  const lower: SidebarMenuItem[] = [
    ...(accountMenu
      ? (accountEntries.length > 0 ? [{
          key: "switch-account",
          label: t("sidebar.account.switchAccount"),
          icon: <ArrowLeftRight size={18} />,
          submenu: accountEntries,
          submenuAlign: "bottom" as const,
          submenuWidth: 228,
          onSelect: () => {},
        }] : [])
      : (switching.length > 0 ? [{
          key: "switch-organization",
          label: t("sidebar.account.switchOrganization"),
          icon: <ArrowLeftRight size={18} />,
          submenu: switching,
          submenuAlign: "bottom" as const,
          submenuWidth: 228,
          onSelect: () => {},
        }] : [])),
    ...(input.signOut ? [{
      key: "sign-out",
      label: t("settings.serverMode.signOut"),
      icon: <LogOut size={18} />,
      onSelect: input.handlers.onSignOut,
    }] : []),
  ];
  if (lower[0]) lower[0] = { ...lower[0], separatorBefore: true };
  // Each row keeps the place it had on the top level. An empty list (every
  // row hidden) leaves Tools out of the menu.
  const tools: SidebarSubmenuEntry[] = [
    {
      key: "routines",
      tourId: "nav-automations",
      label: t("sidebar.nav.automations"),
      icon: <CalendarDays size={18} />,
      active: input.automationsActive,
      onSelect: input.handlers.onAutomations,
    },
    ...(input.teamMap !== false
      ? [{
          key: "team-map",
          label: t("sidebar.nav.teamMap"),
          icon: <Network size={18} />,
          active: input.teamMapActive === true,
          onSelect: input.handlers.onTeamMap,
        }]
      : []),
    // Remote sessions need Perspicax: not offered on a solo server.
    ...(input.remoteSessions !== false
      ? [{
          key: "remote-sessions",
          label: t("remoteSessionsAdmin.title"),
          icon: <MonitorIcon size={18} />,
          active: input.remoteSessionsActive,
          onSelect: input.handlers.onRemoteSessions,
        }]
      : []),
    ...(input.achievementsLabel
      ? [{
          key: "achievements",
          label: input.achievementsLabel,
          icon: <Trophy size={18} />,
          onSelect: input.handlers.onAchievements,
        }]
      : []),
  ];
  return [
    {
      key: "usage",
      label: t("sidebar.account.usage"),
      icon: <Gauge size={18} />,
      value: input.usagePercent === null ? undefined : t("planUsage.used", { used: input.usagePercent }),
      submenu: [
        ...usage,
        { key: "view-usage", label: t("sidebar.account.viewUsage"), separatorBefore: usage.length > 0, onSelect: input.handlers.onViewUsage },
      ],
      submenuWidth: 228,
      onSelect: () => {},
    },
    ...(input.mobile ? [{
      key: "mobile",
      label: t("sidebar.account.mobile"),
      icon: <Smartphone size={18} />,
      onSelect: input.handlers.onMobile,
    }] : []),
    {
      key: "help",
      label: t("sidebar.account.help"),
      icon: <BookOpen size={18} />,
      submenu: help,
      onSelect: () => {},
    },
    {
      key: "settings",
      label: t("sidebar.menu.settings"),
      icon: <SettingsIcon size={18} />,
      onSelect: input.handlers.onSettings,
    },
    ...(tools.length > 0 ? [{
      key: "tools",
      label: t("sidebar.account.tools"),
      icon: <Wrench size={18} />,
      active: tools.some((entry) => entry.active),
      submenu: tools,
      submenuAlign: "bottom" as const,
      onSelect: () => {},
    }] : []),
    ...lower,
  ];
}

/** Calls onOpen once the menu it sits in is open. */
function WhenOpen({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  useEffect(() => { if (open) onOpen(); }, [open, onOpen]);
  return null;
}

interface AccountMenuData {
  percent: number | null;
  lines: UsageLine[];
  monthCost: string | null;
  targets: SwitchTarget[];
}

/** Usage ›'s plan windows (GET /api/plan-usage) and this month's cost (GET
 * /api/me/usage, or /api/usage?mine=1 on an older server), the same reads
 * as Settings > Usage; and Switch organization ›'s saved servers. Read once
 * the menu first opens; each part stays empty when it cannot be read. */
function useAccountMenuData(enabled: boolean, refresh = 0): AccountMenuData {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const plans = enabled && (org !== null || canViewUsage(state.config));
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [monthCost, setMonthCost] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<Parameters<typeof listSwitchTargets>[0]>(null);
  useEffect(() => {
    if (!plans) return;
    let alive = true;
    void api<PlanUsageReport>("/api/plan-usage").then((report) => { if (alive) setRows(connectedPlanRows(report)); }, () => {});
    return () => { alive = false; };
  }, [plans]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const month = personalUsagePeriods().month;
    void api<PersonalUsageSummary>(usageQuery(month, "day"))
      .catch(() => api<PersonalUsageSummary>(usageQuery(month, "day", true)))
      .then((summary) => { if (alive) setMonthCost(formatCost(costOf(summary))); }, () => {});
    void Promise.resolve(window.ogb?.environments?.state())
      .then((next) => { if (alive && next) setEnvironments(next); }, () => {});
    return () => { alive = false; };
  }, [enabled, refresh]);
  return {
    percent: planUsagePercent(rows),
    lines: planUsageLines(rows, {
      weekly: t("planUsage.weekly"),
      fiveHour: t("planUsage.fiveHour"),
      used: (used) => t("planUsage.used", { used }),
      resetsIn: (when) => t("planUsage.resetsIn", { when }),
    }),
    monthCost,
    targets: listSwitchTargets(environments, t("sidebar.account.solo")),
  };
}

export function SidebarProfileMenu({ avatarOnly = false, withName = false, places = [], memberLine = true }: {
  /** just the avatar, for the collapsed (icons) rail; the name moves to the
   * tooltip and the menu keeps its width */
  avatarOnly?: boolean;
  /** with avatarOnly: the wide foot's rounded pill, the avatar then the
   * name (the foot's own update and routines buttons stay beside it) */
  withName?: boolean;
  /** Items listed before the profile items (Archived bots). */
  places?: SidebarMenuItem[];
  /** the title and points line under the name; false while the sidebar
   * shortcuts take the room above the row */
  memberLine?: boolean;
}) {
  const { state, dispatch } = useStore();
  const update = useUpdateItem();
  // the menu's figures (plan, cost, saved servers) are read the first time
  // it opens, not with every sidebar
  const [menuOpened, setMenuOpened] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const achievements = useAchievements();
  // conversations waiting on the person's answer (a plain count, no hook)
  const approvalsWaiting = state.bots
    .filter((bot) => !bot.hidden)
    .reduce((total, bot) => total + (bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you").length, 0);
  const openAchievements = () => dispatch({ type: "showAchievements" });
  // The routines badge sits at the right edge of the row; under the name,
  // the viewer's own title and points, each only while its "Show my ..."
  // switch is on. Nothing under the name when both are off.
  const snapshot = memberLine && achievements.status === "ready" ? achievements.snapshot : undefined;
  const titleName = snapshot && snapshot.settings.showTitle !== false ? achievementTitleName(snapshot.settings.title) : null;
  const pointsText = snapshot && snapshot.settings.showPoints !== false ? formatPoints(snapshot.points) : null;
  const showLine = Boolean(titleName || pointsText);
  // Organization admins: the approvals waiting for an admin, live
  // (org.approvals frames); the count opens Settings > Organization.
  const perspicaxOrg = usePerspicaxOrg();
  const orgAdmin = perspicaxOrg?.viewerRole === "admin";
  const adminApprovals = useOrgApprovalsCount(orgAdmin, () => api<{ approvals?: unknown[] }>("/api/org/approvals"));
  const openAdminApprovals = () => dispatch({ type: "toggleAppSettings", open: true, section: "organization" });

  const profile = state.config?.profile;
  const viewer = state.config?.viewer;
  // the server fills the profile with whoever is looking; an older server
  // that only names the viewer still gets their name on the row
  const name = profileLabel({
    name: profile?.name?.trim() || viewer?.name?.trim(),
    email: profile?.email?.trim() || viewer?.email?.trim(),
  });
  const initials = profileInitials({
    name: profile?.name?.trim() || viewer?.name?.trim(),
    email: profile?.email?.trim() || viewer?.email?.trim(),
  });

  // bumped when a server is renamed, so the lists read the new name
  const [namesTick, setNamesTick] = useState(0);
  const [renaming, setRenaming] = useState<{ id: string; name: string; defaultName: string } | null>(null);
  const account = useAccountMenuData(menuOpened, namesTick);
  const serverMode = useServerMode(namesTick);
  // The desktop opens on an organization server (server mode) and this is
  // that server's page; Personal's own page (it has the saved-server list)
  // is not, even in server mode.
  const lockedServer = serverMode?.active === true && !window.ogb?.environments;
  // A business session is an organization server (Perspicax) or the desktop
  // in server mode on its page. Its page is not given the saved-server list,
  // so the submenu names the account in use and Personal, which the desktop
  // opens at once without signing out.
  const business = lockedServer || perspicaxOrg !== null || viewer?.profileManagedBy === "perspicax";
  const canSwitch = Boolean(window.ogb?.environments?.switch);
  // An organization server's page opens Personal through the desktop, at once
  // and still signed in to the server (never by leaving it).
  const canOpenPersonal = Boolean(window.ogb?.accounts?.openPersonal);
  const leaveBridge = serverModeBridge(window.ogb);
  const setServerName = lockedServer ? leaveBridge?.setName : window.ogb?.environments?.setName;
  const announcedOrg = perspicaxOrg?.org.name?.trim() ?? "";
  const accounts = business
    ? accountChoices(account.targets, businessAccount(serverMode, announcedOrg), t("sidebar.account.personal")).map((entry) => ({
        ...entry,
        // Personal, from an organization server, is a switch: the server's
        // session and page stay as they are (Sign out is its own item)
        switchable: entry.local ? (canSwitch || canOpenPersonal) : canSwitch && entry.switchable,
        renamable: entry.renamable === true && Boolean(setServerName),
      }))
    : null;
  // The organization name the server announces becomes the default name of
  // its saved entry (the person's own name still wins).
  const announcedSaved = lockedServer && serverMode?.active ? serverMode.orgName ?? "" : null;
  useEffect(() => {
    if (announcedSaved === null || !announcedOrg || announcedOrg === announcedSaved || !leaveBridge?.setName) return;
    void Promise.resolve(leaveBridge.setName({ orgName: announcedOrg })).then(() => setNamesTick((tick) => tick + 1), () => {});
  }, [announcedSaved, announcedOrg, leaveBridge]);
  const saveServerName = (id: string, label: string) => {
    const done = () => setNamesTick((tick) => tick + 1);
    if (lockedServer) void Promise.resolve(leaveBridge?.setName?.({ label })).then(done, () => {});
    else void Promise.resolve(window.ogb?.environments?.setName?.(id, { label })).then(done, () => {});
  };
  const profileItems = profileMenuItems({
    usagePercent: account.percent,
    usageLines: account.lines,
    monthCost: account.monthCost,
    mobile: SAGAX_MOBILE_URL !== null,
    achievementsLabel: achievements.status === "ready" ? t("achievements.menu") : null,
    automationsActive: state.activeView === "routines",
    teamMapActive: state.activeView === "team-map",
    teamMap: window.ogb?.remoteClient?.active !== true,
    remoteSessionsActive: state.activeView === "remote-sessions",
    remoteSessions: perspicaxOrg !== null,
    shortcutsTrailing: <ShortcutHint id="shortcuts-cheat-sheet" />,
    updateItem: update ? { ...update.item, label: t("sidebar.update.check") } : null,
    switchTargets: business ? [] : account.targets,
    accounts,
    canAddOrganization: !business && Boolean(window.ogb?.environments),
    signOut: lockedServer,
    handlers: {
      onAutomations: () => dispatch({ type: "showRoutines" }),
      onTeamMap: () => dispatch({ type: "showTeamMap" }),
      onRemoteSessions: () => dispatch({ type: "showRemoteSessions" }),
      onSettings: () => dispatch({ type: "toggleAppSettings" }),
      onAchievements: openAchievements,
      onShortcuts: () => {
        // The menu item unmounts; let the dialog restore the profile button.
        triggerRef.current?.closest("button")?.focus();
        dispatch({ type: "toggleShortcuts", open: true });
      },
      onReleaseNotes: () => requestReleaseNotes("browse"),
      onAbout: () => setAboutOpen(true),
      onViewUsage: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }),
      // Switching never signs out: from an organization server's page,
      // Personal opens through the desktop and the server stays signed in.
      onSwitch: (id) => { void switchAccount(id, window.ogb).catch(() => {}); },
      onRename: (entry) => setRenaming(entry),
      onAddOrganization: () => dispatch({ type: "toggleAppSettings", open: true, section: "organization" }),
      onSignOut: () => {
        const bridge = serverModeBridge(window.ogb);
        if (bridge) void bridge.leave().catch(() => {});
      },
      onMobile: () => { if (SAGAX_MOBILE_URL) openExternalLink(SAGAX_MOBILE_URL); },
    },
  });
  const items = footerMenuItems(places, profileItems);
  const updateButton = !avatarOnly && update !== null && showsUpdateButton(update.phase);
  const [wide, setWide] = useUpdateButtonWide(updateButton ? (update?.label ?? "") : null);
  // the round button speaks for a downloaded update, so the row's badge
  // stays for the other phases
  // Beside Connect apps (avatarOnly, the reference design's foot) the foot's own update
  // button (SidebarUpdatePill) shows a download, a ready update and its
  // install, so the avatar's dot is left for a failed one.
  const footPill = avatarOnly && update !== null && footPillCovers(update.phase);
  const noteworthy = update && updateNoteworthy(update.phase, update.pending) && !updateButton && !footPill ? update : null;
  // a place in the menu asking for attention while the menu is folded away
  const placeAttention = places.some((item) => item.attention);

  const avatar = (size: number) => (
    // the footer avatar, always in its real colours; no presence dot (the reference
    // design's foot, 2026-10-16)
    <span className="relative flex shrink-0 rounded-full">
      {profile?.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={initials} size={size} />
      )}
    </span>
  );

  // The approvals dot on the avatar's bottom-right corner opens the
  // Approvals screen (the #approvals screen). It is a button of its own, a
  // sibling laid over the account button (never nested in it), so a click
  // never opens the account menu. Placed from the avatar's box in each
  // variant: its left edge, its size, centred vertically in the trigger.
  const dotAt = avatarOnly && withName ? { left: 2, size: 36 } : avatarOnly ? { left: 0, size: 36 } : { left: 0, size: 40 };
  const openApprovals = () => dispatch({ type: "showApprovals" });
  const approvalsDotLabel = t("sidebar.profile.openApprovals", { count: approvalsWaiting });
  const approvalsDot = approvalsWaiting > 0 ? (
    <button
      type="button"
      data-avatar-approvals={approvalsWaiting}
      title={approvalsDotLabel}
      aria-label={approvalsDotLabel}
      // a native button: Enter and Space arrive as this same click
      onClick={(event) => {
        event.stopPropagation();
        openApprovals();
      }}
      style={{ left: dotAt.left + dotAt.size - 10, top: `calc(50% + ${dotAt.size / 2 - 10}px)` }}
      // 12px on screen, a 24px target through the invisible ::before
      className="absolute size-3 rounded-full border-2 border-sidebar bg-warning before:absolute before:-inset-1.5 before:rounded-full before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
    />
  ) : null;

  // The routines count opens Automations, so it stays outside the menu
  // button. The highlight is the wrapper around both, one rounded block.
  const accountRow = (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={name}
      menuClassName={avatarOnly ? "left-0 w-max min-w-[228px] max-w-[300px]" : undefined}
      renderTrigger={({ open }) => avatarOnly && withName ? (
        // The foot's profile (reference design): the avatar and the full
        // name, normal weight, no background pill; the update dot on the avatar.
        <span
          ref={triggerRef}
          title={name}
          data-sidebar-account-pill=""
          data-menu-opened={open || undefined}
          className={cn(
            "flex h-[var(--foot-tile-h,2.25rem)] w-full min-w-0 items-center gap-2 rounded-full py-0.5 pl-0.5 pr-1 text-left transition-colors [button:focus-visible:not([data-pointer-focus])>&]:ring-2 [button:focus-visible:not([data-pointer-focus])>&]:ring-focus",
            open ? "ring-2 ring-accent/60" : "hover:bg-sidebar-hover",
          )}
        >
          <span className="relative flex shrink-0">
            {avatar(36)}
            {noteworthy && (
              <span
                title={noteworthy.label}
                aria-label={noteworthy.label}
                className={cn(
                  "absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-sidebar",
                  noteworthy.phase === "error" ? "bg-danger" : "bg-accent",
                )}
              />
            )}
          </span>
          <WhenOpen open={open} onOpen={() => setMenuOpened(true)} />
          {showLine ? (
            // name on top, then the viewer's title and points (the same line
            // as the account row); the row's custom property grows both foot
            // tiles to fit it (styles.css, --foot-tile-h)
            <span data-account-pill-line="" className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
              <span data-account-pill-name="" className="min-w-0 truncate text-[14px] font-normal leading-[18px] text-sidebar-ink">{name}</span>
              <span data-member-line="" className="flex min-w-0 items-center gap-1.5 text-[12px] leading-[16px] text-sidebar-ink-secondary">
                {titleName && <span data-member-title="" className="min-w-0 truncate">{titleName}</span>}
                {pointsText && (
                  <span data-gamertag="" data-footer="" className="achievement-gamertag shrink-0">
                    <Trophy size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span>{pointsText}</span>
                  </span>
                )}
              </span>
            </span>
          ) : (
            <span data-account-pill-name="" className="min-w-0 flex-1 truncate text-[14px] font-normal leading-5 text-sidebar-ink">{name}</span>
          )}
          {placeAttention && !open && (
            <span data-testid="footer-attention" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          )}
        </span>
      ) : avatarOnly ? (
        <span
          ref={triggerRef}
          title={name}
          data-menu-opened={open || undefined}
          className={cn(
            // the rail's avatar: the keyboard ring the wide pill has
            "relative flex size-9 items-center justify-center rounded-full transition-[filter] [button:focus-visible:not([data-pointer-focus])>&]:ring-2 [button:focus-visible:not([data-pointer-focus])>&]:ring-focus",
            open ? "ring-2 ring-accent/60" : "hover:brightness-90",
          )}
        >
          {avatar(36)}
          <WhenOpen open={open} onOpen={() => setMenuOpened(true)} />
          {/* the wide pill's place-attention dot, on the rail's avatar */}
          {placeAttention && !open && !noteworthy && (
            <span data-testid="footer-attention" aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-sidebar bg-danger" />
          )}
          {noteworthy && (
            <span
              title={noteworthy.label}
              aria-label={noteworthy.label}
              className={cn(
                "absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-sidebar",
                noteworthy.phase === "error" ? "bg-danger" : "bg-accent",
              )}
            />
          )}
        </span>
      ) : (
        // One row, like Perspicax's account footer: the avatar and the full
        // name, which ellipsizes only when it truly runs out of room.
        <span
          ref={triggerRef}
          data-sidebar-account
          className="flex w-full min-w-0 items-center gap-2.5 text-left"
        >
          {avatar(40)}
          <WhenOpen open={open} onOpen={() => setMenuOpened(true)} />
          <span
            data-account-name=""
            className={cn(
              "flex min-w-0 flex-col justify-center overflow-hidden transition-[max-width,opacity] duration-200 ease-out",
              updateButton && wide ? "max-w-0 flex-none opacity-0" : "max-w-[240px] flex-1 opacity-100",
            )}
          >
            <span title={name} className="min-w-0 truncate text-[14px] font-medium leading-[18px] text-sidebar-ink">{name}</span>
            {showLine && !avatarOnly && (
              <span data-member-line="" className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-sidebar-ink-secondary">
                {titleName && <span data-member-title="" className="min-w-0 truncate">{titleName}</span>}
                {pointsText && (
                  <span data-gamertag="" data-footer="" className="achievement-gamertag shrink-0">
                    <Trophy size={13} strokeWidth={2.4} aria-hidden="true" />
                    <span>{pointsText}</span>
                  </span>
                )}
              </span>
            )}
          </span>
          {/* an update is the one thing worth interrupting the name for, so
            * it sits on the row rather than waiting to be found in the menu */}
          {noteworthy && (
            <span
              title={noteworthy.label}
              aria-label={noteworthy.label}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                noteworthy.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent",
              )}
            >
              <UpdateIcon phase={noteworthy.phase} pending={noteworthy.pending} size={14} />
            </span>
          )}
          {placeAttention && !open && (
            <span data-testid="footer-attention" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          )}
        </span>
      )}
    />
  );
  const routinesBadge = !avatarOnly ? <SidebarRoutinesBadge /> : null;

  const approvalsLabel = t("organization.adminApprovals.badge", { count: adminApprovals });
  const approvalsBadge = adminApprovals > 0 ? (
    <button
      type="button"
      data-admin-approvals={adminApprovals}
      title={approvalsLabel}
      aria-label={approvalsLabel}
      onClick={(event) => {
        event.stopPropagation();
        openAdminApprovals();
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1 text-[13px] leading-[18px] tabular-nums text-warning hover:bg-sidebar-hover",
        avatarOnly && "absolute -left-1 -top-1 z-10 rounded-full bg-sidebar px-1 py-0 text-[11px]",
      )}
    >
      <ShieldCheck size={avatarOnly ? 11 : 13} strokeWidth={2.2} aria-hidden="true" />
      <span>{adminApprovals}</span>
    </button>
  ) : null;

  return (
    <div className={cn("relative", avatarOnly && withName && "min-w-[3.5rem] flex-1")} data-foot-profile={avatarOnly && withName ? "" : undefined}>
      {avatarOnly && approvalsBadge}
      {avatarOnly ? <div className="relative">{accountRow}{approvalsDot}</div> : (
        <div className="flex items-center gap-2">
          <div
            data-sidebar-account-row=""
            // flex-1 throughout, so the update button stays pinned to the
            // right edge and widens leftward under the pointer; while it is
            // wide the row keeps just what it cannot lose (the avatar and
            // the badges), the name having folded away
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-hover has-[[aria-expanded=true]]:bg-sidebar-hover",
              updateButton && wide ? "min-w-fit" : "min-w-0",
            )}
          >
            <div className="flex items-center gap-1">
              <div className="relative min-w-0 flex-1">{accountRow}{approvalsDot}</div>
              {approvalsBadge}
              {routinesBadge}
            </div>
          </div>
          {updateButton && update && (
            <button
              type="button"
              data-sidebar-update=""
              data-wide={wide ? "" : undefined}
              title={update.label}
              aria-label={update.label}
              onClick={openUpdatePrompt}
              onMouseEnter={() => setWide(true)}
              onMouseLeave={() => setWide(false)}
              onFocus={() => setWide(true)}
              onBlur={() => setWide(false)}
              style={{ flexBasis: wide ? "100%" : "2.75rem" }}
              className="flex h-11 min-w-11 shrink grow-0 items-center justify-center rounded-full bg-ink text-app shadow-sm transition-[flex-basis,filter] duration-200 ease-out hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            >
              <CloudDownload size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {renaming && (
        <RenameServerDialog
          current={renaming.name}
          defaultName={renaming.defaultName}
          onSave={(label) => saveServerName(renaming.id, label)}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

/** The active routines count (calendar icon and number) that opens
 * Automations, while "Show active routines" is on and one runs. Beside the
 * name in the wide row, and to the right of Connect apps in the reference design's foot
 * (2026-10-16: it had vanished with the avatar-only foot). A failed run
 * not seen yet turns its label into a warning. */
export function SidebarRoutinesBadge() {
  const { state, dispatch } = useStore();
  const activeRoutines = activeRoutineCount(state.routines, state.bots, viewerActorId(state.config));
  const badgeEnabled = useShowRoutinesBadge();
  const routineAttention = state.routineRuns.some((run) => isRoutineProblemRun(run) && !run.seenAt);
  if (!badgeEnabled || activeRoutines <= 0) return null;
  const routinesLabel = t(
    routineAttention
      ? (activeRoutines === 1 ? "sidebar.profile.activeRoutinesOneAttention" : "sidebar.profile.activeRoutinesAttention")
      : (activeRoutines === 1 ? "sidebar.profile.activeRoutinesOne" : "sidebar.profile.activeRoutines"),
    { count: activeRoutines },
  );
  return (
    // the right edge of the row, vertically centred against the avatar
    <div className="flex shrink-0 items-center" data-routines-line="">
      <button
        type="button"
        data-active-routines={activeRoutines}
        data-attention={routineAttention ? "" : undefined}
        title={routinesLabel}
        aria-label={routinesLabel}
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: "showRoutines" });
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[14px] font-medium leading-[20px] tabular-nums text-accent-text hover:bg-sidebar-hover",
        )}
      >
        <CalendarClock size={18} strokeWidth={2.2} aria-hidden="true" />
        <span>{activeRoutines}</span>
      </button>
    </div>
  );
}
