// The inside of a widget's card, under its header: a Card stacks its children
// to the mock's rhythm, a ListView draws its rows and folds the ones past
// `limit` behind "Show all". A ListView with a `name` is one choice: its
// rows are a radio group.
import { Fragment, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { useWidgetForm } from "./WidgetControls";
import { SheetKey, sheetKey } from "../QuestionSheet";
import { WIDGET_ROW, WIDGET_ROW_CONTROLS, WidgetListRow, WidgetNodeView } from "./WidgetNodes";
import { ALIGN, fourSides, kids } from "./widget-style";

/** Rows that bring their own height (44px) and are parted by a rule, not by room. */
const isRow = (node: WidgetNode | undefined): boolean => node?.type === "Row" || node?.type === "Checkbox";
/** Rows of any kind sit closer to the card's edge than text does. */
const isRows = (node: WidgetNode | undefined): boolean => isRow(node) || node?.type === "ListViewItem";

/** The room between two children of a card. A Divider carries its own. */
function roomBetween(above: WidgetNode | undefined, below: WidgetNode | undefined): number {
  if (!above || !below || above.type === "Divider" || below.type === "Divider") return 0;
  return isRow(above) && isRow(below) ? 0 : 12;
}

export function WidgetBody({ root, headed }: { root: WidgetNode; headed: boolean }) {
  const children = kids(root);
  if (root.type === "ListView") return <ListBody root={root} items={children} headed={headed} />;
  if (!children.length) return null;
  // 16 at the sides, as on every ask in the chat (AskCard). Under a header the header's own foot is the
  // room above; without one, rows start 6 from the edge and anything else 16.
  const [top, right, bottom, left] = fourSides(root.padding)
    ?? [headed ? 0 : isRows(children[0]) ? 6 : 16, 16, isRows(children[children.length - 1]) ? 6 : 16, 16];
  return (
    <div className="flex min-w-0 flex-col" style={{ padding: `${top}px ${right}px ${bottom}px ${left}px` }}>
      {children.map((child, index) => {
        const room = roomBetween(children[index - 1], child);
        return (
          <Fragment key={child.id ?? index}>
            {room > 0 && <div aria-hidden="true" className="shrink-0" style={{ height: room }} />}
            <WidgetNodeView
              node={child}
              where={{
                axis: "col",
                gap: roomBetween(child, children[index + 1]),
                card: { top: index === 0 ? top : 0, left, right },
                room: [isRow(children[index - 1]) ? 0 : 12, isRow(children[index + 1]) ? 0 : 12],
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function ListBody({ root, items, headed }: { root: WidgetNode; items: WidgetNode[]; headed: boolean }) {
  const [all, setAll] = useState(false);
  const form = useWidgetForm();
  const limit = widgetNumber(root, "limit");
  const name = widgetString(root, "name");
  // a chosen row is never left behind the fold: a list that holds one past its limit opens whole
  const chosenAt = name ? items.findIndex((item) => item.value === form.values[name]) : -1;
  const shown = limit && !all && items.length > limit && chosenAt < limit ? items.slice(0, limit) : items;
  if (!items.length) return null;
  return (
    <div className={cn("flex min-w-0 flex-col px-2 pb-2", !headed && "pt-2")}>
      {name ? <ChoiceRows rows={shown} name={name} required={root.required === true} /> : (
        <div role="list" className="flex min-w-0 flex-col">
          {shown.map((item, index) => (
            <div role="listitem" key={item.id ?? index} className="flex min-w-0">
              {item.type === "ListViewItem" ? <WidgetListRow node={item} /> : <WidgetNodeView node={item} where={{ axis: "col", gap: 0 }} />}
            </div>
          ))}
        </div>
      )}
      {shown.length < items.length && (
        // unfolding is the reader's own: it works on a settled, read-only card too
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-11 w-full items-center rounded-[12px] px-3 text-start text-[13px] font-medium leading-[18px] text-ink-secondary transition-colors hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("widget.showAll", { count: items.length })}
        </button>
      )}
    </div>
  );
}

/** The rows of a list with a `name`: one of them is chosen, as in a radio group. The whole row is the
 * target, the chosen row keeps its fill and its mark, and its `value` is the list's value in the card's
 * form state, so confirm sends it like any other field. Tab lands on the chosen row (the first, while
 * none is), and the arrow keys move the choice. */
function ChoiceRows({ rows, name, required }: { rows: WidgetNode[]; name: string; required: boolean }) {
  const form = useWidgetForm();
  const chosen = form.values[name];
  const invalid = form.invalid === name;
  const stop = Math.max(0, rows.findIndex((row) => row.value === chosen));
  const choose = (row: WidgetNode | undefined) => {
    if (!form.locked && typeof row?.value === "string") form.setValue(name, row.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (form.locked || event.target !== event.currentTarget) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1
      : event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : 0;
    const next = event.key === " " || event.key === "Enter" ? index
      : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : step ? (index + step + rows.length) % rows.length : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(rows[next]);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={form.fields.get(name)?.label ?? name}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? form.errorId : undefined}
      className="flex min-w-0 flex-col"
    >
      {rows.map((row, index) => {
        const checked = typeof row.value === "string" && row.value === chosen;
        const gap = widgetNumber(row, "gap") ?? 12;
        return (
          <div
            key={row.id ?? index}
            role="radio"
            aria-checked={checked}
            aria-disabled={form.locked || undefined}
            tabIndex={index === stop && !form.locked ? 0 : -1}
            // where a press that found nothing chosen sends the focus
            data-widget-field={index === stop ? name : undefined}
            onClick={(event) => {
              // a button or link inside the row is its own press, not a choice of the row
              const inner = (event.target as Element).closest(WIDGET_ROW_CONTROLS);
              if (!inner) choose(row);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              WIDGET_ROW, ALIGN[widgetString(row, "align") ?? "center"], "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              checked && "bg-inset", (checked || !form.locked) && "group/row", !form.locked && "cursor-pointer hover:bg-inset",
            )}
            style={{ gap }}
          >
            {/* the key every question card shows (QuestionSheet), so a
                widget's one choice reads like any other question */}
            <SheetKey letter={sheetKey(index)} on={checked} invalid={invalid} />
            {kids(row).map((child, at) => <WidgetNodeView key={child.id ?? at} node={child} where={{ axis: "row", gap, item: true, lead: at === 0 }} />)}
          </div>
        );
      })}
    </div>
  );
}
