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
// Every word of a card is the console's data: this file names no product and
// no kind, branches on neither, and reads only the tones, the levels, the two
// roles `contact` and `owner` (for their icons) and the date keys. It paints
// from the popover tokens and the menu family's surface; nothing here writes
// a colour, a radius or a shadow of its own. Measured on the reference app
// (docs/design/ux-reference-grokbot-cursor.md, "Record card").
//
// Parts of the skeleton pulse and the notes rail are adapted from Arc,
// Copyright (c) 2026 Elia Kuratli, used under the MIT License
// (third_party/arc-library/LICENSE).
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleAlert, Copy, Lock, MessageSquareText, RotateCw, ShieldAlert, TriangleAlert, UserCheck, UserRound, WifiOff, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatClock, formatFull, formatLateness, formatRelative, isGuid, percentValue, sameText } from "@/lib/record-card-format";
import { fitRows, moreKind, type MoreKind } from "@/lib/record-card-fit";
import { prefetchRecordCard, type UseRecordCard } from "@/lib/record-cards";
import { ServiceIcon } from "@/components/plugins/PluginParts";
import { REF_PILL_CLASS } from "@/components/ref-pill";
import type { RecordCard as Card, RecordCardMiss, RecordLevel, RecordRef, RecordTone } from "../../shared/record-cards";

/** The width below which the panes stack (the available width, in rem). */
export const RECORD_CARD_STACK_REM = 34;

export interface RecordCardProduct {
  name: string;
  /** the product's mark (the product list's `icon.url`, https); none: the neutral tile */
  iconUrl?: string;
}

export interface RecordCardProps {
  record: RecordRef;
  /** the link's own text: the head's number while the card loads */
  label: string;
  /** the kind's name in the person's language, from the product list */
  kindName?: string;
  product?: RecordCardProduct;
  read: Pick<UseRecordCard, "card" | "miss" | "loading" | "at" | "refresh" | "confirm">;
  pinned?: boolean;
  onClose?: () => void;
  /** put the record in the open conversation's composer (absent: no action) */
  onAsk?: () => void;
  /** open the product's page in Connect Apps */
  onConnect?: () => void;
  /** the app's own sign-in again */
  onSignIn?: () => void;
  /** a record the card names (its company): shown as a chip that opens that card in place */
  onOpenRecord?: (ref: RecordRef, label: string) => void;
  /** back to the card this one replaced */
  onBack?: () => void;
  /** the clock, for a test or a gallery that holds time still */
  now?: number;
}

const MARK = "size-4 shrink-0 rounded-[4px]";

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

/** Hovered, the card is a tooltip: it holds no control in the tab order until
 * it is pinned (a dialog). Every button reads this. */
const TabContext = createContext<number | undefined>(undefined);

// A chip's words are in the popover ink over the tone's own tint (4.5:1 in
// every skin, scripts/check-skin-contrast.mjs); the tone is a dot or a glyph.
const TONE_CLASS: Record<RecordTone, string> = {
  open: "bg-popover-field",
  waiting: "bg-warning/15",
  done: "bg-success/15",
  alert: "bg-danger/15",
};
const TONE_DOT: Record<RecordTone, string> = {
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
  return <span title={title} role={role} aria-label={label} className={cn("inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-full px-2 text-[12px] leading-4 text-popover-ink", className)}>{children}</span>;
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
      // a pinned card shows every row; a pane that does not fit leaves the rows
      // alone (the rows of another pane, inside it, are that pane's to hide)
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
function useStacked(ref: RefObject<HTMLElement | null>): boolean {
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // no layout (a test renderer) reads as wide
      setStacked(el.clientWidth > 0 && el.clientWidth < RECORD_CARD_STACK_REM * rem);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref]);
  return stacked;
}

function PersonRow({ person, fitKey }: { person: NonNullable<Card["people"]>[number]; fitKey: string }) {
  const Icon = person.role === "owner" ? UserCheck : UserRound;
  return (
    <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-person={person.role} data-fit-row={fitKey} title={person.label ? `${person.label}: ${person.name}` : person.name}>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      {person.label && <span className="sr-only">{person.label}: </span>}
      {/* the name gives way, the number beside it does not */}
      <span dir="auto" className="min-w-0 truncate">{person.name}</span>
      {person.detail && <span dir="ltr" className="shrink-0 whitespace-nowrap text-popover-ink-secondary [unicode-bidi:isolate]">{person.detail}</span>}
    </div>
  );
}

/** A company a ticket names: the record chip of that company. Resting on it
 * (300 ms) or a click opens the company's card in this card's place. */
function CompanyChip({ name, companyRef, onOpen }: { name: string; companyRef: RecordRef; onOpen: (ref: RecordRef, label: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => clear, []);
  const tab = useContext(TabContext);
  return (
    <button
      type="button"
      tabIndex={tab}
      dir="auto"
      title={name}
      data-record-company-link
      className={cn(REF_PILL_CLASS, "-ms-1.5 min-w-0 max-w-full items-center truncate font-sans text-[1em] no-underline")}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        prefetchRecordCard(companyRef);
        clear();
        timer.current = setTimeout(() => onOpen(companyRef, name), 300);
      }}
      onPointerLeave={clear}
      onClick={() => { clear(); onOpen(companyRef, name); }}
    >
      <span className="truncate">{name}</span>
    </button>
  );
}

function PriorityChip({ priority, onClip }: { priority: NonNullable<Card["priority"]>; onClip?: (clipped: boolean) => void }) {
  const text = useRef<HTMLSpanElement>(null);
  // a narrow head cuts the label (to its glyph at worst): the card says so, and
  // its body then says the full name once
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || !onClip) return;
    const measure = () => onClip(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [onClip, priority.label]);
  return (
    <Chip className={cn(LEVEL_CLASS[priority.level], "min-w-8")} title={priority.label} role="img" label={priority.label}>
      {(priority.level === "urgent" || priority.level === "high") && <TriangleAlert size={12} aria-hidden="true" className={cn("shrink-0", LEVEL_GLYPH[priority.level])} />}
      <span ref={text} className="max-w-[11rem] min-w-0 truncate">{priority.label}</span>
    </Chip>
  );
}

/** The dates and key fields as one description list. */
function Facts({ card, now, lang, part = "all", showPriority = false }: { card: Card; now: number; lang: string; part?: "all" | "dates" | "fields"; showPriority?: boolean }) {
  const tz = card.tz;
  const rows: Array<{ label: string; value: ReactNode; gap?: boolean; key: string }> = [];
  const dates = card.dates ?? {};
  const time = (iso: string, mode: "relative" | "absolute") => (
    <time dateTime={iso} title={formatFull(iso, lang, tz)}>{mode === "relative" ? formatRelative(iso, now, lang) : formatAbsolute(iso, now, lang, tz)}</time>
  );
  // a narrow head that cuts the priority chip: the full name is a row of the body, once
  if (showPriority && card.priority) rows.push({ key: "priority", label: t("recordCard.priority"), value: <span dir="auto">{card.priority.label}</span> });
  if (dates.opened) rows.push({ key: "opened", label: t("recordCard.date.opened"), value: time(dates.opened, "relative") });
  if (dates.updated) rows.push({ key: "updated", label: t("recordCard.date.updated"), value: time(dates.updated, "relative") });
  if (dates.due) {
    const late = card.state?.tone === "done" || dates.closed ? null : formatLateness(dates.due, now, lang);
    rows.push({
      key: "due",
      label: t("recordCard.date.due"),
      value: late ? (
        <span>{time(dates.due, "absolute")}<span className="ms-1.5 inline-flex items-center gap-1 font-medium"><CircleAlert size={12} aria-hidden="true" className="text-danger" />{t("recordCard.late", { duration: late })}</span></span>
      ) : time(dates.due, "absolute"),
    });
  }
  if (dates.closed) rows.push({ key: "closed", label: t("recordCard.date.closed"), value: time(dates.closed, "absolute") });
  const dateCount = rows.length;
  (card.fields ?? []).forEach((field, index) => {
    const share = percentValue(field.value);
    rows.push({
      key: `field-${index}`,
      label: field.label,
      value: share === null ? <span dir="auto">{field.value}</span> : (
        <span className="flex items-center gap-2" data-record-percent>
          <span className="shrink-0">{field.value}</span>
          <span role="progressbar" aria-label={field.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-popover-field">
            <span className="block h-full rounded-full bg-popover-accent" style={{ width: `${share}%` }} />
          </span>
        </span>
      ),
      gap: dateCount > 0 && index === 0,
    });
  });
  const shown = part === "all" ? rows : part === "dates" ? rows.slice(0, dateCount) : rows.slice(dateCount).map((row) => ({ ...row, gap: false }));
  if (!shown.length) return null;
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-[13px] leading-[18px]" data-record-facts>
        {shown.map((row) => (
          <div key={row.key} className="contents">
            <dt data-fit-row={`f-${row.key}`} className={cn("max-w-[9rem] truncate whitespace-nowrap text-[12px] leading-4 text-popover-ink-secondary", row.gap && "mt-1")} title={row.label}>{row.label}</dt>
            <dd data-fit-row={`f-${row.key}`} className={cn("min-w-0 break-words", row.gap && "mt-1")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Notes({ card, now, lang, description, pinned, stacked }: { card: Card; now: number; lang: string; description?: string; pinned: boolean; stacked: boolean }) {
  const { notes } = card;
  const [open, setOpen] = useState(false);
  const tab = useContext(TabContext);
  if (notes.state === "forbidden") return <p data-fit-row="n-state" className="text-[12px] leading-4 text-popover-ink-secondary">{t("recordCard.notes.forbidden")}</p>;
  if (notes.state === "unavailable") return <p data-fit-row="n-state" className="text-[12px] leading-4 text-popover-ink-secondary">{t("recordCard.notes.unavailable")}</p>;
  // a note that is the description's own text is shown once
  const items = notes.items.filter((item) => !description || !sameText(item.text, description));
  const others = notes.total !== undefined ? Math.max(0, notes.total - notes.items.length) : 0;
  if (!items.length && !others) return null;
  const count = notes.total ?? items.length;
  // a card that is not wider than tall keeps its notes behind one row
  const folded = stacked && !open;
  const title = t("recordCard.notes.title", { count });
  return (
    <div className="flex flex-col" data-record-notes>
      {stacked && (pinned ? (
        <div data-fit-row="n-title" className={cn(description && "border-t border-popover-hairline pt-1")}>
          <button type="button" tabIndex={tab} aria-expanded={open} className={cn(BUTTON, "-ms-2 justify-start text-popover-ink-secondary")} onClick={() => setOpen((value) => !value)}>
            <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 transition-transform rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
            <span>{title}</span>
          </button>
        </div>
      ) : (
        <p data-fit-row="n-title" className={cn("flex items-center gap-1.5 text-[12px] leading-4 text-popover-ink-secondary", description && "border-t border-popover-hairline pt-2")}>
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
          <span>{title}</span>
        </p>
      ))}
      {!folded && (
        <>
          <ol className="flex flex-col">
            {items.map((item, index) => (
              <li key={index} className={cn("relative flex gap-2.5 pb-2.5 last:pb-0", index === 0 && description && !stacked && "border-t border-popover-hairline pt-2")} data-record-note data-fit-row={`n-${index}`}>
                <span aria-hidden="true" className="relative flex w-1.5 shrink-0 justify-center">
                  <span className="mt-[7px] size-1.5 rounded-full bg-popover-ink-secondary" />
                  {(index < items.length - 1 || others > 0) && <span className="absolute inset-y-[15px] start-1/2 w-px -translate-x-1/2 bg-popover-hairline" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] leading-5 text-popover-ink-secondary">
                    {item.author && <span dir="auto" className="min-w-0 truncate font-medium text-popover-ink">{item.author}</span>}
                    {item.at && <time dateTime={item.at} title={formatFull(item.at, lang, card.tz)}>{formatAbsolute(item.at, now, lang, card.tz)}</time>}
                    {item.internal === true && <span className="inline-flex items-center gap-1"><Lock size={11} aria-hidden="true" />{t("recordCard.notes.internal")}</span>}
                  </div>
                  <p dir="auto" className={cn("whitespace-pre-line break-words text-[13px] leading-5", !pinned && "line-clamp-2")}>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {others > 0 && (
            <p data-fit-row="n-others" className="ps-4 pt-1 text-[12px] leading-4 text-popover-ink-secondary">
              {others === 1 ? t("recordCard.notes.otherOne") : t("recordCard.notes.other", { count: others })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Head({ card, label, kindName, product, onClose, onBack, pinned, skeleton = false, onPriorityClip }: Pick<RecordCardProps, "label" | "kindName" | "product" | "onClose" | "onBack"> & { card: Card | null; pinned: boolean; skeleton?: boolean; onPriorityClip?: (clipped: boolean) => void }) {
  const tab = useContext(TabContext);
  const kind = card?.kind.name ?? kindName ?? t("recordCard.kindFallback");
  const shown = card?.number ?? label;
  // a number that is the title, or begins it (a company's or a project's name), is said once; a GUID never
  const hidden = isGuid(shown) || (card ? card.title.trim().toLowerCase().startsWith(shown.trim().toLowerCase()) : false);
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 px-3 pt-2.5" data-record-head>
      {onBack && (
        <button type="button" tabIndex={tab} className={cn(ICON_BUTTON, "-ms-1.5 -my-1 size-6")} aria-label={t("recordCard.back")} title={t("recordCard.back")} onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" className="rtl:-scale-x-100" />
        </button>
      )}
      <RecordProductMark product={card ? { name: card.product.name, iconUrl: product?.iconUrl } : product} iconUrl={card?.product.icon?.url} />
      <span className="min-w-0 shrink-0 text-[12px] leading-5 text-popover-ink-secondary">{kind}</span>
      {!hidden && <span dir="ltr" className="shrink-0 font-mono text-[13px] leading-5 [unicode-bidi:isolate]" title={shown}>{shown}</span>}
      <span className="ms-auto flex min-w-0 items-center gap-1">
        {card?.state && <Chip className={cn(TONE_CLASS[card.state.tone], "shrink-0")} title={card.state.label}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[card.state.tone])} /><span className="max-w-[9rem] truncate">{card.state.label}</span></Chip>}
        {card?.priority && <PriorityChip priority={card.priority} onClip={onPriorityClip} />}
        {skeleton && <Bar className="h-5 w-16 rounded-full" />}
        {pinned && onClose && (
          <button type="button" tabIndex={tab} className={cn(ICON_BUTTON, "-me-1.5")} aria-label={t("recordCard.close")} title={t("recordCard.close")} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
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
  org_ask: { icon: ShieldAlert, sentence: "recordCard.state.orgAsk" },
};

function CopyNumber({ text, className = BUTTON, label, first }: { text: string; className?: string; label?: boolean; first?: boolean }) {
  const [done, setDone] = useState(false);
  const tab = useContext(TabContext);
  const run = () => {
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setDone(true);
      setTimeout(() => setDone(false), 1_500);
    });
  };
  const name = done ? t("recordCard.copied") : t("recordCard.copy");
  return (
    <button type="button" tabIndex={tab} className={className} aria-label={label ? undefined : name} title={name} onClick={run} data-record-copy {...(first ? { "data-hover-card-first": "" } : {})}>
      {done ? <Check size={14} aria-hidden="true" className="text-success" /> : <Copy size={14} aria-hidden="true" />}
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

/** The card's outer box: it is the container the stacked layout asks (the
 * space the card has, not the window's), and carries the width. */
function Shell({ wrap, width, frameClass, data, busy, children }: { wrap: RefObject<HTMLDivElement | null>; width: string; frameClass: string; data: Record<string, string>; busy?: boolean; children: ReactNode }) {
  return (
    <div ref={wrap} className={cn("@container", width)} {...data} aria-busy={busy ? "true" : undefined}>
      <div className={frameClass}>{children}</div>
    </div>
  );
}

export function RecordCard({ record, label, kindName, product, read, pinned = false, onClose, onAsk, onConnect, onSignIn, onOpenRecord, onBack, now: clock }: RecordCardProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const stacked = useStacked(wrap);
  const [priorityClipped, setPriorityClipped] = useState(false);
  const lang = activeLocale();
  const now = clock ?? Date.now();
  const { card, miss, loading } = read;
  const productName = card?.product.name ?? product?.name;
  const copy = numberToCopy(card, record, label);
  const description = card?.description?.text;
  const hasNotes = Boolean(card && (card.notes.items.length > 0 || (card.notes.total ?? 0) > card.notes.items.length || card.notes.state === "forbidden" || card.notes.state === "unavailable"));
  const right = Boolean(card && (description || hasNotes));
  const split = !card || right;
  // wider than tall, never taller than wide: stacked (a narrow space), the
  // card is no taller than it is wide
  const frame = "flex w-full max-h-[min(20rem,calc(100vh-1rem))] @max-[34rem]:max-h-[min(100cqw,calc(100vh-1rem))] flex-col overflow-hidden rounded-xl popover-surface menu-surface text-[13px] leading-5 text-popover-ink";
  const width = split ? "w-[min(40rem,calc(100vw-1rem))]" : "w-[min(22rem,calc(100vw-1rem))]";
  const data = { "data-record-card-body": "", "data-layout": split ? "split" : "compact", "data-record-state": card ? "card" : miss ? miss.state : "loading" };
  const tab = pinned ? undefined : -1;

  // no card: the head, then one icon, one sentence and its one action
  if (!card && miss) {
    const { icon: Icon } = MISS[miss.state];
    const first = { "data-hover-card-first": "" };
    const action = (() => {
      if (miss.state === "org_ask") return <button type="button" tabIndex={tab} className={BUTTON_PRIMARY} onClick={read.confirm} {...first}>{t("recordCard.readRecord")}</button>;
      if (miss.state === "down") return <button type="button" tabIndex={tab} className={BUTTON_PRIMARY} onClick={read.refresh} {...first}>{t("recordCard.retry")}</button>;
      if (miss.state === "not_connected" && onConnect) return <button type="button" tabIndex={tab} className={BUTTON_PRIMARY} onClick={onConnect} {...first}>{t("recordCard.connect")}</button>;
      if (miss.state === "sign_in" && onSignIn) return <button type="button" tabIndex={tab} className={BUTTON_PRIMARY} onClick={onSignIn} {...first}>{t("recordCard.signIn")}</button>;
      return null;
    })();
    return (
      <TabContext.Provider value={tab}>
        <Shell wrap={wrap} width={width} frameClass={frame} data={data}>
          <Head card={null} label={label} kindName={kindName} product={product} onClose={onClose} onBack={onBack} pinned={pinned} />
          <div role="status" className="flex shrink-0 flex-col items-center gap-1 px-6 pb-1 pt-4 text-center" title={miss.rule?.text}>
            <Icon size={16} aria-hidden="true" className="text-popover-ink-secondary" />
            <p className="max-w-[28rem] text-[13px] leading-5">{missSentence(miss, product)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 px-2 pb-2.5 pt-1">
            {action}
            <CopyNumber text={copy} label first={!action} className={action ? BUTTON : BUTTON_PRIMARY} />
          </div>
        </Shell>
      </TabContext.Provider>
    );
  }

  // loading: the head at once, a skeleton in each pane
  if (!card) {
    return (
      <TabContext.Provider value={tab}>
        <Shell wrap={wrap} width={width} frameClass={frame} data={data} busy>
          <Head card={null} label={label} kindName={kindName} product={product} onClose={onClose} onBack={onBack} pinned={pinned} skeleton />
          <div className="shrink-0 px-3 pb-2.5 pt-1.5"><Bar className="h-5 w-3/5" /></div>
          <div className="flex min-h-0 flex-1 border-t border-popover-hairline @max-[34rem]:flex-col">
            <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 @min-[34rem]:flex-[2_1_0%] @min-[34rem]:border-e @min-[34rem]:border-popover-hairline">
              <Bar className="h-4 w-4/5" />
              <Bar className="h-4 w-3/5" />
              <Bar className="h-4 w-2/5" />
            </div>
            <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 @min-[34rem]:flex-[3_1_0%] @max-[34rem]:border-t @max-[34rem]:border-popover-hairline">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-11/12" />
              <Bar className="h-4 w-2/3" />
            </div>
          </div>
          <span role="status" className="sr-only">{t("recordCard.loading")}</span>
        </Shell>
      </TabContext.Provider>
    );
  }

  const people = card.people ?? [];
  const owner = people.find((person) => person.role === "owner");
  const others = people.filter((person) => person !== owner);
  const showPeopleBlock = Boolean(card.company || people.length);
  const openUrl = card.openUrl;
  const clockText = (card.asOf ?? (read.at ? new Date(read.at).toISOString() : undefined));
  const productLabel = productName ?? product?.name;
  const upToDate = clockText ? t("recordCard.upToDate", { time: formatClock(clockText, lang, card.tz) }) : "";
  const first = { "data-hover-card-first": "" };

  return (
    <TabContext.Provider value={tab}>
      <Shell wrap={wrap} width={width} frameClass={frame} data={data} busy={loading}>
        <Head card={card} label={label} kindName={kindName} product={product} onClose={onClose} onBack={onBack} pinned={pinned} onPriorityClip={setPriorityClipped} />
        <p dir="auto" className="line-clamp-2 shrink-0 break-words px-3 pb-2 pt-0.5 text-[15px] font-semibold leading-5" title={card.title}>{card.title}</p>
        {/* side by side each pane keeps whole rows (or scrolls, pinned); stacked, the body does */}
        <Pane pinned={pinned} fit={stacked} moreClass="px-3 pb-2 pt-2" moreRoom={16 + 8 + 8} className="flex flex-1 border-t border-popover-hairline @max-[34rem]:flex-col" data-record-panes="">
          <Pane pinned={pinned} fit={!stacked} data-record-pane="left" className={cn("flex flex-col gap-2 px-3 py-2", right ? "@min-[34rem]:flex-[2_1_0%] @min-[34rem]:border-e @min-[34rem]:border-popover-hairline @max-[34rem]:shrink-0 @max-[34rem]:border-b @max-[34rem]:border-popover-hairline" : "flex-1", stacked && "!overflow-visible [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden")}>
            {showPeopleBlock && (
              <div className="flex flex-col gap-1">
                {card.company && (
                  <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-company data-fit-row="p-company">
                    <Building2 size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
                    {card.company.ref && onOpenRecord ? (
                      <CompanyChip name={card.company.name} companyRef={card.company.ref} onOpen={onOpenRecord} />
                    ) : (
                      <span dir="auto" className="min-w-0 flex-1 truncate" title={card.company.name}>{card.company.name}</span>
                    )}
                  </div>
                )}
                {others.map((person, index) => <PersonRow key={`${person.role}-${index}`} person={person} fitKey={`p-${index}`} />)}
                {owner && <PersonRow person={owner} fitKey="p-owner" />}
              </div>
            )}
            <Facts card={card} now={now} lang={lang} part={stacked && right ? "dates" : "all"} showPriority={stacked && priorityClipped} />
          </Pane>
          {right && (
            <Pane pinned={pinned} fit={!stacked} data-record-pane="right" className={cn("flex flex-col gap-2 px-3 py-2 @min-[34rem]:flex-[3_1_0%] @max-[34rem]:shrink-0", stacked && "!overflow-visible [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden")}>
              {description && <p dir="auto" className={cn("whitespace-pre-line break-words", pinned ? "" : "line-clamp-4")} data-record-description data-fit-row="desc">{description}</p>}
              {hasNotes && <Notes card={card} now={now} lang={lang} description={description} pinned={pinned} stacked={stacked} />}
            </Pane>
          )}
          {/* a card not wider than tall says who and what it says first; the key fields come last (and are the first dropped) */}
          {stacked && right && card.fields?.length ? (
            <div className="flex shrink-0 flex-col gap-2 border-t border-popover-hairline px-3 py-2 [&:not(:has([data-fit-row]:not([data-fit-hidden])))]:hidden">
              <Facts card={card} now={now} lang={lang} part="fields" />
            </div>
          ) : null}
        </Pane>
        <div className="flex shrink-0 flex-nowrap items-center gap-x-0.5 border-t border-popover-hairline px-1.5 py-1" data-record-actions>
          {openUrl && (
            <button type="button" tabIndex={tab} className={cn(BUTTON_PRIMARY, "min-w-0 shrink")} onClick={() => { void openExternalLink(openUrl); }} {...first} data-record-open>
              <span className="truncate">{productLabel ? t("recordCard.openIn", { product: productLabel }) : t("recordCard.open")}</span>
              <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
            </button>
          )}
          {onAsk && (
            // the label stays for the wide two-pane card; narrow or left-pane-only, an icon with its tooltip
            <button type="button" tabIndex={tab} className={cn(BUTTON, "px-1.5")} onClick={onAsk} aria-label={t("recordCard.ask")} title={t("recordCard.askTitle")} data-record-ask {...(openUrl ? {} : first)}>
              <MessageSquareText size={14} aria-hidden="true" className="shrink-0" />
              <span className={split ? "@max-[34rem]:hidden" : "hidden"}>{t("recordCard.ask")}</span>
            </button>
          )}
          <CopyNumber text={copy} className={ICON_BUTTON} first={!openUrl && !onAsk} />
          <span className="ms-auto flex shrink-0 items-center gap-0.5 ps-1 text-[12px] leading-4 text-popover-ink-secondary">
            {clockText && <time dateTime={clockText} className={cn("whitespace-nowrap", split ? "@max-[34rem]:hidden" : "hidden")}>{upToDate}</time>}
            <button type="button" tabIndex={tab} className={ICON_BUTTON} aria-label={upToDate ? `${t("recordCard.refresh")}. ${upToDate}` : t("recordCard.refresh")} title={upToDate ? `${upToDate} (${t("recordCard.refresh")})` : t("recordCard.refresh")} onClick={read.refresh} data-record-refresh>
              <RotateCw size={14} aria-hidden="true" className={cn(loading && "animate-spin motion-reduce:animate-none")} />
            </button>
          </span>
        </div>
      </Shell>
    </TabContext.Provider>
  );
}
