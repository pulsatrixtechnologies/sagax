// One recursive renderer for every node a chat widget can hold
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md, "Nodes"). It
// reads canonical trees only and never throws on one: a type this build does
// not know draws its children, or nothing.
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { ChatMarkdown } from "../ChatMarkdown";
import { WidgetChart } from "./WidgetChart";
import { WidgetBadge, WidgetImage, WidgetProgress } from "./WidgetContent";
import { useWidgetForm, widgetActionUrl, widgetCanPress, widgetFieldId, WidgetButton, WidgetGlyph, type WidgetForm } from "./WidgetControls";
import { WIDGET_CAPTION, WIDGET_FIELD_TYPES, WidgetFieldView } from "./WidgetFields";
import { WidgetCarousel, WidgetProduct } from "./WidgetProduct";
import { WidgetTable } from "./WidgetTable";
import {
  ALIGN, BACKGROUND, boxStyle, CAPTION_SIZE, ICON_SIZE, INK, JUSTIFY, kids, TEXT_ALIGN, TEXT_SIZE, TITLE_SIZE, WEIGHT, widthStyle,
} from "./widget-style";

export type { WidgetWhere } from "./widget-where";
import type { WidgetWhere } from "./widget-where";

/** On a card these lines are a tint of the ink, as the question card's are:
 * the hairline token sits one shade off the composer tone in the dark skins
 * and would not show. */
const RULE = "bg-ink/[0.12]";

export function WidgetChildren({ nodes, where }: { nodes: WidgetNode[]; where: WidgetWhere }) {
  return <>{nodes.map((child, index) => <WidgetNodeView key={child.id ?? index} node={child} where={where} />)}</>;
}

export function WidgetNodeView({ node, where }: { node: WidgetNode; where: WidgetWhere }): ReactNode {
  if (WIDGET_FIELD_TYPES.has(node.type)) return <WidgetFieldView node={node} where={where} />;
  switch (node.type) {
    case "Box": case "Row": case "Col": case "Form":
      return <Layout node={node} where={where} />;
    case "ListViewItem":
      return <WidgetListRow node={node} />;
    case "Spacer": {
      const min = widgetNumber(node, "minSize");
      return <div aria-hidden="true" className="min-h-0 min-w-0 flex-1" style={min === undefined ? undefined : where.axis === "row" ? { minWidth: min } : { minHeight: min }} />;
    }
    case "Divider":
      return <Divider node={node} where={where} />;
    case "Table":
      return <WidgetTable node={node} drawCell={drawCell} />;
    case "Text": case "Title": case "Caption":
      return <TextNode node={node} where={where} />;
    case "Label":
      return <LabelNode node={node} where={where} />;
    case "Markdown":
      // the app's own renderer, with the chat's 1.75 line box brought down to the card's
      return <div className="min-w-0 text-[14px] text-ink [&_.chat-md]:leading-[21px]!"><ChatMarkdown inert text={widgetString(node, "value") ?? ""} /></div>;
    case "Image":
      return <WidgetImage node={node} where={where} />;
    case "Icon": {
      const size = ICON_SIZE[widgetString(node, "size") ?? "md"] ?? ICON_SIZE.md;
      const ink = INK[widgetString(node, "color") ?? ""];
      if (!(where.item && where.lead)) return <WidgetGlyph name={node.name} size={size} className={ink} />;
      return (
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-inset group-hover/row:bg-composer group-aria-checked/row:bg-composer", ink ?? "text-ink-secondary")}>
          <WidgetGlyph name={node.name} size={size} />
        </span>
      );
    }
    case "Chart":
      return <WidgetChart node={node} />;
    case "Badge":
      return <WidgetBadge node={node} />;
    case "Progress":
      return <WidgetProgress node={node} />;
    case "Carousel":
      return <WidgetCarousel node={node} draw={drawChild} />;
    case "Product":
      return <WidgetProduct node={node} draw={drawChild} />;
    case "Button":
      return (
        <WidgetButton
          actionRef={node.id}
          label={widgetString(node, "label")}
          look={widgetString(node, "style") ?? "secondary"}
          iconStart={node.iconStart}
          iconEnd={node.iconEnd}
          block={node.block === true}
          disabled={node.disabled === true}
        />
      );
    // Transition draws its one child. So does anything else that has children.
    default:
      return <WidgetChildren nodes={kids(node)} where={where} />;
  }
}

/** The first submit Button under a Form: what Enter in one of its fields presses. */
function submitRef(node: WidgetNode, form: WidgetForm): string | undefined {
  for (const child of kids(node)) {
    const entry = child.type === "Button" && child.submit === true ? form.actions.get(child.id) : undefined;
    // never a link: a keystroke in a field must not open an address the bot chose
    if (entry?.tone === "submit" && !entry.client) return child.id;
    const inner = submitRef(child, form);
    if (inner) return inner;
  }
  return undefined;
}

/** Words that can name a field beside it. */
const WORDS = new Set(["Label", "Text", "Caption", "Title"]);
/** Things that sit side by side and may take another line when a row runs out of room. */
const FLOWS = new Set(["Button", "Badge", "Spacer", ...WIDGET_FIELD_TYPES]);

/** A row that pairs a field with the words for it (Row[Label, Spacer, field]): side by side while the
 * card has room, and in a narrow card the words over a full-width field. */
function pairsField(node: WidgetNode): boolean {
  const children = kids(node);
  return children.some((child) => WIDGET_FIELD_TYPES.has(child.type) && child.type !== "Checkbox") && children.some((child) => WORDS.has(child.type));
}

/** A row of buttons, badges or fields: it wraps rather than squeeze them or run past the card. */
function flows(children: WidgetNode[]): boolean {
  return children.length > 1 && children.every((child) => FLOWS.has(child.type));
}

function Layout({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  const stacked = form.compact && node.type === "Row" && pairsField(node);
  const axis = !stacked && (node.type === "Row" || (node.type !== "Col" && node.direction === "row")) ? "row" : "col";
  // stacked, the words sit 6px over their field, as a Label above a field does
  const gap = stacked ? 6 : widgetNumber(node, "gap") ?? (axis === "row" ? 8 : node.type === "Form" ? 12 : 0);
  const isForm = node.type === "Form";
  // stacked, a spacer has nothing to push apart
  const shown = stacked ? kids(node).filter((child) => child.type !== "Spacer") : kids(node);
  const className = cn(
    "flex min-w-0",
    axis === "row" ? "flex-row" : "flex-col",
    stacked ? ALIGN.stretch : ALIGN[widgetString(node, "align") ?? (axis === "row" ? "center" : "stretch")],
    JUSTIFY[widgetString(node, "justify") ?? ""],
    axis === "row" && (node.wrap === true || flows(shown)) && "flex-wrap",
    BACKGROUND[widgetString(node, "background") ?? ""],
    widgetNumber(node, "border") ? "border-solid border-ink/[0.12]" : null,
    // label on one side, value on the other: the 44px row; stacked, it keeps the same room around it
    where.card && node.type === "Row" && (stacked ? "py-2.5" : "min-h-[44px]"),
  );
  const style: CSSProperties = { gap, ...boxStyle(node) };
  const children = <WidgetChildren nodes={shown} where={{ axis, gap, item: where.item, form: where.form || isForm, room: gap > 0 ? [0, 0] : [8, 8] }} />;
  if (!isForm || where.form) return <div className={className} style={style}>{children}</div>;
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target;
    if (event.key !== "Enter" || event.nativeEvent.isComposing || !(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio") return;
    event.preventDefault();
    const ref = submitRef(node, form);
    if (ref) form.press(ref);
  };
  return <form noValidate onSubmit={(event) => event.preventDefault()} onKeyDown={onKeyDown} className={className} style={style}>{children}</form>;
}

/** The box of a list row, and what inside one takes a click of its own. Its 16px corners sit 8px inside
 * the card's 24px ones, and its content starts 16px in, under the header's. */
export const WIDGET_ROW = "flex min-h-[60px] w-full min-w-0 rounded-2xl px-2 py-2.5 text-start";
export const WIDGET_ROW_CONTROLS = "button, a, input, select, textarea, label, [role='button']";

/** A list row: 60px, the whole of it the target when it has an action. A row
 * that holds a control of its own cannot be a button around a button, so it
 * takes the button's role and keys instead. */
export function WidgetListRow({ node }: { node: WidgetNode }) {
  const form = useWidgetForm();
  const entry = form.actions.get(node.id);
  const live = widgetCanPress(form, entry);
  const style: CSSProperties = { gap: widgetNumber(node, "gap") ?? 12 };
  const shape = cn(WIDGET_ROW, ALIGN[widgetString(node, "align") ?? "center"]);
  const content = kids(node).map((child, index) => (
    <WidgetNodeView key={child.id ?? index} node={child} where={{ axis: "row", gap: style.gap as number, item: true, lead: index === 0 }} />
  ));
  if (!entry) return <div className={shape} style={style}>{content}</div>;
  const pressed = form.pendingRef === node.id
    ? <LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin text-ink-tertiary" />
    : form.sentRef === node.id ? <Check aria-hidden="true" size={14} className="shrink-0 text-success" /> : null;
  // `group/row` only while the row can be pressed: it is what turns the thumbnail to the card's tone on the hover fill
  const className = cn(shape, "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", live ? "group/row cursor-pointer hover:bg-inset active:bg-inset" : "cursor-default");
  const shared = { "data-widget-ref": node.id, "aria-busy": form.pendingRef === node.id || undefined, title: widgetActionUrl(entry), className, style };
  if (!holdsControl(node)) {
    return <button type="button" {...shared} disabled={!live} onClick={() => form.press(node.id)}>{content}{pressed}</button>;
  }
  return (
    <div
      role="button"
      tabIndex={live ? 0 : -1}
      aria-disabled={!live || undefined}
      {...shared}
      onClick={(event) => {
        // a press on a button, field, link or row inside this one is that control's, not this row's
        const inner = (event.target as Element).closest(WIDGET_ROW_CONTROLS);
        if (live && (!inner || inner === event.currentTarget)) form.press(node.id);
      }}
      onKeyDown={(event) => {
        if (!live || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        form.press(node.id);
      }}
    >
      {content}{pressed}
    </div>
  );
}

/** Whether a row holds something that takes a click of its own: a button, a field, a gated image, a row inside
 * it, or Markdown (which may hold a link). Such a row cannot be a real button around them. */
const CLICKABLE = new Set(["Button", "Image", "ListViewItem", "Markdown"]);
function holdsControl(node: WidgetNode): boolean {
  return kids(node).some((child) => CLICKABLE.has(child.type) || WIDGET_FIELD_TYPES.has(child.type) || holdsControl(child));
}

function Divider({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const spacing = widgetNumber(node, "spacing");
  const [before, after] = spacing === undefined ? where.room ?? [0, 0] : [spacing, spacing];
  if (where.axis === "row") {
    return <div role="separator" aria-orientation="vertical" className={cn("w-px shrink-0 self-stretch", RULE)} style={{ marginInlineStart: before, marginInlineEnd: after }} />;
  }
  const edge = node.flush === true ? where.card : undefined;
  return <div role="separator" className={cn("h-px shrink-0", RULE)} style={{ marginTop: before, marginBottom: after, ...(edge ? { marginLeft: -edge.left, marginRight: -edge.right } : {}) }} />;
}

/** A Product's picture or button, drawn as the rest of the widget is. */
const drawChild = (child: WidgetNode, where: WidgetWhere): ReactNode => <WidgetNodeView node={child} where={where} />;

/** What a table cell holds, drawn as the rest of the widget is. */
const CELL: WidgetWhere = { axis: "col", gap: 0, cell: true };
const drawCell = (cell: WidgetNode): ReactNode => <WidgetChildren nodes={kids(cell)} where={CELL} />;

const TYPE: Record<string, { sizes: Record<string, readonly [string, number]>; weight?: string; ink: string }> = {
  Text: { sizes: TEXT_SIZE, ink: "text-ink" },
  Title: { sizes: TITLE_SIZE, weight: "font-semibold", ink: "text-ink" },
  Caption: { sizes: CAPTION_SIZE, ink: "text-ink-secondary" },
};

function TextNode({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const face = TYPE[node.type] ?? TYPE.Text!;
  const [size, line] = face.sizes[widgetString(node, "size") ?? "md"] ?? face.sizes.md!;
  // in a table a plain Text reads at the table's size, and wraps or clips with its Wrap toggle
  const inCell = where.cell === true && widgetString(node, "size") === undefined;
  const maxLines = widgetNumber(node, "maxLines");
  const minLines = widgetNumber(node, "minLines");
  // a list row never wraps: its lines are one line each unless one asks for more
  const oneLine = node.truncate === true || (where.item === true && maxLines === undefined);
  const value = widgetString(node, "value") ?? "";
  const style: CSSProperties = {
    ...(maxLines && !oneLine ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: maxLines, overflow: "hidden" } : {}),
    ...(minLines ? { minHeight: minLines * line } : {}),
    ...widthStyle(node),
  };
  return (
    <div
      dir="auto"
      title={oneLine ? value : undefined}
      className={cn(
        "min-w-0", !inCell && size, WEIGHT[widgetString(node, "weight") ?? ""] ?? face.weight, INK[widgetString(node, "color") ?? ""] ?? face.ink,
        TEXT_ALIGN[widgetString(node, "textAlign") ?? ""], node.italic === true && "italic", node.lineThrough === true && "line-through",
        oneLine ? "truncate" : inCell ? "[.truncate>&]:truncate" : "whitespace-pre-line break-words",
      )}
      style={style}
    >
      {value}
    </div>
  );
}

/** Above its field a label is the app's form caption, 6px off the field
 * whatever room the stack leaves; beside it, in a row, it is the row's 14px
 * in the secondary ink. */
function LabelNode({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  const field = form.fields.get(widgetString(node, "fieldName") ?? "");
  const above = where.axis === "col";
  return (
    <label
      // a group goes by its own name: a click on its label must not pick the first option or day
      htmlFor={field && field.type !== "RadioGroup" && field.type !== "DayPicker" ? widgetFieldId(form, field.name) : undefined}
      dir="auto"
      className={cn(
        "min-w-0", above ? WIDGET_CAPTION : "shrink-0 text-[14px] leading-5 text-ink-secondary",
        TEXT_SIZE[widgetString(node, "size") ?? ""]?.[0], WEIGHT[widgetString(node, "weight") ?? ""], INK[widgetString(node, "color") ?? ""],
        TEXT_ALIGN[widgetString(node, "textAlign") ?? ""],
      )}
      style={{ ...widthStyle(node), ...(above ? { marginBottom: 6 - where.gap } : {}) }}
    >
      {widgetString(node, "value") ?? ""}
    </label>
  );
}
