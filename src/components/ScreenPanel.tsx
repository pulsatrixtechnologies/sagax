// The screen side panel (#4452): one column beside the chat for what the
// selected bot is working in. Compact chrome (M-20261127-064): no title
// header band; page tabs (or place chrome) share a row with Detach / Expand /
// Close; the live view fills the rest edge to edge. Browser, VM and remote
// supply the body; artifacts reuse the same chrome via ScreenPanelChrome.
// Every control is the app's own size (M-20261127-179): the chat header's
// round buttons and glyphs, the app's tabs (PillTabs) for the places.
// Mark up draws over the picture only, so its pen, Detach, Expand, Close and
// the bars stay usable while it is on; the pen, Done and Escape end it
// (M-20261127-180).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Globe, Laptop, Monitor, PenLine, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_ICON } from "@/lib/circle-button";
import { activePlace, type ScreenPlace } from "@/lib/screen-places";
import { setScreenPanelOpen, SCREEN_PANEL_DEFAULT_WIDTH, SCREEN_PANEL_MAX_WIDTH, SCREEN_PANEL_MIN_WIDTH, SCREEN_PANEL_WIDTH_KEY } from "@/lib/screen-panel";
import { useStore, type Bot } from "@/state/store";
import { BrowserPanel, type BrowserDescriber } from "./BrowserPanel";
import { ScreenMarksBar, ScreenMarksOverlay, useScreenMarks } from "./ScreenMarks";
import { ControlSwitch, placeControllable, RemotePane, useScreenPlaces, VmPane } from "./ScreenPlaces";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { FOLD_TAB_ICON, FOLD_TAB_LABEL, SCREEN_PANEL_TITLE, SCREEN_PANEL_TOOL, SCREEN_PANEL_TOP_ROW, ScreenBar, ScreenPanelChrome } from "./ScreenPanelChrome";
import { PillTabs } from "./PillTabs";
import { openScreenPanelWindow, useScreenPanelWindow, type ScreenPanelWindow } from "@/lib/screen-panel-window";

const SCREEN_BOUNDS = {
  key: SCREEN_PANEL_WIDTH_KEY,
  min: SCREEN_PANEL_MIN_WIDTH,
  max: SCREEN_PANEL_MAX_WIDTH,
  fallback: SCREEN_PANEL_DEFAULT_WIDTH,
};

const PLACE_ICON: Record<ScreenPlace, LucideIcon> = { browser: Globe, vm: Monitor, remote: Laptop };
const PLACE_TITLE = { browser: "computer.browserOf", vm: "screenPanel.title.vm", remote: "screenPanel.title.remote" } as const;
const PLACE_TAB = { browser: "screenPanel.tab.browser", vm: "screenPanel.tab.vm", remote: "screenPanel.tab.remote" } as const;

/** Extension point for a surface that is not a place (artifacts): same
 * Detach / Expand / Close chrome, body supplied by the caller. */
export type ScreenPanelArtifactSlot = {
  title: string;
  body: ReactNode;
  onDetach?: () => void;
  onExpand?: () => void;
};

/** Escape with focus nowhere (after drawing on the picture, which takes no focus). */
const loose = (target: EventTarget | null) => !(target instanceof Element) || target === document.body || target === document.documentElement;

export function ScreenPanel({ bot, artifact }: { bot: Bot; artifact?: ScreenPanelArtifactSlot | null }) {
  const panel = useDockedPanelWidth(SCREEN_BOUNDS);
  const found = useScreenPlaces(bot);
  const [picked, setPicked] = useState<ScreenPlace | null>(null);
  const place = activePlace(found.places, picked);
  const [control, setControl] = useState(false);
  const title = artifact ? artifact.title : t(PLACE_TITLE[place], { name: bot.name });
  const PlaceIcon = PLACE_ICON[place];
  const { dispatch } = useStore();
  const [marking, setMarking] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const describer = useRef<BrowserDescriber | null>(null);
  const marks = useScreenMarks({ bot, host: body, describer, dispatch, place, onSent: () => setMarking(false) });
  const pick = (next: ScreenPlace) => { setPicked(next); setControl(false); setMarking(false); marks.clear(); };
  // Expand opened this place's own window: the column draws no second live view.
  const opened = useScreenPanelWindow();
  const inWindow = !artifact && opened?.botId === bot.id && opened.kind === place;

  useEffect(() => {
    if (!marking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !loose(event.target)) return;
      event.preventDefault();
      setMarking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking]);

  const close = () => setScreenPanelOpen(false);
  // Detach and Expand open the window of the place on screen, never the
  // browser's for the VM; a place with no window of its own offers neither.
  const placeWindow = (mode: ScreenPanelWindow["mode"]): ScreenPanelWindow =>
    place === "remote" && found.remote ? { botId: bot.id, mode, kind: "remote", remote: found.remote }
    : place === "vm" ? { botId: bot.id, mode, kind: "vm" }
    : { botId: bot.id, mode, kind: "browser" };
  const windowed = place === "browser" || placeControllable(place, found.vm, found.remote);
  const expand = () => {
    if (artifact?.onExpand) { artifact.onExpand(); return; }
    setMarking(false);
    openScreenPanelWindow(placeWindow("expand"));
  };
  const detach = () => {
    if (artifact?.onDetach) { artifact.onDetach(); return; }
    openScreenPanelWindow(placeWindow("detach"));
    setScreenPanelOpen(false);
  };

  const marksToggle = !artifact && !inWindow ? (
    <button type="button" data-screen-panel-marks="" aria-pressed={marking} onClick={() => setMarking((on) => !on)}
      aria-label={t("screenMarks.toggle")} title={t("screenMarks.toggle")}
      className={cn(SCREEN_PANEL_TOOL, marking && "ring-2 ring-accent/60")}>
      <PenLine {...CIRCLE_ICON} aria-hidden="true" />
    </button>
  ) : null;

  const chrome = (
    <ScreenPanelChrome
      title={title}
      onClose={close}
      onDetach={artifact ? artifact.onDetach : windowed ? detach : undefined}
      onExpand={artifact ? artifact.onExpand : windowed ? expand : undefined}
      leading={marksToggle}
      trailing={place !== "browser" && !artifact && !inWindow && placeControllable(place, found.vm, found.remote)
        ? <ControlSwitch control={control} onChange={setControl} />
        : undefined}
    />
  );

  // One tab list for the places, in the browser's address row and in the VM
  // and remote top row alike: the app's tabs; while their row cannot hold
  // the labels (ScreenBar), each shows its place's icon instead.
  const placeTabs = !artifact && found.places.length > 1 ? (
    <PillTabs tabs={found.places} tab={place} onTab={pick} ariaLabel={t("screenPanel.tabs")} idPrefix="screen-panel"
      label={(id) => {
        const Icon = PLACE_ICON[id];
        return <span className="inline-flex h-[18px] items-center align-top" title={t(PLACE_TAB[id])}><Icon size={16} strokeWidth={1.75} aria-hidden="true" className={FOLD_TAB_ICON} /><span className={FOLD_TAB_LABEL}>{t(PLACE_TAB[id])}</span></span>;
      }}
      tabAttributes={(id) => ({ "data-screen-tab": id })}
      data-screen-place-select="" className="shrink-0 flex-nowrap" />
  ) : null;

  const overlay = marking && !artifact ? <ScreenMarksOverlay marks={marks} /> : null;

  return (
    <aside
      data-screen-panel=""
      data-screen-place={artifact ? "artifact" : place}
      data-screen-compact=""
      aria-label={t("screenPanel.aria", { name: bot.name })}
      style={{ width: panel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-pane-edge bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        // An open menu or dialog closes itself first.
        if (target.closest("[role=menu], [role=dialog], details[open]")) return;
        // Escape ends marking up before it closes anything, from the note too.
        if (marking) { event.preventDefault(); setMarking(false); return; }
        if (target.closest("textarea, input, select")) return;
        setScreenPanelOpen(false);
      }}
    >
      <DockedPanelResizeHandle label={t("screenPanel.resize")} panel={panel} />
      <div ref={body} data-screen-panel-body="" className="relative flex min-h-0 flex-1 flex-col">
        {artifact ? (
          <>
            <div data-screen-panel-tabs="" className={SCREEN_PANEL_TOP_ROW}>
              <span dir="auto" className={SCREEN_PANEL_TITLE} title={artifact.title}>{artifact.title}</span>
              {chrome}
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{artifact.body}</div>
          </>
        ) : place === "browser" && !inWindow ? (
          <BrowserPanel
            key={bot.id}
            bot={bot}
            live
            onDescriber={(describe) => { describer.current = describe; }}
            docked={{
              title,
              chrome,
              placeSelector: placeTabs,
              stageOverlay: overlay,
            }}
          />
        ) : (
          <>
            <ScreenBar data-screen-panel-tabs="" min={120} className={SCREEN_PANEL_TOP_ROW}>
              <PlaceIcon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
              <span dir="auto" data-screen-bar-flex="" className={SCREEN_PANEL_TITLE} title={title}>{title}</span>
              {placeTabs}
              {chrome}
            </ScreenBar>
            {inWindow ? (
              <div role="status" data-screen-in-window="" className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-[12px] text-ink-secondary">{t("sandboxDesktop.inWindow")}</div>
            ) : (
              <div data-screen-stage="" className="relative flex min-h-0 flex-1 flex-col">
                {place === "vm" && found.vm && <VmPane source={found.vm} control={control} host={body} />}
                {place === "remote" && found.remote && <RemotePane botId={bot.id} view={found.remote} control={control} host={body} />}
                {overlay}
              </div>
            )}
          </>
        )}
      </div>
      {marking && !artifact && !inWindow && <ScreenMarksBar marks={marks} onDone={() => setMarking(false)} />}
    </aside>
  );
}
