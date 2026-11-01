// The Computer tab on an organization server, self-contained so it slots
// into any bot panel layout. It looks like the solo panel: one large screen
// (ComputerScreen) with Play / Pause / Stop on it and "<Bot>'s screen" below,
// showing the computer this bot uses, as its Works on says
// (src/lib/place.ts orgComputerFor):
//
// - Auto and Cloud: the person's server environment (power, live desktop
//   through SandboxDesktopView, view-only until they take control);
// - Local VM and This computer: their own computer through the desktop app
//   (src/lib/desktop-local-vm.ts, electron/local-vm.mjs), set up, repaired or
//   started from the screen itself.
//
// Above the screen, when there is more than one to look at, a drop-down
// (ScreenPicker): Cloud, then each of the person's online computers by its
// name (a person with two PCs sees two), then the bot's browser, one state
// dot per screen whose label also names the one the bot works on.
// Picking one only changes the screen shown (and where its Local VM
// actions go, `desktopId`), never where the bot works.
//
// Under it, only the usage of that computer (disk, CPU, memory, OS) behind
// a small Details toggle. The bot's Works on is Edit persona > Access
// (WorksOnSetting), not a control on this screen.
//
// Every action is the signed-in person's own (the server takes the person
// from the session); nothing here names a bot or another person.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Cpu, Ellipsis, Globe, HardDrive, Info, Laptop, MemoryStick, Monitor, Server, type LucideIcon } from "lucide-react";

import { hostPlaceKey, parseHostPlaceKey, remoteHostPlaces } from "../../../shared/remote-bot-hosts";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import type { RemoteSessionView } from "../../../shared/remote-session";
import { PLACE_LABEL_MAX } from "../../../shared/place-labels";
import { chosenComputer, computerChoices, currentDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import {
  desktopLocalVm, installChoices, localVmProblemKey, localVmView, runtimeSummaryKey,
  type DesktopLocalVmStatus, type InstallChoice, type LocalVmAction, type ScreenState, type SetupStep,
} from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { orgComputerFor, type EffectivePlace } from "@/lib/place";
import { placeLabel, savePlaceLabel, usePlaceLabels } from "@/lib/place-labels";
import { reportScreenDot, SCREEN_DOT_CLASS, SCREEN_DOT_LABEL_KEY, screenDot, useScreenDots, type ScreenDot } from "@/lib/screen-status";
import {
  formatBytes, loadServerEnvironment, loadServerEnvironmentStats, powerServerEnvironment, powerState,
  type PowerAction, type ServerEnvironmentStats, type ServerEnvironmentStatus,
} from "@/lib/server-environment";
import type { Bot } from "@/state/store";
import { SandboxDesktopView } from "../SandboxDesktopView";
import { RemoteScreenCard } from "../remote-session/RemoteScreenCard";
import { ComputerScreen, type ScreenAction, type ScreenControls } from "./ComputerScreen";
import { SandboxDesktopModal } from "./SandboxDesktopModal";

const STATS_REFRESH_MS = 5_000;
const STATS_IDLE_REFRESH_MS = 15_000;
const LOCAL_STATUS_MS = 10_000;
const LOCAL_SETUP_MS = 2_000;
const LOCAL_FRAME_MS = 4_000;
/** The server screen re-reads its status this often while it starts (a
 * cluster waking), and slowly while it is off or failed (a bot turn may wake
 * it meanwhile). Never while it runs. */
const SERVER_STARTING_MS = 5_000;
const SERVER_IDLE_MS = 20_000;
/** From this long, the waking hint also says for how long. */
const WAKING_ELAPSED_FROM_MS = 2 * 60_000;

export type ComputerSource = "local" | "server";

/** The screen tells the usage panel beside it that the environment changed
 * (started, paused, stopped, its view connected), so the figures follow at
 * once instead of at the next slow poll. */
const SERVER_ENVIRONMENT_CHANGED = "sagax:server-environment-changed";
const announceServerEnvironment = () => { window.dispatchEvent(new Event(SERVER_ENVIRONMENT_CHANGED)); };

/** Which computer this bot uses, from its Works on, and why (one sentence).
 * Auto starts on the person's computer when the Sagax app is connected
 * (server/auto-computer.ts autoStartTarget), else in the cloud. */
export function activeComputer(bridge: DesktopBridgeStatus, place: EffectivePlace): { source: ComputerSource; reason: "cloud" | "computer" | "notConnected" | "none" } {
  if (place === "auto" && bridge.connected) return { source: "local", reason: "computer" };
  const computer = orgComputerFor(place);
  if (computer === "server") return { source: "server", reason: "cloud" };
  if (computer === "computer") return { source: "local", reason: bridge.connected ? "computer" : "notConnected" };
  return { source: "server", reason: "none" };
}

/** Where the bot works right now for this conversation (the server's answer
 * or the conversation's pin): the screen the tab opens on. "unknown" is an Auto
 * place the server has not answered yet: Cloud meanwhile, so the person's Mac
 * is never reached before it is known to be the one in use. */
export type InUsePlace = "cloud" | "vm" | "local" | "browser" | "off" | "unknown";

/** The screen the tab opens on: the destination in use, else the legacy
 * default (Works on; Auto starts on the Mac when it is connected). */
export function defaultScreen(bridge: DesktopBridgeStatus, place: EffectivePlace, inUse?: InUsePlace): { source: ComputerSource; browser: boolean } {
  if (inUse === "unknown") return { source: "server", browser: false };
  if (inUse === "cloud") return { source: "server", browser: false };
  if (inUse === "vm" || inUse === "local") return { source: "local", browser: false };
  if (inUse === "browser") return { source: "server", browser: true };
  return { source: activeComputer(bridge, place).source, browser: place === "browser" };
}

export function OrgComputerTab({ bridge, place, computerOff, botName, botId, bot = null, threadId, inUse, initialLocal = null, browser = null, remoteHosts = [], remoteSessions = [], onPickRemoteHost }: {
  bridge: DesktopBridgeStatus;
  /** The conversation, so a manual pick ends when it changes. */
  threadId?: string;
  /** The destination the bot uses now; a change of it ends a manual pick. */
  inUse?: InUsePlace;
  /** This bot, for its browser's dot in the picker. */
  botId?: string;
  /** The bot (mascot on asleep / waking screens). */
  bot?: Bot | null;
  /** The bot's Works on (Auto when unset). */
  place: EffectivePlace;
  computerOff: boolean; botName: string;
  /** Tests: the desktop's Local VM status to start from. */
  initialLocal?: DesktopLocalVmStatus | null;
  /** The bot's live browser, offered as the picker's last chip. */
  browser?: ReactNode;
  /** Enrolled hosts attached to this bot (Computer place dropdown, 2026-11-01). */
  remoteHosts?: UnattendedHostRow[];
  /** Connected sessions for this bot; ended ones never become places. */
  remoteSessions?: RemoteSessionView[];
  /** Selecting a host place: open/focus so the bot works on that host. */
  onPickRemoteHost?: (hostId: string) => void;
}) {
  const screen = defaultScreen(bridge, place, inUse);
  const active = { ...activeComputer(bridge, place), source: screen.source };
  const choices = computerChoices(bridge);
  const labels = usePlaceLabels();
  const hostPlaces = remoteHostPlaces(
    remoteHosts.map((row) => row.hostId),
    remoteHosts,
  );
  // A manual pick holds until the bot's destination (or the conversation) changes.
  const scope = `${botId ?? ""}:${threadId ?? ""}:${inUse ?? ""}`;
  const [pick, setPick] = useState<{ scope: string; key: string } | null>(null);
  // the pick ends for good when the scope moves (adjusting state while rendering)
  if (pick && pick.scope !== scope) setPick(null);
  const picked = pick && pick.scope === scope ? pick.key : null;
  const setPicked = useCallback((key: string) => {
    setPick({ scope, key });
    const hostId = parseHostPlaceKey(key);
    if (hostId) onPickRemoteHost?.(hostId);
  }, [scope, onPickRemoteHost]);
  const pickedHostId = parseHostPlaceKey(picked);
  const showingHost = pickedHostId !== null;
  const hostRow = showingHost ? remoteHosts.find((row) => row.hostId === pickedHostId) : undefined;
  const hostSession = showingHost
    ? remoteSessions.find((row) => row.state === "connected" && hostRow?.hostname && (row.hostname ?? "").trim().toLowerCase() === hostRow.hostname.trim().toLowerCase()) ?? null
    : null;
  // a bot that works on its browser opens on it
  const showingBrowser = !showingHost && browser !== null && (picked === "browser" || (picked === null && screen.browser));
  const chosen = chosenComputer(choices, active.source, bridge, showingBrowser || showingHost ? null : picked);
  // Works on a computer that is not connected: its screen says so.
  const source = chosen?.source ?? active.source;
  const desktop = chosen?.source === "local" ? bridge.desktops.find((entry) => entry.id === chosen.desktopId) ?? null : currentDesktop(bridge);
  const worksOnKey = showingHost ? hostPlaceKey(pickedHostId!) : active.source === "server" ? "server" : chosenComputer(choices, "local", bridge, null)?.key ?? null;
  const [details, setDetails] = useState(false);
  const caption = t("computer.screenOf", { name: botName });
  const dots = useScreenDots();
  // The cloud's dot while another screen is shown: one read, no polling.
  const serverShown = !showingBrowser && !showingHost && source === "server";
  const serverKnown = dots.server !== undefined;
  useEffect(() => {
    if (serverShown || serverKnown) return;
    let alive = true;
    loadServerEnvironment().then((status) => { if (alive) reportScreenDot("server", serverDot(status, null)); }).catch(() => {});
    return () => { alive = false; };
  }, [serverShown, serverKnown]);
  const pickerItems: ScreenPickerItem[] = [
    ...choices.map((choice): ScreenPickerItem => {
      const technical = choice.source === "server" ? t("orgComputer.choice.cloud") : choice.name;
      return {
        key: choice.key,
        technical,
        label: placeLabel(choice.key, technical),
        icon: choice.source === "server" ? Server : Laptop,
        here: choice.key === worksOnKey,
        dot: dots[choice.key] ?? "offline",
      };
    }),
    ...hostPlaces.map((host): ScreenPickerItem => {
      const key = hostPlaceKey(host.hostId);
      const technical = host.label;
      return {
        key,
        technical,
        label: placeLabel(key, technical),
        icon: Monitor,
        here: worksOnKey === key,
        dot: host.state === "enrolled"
          ? (remoteSessions.some((row) => row.state === "connected" && (row.hostname ?? "").trim().toLowerCase() === host.label.trim().toLowerCase()) ? "online" : "asleep")
          : "offline",
      };
    }),
    ...(browser !== null ? [{
      key: "browser",
      technical: t("computer.view.browser"),
      label: placeLabel("browser", t("computer.view.browser")),
      icon: Globe,
      dot: (botId ? dots[`browser:${botId}`] : undefined) ?? "offline" as ScreenDot,
    }] : []),
  ];
  void labels; // subscribe so renames re-render
  const showPicker = choices.length > 1 || browser !== null || hostPlaces.length > 0;
  const cloudName = placeLabel("server", t("orgComputer.choice.cloud"));
  const desktopName = desktop ? placeLabel(`desktop:${desktop.id}`, desktop.name) : t("computerScreen.computer");
  const hostName = hostRow
    ? placeLabel(hostPlaceKey(hostRow.hostId), hostRow.hostname ?? t("remoteSessionsAdmin.hosts.unnamed"))
    : t("botRemoteHosts.place");
  return (
    <div className="flex flex-col gap-3" data-org-computer={showingHost ? "remote-host" : source === "server" ? "user-sandbox" : "user-desktop"} data-works-on={place} data-remote-host={pickedHostId ?? undefined}>
      {showPicker && (
        <ScreenPicker
          items={pickerItems}
          chosen={showingHost ? hostPlaceKey(pickedHostId!) : showingBrowser ? "browser" : chosen?.key ?? null}
          onPick={setPicked}
          onRename={(key, label) => savePlaceLabel(key, label)}
        />
      )}
      {showingHost
        ? (botId && hostSession
          ? <div data-remote-host-screen=""><RemoteScreenCard botId={botId} view={hostSession} /></div>
          : (
            <div data-remote-host-pending="">
              <ComputerScreen
                source="remote"
                state="off"
                caption={caption}
                bot={bot}
                computerName={hostName}
                controls={{ play: pickedHostId ? () => onPickRemoteHost?.(pickedHostId) : undefined }}
              />
            </div>
          ))
        : showingBrowser
        ? <BrowserScreen>{browser}</BrowserScreen>
        : source === "server"
        ? <ServerComputerScreen caption={caption} bot={bot} computerName={cloudName} />
        : (
          <LocalComputerScreen
            // a new computer starts over: its own status, frames and errors
            key={chosen?.key ?? "current"}
            bridge={bridge}
            bot={bot}
            computerName={desktopName}
            desktopId={chosen?.source === "local" ? chosen.desktopId : undefined}
            caption={chosen?.source === "local" ? `${caption} · ${chosen.name}` : caption}
            initial={initialLocal}
          />
        )}
      {computerOff && !showingBrowser && !showingHost && <p role="note" className="-mt-1 text-center text-[12px] text-ink-secondary">{t("computer.phase.off")}</p>}
      {!showingBrowser && !showingHost && <div className="flex flex-col gap-1.5">
        <button type="button" onClick={() => setDetails((open) => !open)} aria-expanded={details} data-usage-toggle
          className="flex items-center gap-1 self-start text-[12px] text-ink-secondary hover:text-ink">
          <Info size={12} aria-hidden="true" />
          {t("orgComputer.details")}
          <ChevronDown size={12} aria-hidden="true" className={details ? "rotate-180" : undefined} />
        </button>
        {details && (source === "server" ? <UsagePanel /> : <DesktopUsage bridge={bridge} name={desktop?.name} />)}
      </div>}
    </div>
  );
}

/** One chip of a screen picker. */
export interface ScreenPickerItem {
  key: string;
  /** Shown name (person's label when set). */
  label: string;
  /** Technical name for tooltip / Copy / rename placeholder. */
  technical?: string;
  icon: LucideIcon;
  /** The bot works here: said in the dot's label and the tooltip. */
  here?: boolean;
  /** Its state (src/lib/screen-status.ts): asleep, online or offline. */
  dot?: ScreenDot;
}

/** The one small dot of a screen, right of its name (2026-10-15: never
 * two). Its colour is the screen's state (src/lib/screen-status.ts: green
 * online, yellow asleep or waking, grey offline); where the bot works is said
 * in its label and tooltip ("Offline · this bot works here"). A screen whose
 * state is unknown and where the bot works keeps an accent dot. */
export function ScreenStatusDot({ dot, here = false }: { dot?: ScreenDot; here?: boolean }) {
  if (!dot && !here) return null;
  const worksHere = here ? t("orgComputer.choice.worksHereShort") : null;
  const label = dot ? [t(SCREEN_DOT_LABEL_KEY[dot]), worksHere].filter(Boolean).join(" · ") : worksHere!;
  return (
    <span role="img" aria-label={label} title={label} data-screen-dot={dot} data-works-here={here ? "" : undefined}
      className={`size-[7px] shrink-0 rounded-full ${dot ? SCREEN_DOT_CLASS[dot] : "bg-accent"}`} />
  );
}

/** The Computer tab's one screen chooser, a drop-down (#518 menus): one
 * button names the screen shown (Cloud and each of the person's computers by
 * name on an organization server, then the bot's Browser; Screen and Browser
 * on a solo server) and opens the list of them. One dot per screen, its
 * state; its label also says where the bot works. Keyboard: Enter, Space or the arrows open it; in the list the
 * arrows, Home and End move, Enter or Space pick, Escape and Tab close, and
 * focus comes back to the button. The list stays in the page while closed
 * (hidden), so a screen reader never meets a half-built one. */
export function ScreenPicker({ items, chosen, onPick, onRename }: {
  items: ScreenPickerItem[];
  chosen: string | null;
  onPick: (key: string) => void;
  /** Inline rename (F2 / … / right-click). Null or blank clears the label. */
  onRename?: (key: string, label: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosenIndex = Math.max(0, items.findIndex((item) => item.key === chosen));
  const [active, setActive] = useState(chosenIndex);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = items[chosenIndex];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setRenaming(null);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const show = (index: number) => {
    setActive(Math.min(Math.max(index, 0), items.length - 1));
    setOpen(true);
  };
  const pick = (index: number) => {
    if (renaming) return;
    const item = items[index];
    close(true);
    if (item) onPick(item.key);
  };
  const beginRename = (item: ScreenPickerItem) => {
    if (!onRename) return;
    setRenaming(item.key);
    setDraft(item.label);
    setOpen(true);
  };
  const commitRename = () => {
    if (!renaming || !onRename) return;
    const key = renaming;
    const value = draft.trim();
    setRenaming(null);
    onRename(key, value || null);
  };
  const cancelRename = () => setRenaming(null);

  useEffect(() => {
    if (!open) return;
    if (renaming) renameInput.current?.focus({ preventScroll: true });
    else list.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open, close, renaming]);

  const onTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(chosenIndex);
    }
  };
  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (renaming) return;
    const last = items.length - 1;
    const move: Record<string, number> = { ArrowDown: Math.min(active + 1, last), ArrowUp: Math.max(active - 1, 0), Home: 0, End: last };
    if (event.key in move) { event.preventDefault(); setActive(move[event.key]!); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(active); return; }
    if (event.key === "F2" && onRename && items[active]) { event.preventDefault(); beginRename(items[active]!); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") close(false);
  };

  if (!current) return null;
  const CurrentIcon = current.icon;
  const optionId = (index: number) => `${id}-option-${index}`;
  return (
    <div ref={root} className="relative max-w-full self-center" data-computer-picker="">
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        aria-label={t("orgComputer.choice.button", { name: current.here ? t("orgComputer.choice.worksHere", { name: current.label }) : current.label })}
        title={current.technical && current.technical !== current.label
          ? `${current.label} (${current.technical})`
          : current.here ? t("orgComputer.choice.worksHere", { name: current.label }) : current.label}
        data-computer-picker-button="" data-computer-current={current.key}
        onClick={() => (open ? close(false) : show(chosenIndex))} onKeyDown={onTriggerKey}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-control px-3 py-1 text-[12.5px] text-ink transition-colors hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <CurrentIcon size={12} aria-hidden="true" />
        <span className="max-w-[180px] truncate">{current.label}</span>
        <ScreenStatusDot dot={current.dot} here={current.here} />
        <ChevronDown size={12} aria-hidden="true" className={open ? "rotate-180 text-ink-secondary" : "text-ink-secondary"} />
      </button>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={t("orgComputer.choice.label")} tabIndex={-1} hidden={!open}
        aria-activedescendant={open && !renaming ? optionId(active) : undefined} onKeyDown={onListKey}
        className="absolute left-1/2 top-full z-30 mt-1 flex w-max min-w-[180px] max-w-[min(280px,90vw)] -translate-x-1/2 flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] shadow-lg outline-none popover-surface">
        {items.map((item, index) => {
          const selected = item.key === current.key;
          const Icon = item.icon;
          const technical = item.technical ?? item.label;
          if (renaming === item.key) {
            return (
              <div key={item.key} id={optionId(index)} role="option" aria-selected={selected} data-computer-choice={item.key} data-computer-renaming=""
                className="flex items-center gap-2 rounded-lg bg-raised-hover px-2.5 py-1.5 text-ink">
                <Icon size={13} aria-hidden="true" />
                <input
                  ref={renameInput}
                  data-computer-rename-input=""
                  value={draft}
                  maxLength={PLACE_LABEL_MAX}
                  placeholder={technical}
                  aria-label={t("computerScreen.renamePlaceholder")}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commitRename(); }
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelRename(); }
                  }}
                  onBlur={() => commitRename()}
                  className="min-w-0 flex-1 rounded-md border border-hairline/60 bg-card px-1.5 py-0.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/60"
                />
              </div>
            );
          }
          return (
            <div key={item.key} id={optionId(index)} role="option" aria-selected={selected} data-computer-choice={item.key}
              title={technical !== item.label ? `${item.label} · ${technical}` : item.here ? t("orgComputer.choice.worksHere", { name: item.label }) : item.label}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(index)}
              onPointerEnter={() => setActive(index)}
              onContextMenu={(event) => { if (!onRename) return; event.preventDefault(); beginRename(item); }}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ${index === active && open ? "bg-raised-hover" : ""} ${selected ? "text-ink" : "text-ink-secondary"}`}>
              <Icon size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ScreenStatusDot dot={item.dot} here={item.here} />
              {onRename && (
                <button
                  type="button"
                  data-computer-rename=""
                  aria-label={t("computerScreen.rename")}
                  title={t("computerScreen.rename")}
                  onClick={(event) => { event.stopPropagation(); beginRename(item); }}
                  className="rounded p-0.5 text-ink-tertiary hover:bg-raised hover:text-ink"
                >
                  <Ellipsis size={13} aria-hidden="true" />
                </button>
              )}
              {selected ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" className="w-[13px]" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The bot's browser in the picker's place. BrowserPanel draws it as a
 * screen (ComputerScreen), its frame and its name below, like the others. */
export function BrowserScreen({ children }: { children: ReactNode }) {
  return <div className="flex flex-col" data-browser-view="">{children}</div>;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** The cloud screen's state: "starting" while the environment's cluster
 * wakes (it slept while idle), never an error in that window. */
export function serverScreenState(status: ServerEnvironmentStatus | null, pending: PowerAction | null): ScreenState {
  if (!status) return "starting";
  const power = powerState(status.state, pending);
  if ((status.waking || status.starting) && power !== "running" && power !== "paused") return "starting";
  if (!status.configured) return "off";
  return power === "unavailable" ? "error" : power;
}

/** The cloud's dot in the picker. */
export function serverDot(status: ServerEnvironmentStatus | null, pending: PowerAction | null): ScreenDot {
  return screenDot(status ? serverScreenState(status, pending) : "off", Boolean(status?.waking));
}

/** The quiet line under "Starting" while the cluster wakes, with how long
 * so far once it has been a while (never alarming). */
export function wakingHint(elapsedMs: number | null): string | undefined {
  if (elapsedMs === null) return undefined;
  const hint = t("computerScreen.wakingHint");
  return elapsedMs >= WAKING_ELAPSED_FROM_MS ? `${hint} ${t("computerScreen.wakingSince", { minutes: Math.floor(elapsedMs / 60_000) })}` : hint;
}

/** Retry on an error the cluster caused starts it again (it may have gone
 * back to sleep); any other error only reads the status again. */
export function retryStartsCluster(status: ServerEnvironmentStatus | null): boolean {
  return Boolean(status?.configured && status.error?.startsWith("cluster_"));
}

/** The person's server environment on the screen. */
export function ServerComputerScreen({ caption, initial = null, bot = null, computerName }: {
  caption: string;
  initial?: ServerEnvironmentStatus | null;
  bot?: Bot | null;
  computerName?: string;
}) {
  const visible = usePageVisible();
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(initial);
  const [pending, setPending] = useState<PowerAction | null>(null);
  const [error, setError] = useState("");
  // "Take control" opens the large window; the square stays view-only.
  const [takeover, setTakeover] = useState(false);
  // When the waking answer came, to count the time on this screen's clock.
  const [wakingSeen, setWakingSeen] = useState<{ elapsedMs: number; at: number } | null>(() => initial?.waking ? { elapsedMs: initial.waking.elapsedMs, at: Date.now() } : null);
  const [, setTick] = useState(0);
  const show = useCallback((next: ServerEnvironmentStatus) => {
    setStatus(next);
    setWakingSeen(next.waking ? { elapsedMs: next.waking.elapsedMs, at: Date.now() } : null);
  }, []);
  const load = useCallback(async () => {
    try { show(await loadServerEnvironment()); } catch { show({ configured: true, state: "unavailable" }); }
    announceServerEnvironment();
  }, [show]);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);

  const act = async (action: PowerAction) => {
    setPending(action);
    setError("");
    try {
      let next = await powerServerEnvironment(action);
      if (next === null) {
        // A bot is working there right now: shutting down or pausing cuts it short.
        if (!window.confirm(t("orgComputer.confirmRunning"))) return;
        next = await powerServerEnvironment(action, true);
      }
      if (next) { show(next); announceServerEnvironment(); }
    } catch {
      setError(t("orgComputer.actionFailed"));
      await load();
    } finally {
      setPending(null);
    }
  };

  const power = powerState(status?.state, pending);
  const state = serverScreenState(status, pending);
  const waking = state === "starting" && status?.waking !== undefined;
  // Re-read while it starts (the cluster may take minutes), slowly while it
  // is off or failed, never while it runs or the page is hidden.
  const pollMs = !status || !visible ? 0 : state === "starting" ? SERVER_STARTING_MS : state === "off" || state === "error" ? SERVER_IDLE_MS : 0;
  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => void load(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, load]);
  // The elapsed time in the hint moves on its own between reads.
  useEffect(() => {
    if (!waking) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [waking]);
  useEffect(() => { if (status) reportScreenDot("server", serverDot(status, pending)); }, [status, pending]);

  const busy = pending !== null || !status;
  // Asleep / waking use the calm mascot copy; keep technical text for error / not configured.
  const message = !status ? undefined
    : !status.configured ? t("serverEnvironment.notConfigured")
    : state === "error" ? t("computerScreen.serverUnavailable")
    : undefined;
  const hint = waking && wakingSeen ? wakingHint(wakingSeen.elapsedMs + Math.max(0, Date.now() - wakingSeen.at)) : undefined;
  const controls: ScreenControls = {
    play: status?.configured && power === "off" && state !== "starting" ? () => void act("start") : undefined,
    resume: power === "paused" ? () => void act("resume") : undefined,
    pause: power === "running" ? () => void act("pause") : undefined,
    stop: power === "running" || power === "paused" ? () => void act("shutdown") : undefined,
  };
  // While the large window has control, the square shows no second live
  // view (one VNC stream, and the window's passwords stay the valid ones).
  // Open pill on ComputerScreen opens the window; no second Take control pill.
  const live = takeover
    ? <div data-sandbox-takeover-open className="flex h-full w-full items-center justify-center p-4 text-center text-[12px] text-ink-secondary">{t("sandboxDesktop.inWindow")}</div>
    : <SandboxDesktopView embedded onConnected={() => void load()} />;
  return (
    <>
      <ComputerScreen
        source="server"
        state={state}
        caption={caption}
        message={message}
        hint={hint}
        busy={busy}
        bot={bot}
        computerName={computerName ?? t("orgComputer.choice.cloud")}
        onOpen={state === "running" || state === "paused" ? () => setTakeover(true) : undefined}
        // An error screen already says what failed: no second line under it.
        error={state === "error" ? undefined : error || undefined}
        live={live}
        actions={state === "error" ? [{ label: t("computerScreen.retry"), onClick: () => void (retryStartsCluster(status) ? act("start") : load()) }] : !status?.configured ? [] : []}
        controls={controls}
      />
      {takeover && (
        <SandboxDesktopModal title={caption} state={state} controls={controls} busy={busy}
          onClose={() => setTakeover(false)} onConnected={() => void load()} />
      )}
    </>
  );
}

/** The person's Local VM, through their desktop app. */
export function useDesktopLocalVm(connected: boolean, initial: DesktopLocalVmStatus | null = null, desktopId?: string) {
  const visible = usePageVisible();
  const [status, setStatus] = useState<DesktopLocalVmStatus | null>(initial);
  const [pending, setPending] = useState<LocalVmAction | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const answer = await desktopLocalVm("status", { desktopId });
      if (answer.status) setStatus(answer.status);
      else if (!answer.ok) setError(answer.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("orgComputer.actionFailed"));
    }
  }, [desktopId]);
  const settingUp = status?.setup?.state === "running";
  useEffect(() => {
    if (!connected || !visible) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), settingUp ? LOCAL_SETUP_MS : LOCAL_STATUS_MS);
    return () => window.clearInterval(timer);
  }, [connected, visible, refresh, settingUp]);
  const act = useCallback(async (action: LocalVmAction, extra: { choice?: InstallChoice } = {}) => {
    setPending(action);
    setError("");
    try {
      const answer = await desktopLocalVm(action, { ...extra, desktopId });
      if (!answer.ok) setError(answer.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("orgComputer.actionFailed"));
    } finally {
      setPending(null);
      await refresh();
    }
  }, [refresh, desktopId]);
  return { status, pending, error, act, refresh, visible };
}

export function LocalComputerScreen({ bridge, caption, initial = null, desktopId, bot = null, computerName }: {
  bridge: DesktopBridgeStatus; caption: string; initial?: DesktopLocalVmStatus | null;
  /** The computer the person picked by name; their current one without it. */
  desktopId?: string;
  bot?: Bot | null;
  computerName?: string;
}) {
  const desktop = desktopId ? bridge.desktops.find((entry) => entry.id === desktopId && entry.online) ?? null : currentDesktop(bridge);
  const connected = Boolean(desktop?.capabilities?.localVm);
  const vm = useDesktopLocalVm(connected, initial, desktopId);
  const view = localVmView(vm.status, connected, vm.pending);
  const dotKey = desktop ? `desktop:${desktop.id}` : null;
  const dot = !connected ? "offline" : vm.status ? screenDot(view.state) : null;
  useEffect(() => { if (dotKey && dot) reportScreenDot(dotKey, dot); }, [dotKey, dot]);
  const [frame, setFrame] = useState<string | null>(null);
  const running = view.state === "running";
  useEffect(() => {
    if (!running || !vm.visible) { setFrame(null); return; }
    let cancelled = false;
    const grab = async () => {
      try {
        const answer = await desktopLocalVm("screenshot", { desktopId });
        if (!cancelled && answer.image) setFrame(answer.image);
      } catch { /* keep the last frame */ }
    };
    void grab();
    const timer = window.setInterval(() => void grab(), LOCAL_FRAME_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running, vm.visible, desktopId]);

  const setUp = () => {
    if (view.playNeedsConsent && !window.confirm(t(view.repair ? "localVm.consent.repair" : "localVm.consent.create", { folder: vm.status?.workspace ?? "" }))) return;
    void vm.act("setup");
  };
  const setup = vm.status?.setup;
  const runtime = runtimeSummaryKey(vm.status?.runtime);
  const actions: ScreenAction[] = [];
  if (view.problem === "no_runtime") {
    for (const choice of installChoices(desktop?.platform)) actions.push({ label: t(`localVm.install.${choice}`), onClick: () => void vm.act("install", { choice }), primary: actions.length === 0 });
  } else if (view.repair) {
    actions.push({ label: t("localVm.repair"), onClick: setUp, primary: true });
  } else if (view.canPlay && view.state !== "running" && view.problem) {
    // Setup / problem cases keep a primary button. A plain off VM wakes by
    // clicking the calm asleep screen (controls.play), Grok Bot style.
    actions.push({ label: t(view.problem === "missing" ? "localVm.setupOneClick" : "computerScreen.play"), onClick: setUp, primary: true });
  }
  const message = view.state === "starting" && setup?.state === "running"
    ? setupProgress(setup.steps)
    : view.problem
      ? `${t(localVmProblemKey(view.problem), { product: runtime.product, folder: vm.status?.vm?.folder ?? "" })}${setup?.state === "error" && setup.error && view.problem === "setup_failed" ? ` ${setup.error}` : ""}`
      : undefined;
  return (
    <>
      <ComputerScreen
        source="local"
        state={view.state}
        caption={caption}
        message={message}
        busy={vm.pending !== null}
        error={vm.error || undefined}
        bot={bot}
        computerName={computerName ?? desktop?.name ?? t("computerScreen.computer")}
        actions={actions}
        live={frame ? <img src={frame} alt={caption} className="h-full w-full object-contain" /> : undefined}
        controls={{
          play: view.canPlay ? setUp : undefined,
          resume: view.canResume ? () => void vm.act("resume") : undefined,
          pause: view.canPause ? () => void vm.act("pause") : undefined,
          stop: view.canStop ? () => void vm.act("stop") : undefined,
        }}
      />
      {setup?.state === "done" && setup.previousFolder && (
        <p className="text-[11.5px] text-ink-secondary">{t("localVm.previousFolder", { folder: setup.previousFolder })}</p>
      )}
    </>
  );
}

/** "Étape 2 sur 4 : préparation de l'image" while a setup runs. */
export function setupProgress(steps: SetupStep[]): string {
  const index = Math.max(0, steps.findIndex((step) => step.state === "running"));
  const step = steps[index];
  return t("localVm.progress", { step: index + 1, total: steps.length, label: t(`localVm.step.${step?.id ?? "runtime"}`) });
}

/** Disk, CPU, memory and OS of the person's server environment, refreshed
 * every few seconds while the tab is visible (more often while it runs). */
export function UsagePanel() {
  const visible = usePageVisible();
  const [stats, setStats] = useState<ServerEnvironmentStats | null>(null);
  const running = stats?.state === "running" || stats?.state === "paused";
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const load = async () => {
      try { setStats(await loadServerEnvironmentStats(controller.signal)); } catch { /* keep the last one */ }
    };
    void load();
    // Keep asking while it is off too: the person may start it from the
    // screen above, and a usage panel frozen on its first answer kept
    // showing "?" next to a running desktop.
    const timer = window.setInterval(() => void load(), running ? STATS_REFRESH_MS : STATS_IDLE_REFRESH_MS);
    const changed = () => void load();
    window.addEventListener(SERVER_ENVIRONMENT_CHANGED, changed);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener(SERVER_ENVIRONMENT_CHANGED, changed); };
  }, [visible, running]);
  const live = stats?.state === "running";
  return (
    <dl aria-label={t("orgComputer.usage")} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-hairline p-3 text-[12px]">
      <Row icon={HardDrive} label={t("orgComputer.disk")} value={stats ? t("orgComputer.usedOf", { used: formatBytes(stats.workspaceBytes), limit: formatBytes(stats.workspaceQuotaBytes) }) : "?"} />
      <Row icon={Cpu} label={t("orgComputer.cpu")} value={live && stats.cpuPercent !== null ? t("orgComputer.cpuValue", { percent: Math.round(stats.cpuPercent) }) : "?"} />
      <Row icon={MemoryStick} label={t("orgComputer.memory")} value={stats ? t("orgComputer.usedOf", { used: live ? formatBytes(stats.memoryBytes) : "?", limit: formatBytes(stats.memoryLimitBytes) }) : "?"} />
      <Row icon={Server} label={t("orgComputer.os")} value={stats ? [stats.os, stats.arch].filter(Boolean).join(" ") || "Linux" : "?"} detail={stats?.image} />
    </dl>
  );
}

/** The person's own computer: its coarse facts (the Local VM runs there). */
function DesktopUsage({ bridge, name }: { bridge: DesktopBridgeStatus; name: string | undefined }) {
  const system = currentDesktop(bridge)?.system;
  return (
    <dl aria-label={t("orgComputer.usage")} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-hairline p-3 text-[12px]">
      <Row icon={HardDrive} label={t("orgComputer.disk")} value={system?.diskGb !== undefined ? t("orgComputer.freeOf", { free: `${system.diskFreeGb ?? "?"} GB`, total: `${system.diskGb} GB` }) : "?"} />
      <Row icon={Cpu} label={t("orgComputer.cpu")} value={system ? [system.cpuPercent !== undefined ? t("orgComputer.cpuValue", { percent: system.cpuPercent }) : null, t("orgComputer.cores", { count: system.cpus })].filter(Boolean).join(", ") : "?"} detail={system?.cpuModel} />
      <Row icon={MemoryStick} label={t("orgComputer.memory")} value={system ? t("orgComputer.usedOf", { used: system.memoryUsedGb !== undefined ? `${system.memoryUsedGb} GB` : "?", limit: `${system.memoryGb} GB` }) : "?"} />
      <Row icon={Laptop} label={t("orgComputer.os")} value={system ? `${system.os} ${system.arch}` : "?"} detail={name} />
    </dl>
  );
}

function Row({ icon: Icon, label, value, detail }: { icon: typeof Cpu; label: string; value: string; detail?: string | undefined }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-ink-secondary"><Icon size={12} aria-hidden="true" />{label}</dt>
      <dd className="min-w-0 truncate text-ink" title={detail ? `${value} (${detail})` : value}>{value}{detail && <span className="text-ink-secondary"> · {detail}</span>}</dd>
    </>
  );
}
