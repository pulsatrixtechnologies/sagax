// Hibou 98: the late-90s window chrome around the app. Loaded only while the
// retro98 skin is worn (RetroChromeHost). It draws, from scratch: a navy title
// bar with the app name and the open bot, a menu bar whose drop-downs run the
// app's real actions, a flat toolbar with small pixel icons, and a status bar
// of sunken panes. It also tags a few surfaces the stylesheet cannot find on
// its own (a dialog's title, its close box, the Send button) so the skin can
// draw them as 98 dialogs. Nothing here exists under any other skin.
import "../retro-assistant/retro-assistant.css";
import "./retro-chrome.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { brand } from "@/lib/brand";
import { APP_FULL_NAME, APP_NAME } from "@/lib/app-links";
import { usageChip } from "@/lib/usage";
import { readRetroEnabled, retroSignal, setRetroEnabled } from "@/lib/retro98";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { OwlFaceIcon } from "../retro-assistant/RetroArt";
import { PulsatrixMark } from "../PulsatrixMark";
import { Win98Button, Win98Window } from "../retro-assistant/Win98";
import { PixelIcon, type PixelIconName } from "./pixel-icons";
import { decorateRetroSurfaces } from "./decorate";

type MenuEntry =
  | { id: string; label: string; hint?: string; checked?: boolean; disabled?: boolean; run: () => void }
  | { id: string; separator: true };

type MenuId = "file" | "edit" | "view" | "bots" | "help";

/** Clicks a control the app already renders, by its accessible name. */
function clickByLabel(label: string, scope: ParentNode = document): boolean {
  const target = [...scope.querySelectorAll<HTMLElement>("button[aria-label]")].find((node) => node.getAttribute("aria-label") === label);
  if (!target) return false;
  target.click();
  return true;
}

/** The command palette listens for Cmd/Ctrl+K on the window. */
function openPalette(): void {
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true }));
}

export function RetroTop({ onNewBot }: { onNewBot?: () => void }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const [open, setOpen] = useState<MenuId | null>(null);
  const [about, setAbout] = useState(false);
  const [assistantOn, setAssistantOn] = useState(readRetroEnabled);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => decorateRetroSurfaces(), []);
  useEffect(() => {
    const sync = () => setAssistantOn(readRetroEnabled());
    window.addEventListener("omb:retro98-toggle", sync);
    return () => window.removeEventListener("omb:retro98-toggle", sync);
  }, []);

  const bot = state.bots.find((item) => item.id === state.selectedId);
  const group = state.groups.find((item) => item.id === state.selectedId);
  const openName = group?.name ?? bot?.name;
  const appName = brand().name;
  const macInset = capabilities.windowChrome === "mac-inset";
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  const controls = ogb?.windowControls;
  // Windows' frameless shell and a plain browser tab get drawn caption boxes;
  // macOS keeps its traffic lights and Linux its native frame.
  const drawCaption = Boolean(controls) || !ogb;

  const menus = useMemo<Array<{ id: MenuId; label: string; items: MenuEntry[] }>>(() => {
    const visibleBots = state.bots.filter((item) => !item.hidden);
    return [
      {
        id: "file",
        label: t("retro.chrome.file"),
        items: [
          { id: "newBot", label: t("retro.cmd.newBot"), hint: "", run: () => dispatch({ type: "toggleNewBot", open: true }) },
          ...(onNewBot ? [{ id: "newMessage", label: t("retro.cmd.newMessage"), hint: "Ctrl+N", run: onNewBot }] : []),
          { id: "s1", separator: true },
          { id: "export", label: t("retro.cmd.export"), disabled: !bot, run: () => void clickByLabel("Export conversation") },
          { id: "s2", separator: true },
          { id: "settings", label: t("retro.cmd.settings"), run: () => dispatch({ type: "toggleAppSettings", open: true }) },
          { id: "s3", separator: true },
          { id: "quit98", label: t("retro.cmd.quit98"), run: () => setRetroEnabled(false) },
        ],
      },
      {
        id: "edit",
        label: t("retro.chrome.edit"),
        items: [
          { id: "search", label: t("retro.cmd.search"), run: () => void clickByLabel(t("sidebar.searchAria")) },
          { id: "palette", label: t("retro.cmd.palette"), hint: "Ctrl+K", run: openPalette },
        ],
      },
      {
        id: "view",
        label: t("retro.chrome.view"),
        items: [
          { id: "panel", label: t("retro.cmd.sidePanel"), checked: state.settingsOpen, disabled: !bot, run: () => dispatch({ type: "toggleSettings" }) },
          { id: "inspector", label: t("retro.cmd.inspector"), checked: state.inspectorOpen, disabled: !bot, run: () => dispatch({ type: "toggleInspector" }) },
          { id: "s1", separator: true },
          { id: "routines", label: t("sidebar.nav.automations"), run: () => dispatch({ type: "showRoutines" }) },
          { id: "teamMap", label: t("sidebar.nav.teamMap"), run: () => dispatch({ type: "showTeamMap" }) },
          { id: "apps", label: t("sidebar.nav.connectedApps"), run: () => dispatch({ type: "togglePlugins", open: true }) },
          { id: "s2", separator: true },
          { id: "appearance", label: t("retro.cmd.appearance"), run: () => dispatch({ type: "toggleAppSettings", open: true, section: "appearance" }) },
        ],
      },
      {
        id: "bots",
        label: t("retro.chrome.bots"),
        items: [
          ...visibleBots.slice(0, 12).map((item, index) => ({
            id: `bot:${item.id}`,
            label: item.name,
            hint: index < 9 ? `Ctrl+${index + 1}` : undefined,
            checked: state.activeView === "chat" && item.id === state.selectedId,
            run: () => dispatch({ type: "select", id: item.id }),
          })),
          ...(visibleBots.length ? [{ id: "s1", separator: true as const }] : []),
          { id: "newBot", label: t("retro.cmd.newBot"), run: () => dispatch({ type: "toggleNewBot", open: true }) },
          { id: "profile", label: t("retro.cmd.profile"), disabled: !bot, run: () => dispatch({ type: "toggleSettings", open: true }) },
        ],
      },
      {
        id: "help",
        label: t("retro.chrome.help"),
        items: [
          { id: "tip", label: t("retro.cmd.tip"), run: () => { if (!readRetroEnabled()) setRetroEnabled(true); else retroSignal("tip"); } },
          { id: "gallery", label: t("retro.cmd.gallery"), run: () => { if (!readRetroEnabled()) setRetroEnabled(true); else retroSignal("gallery"); } },
          { id: "assistant", label: assistantOn ? t("retro.cmd.hideAssistant") : t("retro.cmd.showAssistant"), run: () => setRetroEnabled(!assistantOn) },
          { id: "shortcuts", label: t("retro.cmd.shortcuts"), hint: "Ctrl+/", run: () => dispatch({ type: "toggleShortcuts", open: true }) },
          { id: "s1", separator: true },
          { id: "about", label: t("retro.cmd.about", { app: appName }), run: () => setAbout(true) },
        ],
      },
    ];
  }, [appName, assistantOn, bot, dispatch, onNewBot, state.activeView, state.bots, state.config, state.inspectorOpen, state.selectedId, state.settingsOpen]);

  const toolbar: Array<{ id: string; icon: PixelIconName; label: string; pressed?: boolean; disabled?: boolean; run: () => void } | { id: string; sep: true }> = [
    { id: "newBot", icon: "newBot", label: t("retro.cmd.newBot"), run: () => dispatch({ type: "toggleNewBot", open: true }) },
    { id: "search", icon: "search", label: t("retro.cmd.search"), run: () => void clickByLabel(t("sidebar.searchAria")) },
    { id: "sep1", sep: true },
    { id: "export", icon: "share", label: t("retro.cmd.export"), disabled: !bot, run: () => void clickByLabel("Export conversation") },
    { id: "inspector", icon: "bug", label: t("retro.cmd.inspector"), pressed: state.inspectorOpen, disabled: !bot, run: () => dispatch({ type: "toggleInspector" }) },
    { id: "sep2", sep: true },
    { id: "panel", icon: "panel", label: t("retro.cmd.sidePanel"), pressed: state.settingsOpen, disabled: !bot, run: () => dispatch({ type: "toggleSettings" }) },
    { id: "settings", icon: "settings", label: t("retro.cmd.settings"), run: () => dispatch({ type: "toggleAppSettings", open: true }) },
  ];

  // Close an open menu on an outside press or Escape.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = useCallback((entry: MenuEntry) => {
    if ("separator" in entry || entry.disabled) return;
    setOpen(null);
    entry.run();
  }, []);

  const onMenubarKey = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const ids = menus.map((menu) => menu.id);
    const at = open ? ids.indexOf(open) : 0;
    const next = ids[(at + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    if (open) setOpen(next);
    bar.current?.querySelector<HTMLElement>(`[data-r98-menu="${next}"]`)?.focus();
  };

  return (
    <div className="r98w-top" data-r98-chrome="">
      <div className={cn("r98w-titlebar", macInset && "r98w-titlebar-mac")}>
        {!macInset && <span className="r98w-titlebar-icon" aria-hidden="true"><PulsatrixMark size={16} ground="dark" /></span>}
        <span className="r98w-titlebar-text">{openName ? `${appName} - ${openName}` : appName}</span>
        {drawCaption && (
          <span className="r98w-caption">
            <button type="button" className="r98w-caption-btn r98w-min" aria-label={t("retro.caption.minimize")} tabIndex={-1} onClick={() => void controls?.minimize()} />
            <button type="button" className="r98w-caption-btn r98w-max" aria-label={t("retro.caption.maximize")} tabIndex={-1} onClick={() => void controls?.toggleMaximize()} />
            <button type="button" className="r98w-caption-btn r98w-close" aria-label={t("retro.caption.close")} tabIndex={-1} onClick={() => void controls?.close()} />
          </span>
        )}
      </div>
      <div ref={bar} className="r98w-menubar" role="menubar" aria-label={t("retro.chrome.menubar")} onKeyDown={onMenubarKey}>
        {menus.map((menu) => (
          <div key={menu.id} className="r98w-menu-slot">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === menu.id}
              data-r98-menu={menu.id}
              className={cn("r98w-menubar-item", open === menu.id && "r98w-open")}
              onClick={() => setOpen((current) => (current === menu.id ? null : menu.id))}
              onPointerEnter={() => setOpen((current) => (current && current !== menu.id ? menu.id : current))}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen(menu.id);
                }
              }}
            >
              <Mnemonic label={menu.label} />
            </button>
            {open === menu.id && <Dropdown items={menu.items} onRun={run} onClose={() => setOpen(null)} />}
          </div>
        ))}
      </div>
      <div className="r98w-toolbar" role="toolbar" aria-label={t("retro.chrome.toolbar")}>
        {toolbar.map((item) =>
          "sep" in item ? (
            <span key={item.id} className="r98w-tool-sep" aria-hidden="true" />
          ) : (
            <button
              key={item.id}
              type="button"
              className="r98w-tool"
              title={item.label}
              aria-label={item.label}
              aria-pressed={item.pressed === undefined ? undefined : item.pressed}
              disabled={item.disabled}
              onClick={item.run}
            >
              <PixelIcon name={item.icon} />
            </button>
          ),
        )}
      </div>
      {about && <AboutDialog appName={appName} onClose={() => setAbout(false)} />}
    </div>
  );
}

/** The first letter underlined, the way menu access keys were shown. */
function Mnemonic({ label }: { label: string }) {
  return (
    <>
      <span className="r98w-mnemonic">{label.slice(0, 1)}</span>
      {label.slice(1)}
    </>
  );
}

function Dropdown({ items, onRun, onClose }: { items: MenuEntry[]; onRun: (entry: MenuEntry) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true]), [role=menuitemcheckbox]:not([aria-disabled=true])")?.focus();
  }, []);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>("[data-r98-item]:not([aria-disabled=true])") ?? [])];
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div ref={ref} className="r98w-dropdown" role="menu" onKeyDown={onKeyDown}>
      {items.map((entry) =>
        "separator" in entry ? (
          <div key={entry.id} className="r98w-dropdown-sep" role="separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            data-r98-item=""
            role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={entry.checked === undefined ? undefined : entry.checked}
            aria-disabled={entry.disabled || undefined}
            className="r98w-dropdown-item"
            onClick={() => onRun(entry)}
          >
            <span className="r98w-check" aria-hidden="true">{entry.checked ? <CheckMark /> : null}</span>
            <span className="r98w-dropdown-label">{entry.label}</span>
            <span className="r98w-dropdown-hint">{entry.hint ?? ""}</span>
          </button>
        ),
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 7 7" width="7" height="7" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M7 0H6v1H5v1H4v1H3v1H2V3H1V2H0v3h1v1h1v1h1V6h1V5h1V4h1V3h1V0z" fill="currentColor" />
    </svg>
  );
}

function AboutDialog({ appName, onClose }: { appName: string; onClose: () => void }) {
  return (
    <div className="r98-root">
      <Win98Window title={t("retro.cmd.about", { app: appName })} onClose={onClose} icon={<OwlFaceIcon />} width={340}>
        <div className="r98w-about">
          <span className="r98w-about-icon" aria-hidden="true"><PixelIcon name="newBot" scale={2} /></span>
          <div>
            {/* the default brand gets its full name; a white-label keeps its own */}
            <p><strong>{appName === APP_NAME ? APP_FULL_NAME : appName}</strong></p>
            <p>{t("retro.about.edition")}</p>
            <p>{t("retro.about.body")}</p>
          </div>
        </div>
        <div className="r98-row">
          <Win98Button className="r98-default" onClick={onClose}>{t("retro.button.ok")}</Win98Button>
        </div>
      </Win98Window>
    </div>
  );
}

/** The window's bottom edge: sunken panes for status, model and spend. */
export function RetroStatusBar() {
  const { state } = useStore();
  const bot = state.bots.find((item) => item.id === state.selectedId);
  const usage = bot?.tasks?.find((task) => task.threadId === bot.threadId)?.usage;
  const cost = usage ? usageChip(usage) : "";
  const [model, setModel] = useState("");
  // The composer's model picker already knows the friendly name (a hidden
  // data-composer-model since the chip moved into the + menu); read it
  // rather than re-deriving the engine catalog here.
  useEffect(() => {
    const read = () => setModel(document.querySelector('[data-app-shell] main [data-composer-model]')?.getAttribute("data-composer-model")?.trim() ?? "");
    read();
    const tick = setInterval(read, 1500);
    return () => clearInterval(tick);
  }, []);
  const busy = state.bots.filter((item) => item.busy);
  let status: ReactNode = t("retro.status.ready");
  if (!state.connected) status = t("retro.status.offline");
  else if (busy.length === 1) status = t("retro.status.working", { name: busy[0].name });
  else if (busy.length > 1) status = t("retro.status.workingMany", { count: busy.length });
  return (
    <div className="r98w-status" role="status" data-r98-chrome="">
      <span className="r98w-status-field r98w-status-main">
        <span className={cn("r98w-led", state.connected ? "r98w-led-on" : "r98w-led-off")} aria-hidden="true" />
        {status}
      </span>
      <span className="r98w-status-field r98w-status-model" title={t("retro.status.model")}>{model || "-"}</span>
      <span className="r98w-status-field r98w-status-cost" title={t("retro.status.cost")}>{cost || "$0.00"}</span>
    </div>
  );
}

export type { MenuEntry };
