// A record window's lists (M-20261127-139, M-20261127-125), shared by every
// kind and plugin (D-20261127-009):
//
// - One dynamic filter, the app's own (DataFilter of the Data window: pick a
//   column or all of them, then the words it contains); never a checkbox
//   column, never a row of filters under the heads.
// - `RecordGrid`: a table whose columns move (drag a head onto another, or
//   Alt with an arrow key on a focused head) and resize (drag a head's right
//   edge, the arrow keys on it), kept per person and per type of window.
// - `RecordList`: rows of any shape under the same filter.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { DataFilter, type DataFilterValue } from "@/components/data/DataFilter";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { keepRecordGrid, useRecordWindow, type RecordGridKept } from "@/lib/record-window-layout";

export interface RecordColumn<R> {
  id: string;
  label: string;
  /** the words the filter reads */
  text: (row: R) => string;
  /** what the cell shows (absent: its words) */
  cell?: (row: R) => ReactNode;
  /** how the filter names the column's kind (its icon) */
  kind?: "text" | "number" | "date";
  /** the default width, in px */
  width?: number;
  /** a column that stays at its place and size (the row's actions) */
  fixed?: boolean;
  className?: string;
}

const COLUMN_LEAST = 64;
const KEY_STEP = 24;

const TYPE: Record<NonNullable<RecordColumn<unknown>["kind"]>, string> = { text: "VARCHAR", number: "DOUBLE", date: "TIMESTAMP" };

/** The rows the filter keeps: every column, or the one chosen, holding the words (case and accents aside). */
export function filterRecordRows<R>(rows: readonly R[], columns: readonly RecordColumn<R>[], value: DataFilterValue): R[] {
  const words = fold(value.text.trim());
  if (!words) return [...rows];
  const read = value.column ? columns.filter((column) => column.label === value.column) : columns;
  return rows.filter((row) => read.some((column) => fold(column.text(row)).includes(words)));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** The filter, and how many rows it keeps of how many. */
export function RecordFilter<R>({ columns, value, onChange, shown, total }: {
  columns: readonly RecordColumn<R>[];
  value: DataFilterValue;
  onChange: (value: DataFilterValue) => void;
  shown: number;
  total: number;
}) {
  const named = useMemo(() => columns.filter((column) => !column.fixed).map((column) => ({ name: column.label, type: TYPE[column.kind ?? "text"] })), [columns]);
  return (
    <div className="flex min-w-0 items-center gap-2" data-record-filter="">
      <DataFilter columns={named} value={value} onChange={onChange} />
      {value.text.trim() && <span className="text-[13px] leading-[18px] text-popover-ink-secondary" data-record-filter-count="">{t("recordWindow.filtered", { shown, total })}</span>}
    </div>
  );
}

/** The columns in the person's order, at their widths (a kept order loses the ids the table no longer has and gains the new ones at its end). */
export function orderedColumns<R>(columns: readonly RecordColumn<R>[], kept: RecordGridKept | undefined): RecordColumn<R>[] {
  const movable = columns.filter((column) => !column.fixed);
  const order = kept?.order ?? [];
  const placed = order.map((id) => movable.find((column) => column.id === id)).filter((column): column is RecordColumn<R> => Boolean(column));
  return [...placed, ...movable.filter((column) => !placed.includes(column)), ...columns.filter((column) => column.fixed)];
}

export function RecordGrid<R>({ type, grid, columns, rows, rowKey, rowAttributes, toolbar, empty, filter = true, label }: {
  /** the window's type and the table's id: its columns are kept for them */
  type: string;
  grid: string;
  columns: readonly RecordColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  rowAttributes?: (row: R) => Record<`data-${string}`, string | undefined> & { className?: string };
  /** beside the filter, at the right; given the rows the filter keeps, for an action on them (an export) */
  toolbar?: ReactNode | ((visible: readonly R[]) => ReactNode);
  empty?: ReactNode;
  filter?: boolean;
  label: string;
}) {
  const kept = useRecordWindow(type).grids?.[grid];
  const [value, setValue] = useState<DataFilterValue>({ text: "" });
  const [over, setOver] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, number>>({});
  const moving = useRef<string | null>(null);
  const resize = useRef<{ id: string; pointer: number; x: number; start: number; last: number } | null>(null);
  const shownColumns = orderedColumns(columns, kept);
  const widthOf = (column: RecordColumn<R>) => live[column.id] ?? kept?.widths?.[column.id] ?? column.width;
  const currentGrid = (): RecordGridKept => ({ order: shownColumns.filter((column) => !column.fixed).map((column) => column.id), widths: { ...kept?.widths } });
  const move = (id: string, to: string | number) => {
    const order = shownColumns.filter((column) => !column.fixed).map((column) => column.id);
    const from = order.indexOf(id);
    const target = typeof to === "number" ? Math.max(0, Math.min(order.length - 1, to)) : order.indexOf(to);
    if (from < 0 || target < 0 || from === target) return;
    order.splice(from, 1);
    order.splice(target, 0, id);
    keepRecordGrid(type, grid, { ...currentGrid(), order });
  };
  const setWidth = (id: string, width: number) => keepRecordGrid(type, grid, { ...currentGrid(), widths: { ...kept?.widths, [id]: Math.max(COLUMN_LEAST, Math.round(width)) } });
  const visible = filter ? filterRecordRows(rows, columns, value) : [...rows];
  const tools = typeof toolbar === "function" ? toolbar(visible) : toolbar;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-record-grid={grid}>
      {(filter || tools) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {filter && <RecordFilter columns={columns} value={value} onChange={setValue} shown={visible.length} total={rows.length} />}
          {tools && <span className="ms-auto flex flex-wrap items-center gap-1.5">{tools}</span>}
        </div>
      )}
      {visible.length ? (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-full table-fixed border-collapse text-start text-[14px] leading-5" aria-label={label}>
            <colgroup>{shownColumns.map((column) => <col key={column.id} style={widthOf(column) ? { width: widthOf(column) } : undefined} />)}</colgroup>
            <thead>
              <tr>
                {shownColumns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    data-record-column={column.id}
                    data-over={over === column.id ? "" : undefined}
                    draggable={!column.fixed}
                    tabIndex={column.fixed ? undefined : 0}
                    title={column.fixed ? undefined : t("recordWindow.columnHint")}
                    className={cn("relative select-none pb-2 pe-3 pt-1 text-start align-bottom text-[13px] font-normal leading-[18px] text-popover-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus data-[over]:shadow-[inset_2px_0_0_var(--color-accent)]", !column.fixed && "cursor-grab", column.className)}
                    onDragStart={(event) => { moving.current = column.id; event.dataTransfer?.setData("text/plain", column.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(event) => { if (!moving.current || column.fixed) return; event.preventDefault(); setOver(column.id); }}
                    onDragLeave={() => setOver((now) => (now === column.id ? null : now))}
                    onDrop={(event) => { event.preventDefault(); const id = moving.current; moving.current = null; setOver(null); if (id) move(id, column.id); }}
                    onDragEnd={() => { moving.current = null; setOver(null); }}
                    onKeyDown={(event) => {
                      if (column.fixed || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                      event.preventDefault();
                      const index = shownColumns.indexOf(column);
                      move(column.id, index + (event.key === "ArrowLeft" ? -1 : 1));
                    }}
                  >
                    <span className="block truncate">{column.label}</span>
                    {!column.fixed && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t("recordWindow.columnWidth", { column: column.label })}
                        tabIndex={0}
                        draggable={false}
                        data-record-column-grip=""
                        className="absolute -end-1 bottom-1 top-1 z-[1] w-2 cursor-col-resize after:absolute after:inset-y-0 after:start-[3px] after:w-0.5 after:rounded-sm hover:after:bg-accent/55 focus-visible:outline-none focus-visible:after:bg-accent/55"
                        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        onPointerDown={(event) => {
                          if (event.button > 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const cell = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect().width ?? widthOf(column) ?? 120;
                          resize.current = { id: column.id, pointer: event.pointerId, x: event.clientX, start: cell, last: cell };
                          event.currentTarget.setPointerCapture?.(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                          const from = resize.current;
                          if (!from || from.pointer !== event.pointerId) return;
                          from.last = Math.max(COLUMN_LEAST, from.start + event.clientX - from.x);
                          setLive({ [from.id]: from.last });
                        }}
                        onPointerUp={(event) => {
                          const from = resize.current;
                          if (!from || from.pointer !== event.pointerId) return;
                          resize.current = null;
                          if (from.last !== from.start) setWidth(from.id, from.last);
                          setLive({});
                        }}
                        onKeyDown={(event) => {
                          const step = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
                          if (!step) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const cell = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect().width || widthOf(column) || 120;
                          setWidth(column.id, cell + step);
                        }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const { className, ...attributes } = rowAttributes?.(row) ?? {};
                return (
                  <tr key={rowKey(row)} className={cn("border-t border-popover-hairline", className)} {...attributes}>
                    {shownColumns.map((column) => (
                      <td key={column.id} className={cn("break-words py-2.5 pe-3 align-middle", column.className)}>{column.cell ? column.cell(row) : column.text(row)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-2 text-popover-ink-secondary" role="status">{rows.length ? t("recordWindow.noMatch") : empty ?? t("recordCard.related.empty")}</p>
      )}
    </div>
  );
}

/** How a list lays its entries: rows parted by a hairline, blocks one under the other, or blocks side by side. */
const LIST_LAYOUT = {
  rows: { list: "flex min-w-0 flex-col divide-y divide-popover-hairline", item: "flex min-w-0 items-center gap-3 py-2.5" },
  stack: { list: "flex min-w-0 flex-col gap-2.5", item: "flex min-w-0 flex-col gap-2 rounded-xl bg-popover-field p-3.5" },
  cards: { list: "grid min-w-0 grid-cols-1 gap-3 @min-[40rem]:grid-cols-2 @min-[64rem]:grid-cols-3 @min-[84rem]:grid-cols-4", item: "flex min-w-0 flex-col gap-2.5 rounded-xl bg-popover-field p-4" },
} as const;

/** Entries of any shape under the one filter (a ticket's attachments, its configurations; a company's contacts as cards). */
export function RecordList<R>({ columns, rows, rowKey, row, toolbar, empty, label, layout = "rows" }: {
  columns: readonly RecordColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  row: (row: R) => ReactNode;
  toolbar?: ReactNode;
  empty?: ReactNode;
  label: string;
  layout?: keyof typeof LIST_LAYOUT;
}) {
  const [value, setValue] = useState<DataFilterValue>({ text: "" });
  const kept = filterRecordRows(rows, columns, value);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-record-list="">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {rows.length > 0 && <RecordFilter columns={columns} value={value} onChange={setValue} shown={kept.length} total={rows.length} />}
        {toolbar && <span className="ms-auto flex flex-wrap items-center gap-1.5">{toolbar}</span>}
      </div>
      {kept.length ? (
        <ul className={LIST_LAYOUT[layout].list} aria-label={label}>
          {kept.map((one) => <li key={rowKey(one)} className={LIST_LAYOUT[layout].item}>{row(one)}</li>)}
        </ul>
      ) : (
        <p className="py-2 text-popover-ink-secondary" role="status">{rows.length ? t("recordWindow.noMatch") : empty ?? t("recordCard.related.empty")}</p>
      )}
    </div>
  );
}
