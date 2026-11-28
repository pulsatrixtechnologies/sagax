// The board window (M-20261127-101, M-20261127-140): a board a bot names
// opens in the record window like a ticket and shows its active tickets.
// On top, four tiles that are quick filters (active, urgent, not scheduled,
// waiting); then the filters All, My tickets, Urgent, Not scheduled, Waiting,
// the owner and the one dynamic filter (M-20261127-139). Three tabs across
// the window: List, one plain grid, never grouped by status (M-20261127-145,
// TicketGrid.tsx); Columns, one column per status; Data, the figures
// (D-20261127-010, BoardData.tsx). A click on a ticket opens it in the same
// window with a way back to the board (M-20261127-101). The tab and the
// filters are kept while the window is open, so coming back from a ticket
// finds the board as it was (agent's choice).
//
// Every row is the console's (the `tickets` section of the detail route);
// the tiles count those rows, never a total the window adds up from amounts.
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DataFilterValue } from "@/components/data/DataFilter";
import { FieldValue, RecordRefChip, useOpenRef, type RecordWindowLayout } from "@/components/RecordCard";
import { MENU_ROW, MENU_ROW_ACTIVE, MENU_SURFACE } from "@/components/menu-look";
import { PillTabs } from "@/components/PillTabs";
import { RECORD_ACTION, RecordPod, RecordWindowTabs, type RecordTab } from "@/components/record-window/RecordBlocks";
import { filterRecordRows, RecordFilter } from "@/components/record-window/RecordGrid";
import { RecordTiles, type RecordTile } from "@/components/record-window/RecordTiles";
import { NextPlanCell, QuietRecordName, OwnerCell, PriorityBar, TicketGrid, ticketColumns } from "@/components/record-window/TicketGrid";
import { dayOf } from "@/components/record-window/ticket/parts";
import type { RecordDetail } from "@/components/useRecordDetail";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { moveMenuFocus } from "@/lib/menu-keys";
import { cn } from "@/lib/cn";
import { activeLocale, formatNumber, t } from "@/lib/i18n";
import type { TicketRow } from "@/lib/record-detail";
import type { RecordCard as Card } from "../../../../shared/record-cards";
import { BoardData } from "./BoardData";

export const BOARD_TABS = ["list", "columns", "data"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
export const BOARD_QUICK = ["all", "mine", "urgent", "unscheduled", "waiting"] as const;
export type BoardQuick = (typeof BOARD_QUICK)[number];
/** Every owner, or nobody's tickets, or one owner's (by `ownerKey`). */
export const OWNER_ALL = "";
export const OWNER_NONE = "none";

/** What the person set in the window: its tab and its filters. */
export interface BoardView {
  tab: BoardTab;
  quick: BoardQuick;
  owner: string;
  filter: DataFilterValue;
}
export const BOARD_VIEW: BoardView = { tab: "list", quick: "all", owner: OWNER_ALL, filter: { text: "" } };

/** An owner, the same person under one key: their record, else their name. */
export function ownerKey(row: Pick<TicketRow, "owner" | "ownerRef">): string {
  if (!row.owner) return OWNER_NONE;
  return row.ownerRef ? `ref:${row.ownerRef.product}/${row.ownerRef.kind}/${row.ownerRef.id}` : `name:${row.owner}`;
}

export function quickPass(row: TicketRow, quick: BoardQuick): boolean {
  switch (quick) {
    case "all": return true;
    case "mine": return row.mine === true;
    case "urgent": return row.level === "urgent";
    case "unscheduled": return row.next?.state === "none";
    case "waiting": return row.statusTone === "waiting";
  }
}

/** The view the rows can answer: a quick filter they carry no field for is All, an owner who has no ticket left is everyone (the menu says so, never an empty list under it). */
export function shownView(rows: readonly TicketRow[], view: BoardView): BoardView {
  const known = boardKnown(rows);
  const owner = view.owner === OWNER_ALL || rows.some((row) => ownerKey(row) === view.owner) ? view.owner : OWNER_ALL;
  return { ...view, quick: known.has(view.quick) ? view.quick : "all", owner };
}

/** The rows the view keeps: its quick filter, its owner, then the words of the one filter. */
export function boardRows(rows: readonly TicketRow[], view: BoardView, now: number, tz?: string): TicketRow[] {
  const kept = rows.filter((row) => quickPass(row, view.quick) && (view.owner === OWNER_ALL || ownerKey(row) === view.owner));
  return filterRecordRows(kept, ticketColumns({ now, tz, company: true }), view.filter);
}

/** The tiles' numbers: rows counted, never amounts added. Urgent "since this morning": entered today in the board's zone. */
export function boardCounts(rows: readonly TicketRow[], now: number, tz?: string) {
  const today = dayOf(new Date(now).toISOString(), "", tz).key;
  return {
    active: rows.length,
    urgent: rows.filter((row) => row.level === "urgent").length,
    urgentToday: rows.filter((row) => row.level === "urgent" && row.opened && dayOf(row.opened, "", tz).key === today).length,
    unscheduled: rows.filter((row) => row.next?.state === "none").length,
    waiting: rows.filter((row) => row.statusTone === "waiting").length,
  };
}

/** The quick filters the console's rows can answer: a field none of them carries is not counted as a 0 (an empty board answers all of them). */
export function boardKnown(rows: readonly TicketRow[]): Set<BoardQuick> {
  const any = (has: (row: TicketRow) => boolean) => !rows.length || rows.some(has);
  return new Set(BOARD_QUICK.filter((quick) => {
    switch (quick) {
      case "all": return true;
      case "mine": return rows.some((row) => row.mine !== undefined);
      case "urgent": return any((row) => row.level !== undefined);
      case "unscheduled": return any((row) => row.next !== undefined);
      case "waiting": return any((row) => row.statusTone !== undefined);
    }
  }));
}

/** The owners of the rows, most tickets first, nobody last. */
export function boardOwners(rows: readonly TicketRow[]): Array<{ key: string; name: string; row: TicketRow; count: number }> {
  const all = new Map<string, { key: string; name: string; row: TicketRow; count: number }>();
  for (const row of rows) {
    const key = ownerKey(row);
    const known = all.get(key);
    if (known) known.count += 1;
    else all.set(key, { key, name: row.owner || t("recordCard.related.unassigned"), row, count: 1 });
  }
  return [...all.values()].sort((a, b) => (a.key === OWNER_NONE ? 1 : b.key === OWNER_NONE ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}

export interface BoardWindowProps {
  card: Card;
  detail: RecordDetail;
  /** the window's type (its columns are kept for it) */
  type: string;
  now: number;
  view?: BoardView;
  onView: (view: BoardView) => void;
}

/** The board's tabs across the window and its body (RecordCard's `window`). */
export function boardWindow(props: BoardWindowProps): RecordWindowLayout {
  const view = props.view ?? BOARD_VIEW;
  const idPrefix = `board-${props.card.id}`;
  const tabs: RecordTab<BoardTab>[] = BOARD_TABS.map((id) => ({ id, label: t(`recordWindow.board.tabs.${id}` as "recordWindow.board.tabs.list"), canAdd: true }));
  return {
    tabs: <RecordWindowTabs tabs={tabs} tab={view.tab} onTab={(tab) => props.onView({ ...view, tab })} label={t("recordWindow.board.tabs.label")} idPrefix={idPrefix} />,
    body: <BoardBody {...props} view={view} idPrefix={idPrefix} />,
  };
}

function OwnerMenu({ owners, value, onChange }: { owners: ReturnType<typeof boardOwners>; value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** a choice or Escape gives the focus back to the button */
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const id = useId();
  usePopoverDismiss(open, root, () => setOpen(false));
  // opened, the chosen owner has the focus; the arrows move between the owners (the app's menu keys)
  useEffect(() => {
    if (open) (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>("[role=menuitemradio]"))?.focus();
  }, [open]);
  const chosen = owners.find((one) => one.key === value);
  const choices = [{ key: OWNER_ALL, name: t("recordWindow.board.quick.all") }, ...owners];
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <button ref={trigger} type="button" className={RECORD_ACTION} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} data-board-owner-menu="">
        {t("recordWindow.board.owner", { owner: chosen?.name ?? t("recordWindow.board.ownerAll") })}<ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <span ref={menu} id={id} role="menu" aria-label={t("recordWindow.tickets.owner")} className={cn(MENU_SURFACE, "absolute start-0 top-full z-20 mt-1 max-h-72 min-w-56 overflow-y-auto")}
          onKeyDown={(event) => { if (menu.current && moveMenuFocus(menu.current, event.key, document.activeElement)) event.preventDefault(); }}>
          {choices.map((choice) => (
            <button key={choice.key} type="button" role="menuitemradio" aria-checked={choice.key === value} className={choice.key === value ? MENU_ROW_ACTIVE : MENU_ROW} data-board-owner={choice.key}
              onClick={() => { close(); onChange(choice.key); }}>
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              {"count" in choice && <span className="tabular-nums text-popover-ink-secondary">{formatNumber(choice.count)}</span>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** One ticket in its status column: its priority's edge, its number, its subject, its company, its next scheduling and its owner. */
function ColumnCard({ row, now, tz }: { row: TicketRow; now: number; tz?: string }) {
  const open = useOpenRef(row.ref);
  return (
    <li className="flex min-w-0 gap-2.5 rounded-lg bg-popover p-3" data-ticket-row={row.id}>
      <PriorityBar row={row} className="h-auto self-stretch" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] tabular-nums text-popover-ink-secondary">{row.number}</span>
        <span className="min-w-0">{row.ref && open ? <RecordRefChip name={row.summary} refTo={row.ref} onOpen={open} /> : <span dir="auto" className="break-words">{row.summary}</span>}</span>
        <QuietRecordName name={row.company ?? ""} recordRef={row.companyRef} />
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1"><NextPlanCell next={row.next} now={now} tz={tz} /></span>
          <OwnerCell name={row.owner} ownerRef={row.ownerRef} />
        </span>
      </span>
    </li>
  );
}

/** One column per status, in the order the console lists the tickets. */
function BoardColumns({ rows, now, tz }: { rows: readonly TicketRow[]; now: number; tz?: string }) {
  const groups: Array<{ status: string; tone: TicketRow["statusTone"]; rows: TicketRow[] }> = [];
  for (const row of rows) {
    const group = groups.find((one) => one.status === row.status);
    if (group) group.rows.push(row);
    else groups.push({ status: row.status, tone: row.statusTone, rows: [row] });
  }
  if (!groups.length) return <p className="py-2 text-popover-ink-secondary" role="status">{t("recordWindow.noMatch")}</p>;
  const lang = activeLocale();
  return (
    <div className="grid min-w-0 auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1" data-board-columns="">
      {groups.map((group) => (
        <RecordPod key={group.status || "none"} data-board-column={group.status}
          title={group.status ? <FieldValue field={{ label: group.status, value: group.status, type: "state", tone: group.tone }} label={t("recordCard.related.status")} now={now} lang={lang} tz={tz} /> : t("recordWindow.board.noStatus")}
          count={group.rows.length}>
          <ul className="flex min-w-0 flex-col gap-2">{group.rows.map((row) => <ColumnCard key={row.id} row={row} now={now} tz={tz} />)}</ul>
        </RecordPod>
      ))}
    </div>
  );
}

function BoardBody({ card, detail, type, now, view, onView, idPrefix }: BoardWindowProps & { view: BoardView; idPrefix: string }) {
  const { want } = detail;
  useEffect(() => { want(["tickets", "stats"]); }, [want]);
  const tickets = detail.section("tickets");
  const statsPage = detail.section("stats").page;
  const stats = statsPage?.stats && !("hours" in statsPage.stats) ? statsPage.stats : statsPage?.stats && "closedThisWeek" in statsPage.stats ? statsPage.stats : undefined;
  const rows = tickets.page?.lines ?? [];
  const tz = card.tz;
  const counts = boardCounts(rows, now, tz);
  const owners = boardOwners(rows);
  const loading = tickets.loading && !tickets.page;
  const set = (patch: Partial<BoardView>) => onView({ ...view, ...patch });
  // a tile and its quick filter only when the console says what they read (never a 0 made of a field it does not send)
  const known = boardKnown(rows);
  const all: RecordTile<BoardQuick>[] = [
    { id: "all", label: t("recordWindow.board.active"), value: formatNumber(counts.active), ...(stats?.closedThisWeek !== undefined ? { detail: t("recordWindow.board.closedThisWeek", { count: formatNumber(stats.closedThisWeek) }) } : {}) },
    { id: "urgent", label: t("recordWindow.board.urgent"), value: formatNumber(counts.urgent), ...(counts.urgentToday ? { detail: t("recordWindow.board.sinceMorning", { count: formatNumber(counts.urgentToday) }), tone: "alert" as const } : {}) },
    { id: "unscheduled", label: t("recordWindow.board.unscheduled"), value: formatNumber(counts.unscheduled), detail: t("recordWindow.board.toDispatch"), tone: "waiting" },
    { id: "waiting", label: t("recordWindow.board.waiting"), value: formatNumber(counts.waiting), detail: t("recordWindow.board.waitingOn") },
  ];
  const tiles = all.filter((tile) => known.has(tile.id));
  const quick = BOARD_QUICK.filter((one) => known.has(one));
  // the quick filters' panel is the list or the columns under them
  const effective = shownView(rows, view);
  const shownQuick = effective.quick;
  const shown = boardRows(rows, effective, now, tz);
  const columns = ticketColumns({ now, tz, company: true });
  return (
    <div className="record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel" id={`${idPrefix}-panel-${view.tab}`} aria-labelledby={`${idPrefix}-tab-${view.tab}`} data-board-tab={view.tab}>
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {/* in Data a tile opens the list with its filter */}
        {tickets.page && <RecordTiles tiles={tiles} selected={view.tab === "data" || shownQuick === "mine" ? undefined : shownQuick} label={t("recordWindow.board.figures")}
          onSelect={(id) => set({ quick: id, ...(view.tab === "data" ? { tab: "list" as const } : {}) })} />}
        {view.tab !== "data" && (
          <div className="flex min-w-0 flex-wrap items-center gap-2" data-board-filters="">
            <PillTabs tabs={quick} tab={shownQuick} onTab={(next) => set({ quick: next })} ariaLabel={t("recordWindow.board.quick")} idPrefix={`${idPrefix}-quick`}
              label={(id) => t(`recordWindow.board.quick.${id}` as "recordWindow.board.quick.all")} tabAttributes={(id) => ({ "data-board-quick": id })} className="gap-y-1" />
            <OwnerMenu owners={owners} value={effective.owner} onChange={(owner) => set({ owner })} />
            <span className="ms-auto flex items-center"><RecordFilter columns={columns} value={view.filter} onChange={(filter) => set({ filter })} shown={shown.length} total={rows.length} /></span>
          </div>
        )}
        {tickets.error ? <p role="status" className="py-2 text-popover-ink-secondary">{tickets.error}</p>
          : loading ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
          : view.tab === "list" ? (
            <div role="tabpanel" id={`${idPrefix}-quick-panel-${shownQuick}`} aria-labelledby={`${idPrefix}-quick-tab-${shownQuick}`}>
              <RecordPod bodyClassName="-my-1" data-board-list="">
                <TicketGrid type={type} grid="board-tickets" label={t("recordWindow.board.tabs.list")} rows={shown} now={now} tz={tz} company filter={false}
                  empty={rows.length ? t("recordWindow.noMatch") : t("recordWindow.board.none")} />
              </RecordPod>
            </div>
          )
          : view.tab === "columns" ? <div role="tabpanel" id={`${idPrefix}-quick-panel-${shownQuick}`} aria-labelledby={`${idPrefix}-quick-tab-${shownQuick}`}><BoardColumns rows={shown} now={now} tz={tz} /></div>
          : <BoardData rows={rows} weeks={detail.section("stats").page?.lines ?? []} stats={stats} owners={owners} now={now} tz={tz} />}
      </div>
    </div>
  );
}
