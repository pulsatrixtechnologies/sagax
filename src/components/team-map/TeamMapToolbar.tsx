import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, Info, Keyboard, Map as MapIcon, Maximize2, Minus, MoreHorizontal, PanelRight, Plus, Search, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "../AnchoredPopover";
import { PAGE_ACTION_BUTTON, PAGE_HEADER_BUTTON, PageSearch, PageSegment } from "../content-page";
import { MENU_BOX, MenuGlyph, menuRow } from "../menu-look";

export type StateFilter = "all" | "working" | "waiting";

const CONTROL = "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 text-[12px] text-ink-secondary";

/** The searchable select for many teams: a button, a search field, the list. */
function TeamSelect({ teams, value, onChange }: { teams: Array<{ key: string; name: string; count: number }>; value: string | null; onChange: (key: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const root = useAnchoredDismissRoot(anchor, popover);
  usePopoverDismiss(open, root, () => setOpen(false));
  const shown = teams.filter((team) => team.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = value === null ? t("teamMap.org.allTeams") : teams.find((team) => team.key === value)?.name ?? t("teamMap.org.allTeams");
  return (
    <>
      <button ref={anchor} type="button" aria-haspopup="listbox" aria-expanded={open} data-team-map-team-filter=""
        onClick={() => { setQuery(""); setOpen((was) => !was); }}
        className={cn(CONTROL, "w-[190px] max-sm:w-[170px]", value !== null && "border-accent/40 text-ink")}>
        <Users size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-left">{current}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <AnchoredPopover anchorRef={anchor} popoverRef={popover} side="bottom" align="start" gap={6} role="listbox" aria-label={t("teamMap.org.allTeams")}
          className={cn(MENU_BOX, "z-[70] flex max-h-[360px] w-[260px] flex-col overflow-hidden p-1.5 text-[13px]")}>
          <label className="mb-1 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-hairline/50 px-2">
            <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("teamMap.org.teamsSearch")} aria-label={t("teamMap.org.teamsSearch")}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {[{ key: "__all", name: t("teamMap.org.allTeams"), count: teams.reduce((n, team) => n + team.count, 0) }, ...shown]
              .filter((team) => team.key === "__all" ? !query.trim() : true)
              .map((team) => {
                const on = (team.key === "__all" && value === null) || team.key === value;
                return (
                  <button key={team.key} type="button" role="option" aria-selected={on} onClick={() => { onChange(team.key === "__all" ? null : team.key); setOpen(false); }}
                    className={menuRow(on ? "active" : "idle")}>
                    <span className="min-w-0 flex-1 truncate">{team.name}</span><span className="text-[11px] text-ink-tertiary">{team.count}</span>{on && <Check size={13} aria-hidden="true" />}
                  </button>
                );
              })}
            {shown.length === 0 && query.trim() && <p className="px-2 py-2 text-[12px] text-ink-secondary">{t("teamMap.org.noTeam")}</p>}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

function Swatch({ dashed, color }: { dashed?: boolean; color: string }) {
  return (
    <svg width="28" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="1.6" strokeDasharray={dashed ? "4 3" : undefined} />
      {dashed ? <circle cx="24" cy="5" r="2.6" fill="var(--color-app)" stroke={color} strokeWidth="1.3" /> : <polygon points="27,5 21,2 21,8" fill={color} />}</svg>
  );
}

/** "...": the legend (with the gesture hint as its tooltip), the minimap, the
 * image export and the keyboard keys. */
function OverflowMenu({ minimap, onMinimap, onExport, onKeyboard }: { minimap: boolean; onMinimap: () => void; onExport: () => void; onKeyboard: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const root = useAnchoredDismissRoot(anchor, popover);
  usePopoverDismiss(open, root, () => setOpen(false));
  const row = (icon: React.ReactNode, label: string, onClick: () => void, extra?: React.ReactNode) => (
    <button type="button" role="menuitem" onClick={() => { onClick(); setOpen(false); }} className={menuRow()}>
      <MenuGlyph>{icon}</MenuGlyph><span className="min-w-0 flex-1 truncate">{label}</span>{extra}
    </button>
  );
  return (
    <>
      <button ref={anchor} type="button" aria-label={t("teamMap.org.more")} aria-haspopup="menu" aria-expanded={open} data-team-map-more="" className={PAGE_HEADER_BUTTON} onClick={() => setOpen((was) => !was)}><MoreHorizontal size={16} /></button>
      {open && (
        <AnchoredPopover anchorRef={anchor} popoverRef={popover} side="bottom" align="end" gap={6} role="menu" aria-label={t("teamMap.org.more")}
          className={cn(MENU_BOX, "z-[70] w-[272px] p-1.5 text-[13px]")}>
          <div title={t("canvas.hint")} className="px-2 pb-1 pt-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-tertiary">{t("teamMap.org.legend")}<Info size={11} aria-hidden="true" /></div>
            <div className="mt-1.5 flex flex-col gap-1.5 text-[12px] text-ink-secondary">
              <span className="flex items-center gap-2"><Swatch color="var(--color-ink-tertiary)" />{t("teamMap.org.legendDelegates")}</span>
              <span className="flex items-center gap-2"><Swatch color="var(--color-ink-tertiary)" dashed />{t("teamMap.org.legendReviews")}</span>
              <span className="flex items-center gap-2"><Swatch color="var(--color-success)" />{t("teamMap.org.legendLive")}</span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">{t("canvas.hint")}</p>
          </div>
          <div className="my-1 h-px bg-hairline/50" role="separator" />
          {row(<MapIcon />, t("teamMap.org.minimap"), onMinimap, minimap ? <Check size={13} aria-hidden="true" /> : null)}
          {row(<Download />, t("teamMap.org.exportImage"), onExport)}
          {row(<Keyboard />, t("teamMap.org.keyboard"), onKeyboard)}
        </AnchoredPopover>
      )}
    </>
  );
}

export function TeamMapToolbar({ query, onQuery, teams, teamFilter, onTeamFilter, stateFilter, onStateFilter, counts, scale, onFit, onZoom, detailOpen, onToggleDetail, minimap, onMinimap, onExport, onKeyboard, compact = false }: {
  query: string;
  onQuery: (next: string) => void;
  teams: Array<{ key: string; name: string; count: number }>;
  teamFilter: string | null;
  onTeamFilter: (key: string | null) => void;
  stateFilter: StateFilter;
  onStateFilter: (next: StateFilter) => void;
  counts: { all: number; working: number; waiting: number };
  scale: number;
  onFit: () => void;
  onZoom: (factor: number) => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  minimap: boolean;
  onMinimap: () => void;
  onExport: () => void;
  onKeyboard: () => void;
  compact?: boolean;
}) {
  return (
    <div data-team-map-toolbar="" className={cn("flex items-center gap-2", compact ? "shrink-0 overflow-x-auto px-4 py-2" : "")}>
      <PageSearch compact value={query} onChange={onQuery} placeholder={t("teamMap.org.search")} label={t("teamMap.org.searchAria")} data-team-map-search="" />
      <TeamSelect teams={teams} value={teamFilter} onChange={onTeamFilter} />
      <PageSegment compact label={t("teamMap.org.stateAria")} value={stateFilter} onChange={onStateFilter} options={[
        { value: "all", label: t("teamMap.org.stateAll", { count: counts.all }) },
        { value: "working", label: t("teamMap.org.stateWorking", { count: counts.working }) },
        { value: "waiting", label: t("teamMap.org.stateWaiting", { count: counts.waiting }) },
      ]} />
      {!compact && (
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={PAGE_ACTION_BUTTON} aria-label={t("canvas.fit")} title={t("canvas.fitHint")} onClick={onFit}><Maximize2 size={14} />{t("teamMap.org.fit")}</button>
          <div className={cn(CONTROL, "gap-1 px-1")}>
            <button type="button" aria-label={t("canvas.zoomOut")} onClick={() => onZoom(1 / 1.2)} className="flex size-7 items-center justify-center rounded-md hover:bg-control hover:text-ink"><Minus size={14} /></button>
            <span className="w-10 text-center tabular-nums text-ink" data-team-map-zoom="">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label={t("canvas.zoomIn")} onClick={() => onZoom(1.2)} className="flex size-7 items-center justify-center rounded-md hover:bg-control hover:text-ink"><Plus size={14} /></button>
          </div>
          <button type="button" aria-label={detailOpen ? t("teamMap.org.detailHide") : t("teamMap.org.detailShow")} aria-pressed={detailOpen} title={detailOpen ? t("teamMap.org.detailHide") : t("teamMap.org.detailShow")}
            onClick={onToggleDetail} className={cn(PAGE_HEADER_BUTTON, detailOpen && "text-ink")}><PanelRight size={16} /></button>
          <OverflowMenu minimap={minimap} onMinimap={onMinimap} onExport={onExport} onKeyboard={onKeyboard} />
        </div>
      )}
      {compact && <OverflowMenu minimap={minimap} onMinimap={onMinimap} onExport={onExport} onKeyboard={onKeyboard} />}
    </div>
  );
}

/** Cmd or Ctrl + F focuses the map's own search while the page is open. */
export function useSearchShortcut() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return;
      const input = document.querySelector<HTMLInputElement>("[data-team-map-search]");
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
