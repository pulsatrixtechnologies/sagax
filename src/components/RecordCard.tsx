// The card a record's chip opens (#4507). Landscape, wider than tall: the
// head (product mark, kind, number, state chip) and the title across the top;
// under them two panes parted by a hairline, left "who and what state"
// (company, contact, owner, priority, dates, key fields), right "what it
// says" (the description, then the latest notes on a rail); one row of
// actions across the bottom (open in the product, ask the bot, copy the
// number, "up to date at", refresh). Below 34 rem of available width the
// panes stack; a record with no description and no notes keeps the left pane
// only, about 22 rem wide.
//
// Opened by its chip (pinned), the card is the record window
// (M-20261127-101, record-window/RecordWindow.tsx): the one window of every
// record of every plugin, moved by its head and resized by its edges, its
// size and place kept per person and per type of window (M-20261127-147).
// The head (mark, kind, number, title written in place, the state pills,
// close) and the foot (open on the web, ask, copy, "up to date at", refresh)
// are this file's for every kind; between them, a kind's own body
// (`window`: a ticket's tabs and sides, record-window/TicketWindow.tsx), or
// else the facts at the left and what the record says at the right, each
// side scrolling on its own (RecordSplit.tsx). A step to another record (its
// company, its contact) happens in the same window, with a trail of the
// records opened on the way above the head (M-20261119-084). Hovered, it
// stays the tooltip above.
//
// What a record says (its description, its notes) is the product's Markdown:
// the opened card draws it with the chat's renderer and the note images read
// as the person (RecordMarkdown.tsx); a hovered card shows its words only
// (markdownPreview). The title is changed in place when the product lets the
// person write it, through the card's one write path.
//
// Every word of a card is the console's data: this file names no product and
// no kind, branches on neither, and reads only the tones, the levels, the two
// roles `contact` and `owner` (for their icons), the date keys and the
// types of a field (#4572): a ticket, a company, a project, an invoice or an
// agreement are the same renderer over different data. The layout is the data's:
// a kind with a text, a list or an activity is the two-pane landscape card, a
// kind with none is the narrower single-pane card. It paints
// from the popover tokens and the menu family's surface; nothing here writes
// a colour, a radius or a shadow of its own. Measured on the reference app
// (docs/design/ux-reference-grokbot-cursor.md, "Record card").
//
// Parts of the skeleton pulse and the notes rail are adapted from Arc,
// Copyright (c) 2026 Elia Kuratli, used under the MIT License
// (third_party/arc-library/LICENSE).
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleAlert, Copy, Globe, Lock, MessageSquareText, Pencil, RotateCw, ShieldAlert, TriangleAlert, UserCheck, UserRound, WifiOff, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatClock, formatFull, formatLateness, formatRelative, isGuid, percentValue, sameText } from "@/lib/record-card-format";
import { fitRows, moreKind, type MoreKind } from "@/lib/record-card-fit";
import { markdownPreview } from "@/lib/markdown-preview";
import { RECORD_TITLE_MAX, titleValue } from "@/lib/record-detail";
import type { UseRecordCard } from "@/lib/record-cards";
import { recordWindowType } from "@/lib/record-window-layout";
import { RecordFieldSelect, type RecordFieldEdit } from "./RecordFieldSelect";
import { RecordMarkdown } from "./RecordMarkdown";
import { RecordWindow } from "./record-window/RecordWindow";
import { RecordSplit } from "./record-window/RecordSplit";
import { ServiceIcon } from "@/components/plugins/PluginParts";
import { REF_PILL_CLASS } from "@/components/ref-pill";
import type { RecordCard as Card, RecordCardMiss, RecordField, RecordLevel, RecordRef, RecordTone } from "../../shared/record-cards";

/** A hovered list shows this many entries, then "See all". */
const LIST_FOLD = 3;

/** A description this short (one line) is not given a pane of its own. */
const SHORT_TEXT_MAX = 90;

/** The width below which the panes stack (the available width, in rem). */
export const RECORD_CARD_STACK_REM = 34;
/** The opened card's (#5053): its facts keep 22rem beside what the record says. */
export const RECORD_CARD_OPEN_STACK_REM = 50;

export interface RecordCardProduct {
  name: string;
  /** the product's mark (the product list's `icon.url`, https); none: the neutral tile */
  iconUrl?: string;
}

/** One record of the way the opened card came (M-20261119-084): the first is
 * the chip's, the last the one on screen. An earlier one opens again. */
export interface RecordCardCrumb {
  label: string;
  onOpen?: () => void;
}

/** The title written in place: the product lets the person write it. */
export interface RecordTitleEdit {
  save: (value: string) => Promise<void>;
}

/** A kind's own body in the opened window: its tabs across the window (when they are not over one side) and its body. */
export interface RecordWindowLayout {
  tabs?: ReactNode;
  body: ReactNode;
}

export interface RecordCardProps {
  record: RecordRef;
  /** the link's own text: the head's number while the card loads */
  label: string;
  /** the kind's name in the person's language, from the product list */
  kindName?: string;
  product?: RecordCardProduct;
  read: Pick<UseRecordCard, "card" | "miss" | "loading" | "at" | "refresh">;
  /** the opened window's own layout for this kind (a ticket's tabs and sides, M-20261127-101): the
   * head, the foot and the frame stay the card's; absent, the card's facts and text in two sides */
  window?: RecordWindowLayout;
  edits?: Readonly<Record<string, RecordFieldEdit>>;
  /** the title, changed in place (the opened card only) */
  titleEdit?: RecordTitleEdit;
  /** the records opened on the way here, this one last; shown from two on */
  trail?: readonly RecordCardCrumb[];
  pinned?: boolean;
  onClose?: () => void;
  /** put the record in the open conversation's composer (absent: no action) */
  onAsk?: () => void;
  /** open the product's page in Connect Apps */
  onConnect?: () => void;
  /** the app's own sign-in again */
  onSignIn?: () => void;
  /** a record the card names (its company, a `ref` field, a person, a line): shown as a chip that opens that card in place */
  onOpenRecord?: (ref: RecordRef, label: string) => void;
  /** whether the person holds that record's product (absent: every ref opens); a ref that does not is plain words */
  canOpenRecord?: (ref: RecordRef) => boolean;
  /** back to the card this one replaced */
  onBack?: () => void;
  /** the clock, for a test or a gallery that holds time still */
  now?: number;
}

const MARK = "size-4 shrink-0 rounded-[4px]";
const MARK_ROOMY = "size-5 shrink-0 rounded-[5px]";

/** The opened card (pinned) is a window over the chat (#5053): the chat's text
 * size (15px on 22px), 13px labels, air between rows and blocks. Hovered, the
 * card keeps the compact tooltip it was. Every part reads this. */
const RoomyContext = createContext(false);

/** The product's mark: the card's own icon when it came with one, else the
 * product list's, else a neutral tile with the product's first letter. */
export function RecordProductMark({ product, iconUrl, className = MARK }: { product?: RecordCardProduct; iconUrl?: string; className?: string }) {
  const logo = iconUrl ?? product?.iconUrl ?? null;
  return <ServiceIcon key={logo ?? ""} card={{ logo, domain: null, label: product?.name || "?" }} className={cn(className, "text-[10px] leading-none")} />;
}

const BUTTON_BASE = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] leading-5 hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
const BUTTON = cn(BUTTON_BASE, "text-popover-ink");
// the primary action wears the popover's accent, in both themes
const BUTTON_PRIMARY = cn(BUTTON_BASE, "text-popover-accent");
const ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink focus-visible:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
// the opened card's actions: 32px controls, 14px words
const ROOMY_BUTTON = "h-8 gap-2 px-2.5 text-[14px]";
const ROOMY_ICON_BUTTON = "size-8";
// a field's picker in the opened card's body: the value at the body's size, a soft hover. A 28px control on
// the row's 22px line (-3px above and under), moved 8px back by its place and never by a margin across: a
// negative margin there would narrow the box that caps the picker and cut its words
// (a long value goes on a second line: nothing of the opened card ends on an ellipsis)
export const ROOMY_FIELD_UNSET = "relative -start-2 -my-[3px] inline-flex min-h-7 min-w-0 max-w-full items-center gap-1 rounded-lg px-2 py-[3px] text-start text-[15px] leading-[22px] text-popover-ink hover:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-popover-hover disabled:opacity-50 [&>span]:whitespace-normal [&>span]:break-words";
// a value the record has reads in the ink (the picker greys what is not one of its loaded choices)
export const ROOMY_FIELD_SELECT = `${ROOMY_FIELD_UNSET} [&>span]:text-popover-ink`;

/** Hovered, the card is a tooltip: it holds no control in the tab order until
 * it is pinned (a dialog). Every button reads this. */
const EditContext = createContext<RecordCardProps["edits"]>(undefined);
/** The opened card's field pickers, for a kind's own body (RecordCardProps.window). */
export function useRecordEdits(): RecordCardProps["edits"] {
  return useContext(EditContext);
}

const TabContext = createContext<number | undefined>(undefined);

/** The product's page of the record: the target of every "See all" (absent: no such action). */
const SeeAllContext = createContext<{ url?: string; product?: string }>({});

/** The quiet "N more" line of a list, with "See all" opening the record in its product. */
function MoreLine({ fitKey, text, className }: { fitKey: string; text: string; className?: string }) {
  const { url, product } = useContext(SeeAllContext);
  const tab = useContext(TabContext);
  const roomy = useContext(RoomyContext);
  return (
    <p data-fit-row={fitKey} className={cn("flex items-baseline gap-1.5 text-[12px] leading-4 text-popover-ink-secondary", roomy && "text-[13px] leading-[18px]", className)}>
      <span>{text}</span>
      {url && (
        <button
          type="button"
          tabIndex={tab}
          data-record-see-all
          title={product ? t("recordCard.openIn", { product }) : t("recordCard.open")}
          className="rounded text-popover-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onClick={() => { void openExternalLink(url); }}
        >{t("recordCard.seeAll")}</button>
      )}
    </p>
  );
}

/** What a record named inside the card does: opens in this card's place when
 * the person holds its product, else it is plain words. */
const RefContext = createContext<RefTarget>({});
type RefTarget = { open?: (ref: RecordRef, label: string) => void; can?: (ref: RecordRef) => boolean };
/** The one rule: a record named in the card opens in place only when the card
 * can open records and the person holds that record's product (and kind). */
function openerFor(target: RefTarget, ref: RecordRef | undefined): ((ref: RecordRef, label: string) => void) | undefined {
  return ref && target.open && (!target.can || target.can(ref)) ? target.open : undefined;
}
export function useOpenRef(ref: RecordRef | undefined): ((ref: RecordRef, label: string) => void) | undefined {
  return openerFor(useContext(RefContext), ref);
}

// A chip's words are in the popover ink over the tone's own tint (4.5:1 in
// every skin, scripts/check-skin-contrast.mjs); the tone is a dot or a glyph.
export const TONE_CLASS: Record<RecordTone, string> = {
  open: "bg-popover-field",
  waiting: "bg-warning/15",
  done: "bg-success/15",
  alert: "bg-danger/15",
};
export const TONE_DOT: Record<RecordTone, string> = {
  open: "bg-popover-ink-secondary",
  waiting: "bg-warning",
  done: "bg-success",
  alert: "bg-danger",
};
const LEVEL_CLASS: Record<RecordLevel, string> = {
  urgent: "bg-danger/15",
  high: "bg-warning/15",
  normal: "bg-popover-field",
  low: "bg-popover-field",
};
const LEVEL_GLYPH: Record<RecordLevel, string> = {
  urgent: "text-danger",
  high: "text-warning",
  normal: "",
  low: "",
};

function Chip({ className, children, title, role, label }: { className: string; children: ReactNode; title?: string; role?: "img"; label?: string }) {
  const roomy = useContext(RoomyContext);
  return <span title={title} role={role} aria-label={label} className={cn("inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-full px-2 text-[12px] leading-4 text-popover-ink", roomy && "h-6 gap-1.5 px-2.5 text-[13px] leading-[18px]", className)}>{children}</span>;
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-popover-ink/10 motion-reduce:animate-none", className)} />;
}

/** The "N more" line is a row of the pane: 16px tall, after the 8px gap every
 * pane keeps between its children. A fit reserves both, or the line would sit
 * on the last row it leaves. */
const MORE_ROOM = 16 + 8;

/**
 * A pane. Pinned, it scrolls inside, with a 16px fade at an edge only while
 * there is more in that direction, and rows that snap softly. Only hovered
 * (`fit`), it shows WHOLE rows (src/lib/record-card-fit.ts): the rows that do
 * not fit (`data-fit-row`, a row being one or two elements sharing a key) are
 * left out, and a quiet "N more" at the pane's foot says how many and of what.
 * The pass runs when the pane's size or its content changes, never on a render.
 */
function Pane({ pinned, fit = false, className, moreClass, moreRoom = MORE_ROOM, children, ...data }: { pinned: boolean; fit?: boolean; className?: string; moreClass?: string; moreRoom?: number; children: ReactNode; [key: `data-${string}`]: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  const [left, setLeft] = useState<{ count: number; kind: MoreKind } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measureScroll = () => {
      const above = pinned && el.scrollTop > 2;
      const below = pinned && el.scrollHeight - el.scrollTop - el.clientHeight > 2;
      setEdges((current) => (current.above === above && current.below === below ? current : { above, below }));
    };
    const measureRows = () => {
      // an expanded pinned card shows every row and scrolls; a pane that does not fit leaves the
      // rows alone (the rows of another pane, inside it, are that pane's to hide)
      // a pinned (clicked) card hides nothing: every row shows and the pane scrolls
      if (pinned) for (const node of el.querySelectorAll("[data-fit-hidden]")) node.removeAttribute("data-fit-hidden");
      if (pinned || !fit) {
        setLeft((current) => (current === null ? current : null));
        return;
      }
      const groups = new Map<string, HTMLElement[]>();
      for (const node of el.querySelectorAll<HTMLElement>("[data-fit-row]")) {
        node.removeAttribute("data-fit-hidden");
        const key = node.dataset.fitRow ?? "";
        groups.set(key, [...(groups.get(key) ?? []), node]);
      }
      if (!groups.size) {
        setLeft((current) => (current === null ? current : null));
        return;
      }
      const top = el.getBoundingClientRect().top - el.scrollTop;
      const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const entries = [...groups.entries()];
      const bottoms = entries.map(([, nodes]) => Math.max(...nodes.map((node) => node.getBoundingClientRect().bottom - top)));
      const shown = fitRows({ bottoms, full: el.clientHeight - paddingBottom, partial: el.clientHeight - paddingBottom - moreRoom });
      const hiddenKeys = entries.slice(shown).map(([key]) => key);
      for (const [, nodes] of entries.slice(shown)) for (const node of nodes) node.setAttribute("data-fit-hidden", "");
      const next = hiddenKeys.length ? { count: hiddenKeys.length, kind: moreKind(hiddenKeys) } : null;
      setLeft((current) => (current?.count === next?.count && current?.kind === next?.kind ? current : next));
    };
    const measure = () => { measureRows(); measureScroll(); };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(el);
    // content that changes (a card read again) is measured again; the "N more"
    // line coming and going is not content
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
      // only the "N more" line coming or going is not content; a changed text is
      const isMoreLine = (node: Node) => node instanceof HTMLElement && node.hasAttribute("data-fit-more");
      if (records.every((record) => record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(isMoreLine))) return;
      measure();
    });
    mutations?.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", measureScroll, { passive: true });
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
      el.removeEventListener("scroll", measureScroll);
    };
  }, [fit, pinned, moreRoom]);
  const label = left ? t(`recordCard.more.${left.kind}${left.count === 1 ? "One" : "Many"}` as Parameters<typeof t>[0], { count: left.count }) : "";
  return (
    <div
      ref={ref}
      {...data}
      data-more-above={edges.above ? "" : undefined}
      data-more-below={edges.below ? "" : undefined}
      tabIndex={pinned && (edges.above || edges.below) ? 0 : undefined}
      className={cn("relative min-h-0 min-w-0 [&_[data-fit-hidden]]:hidden", pinned ? "record-scroll overflow-y-auto" : "overflow-hidden", className)}
    >
      {children}
      {left && <p data-fit-more className={cn("shrink-0 text-[12px] leading-4 text-popover-ink-secondary", moreClass)}>{label}</p>}
    </div>
  );
}

/** The width of the space the card has, as the stacked layout reads it. */
function useStacked(ref: RefObject<HTMLElement | null>, below = RECORD_CARD_STACK_REM): boolean {
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // no layout (a test renderer) reads as wide
      setStacked(el.clientWidth > 0 && el.clientWidth < below * rem);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref, below]);
  return stacked;
}

/** A person: the small icon, the name (a chip that opens their record when they
 * are one the person may open), a quiet detail. One drawing for the people
 * block and for a `person` field. */
export function PersonLine({ role, label, name, detail, personRef, labelled = false }: { role?: string; label?: string; name: string; detail?: string; personRef?: RecordRef; /** the label is written beside the row (the opened card): it is not said twice */ labelled?: boolean }) {
  const Icon = role === "owner" || role === "manager" ? UserCheck : UserRound;
  const open = useOpenRef(personRef);
  const edits = useContext(EditContext);
  const roomy = useContext(RoomyContext);
  const edit = role ? edits?.[role] : undefined;
  const who = edit ? <RecordFieldSelect edit={edit} current={name} label={label ?? name} triggerClass={roomy ? ROOMY_FIELD_SELECT : undefined} /> : personRef && open ? <RecordRefChip name={name} refTo={personRef} onOpen={open} /> : <span dir="auto" className={roomy ? "min-w-0 break-words" : "min-w-0 truncate"}>{name}</span>;
  const opener = edit && personRef && open && <button type="button" onClick={() => open(personRef, name)} aria-label={t("recordCard.open")} className="text-popover-ink-secondary hover:text-popover-ink"><ArrowUpRight size={roomy ? 16 : 14} /></button>;
  const more = detail && <span dir="ltr" className="shrink-0 whitespace-nowrap text-popover-ink-secondary [unicode-bidi:isolate]">{detail}</span>;
  if (roomy) {
    // the opened card: the icon on the first line, and the detail (a phone) goes under the name when the row is short of room
    return (
      <>
        <span aria-hidden="true" className="flex h-[22px] shrink-0 items-center text-popover-ink-secondary"><Icon size={16} /></span>
        {label && !labelled && <span className="sr-only">{label}: </span>}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">{who}{opener}{more}</span>
      </>
    );
  }
  return (
    <>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      {label && !labelled && <span className="sr-only">{label}: </span>}
      {/* the name gives way, the number beside it does not */}
      {who}
      {opener}
      {more}
    </>
  );
}

function PersonRow({ person, fitKey }: { person: NonNullable<Card["people"]>[number]; fitKey: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-person={person.role} data-fit-row={fitKey} title={person.label ? `${person.label}: ${person.name}` : person.name}>
      <PersonLine role={person.role} label={person.label} name={person.name} detail={person.detail} personRef={person.ref} />
    </div>
  );
}

/** A record the card names: the record chip of it. Only a click opens that
 * record's card in this card's place (a pointer resting on it never does: a
 * pointer crossing a card must not replace it); hovering shows the chip's own
 * hover tint and a tooltip. `slot` marks the card's own company slot (its
 * attribute is kept for the captures and the tests). */
export function RecordRefChip({ name, refTo, onOpen, slot }: { name: string; refTo: RecordRef; onOpen: (ref: RecordRef, label: string) => void; slot?: "company" }) {
  const tab = useContext(TabContext);
  const roomy = useContext(RoomyContext);
  return (
    <button
      type="button"
      tabIndex={tab}
      dir="auto"
      title={name}
      {...(slot === "company" ? { "data-record-company-link": true } : { "data-record-ref-link": true })}
      // the opened card: a long name goes on a second line inside its chip (the same pill on one line: 11px is half its 22px)
      className={cn(REF_PILL_CLASS, roomy ? "-ms-1.5 min-w-0 max-w-full cursor-pointer items-center whitespace-normal rounded-[11px] text-start font-sans text-[1em] no-underline" : "-ms-1.5 min-w-0 max-w-full cursor-pointer items-center truncate font-sans text-[1em] no-underline")}
      onClick={() => onOpen(refTo, name)}
    >
      <span className={roomy ? "min-w-0 break-words" : "truncate"}>{name}</span>
    </button>
  );
}

/** The priority never loses words to its neighbours: the head wraps to a second
 * line before a chip is cut, and a label wider than the whole card is cut with
 * its full name in the tooltip and the accessible name. */
function PriorityChip({ priority }: { priority: NonNullable<Card["priority"]> }) {
  return (
    <Chip className={cn(LEVEL_CLASS[priority.level], "shrink-0")} title={priority.label} role="img" label={priority.label}>
      {(priority.level === "urgent" || priority.level === "high") && <TriangleAlert size={12} aria-hidden="true" className={cn("shrink-0", LEVEL_GLYPH[priority.level])} />}
      <span className="min-w-0 truncate">{priority.label}</span>
    </Chip>
  );
}

/** The value of one field, drawn by its TYPE alone (#4572). Never by what the
 * field is about: `value` is the product's own ready text, shown as sent. */
export function FieldValue({ field, label, now, lang, tz }: { field: RecordField; label: string; now: number; lang: string; tz: string | undefined }) {
  const open = useOpenRef(field.ref);
  const edits = useContext(EditContext);
  const roomy = useContext(RoomyContext);
  const edit = field.editKey ? edits?.[field.editKey] : undefined;
  if (edit) return <span className="inline-flex min-w-0 items-center gap-1">
    <RecordFieldSelect edit={edit} current={field.value} label={label} triggerClass={roomy ? ROOMY_FIELD_SELECT : undefined} />
    {open && field.ref && <button type="button" aria-label={t("recordCard.open")} onClick={() => open(field.ref!, field.value)}><ArrowUpRight size={14} /></button>}
  </span>;
  switch (field.type) {
    case "money":
      // the product's number and currency as sent, never computed; left in the value column
      // like every other value (the ticket card's rule), in tabular figures
      return <span dir="auto" data-record-money className="tabular-nums" title={field.currency}>{field.value}</span>;
    case "date":
      // a fact of the record (an invoice date, an agreement's start and end) always says its year
      return <time dateTime={field.at} title={formatFull(field.at!, lang, tz)}>{formatAbsolute(field.at!, now, lang, tz, { year: true })}</time>;
    case "ago":
      return <time dateTime={field.at} title={formatFull(field.at!, lang, tz)}>{formatRelative(field.at!, now, lang, tz)}</time>;
    case "person":
      return <span className={cn("flex min-w-0 items-center gap-2 leading-[18px]", roomy && "items-start leading-[22px]")} data-record-person={field.role}><PersonLine role={field.role} name={field.value} detail={field.detail} personRef={field.ref} /></span>;
    case "ref":
      return open && field.ref ? <RecordRefChip name={field.value} refTo={field.ref} onOpen={open} /> : <span dir="auto">{field.value}</span>;
    case "state": {
      const tone = field.tone ?? "open";
      return <Chip className={TONE_CLASS[tone]} title={field.value}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} /><span className="truncate">{field.value}</span></Chip>;
    }
    default: {
      // a percent: the bar from `share`; an untyped value written as a percentage keeps its bar
      const share = field.type === "percent" ? field.share ?? percentValue(field.value) : field.type === undefined ? percentValue(field.value) : null;
      if (share === null || share === undefined) return <span dir="auto">{field.value}</span>;
      return (
        <span className="flex items-center gap-2" data-record-percent>
          <span className="shrink-0">{field.value}</span>
          <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-popover-field">
            <span className="block h-full rounded-full bg-popover-accent" style={{ width: `${share}%` }} />
          </span>
        </span>
      );
    }
  }
}

/** How late a record is past its due date: never once it is done or closed,
 * else formatLateness. One rule for the card's due row and a kind's own window
 * (an invoice's balance, M-20261127-140). */
export function recordLateness(card: { state?: { tone: string }; dates?: { due?: string; closed?: string } }, now: number, lang: string, tz?: string, due = card.dates?.due): string | null {
  if (!due || card.state?.tone === "done" || card.dates?.closed) return null;
  return formatLateness(due, now, lang, tz);
}

type FactRow = { label: string; value: ReactNode; gap?: boolean; key: string };

/** The dates and key fields as one description list. In the opened card the
 * company and the people lead it (`lead`), each under its label like any fact,
 * and facts that have the card's whole width lay two a row from 40rem (`pairs`). */
function Facts({ card, now, lang, part = "all", chipRows = [], lead = [], pairs = false }: { card: Card; now: number; lang: string; part?: "all" | "dates" | "fields"; chipRows?: NonNullable<Card["chips"]>; lead?: FactRow[]; pairs?: boolean }) {
  const edits = useContext(EditContext);
  const roomy = useContext(RoomyContext);
  const tz = card.tz;
  const rows: FactRow[] = [...lead];
  const dates = card.dates ?? {};
  const time = (iso: string, mode: "relative" | "absolute") => (
    <time dateTime={iso} title={formatFull(iso, lang, tz)}>{mode === "relative" ? formatRelative(iso, now, lang, tz) : formatAbsolute(iso, now, lang, tz)}</time>
  );
  // a narrow head gives its last chips way: their words are rows of the body, once
  chipRows.forEach((chip, index) => rows.push({ key: `chip-${index}`, label: t("recordCard.chip"), value: <span dir="auto">{chip.label}</span> }));
  if (dates.opened) rows.push({ key: "opened", label: t("recordCard.date.opened"), value: time(dates.opened, "relative") });
  if (dates.updated) rows.push({ key: "updated", label: t("recordCard.date.updated"), value: time(dates.updated, "relative") });
  if (dates.due) {
    const late = recordLateness(card, now, lang, tz);
    rows.push({
      key: "due",
      label: t("recordCard.date.due"),
      value: late ? (
        <span>{time(dates.due, "absolute")}<span className="ms-1.5 inline-flex items-center gap-1 whitespace-nowrap font-medium"><CircleAlert size={12} aria-hidden="true" className="text-danger" />{t("recordCard.late", { duration: late })}</span></span>
      ) : time(dates.due, "absolute"),
    });
  }
  if (dates.closed) rows.push({ key: "closed", label: t("recordCard.date.closed"), value: time(dates.closed, "absolute") });
  const dateCount = rows.length;
  (card.fields ?? []).forEach((field, index) => {
    rows.push({
      key: `field-${index}`,
      label: field.label,
      value: <FieldValue field={field} label={field.label} now={now} lang={lang} tz={tz} />,
      gap: dateCount > 0 && index === 0,
    });
  });
  // an editable field the card carries no value for (or none it shows) is still a choice to make
  const placed = new Set<string>([
    ...(card.state ? ["status"] : []), ...(card.priority ? ["priority"] : []),
    ...(card.people ?? []).map((person) => person.role),
    ...(card.fields ?? []).flatMap((field) => [field.editKey, field.role].filter((key): key is string => Boolean(key))),
  ]);
  Object.entries(edits ?? {}).filter(([key]) => !placed.has(key)).forEach(([key, edit], index) => {
    const label = t(`recordCard.edit.${key}` as "recordCard.edit.board");
    rows.push({ key: `edit-${key}`, label, value: <RecordFieldSelect edit={edit} current={t("recordCard.edit.notSet")} label={label} triggerClass={roomy ? ROOMY_FIELD_UNSET : undefined} />, gap: dateCount > 0 && index === 0 && !(card.fields ?? []).length });
  });
  const shown = part === "all" ? rows : part === "dates" ? rows.slice(0, dateCount) : rows.slice(dateCount).map((row) => ({ ...row, gap: false }));
  if (!shown.length) return null;
  if (roomy) {
    // every fact under a label that reads (13px in the secondary ink), its value at the chat's size, 10px between rows
    return (
      // (every first line is one 22px line, so a label and its value sit on the same line whatever the value is: words, a chip, a picker)
      <dl className={cn("grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5 text-[15px] leading-[22px]", pairs && "@min-[40rem]:grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)_minmax(5.5rem,auto)_minmax(0,1fr)]")} data-record-facts>
        {shown.map((row) => (
          <div key={row.key} className="contents">
            <dt data-fit-row={`f-${row.key}`} className="max-w-[12rem] break-words text-[13px] text-popover-ink-secondary">{row.label}</dt>
            <dd data-fit-row={`f-${row.key}`} className="min-h-[22px] min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-[13px] leading-[18px]" data-record-facts>
        {shown.map((row) => (
          <div key={row.key} className="contents">
            <dt data-fit-row={`f-${row.key}`} className={cn("max-w-[9rem] break-words text-[12px] leading-4 text-popover-ink-secondary", row.gap && "mt-1")} title={row.label}>{row.label}</dt>
            <dd data-fit-row={`f-${row.key}`} className={cn("min-w-0 break-words", row.gap && "mt-1")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function LineRow({ line }: { line: NonNullable<Card["lines"]>["items"][number] }) {
  const open = useOpenRef(line.ref);
  const roomy = useContext(RoomyContext);
  return (
    <>
      {line.ref && open ? <RecordRefChip name={line.label} refTo={line.ref} onOpen={open} /> : <span dir="auto" className={roomy ? "min-w-0 flex-1 break-words" : "min-w-0 flex-1 truncate"} title={line.label}>{line.label}</span>}
      {line.detail && <span dir="auto" className={cn("shrink-0 whitespace-nowrap text-[12px] text-popover-ink-secondary", roomy && "text-[13px]")}>{line.detail}</span>}
      {line.value && <span dir="auto" className={cn("shrink-0 whitespace-nowrap text-end tabular-nums", !(line.ref && open) && "ms-auto")}>{line.value}</span>}
    </>
  );
}

/** The right pane's list (an invoice's products, an agreement's additions):
 * a label, a quiet detail, a value at the right in tabular figures. One row
 * is a unit of the fit pass, like a field. */
function Lines({ card, above, pinned, folded }: { card: Card; above: boolean; pinned: boolean; /** the card also has an activity: a hovered list keeps one line for it */ folded: boolean }) {
  const { lines } = card;
  const roomy = useContext(RoomyContext);
  if (!lines) return null;
  const quiet = cn("text-[12px] leading-4 text-popover-ink-secondary", roomy && "text-[13px] leading-[18px]");
  if (lines.state === "forbidden") return <p data-fit-row="l-state" className={quiet}>{t("recordCard.lines.forbidden")}</p>;
  if (lines.state === "unavailable") return <p data-fit-row="l-state" className={quiet}>{t("recordCard.lines.unavailable")}</p>;
  // hovered, a list shows 3 lines (1 beside an activity), the rest behind "See all"; pinned, all it has
  const items = pinned ? lines.items : lines.items.slice(0, folded ? 1 : LIST_FOLD);
  const others = Math.max(0, (lines.total ?? lines.items.length) - items.length);
  if (!items.length && !others) return null;
  return (
    <div className={cn("flex shrink-0 flex-col [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden", above && "border-t border-popover-hairline pt-2", above && roomy && "pt-4")} data-record-lines>
      {lines.title && <p data-fit-row="l-title" className={cn("pb-1 text-[12px] leading-4 text-popover-ink-secondary", roomy && "pb-2 text-[13px] leading-[18px]")}>{lines.title}</p>}
      <ul className={cn("flex flex-col", roomy && "gap-2")}>
        {items.map((line, index) => (
          <li key={index} data-record-line data-fit-row={`l-${index}`} className={cn("flex min-w-0 items-baseline gap-2 leading-[18px]", roomy && "gap-3 leading-[22px]")}>
            <LineRow line={line} />
          </li>
        ))}
      </ul>
      {others > 0 && (
        <MoreLine fitKey="l-others" className={roomy ? "pt-2" : "pt-1"} text={others === 1 ? t("recordCard.lines.otherOne") : t("recordCard.lines.other", { count: others })} />
      )}
    </div>
  );
}

function Notes({ card, now, lang, description, above, pinned, stacked }: { card: Card; now: number; lang: string; description?: string; /** something sits above the activity in its pane */ above: boolean; pinned: boolean; stacked: boolean }) {
  const { notes } = card;
  const tab = useContext(TabContext);
  const roomy = useContext(RoomyContext);
  // the opened card scrolls as one and has the room: its notes are open until the person folds them
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? roomy;
  const quiet = cn("text-[12px] leading-4 text-popover-ink-secondary", roomy && "text-[13px] leading-[18px]");
  if (notes.state === "forbidden") return <p data-fit-row="n-state" className={quiet}>{t("recordCard.notes.forbidden")}</p>;
  if (notes.state === "unavailable") return <p data-fit-row="n-state" className={quiet}>{t("recordCard.notes.unavailable")}</p>;
  // a note that is the description's own text is shown once
  const items = notes.items.filter((item) => !description || !sameText(item.text, description));
  const others = notes.total !== undefined ? Math.max(0, notes.total - notes.items.length) : 0;
  if (!items.length && !others) return null;
  const count = notes.total ?? items.length;
  // a hovered card that is not wider than tall keeps its notes behind one row
  const folded = stacked && !open;
  const title = notes.title ? `${notes.title} (${count})` : t("recordCard.notes.title", { count });
  return (
    <div className="flex shrink-0 flex-col [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden" data-record-notes>
      {stacked && (pinned ? (
        <div data-fit-row="n-title" className={cn(above && "border-t border-popover-hairline pt-1", above && roomy && "pt-3")}>
          <button type="button" tabIndex={tab} aria-expanded={open} className={cn(BUTTON, roomy && ROOMY_BUTTON, "-ms-2 justify-start text-popover-ink-secondary")} onClick={() => setOpen(!open)}>
            <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 transition-transform rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
            <span>{title}</span>
          </button>
        </div>
      ) : (
        <p data-fit-row="n-title" className={cn("flex items-center gap-1.5 text-[12px] leading-4 text-popover-ink-secondary", above && "border-t border-popover-hairline pt-2")}>
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
          <span>{title}</span>
        </p>
      ))}
      {!folded && (
        <>
          <ol className="flex flex-col">
            {items.map((item, index) => (
              <li key={index} className={cn("relative flex gap-2.5 last:pb-0", pinned ? "pb-2.5" : "pb-1.5", roomy && "gap-3 pb-4", index === 0 && above && !stacked && "border-t border-popover-hairline pt-2", index === 0 && above && !stacked && roomy && "pt-4")} data-record-note data-fit-row={`n-${index}`}>
                <span aria-hidden="true" className="relative flex w-1.5 shrink-0 justify-center">
                  <span className="mt-[7px] size-1.5 rounded-full bg-popover-ink-secondary" />
                  {(index < items.length - 1 || others > 0) && <span className="absolute inset-y-[15px] start-1/2 w-px -translate-x-1/2 bg-popover-hairline" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-popover-ink-secondary", pinned ? "leading-5" : "leading-4", roomy && "gap-x-2 text-[13px]")}>
                    {item.author && <span dir="auto" className="min-w-0 truncate font-medium text-popover-ink">{item.author}</span>}
                    {item.at && <time dateTime={item.at} title={formatFull(item.at, lang, card.tz)}>{formatAbsolute(item.at, now, lang, card.tz)}</time>}
                    {item.tag && <span dir="auto" className="max-w-[8rem] truncate rounded bg-popover-field px-1 text-[11px] leading-4 text-popover-ink" data-record-note-tag>{item.tag}</span>}
                    {item.internal === true && <span className="inline-flex items-center gap-1" data-record-note-scope="internal"><Lock size={11} aria-hidden="true" />{t("recordCard.notes.internal")}</span>}
                    {item.internal === false && <span className="inline-flex items-center gap-1" data-record-note-scope="external"><Globe size={11} aria-hidden="true" />{t("recordCard.notes.external")}</span>}
                  </div>
                  {roomy
                    ? <RecordMarkdown text={item.text} className="pt-0.5 text-[15px] leading-[22px]" />
                    : <p dir="auto" className={cn("whitespace-pre-line break-words text-[13px] leading-[18px]", !pinned && (items.length > 2 ? "line-clamp-1" : "line-clamp-2"))}>{markdownPreview(item.text)}</p>}
                </div>
              </li>
            ))}
          </ol>
          {others > 0 && (
            <MoreLine fitKey="n-others" className={roomy ? "ps-[18px] pt-1" : "ps-4 pt-1"} text={others === 1 ? t("recordCard.notes.otherOne") : t("recordCard.notes.other", { count: others })} />
          )}
        </>
      )}
    </div>
  );
}

/** The records opened on the way (M-20261119-084): each earlier one a link
 * back to it, the one on screen last, in words. Long names go on a second
 * line, never cut. */
function Trail({ trail }: { trail: readonly RecordCardCrumb[] }) {
  const tab = useContext(TabContext);
  return (
    <nav aria-label={t("recordCard.trail")} className="w-full min-w-0 pb-1 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-trail="">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={index} className="flex min-w-0 items-center gap-x-1">
              {index > 0 && <ChevronRight size={12} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />}
              {last || !crumb.onOpen
                ? <span dir="auto" className={cn("min-w-0 break-words", last && "text-popover-ink")} aria-current={last ? "page" : undefined}>{crumb.label}</span>
                : <button type="button" tabIndex={tab} dir="auto" className="min-w-0 break-words rounded text-start hover:text-popover-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={crumb.onOpen} data-record-trail-step={index}>{crumb.label}</button>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Head({ card, label, kindName, product, onClose, onBack, pinned, trail, skeleton = false, chips = card?.chips ?? [] }: Pick<RecordCardProps, "label" | "kindName" | "product" | "onClose" | "onBack" | "trail"> & { card: Card | null; pinned: boolean; skeleton?: boolean; /** the chips this head has room for (the last ones give way first) */ chips?: NonNullable<Card["chips"]> }) {
  const tab = useContext(TabContext);
  const edits = useContext(EditContext);
  const roomy = useContext(RoomyContext);
  // a head chip that is a picker: the chip's own height and words
  const pill = roomy ? "h-6 rounded-full px-2.5" : "h-5 rounded-full";
  const kind = card?.kind.name ?? kindName ?? t("recordCard.kindFallback");
  const shown = card?.number ?? label;
  // a number that is the title, or begins it (a company's or a project's name), is said once; a GUID never
  const hidden = isGuid(shown) || (card ? card.title.trim().toLowerCase().startsWith(shown.trim().toLowerCase()) : false);
  return (
    <div className={cn("relative flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5", pinned && onClose && "pe-9", roomy && "gap-x-2.5 gap-y-1.5 px-6 pt-5", roomy && onClose && "pe-14")} data-record-head>
      {roomy && trail && trail.length > 1 && <Trail trail={trail} />}
      {onBack && (
        <button type="button" tabIndex={tab} className={cn(ICON_BUTTON, "-ms-1.5 -my-1 size-6", roomy && "-ms-2 size-8")} aria-label={t("recordCard.back")} title={t("recordCard.back")} onClick={onBack}>
          <ArrowLeft size={roomy ? 16 : 14} aria-hidden="true" className="rtl:-scale-x-100" />
        </button>
      )}
      <RecordProductMark product={card ? { name: card.product.name, iconUrl: product?.iconUrl } : product} iconUrl={card?.product.icon?.url} className={roomy ? MARK_ROOMY : MARK} />
      <span className={cn("min-w-0 shrink-0 text-[12px] leading-5 text-popover-ink-secondary", roomy && "text-[13px] leading-6")}>{kind}</span>
      {!hidden && <span dir="ltr" className={cn("shrink-0 font-mono text-[13px] leading-5 [unicode-bidi:isolate]", roomy && "text-[14px] leading-6")} title={shown}>{shown}</span>}
      <span className={cn("ms-auto flex max-w-full flex-wrap items-center justify-end gap-1", roomy && "gap-1.5")}>
        {edits?.status && card?.state ? <RecordFieldSelect edit={edits.status} current={card.state.label} leading={<span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[card.state.tone])} />} label={t("recordCard.related.status")} triggerClass={cn(BUTTON_BASE, pill, TONE_CLASS[card.state.tone])} /> : card?.state && <Chip className={cn(TONE_CLASS[card.state.tone], "shrink-0")} title={card.state.label}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[card.state.tone])} /><span className="truncate">{card.state.label}</span></Chip>}
        {edits?.priority && card?.priority ? <RecordFieldSelect edit={edits.priority} current={card.priority.label} leading={(card.priority.level === "urgent" || card.priority.level === "high") && <TriangleAlert size={12} aria-hidden="true" className={LEVEL_GLYPH[card.priority.level]} />} label={t("recordCard.edit.priority")} triggerClass={cn(BUTTON_BASE, pill, LEVEL_CLASS[card.priority.level])} /> : card?.priority && <PriorityChip priority={card.priority} />}
        {chips.map((chip, index) => (
          <Chip key={index} className={cn(TONE_CLASS[chip.tone], "shrink-0")} title={chip.label}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[chip.tone])} /><span className="min-w-0 truncate">{chip.label}</span></Chip>
        ))}
        {skeleton && <Bar className={roomy ? "h-6 w-20 rounded-full" : "h-5 w-16 rounded-full"} />}
      </span>
      {pinned && onClose && (
        <button type="button" tabIndex={tab} className={cn(ICON_BUTTON, "absolute end-1.5 top-2", roomy && "end-3 top-3.5 size-8")} aria-label={t("recordCard.close")} title={t("recordCard.close")} onClick={onClose}>
          <X size={roomy ? 16 : 14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The opened card's title, changed in place (M-20261119-084): a click (or
 * Enter) turns it into a field; Enter or the check saves through the card's
 * write path, Escape or the cross leaves it as it was. Nothing is written on
 * a blur. The saved words stand until the card read again says otherwise. */
function RecordTitle({ title, edit }: { title: string; edit: RecordTitleEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ text: string; on: string }>();
  const shown = done && done.on === title ? done.text : title;
  const value = titleValue(draft);
  const leave = () => {
    setEditing(false);
    setError("");
  };
  const save = async () => {
    if (saving) return;
    if (!value) {
      setError(t("recordCard.title.invalid", { max: RECORD_TITLE_MAX }));
      return;
    }
    if (value === shown) {
      leave();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await edit.save(value);
      setDone({ text: value, on: title });
      setEditing(false);
    } catch {
      setError(t("recordCard.title.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  if (!editing) {
    return (
      <div className="shrink-0 px-6 pb-5 pt-2">
        <button
          type="button"
          className="group -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 text-start text-[20px] font-semibold leading-7 hover:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={t("recordCard.title.edit")}
          aria-label={`${t("recordCard.title.edit")}: ${shown}`}
          onClick={() => { setDraft(shown); setError(""); setEditing(true); }}
          data-record-title=""
        >
          <span dir="auto" className="break-words">{shown}</span>
          <Pencil size={16} aria-hidden="true" className="ms-2 inline-block align-[-2px] text-popover-ink-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 touch:opacity-100" />
        </button>
      </div>
    );
  }
  return (
    <form className="flex shrink-0 flex-col gap-1 px-6 pb-5 pt-2" onSubmit={(event) => { event.preventDefault(); void save(); }} data-record-title-form="">
      <div className="flex items-start gap-1">
        <textarea
          autoFocus
          rows={1}
          maxLength={RECORD_TITLE_MAX}
          value={draft}
          disabled={saving}
          dir="auto"
          aria-label={t("recordCard.title.label")}
          aria-invalid={error ? true : undefined}
          className="-mx-2 min-w-0 flex-1 resize-none rounded-lg bg-popover-field px-2 text-[20px] font-semibold leading-7 text-popover-ink [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void save();
            } else if (event.key === "Escape") {
              // the card stays open: Escape only leaves the field
              event.preventDefault();
              event.stopPropagation();
              leave();
            }
          }}
          data-record-title-input=""
        />
        <button type="submit" className={cn(ICON_BUTTON, ROOMY_ICON_BUTTON)} disabled={saving || !value} aria-label={t("recordCard.title.save")} title={t("recordCard.title.save")} data-record-title-save="">
          {saving ? <RotateCw size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Check size={16} aria-hidden="true" />}
        </button>
        <button type="button" className={cn(ICON_BUTTON, ROOMY_ICON_BUTTON)} disabled={saving} aria-label={t("recordCard.title.cancel")} title={t("recordCard.title.cancel")} onClick={leave} data-record-title-cancel="">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {error && <span role="alert" className="text-[13px] leading-[18px] text-danger">{error}</span>}
    </form>
  );
}

const MISS: Record<RecordCardMiss["state"], { icon: typeof Lock; sentence: string }> = {
  sign_in: { icon: Lock, sentence: "recordCard.state.signIn" },
  no_access: { icon: Lock, sentence: "recordCard.state.noAccess" },
  unknown: { icon: CircleAlert, sentence: "recordCard.state.unknown" },
  not_connected: { icon: WifiOff, sentence: "recordCard.state.notConnected" },
  busy: { icon: CircleAlert, sentence: "recordCard.state.busy" },
  down: { icon: WifiOff, sentence: "recordCard.state.down" },
  unavailable: { icon: CircleAlert, sentence: "recordCard.state.unavailable" },
  org_refused: { icon: ShieldAlert, sentence: "recordCard.state.orgRefused" },
};

function CopyNumber({ text, className = BUTTON, label, first }: { text: string; className?: string; label?: boolean; first?: boolean }) {
  const [done, setDone] = useState(false);
  const tab = useContext(TabContext);
  const roomy = useContext(RoomyContext);
  const run = () => {
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setDone(true);
      setTimeout(() => setDone(false), 1_500);
    });
  };
  const name = done ? t("recordCard.copied") : t("recordCard.copy");
  const size = roomy ? 16 : 14;
  return (
    <button type="button" tabIndex={tab} className={className} aria-label={label ? undefined : name} title={name} onClick={run} data-record-copy {...(first ? { "data-hover-card-first": "" } : {})}>
      {done ? <Check size={size} aria-hidden="true" className="text-success" /> : <Copy size={size} aria-hidden="true" />}
      {label && <span>{name}</span>}
    </button>
  );
}

/** The number copied: the label without its `#`, and never a GUID's. */
export function numberToCopy(card: Card | null, record: RecordRef, label: string): string {
  const raw = card?.number ?? label;
  return (isGuid(raw) ? record.id : raw).replace(/^#/, "").trim();
}

/** The sentence of a state, with the product named when it is known. */
export function missSentence(miss: RecordCardMiss, product: RecordCardProduct | undefined): string {
  return t(MISS[miss.state].sentence as Parameters<typeof t>[0], { product: product?.name ?? t("recordCard.productFallback") });
}

/** The hovered card's outer box: it is the container the stacked layout asks
 * (the space the card has, not the window's), and carries the width. */
function Shell({ wrap, width, frameClass, data, busy, children }: { wrap: RefObject<HTMLDivElement | null>; width: string; frameClass: string; data: Record<string, string>; busy?: boolean; children: ReactNode }) {
  return (
    <div ref={wrap} className={cn("@container", width)} {...data} aria-busy={busy ? "true" : undefined}>
      <div className={frameClass}>{children}</div>
    </div>
  );
}

/** The foot of a card: open on the web, ask, copy the number, "up to date at", refresh. */
function Actions({ card, read, copy, onAsk, split, roomy, loading }: { card: Card; read: RecordCardProps["read"]; copy: string; onAsk?: () => void; split: boolean; roomy: boolean; loading: boolean }) {
  const tab = useContext(TabContext);
  const lang = activeLocale();
  const first = { "data-hover-card-first": "" };
  const openUrl = card.openUrl;
  const icon = roomy ? 16 : 14;
  const clockText = (card.asOf ?? (read.at ? new Date(read.at).toISOString() : undefined));
  const upToDate = clockText ? t("recordCard.upToDate", { time: formatClock(clockText, lang, card.tz) }) : "";
  return (
    <div className={cn("flex shrink-0 flex-nowrap items-center gap-x-0.5 border-t border-popover-hairline px-1.5 py-1", roomy && "gap-x-1 px-4 py-2.5")} data-record-actions>
      {openUrl && (
        // plain words (M-20261119-084): the product's long name is no part of the action
        <button type="button" tabIndex={tab} className={cn(BUTTON_PRIMARY, roomy && ROOMY_BUTTON, "min-w-0 shrink")} onClick={() => { void openExternalLink(openUrl); }} {...first} data-record-open>
          <span className="truncate">{t("recordCard.openWeb")}</span>
        </button>
      )}
      {onAsk && (
        // the label stays for the wide card; narrow, or the hovered left-pane-only card, an icon with its tooltip
        <button type="button" tabIndex={tab} className={cn(BUTTON, "px-1.5", roomy && ROOMY_BUTTON)} onClick={onAsk} aria-label={t("recordCard.ask")} title={t("recordCard.askTitle")} data-record-ask {...(openUrl ? {} : first)}>
          <MessageSquareText size={icon} aria-hidden="true" className="shrink-0" />
          <span className={split || roomy ? "@max-[34rem]:hidden" : "hidden"}>{t("recordCard.ask")}</span>
        </button>
      )}
      <CopyNumber text={copy} className={cn(ICON_BUTTON, roomy && ROOMY_ICON_BUTTON)} first={!openUrl && !onAsk} />
      <span className={cn("ms-auto flex shrink-0 items-center gap-0.5 ps-1 text-[12px] leading-4 text-popover-ink-secondary", roomy && "gap-1.5 text-[13px] leading-[18px]")}>
        {clockText && <time dateTime={clockText} className={cn("whitespace-nowrap", split || roomy ? "@max-[34rem]:hidden" : "hidden")}>{upToDate}</time>}
        <button type="button" tabIndex={tab} className={cn(ICON_BUTTON, roomy && ROOMY_ICON_BUTTON)} aria-label={upToDate ? `${t("recordCard.refresh")}. ${upToDate}` : t("recordCard.refresh")} title={upToDate ? `${upToDate} (${t("recordCard.refresh")})` : t("recordCard.refresh")} onClick={read.refresh} data-record-refresh>
          <RotateCw size={icon} aria-hidden="true" className={cn(loading && "animate-spin motion-reduce:animate-none")} />
        </button>
      </span>
    </div>
  );
}

export function RecordCard({ record, label, kindName, product, read, window: layout, edits, titleEdit, trail, pinned = false, onClose, onAsk, onConnect, onSignIn, onOpenRecord, canOpenRecord, onBack, now: clock }: RecordCardProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const stacked = useStacked(wrap, pinned ? RECORD_CARD_OPEN_STACK_REM : RECORD_CARD_STACK_REM);
  // below this a head has no room for a second chip: its words move into the body
  const narrowHead = useStacked(wrap, 30);
  const lang = activeLocale();
  const now = clock ?? Date.now();
  const { card, miss, loading } = read;
  const productName = card?.product.name ?? product?.name;
  const copy = numberToCopy(card, record, label);
  const description = card?.description?.text;
  const hasNotes = Boolean(card && (card.notes.items.length > 0 || (card.notes.total ?? 0) > card.notes.items.length || card.notes.state === "forbidden" || card.notes.state === "unavailable"));
  const hasLines = Boolean(card?.lines && (card.lines.items.length > 0 || (card.lines.total ?? 0) > card.lines.items.length || card.lines.state === "forbidden" || card.lines.state === "unavailable"));
  // the layout is the data's: a text, a list or an activity makes the two-pane card, none the single pane
  // a text of one short line is a row above the fields of the single-pane card, not a nearly empty pane
  const shortText = Boolean(description && !hasLines && !hasNotes && card?.fields?.length && description.length <= SHORT_TEXT_MAX && !description.includes("\n"));
  const right = Boolean(card && ((description && !shortText) || hasLines || hasNotes));
  // a card of typed fields sizes its field pane from what the rows need (a share of the card, not a fixed ratio)
  const sized = Boolean(card?.fields?.some((field) => field.type));
  const split = !card || right;
  // the opened card is the record window (M-20261127-101): its frame, its head and its foot are every kind's
  const roomy = pinned;
  // wider than tall, never taller than wide: stacked (a narrow space), the
  // card is no taller than it is wide
  const surface = "flex-col overflow-hidden rounded-xl popover-surface menu-surface [background-color:var(--float-fill)] [box-shadow:var(--float-shadow)]";
  const frame = cn("flex w-full max-h-[min(20rem,var(--hover-card-room,calc(100vh-1rem)))] @max-[34rem]:max-h-[min(100cqw,var(--hover-card-room,calc(100vh-1rem)))]", surface, "text-[13px] leading-5 text-popover-ink");
  const width = split ? "w-[min(40rem,calc(100vw-1rem))]" : "w-[min(22rem,calc(100vw-1rem))]";
  const data = { "data-record-card-body": "", "data-layout": split || layout ? "split" : "compact", "data-record-state": card ? "card" : miss ? miss.state : "loading" };
  const tab = pinned ? undefined : -1;
  const first = { "data-hover-card-first": "" };
  const openUrl = card?.openUrl;
  const productLabel = productName ?? product?.name;

  const head = (skeleton = false, chips?: NonNullable<Card["chips"]>) => (
    <Head card={card} label={label} kindName={kindName} product={product} onClose={onClose} onBack={onBack} pinned={pinned} trail={trail} skeleton={skeleton} {...(chips ? { chips } : {})} />
  );

  // no card: one icon, one sentence and its one action
  const missBody = (() => {
    if (card || !miss) return null;
    const { icon: Icon } = MISS[miss.state];
    const primary = cn(BUTTON_PRIMARY, roomy && ROOMY_BUTTON);
    const action = (() => {
      if (miss.state === "down") return <button type="button" tabIndex={tab} className={primary} onClick={read.refresh} {...first}>{t("recordCard.retry")}</button>;
      if (miss.state === "not_connected" && onConnect) return <button type="button" tabIndex={tab} className={primary} onClick={onConnect} {...first}>{t("recordCard.connect")}</button>;
      if (miss.state === "sign_in" && onSignIn) return <button type="button" tabIndex={tab} className={primary} onClick={onSignIn} {...first}>{t("recordCard.signIn")}</button>;
      return null;
    })();
    return (
      <>
        <div role="status" className={cn("flex shrink-0 flex-col items-center gap-1 px-6 pb-1 pt-4 text-center", roomy && "gap-2 pb-2 pt-10")} title={miss.rule?.text}>
          <Icon size={roomy ? 20 : 16} aria-hidden="true" className="text-popover-ink-secondary" />
          <p className={cn("max-w-[28rem] text-[13px] leading-5", roomy && "max-w-[32rem] text-[15px] leading-[22px]")}>{missSentence(miss, product)}</p>
        </div>
        <div className={cn("flex shrink-0 flex-wrap items-center justify-center gap-1 px-2 pb-2.5 pt-1", roomy && "gap-2 px-6 pb-10 pt-2")}>
          {action}
          <CopyNumber text={copy} label first={!action} className={cn(action ? BUTTON : BUTTON_PRIMARY, roomy && ROOMY_BUTTON)} />
        </div>
      </>
    );
  })();

  const providers = (children: ReactNode) => (
    <TabContext.Provider value={tab}>
      <RoomyContext.Provider value={roomy}>
      <RefContext.Provider value={{ open: onOpenRecord, can: canOpenRecord }}>
      <EditContext.Provider value={card ? edits : undefined}>
      <SeeAllContext.Provider value={{ url: openUrl, product: productLabel }}>
        {children}
      </SeeAllContext.Provider>
      </EditContext.Provider>
      </RefContext.Provider>
      </RoomyContext.Provider>
    </TabContext.Provider>
  );

  if (roomy) {
    const type = recordWindowType(record);
    const chips = card?.chips ?? [];
    const title = card && (titleEdit
      ? <RecordTitle key={`${record.product}/${record.kind}/${record.id}`} title={card.title} edit={titleEdit} />
      : <p dir="auto" className="shrink-0 break-words px-6 pb-4 pt-2 text-[20px] font-semibold leading-7" title={card.title}>{card.title}</p>);
    const body = (() => {
      if (missBody) return <div className="record-scroll min-h-0 flex-1 overflow-y-auto">{missBody}</div>;
      if (!card) {
        // loading: a skeleton on each side
        const pane = "flex min-w-0 flex-col gap-4 px-6 py-5";
        return (
          <div className="flex min-h-0 flex-1 @max-[34rem]:flex-col" data-record-panes="">
            <div className={cn(pane, "@min-[34rem]:w-[22rem] @min-[34rem]:border-e @min-[34rem]:border-popover-hairline")}>
              <Bar className="h-5 w-4/5" /><Bar className="h-5 w-3/5" /><Bar className="h-5 w-2/5" />
            </div>
            <div className={cn(pane, "@min-[34rem]:flex-1")}>
              <Bar className="h-5 w-full" /><Bar className="h-5 w-11/12" /><Bar className="h-5 w-2/3" />
            </div>
            <span role="status" className="sr-only">{t("recordCard.loading")}</span>
          </div>
        );
      }
      if (layout) return layout.body;
      const people = card.people ?? [];
      const owner = people.find((person) => person.role === "owner");
      const others = people.filter((person) => person !== owner);
      const companyOpen = openerFor({ open: onOpenRecord, can: canOpenRecord }, card.company?.ref);
      const company = card.company && (card.company.ref && companyOpen
        ? <RecordRefChip name={card.company.name} refTo={card.company.ref} onOpen={companyOpen} slot="company" />
        : <span dir="auto" className="min-w-0 flex-1 break-words" title={card.company.name}>{card.company.name}</span>);
      // the company and the people are facts like the others, each under its label
      const personLabel = (person: NonNullable<Card["people"]>[number]) => person.label || (person.role === "owner" ? t("recordCard.edit.owner") : person.role === "contact" ? t("recordCard.edit.contact") : person.role);
      const lead: FactRow[] = [
        ...(card.company ? [{
          key: "company", label: t("recordCard.company"),
          value: <span className="flex min-w-0 items-start gap-2" data-record-company><span aria-hidden="true" className="flex h-[22px] shrink-0 items-center text-popover-ink-secondary"><Building2 size={16} /></span>{company}</span>,
        }] : []),
        ...[...others, ...(owner ? [owner] : [])].map((person, index) => ({
          key: `person-${index}`, label: personLabel(person),
          value: <span className="flex min-w-0 items-start gap-2" data-record-person={person.role}><PersonLine role={person.role} label={personLabel(person)} name={person.name} detail={person.detail} personRef={person.ref} labelled /></span>,
        })),
      ];
      const facts = (
        <div data-record-pane="left" className="flex flex-col gap-4 px-6 py-5">
          {shortText && <p dir="auto" className="whitespace-pre-line break-words" data-record-description>{markdownPreview(description!)}</p>}
          <Facts card={card} now={now} lang={lang} chipRows={narrowHead ? chips.slice(1) : []} lead={lead} pairs={!right} />
        </div>
      );
      // each side scrolls on its own (M-20261127-124); a record with nothing to say has its facts only
      if (!right) return <div className="record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" data-record-side="left">{facts}</div>;
      return (
        <RecordSplit
          type={type}
          fallback={sized ? 440 : 380}
          left={facts}
          right={
            <div data-record-pane="right" className="flex flex-col gap-4 px-6 py-5">
              {description && !shortText && <div className="shrink-0" data-record-description><RecordMarkdown text={description} /></div>}
              {hasNotes && <Notes card={card} now={now} lang={lang} description={description} above={Boolean(description)} pinned stacked={stacked} />}
              {hasLines && <Lines card={card} above={Boolean(description || hasNotes)} pinned folded={hasNotes} />}
            </div>
          }
        />
      );
    })();
    return providers(
        <RecordWindow
          type={type}
          frameRef={wrap}
          data={data}
          busy={card ? loading : !miss}
          head={<>{head(!card && !miss, narrowHead ? chips.slice(0, 1) : chips)}{title ?? (!card && !miss ? <div className="shrink-0 px-6 pb-5 pt-2.5"><Bar className="h-7 w-3/5" /></div> : <div className="pb-4" />)}</>}
          tabs={card ? layout?.tabs : undefined}
          foot={card ? <Actions card={card} read={read} copy={copy} onAsk={onAsk} split={split} roomy loading={loading} /> : undefined}
        >
          {body}
        </RecordWindow>,
    );
  }

  const content = (() => {
    // no card: the head, then one icon, one sentence and its one action
    if (missBody) return <>{head()}{missBody}</>;

    // loading: the head at once, a skeleton in each pane
    if (!card) {
      const pane = "flex min-w-0 flex-col gap-2 px-3 py-2.5";
      const bar = "h-4";
      return (
        <>
          {head(true)}
          <div className="shrink-0 px-3 pb-2.5 pt-1.5"><Bar className="h-5 w-3/5" /></div>
          <div className="flex min-h-0 flex-1 border-t border-popover-hairline @max-[34rem]:flex-col">
            <div className={cn(pane, "@min-[34rem]:flex-[2_1_0%] @min-[34rem]:border-e @min-[34rem]:border-popover-hairline")}>
              <Bar className={cn(bar, "w-4/5")} />
              <Bar className={cn(bar, "w-3/5")} />
              <Bar className={cn(bar, "w-2/5")} />
            </div>
            <div className={cn(pane, "@min-[34rem]:flex-[3_1_0%] @max-[34rem]:border-t @max-[34rem]:border-popover-hairline")}>
              <Bar className={cn(bar, "w-full")} />
              <Bar className={cn(bar, "w-11/12")} />
              <Bar className={cn(bar, "w-2/3")} />
            </div>
          </div>
          <span role="status" className="sr-only">{t("recordCard.loading")}</span>
        </>
      );
    }

    const chips = card.chips ?? [];
    const headChips = narrowHead ? chips.slice(0, 1) : chips;
    const chipRows = narrowHead ? chips.slice(1) : [];
    const people = card.people ?? [];
    const owner = people.find((person) => person.role === "owner");
    const others = people.filter((person) => person !== owner);
    const showPeopleBlock = Boolean(card.company || people.length);
    const companyOpen = openerFor({ open: onOpenRecord, can: canOpenRecord }, card.company?.ref);
    const company = card.company && (card.company.ref && companyOpen ? (
      <RecordRefChip name={card.company.name} refTo={card.company.ref} onOpen={companyOpen} slot="company" />
    ) : (
      <span dir="auto" className="min-w-0 flex-1 truncate" title={card.company.name}>{card.company.name}</span>
    ));
    const hasFields = Boolean(card.fields?.length || (edits && Object.keys(edits).length));

    const panes = (
      <>
        {/* side by side each pane keeps whole rows; stacked, the body does */}
        <Pane pinned={pinned} fit={stacked} moreClass="px-3 pb-2 pt-2" moreRoom={16 + 8 + 8} className="flex flex-1 border-t border-popover-hairline @max-[34rem]:flex-col" data-record-panes="">
          <Pane pinned={pinned} fit={!stacked} data-record-pane="left" className={cn("flex flex-col gap-2 px-3 py-2", right ? cn(sized ? "@min-[34rem]:flex-[0_1_auto] @min-[34rem]:min-w-[45%] @min-[34rem]:max-w-[60%]" : "@min-[34rem]:flex-[2_1_0%]", "@min-[34rem]:border-e @min-[34rem]:border-popover-hairline @max-[34rem]:shrink-0 @max-[34rem]:border-b @max-[34rem]:border-popover-hairline") : "flex-1", stacked && "!overflow-visible [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden")}>
            {showPeopleBlock && (
              <div className="flex flex-col gap-1">
                {card.company && (
                  <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-company data-fit-row="p-company">
                    <Building2 size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
                    {company}
                  </div>
                )}
                {others.map((person, index) => <PersonRow key={`${person.role}-${index}`} person={person} fitKey={`p-${index}`} />)}
                {owner && <PersonRow person={owner} fitKey="p-owner" />}
              </div>
            )}
            {shortText && <p dir="auto" className="whitespace-pre-line break-words" data-record-description data-fit-row="desc">{markdownPreview(description!)}</p>}
            <Facts card={card} now={now} lang={lang} part={stacked && right ? "dates" : "all"} chipRows={chipRows} />
          </Pane>
          {right && (
            <Pane pinned={pinned} fit={!stacked} data-record-pane="right" className={cn("flex flex-col gap-2 px-3 py-2", sized ? "@min-[34rem]:flex-1" : "@min-[34rem]:flex-[3_1_0%]", "@max-[34rem]:shrink-0", stacked && "!overflow-visible [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden")}>
              {description && <p dir="auto" className={cn("shrink-0 whitespace-pre-line break-words", hasNotes ? (card.notes.items.length > 2 ? "line-clamp-1" : "line-clamp-2") : "line-clamp-4")} data-record-description data-fit-row="desc">{markdownPreview(description)}</p>}
              {/* the latest activity comes before a list: a hovered card drops whole rows from the foot */}
              {hasNotes && <Notes card={card} now={now} lang={lang} description={description} above={Boolean(description)} pinned={pinned} stacked={stacked} />}
              {hasLines && <Lines card={card} above={Boolean(description || hasNotes)} pinned={pinned} folded={hasNotes} />}
            </Pane>
          )}
          {/* a card not wider than tall says who and what it says first; the key fields come last (and are the first dropped) */}
          {stacked && right && hasFields ? (
            <div className="flex shrink-0 flex-col gap-2 border-t border-popover-hairline px-3 py-2 [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden">
              <Facts card={card} now={now} lang={lang} part="fields" />
            </div>
          ) : null}
        </Pane>
      </>
    );

    return (
      <>
        {head(false, headChips)}
        <p dir="auto" className="line-clamp-2 shrink-0 break-words px-3 pb-2 pt-0.5 text-[15px] font-semibold leading-5" title={card.title}>{card.title}</p>
        {panes}
        <Actions card={card} read={read} copy={copy} onAsk={onAsk} split={split} roomy={false} loading={loading} />
      </>
    );
  })();

  return providers(
    <Shell wrap={wrap} width={width} frameClass={frame} data={data} busy={card ? loading : !miss}>
      {content}
    </Shell>,
  );
}
