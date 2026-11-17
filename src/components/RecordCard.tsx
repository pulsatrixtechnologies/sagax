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
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Building2, Check, CircleAlert, Copy, Lock, MessageSquareText, RotateCw, ShieldAlert, TriangleAlert, UserCheck, UserRound, WifiOff, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatClock, formatFull, formatLateness, formatRelative, isGuid, percentValue, sameText } from "@/lib/record-card-format";
import type { UseRecordCard } from "@/lib/record-cards";
import { ServiceIcon } from "@/components/plugins/PluginParts";
import type { RecordCard as Card, RecordCardMiss, RecordLevel, RecordRef, RecordTone } from "../../shared/record-cards";

/** The width below which the panes stack (the available width, in rem). */
export const RECORD_CARD_STACK_REM = 34;

export interface RecordCardProduct {
  name: string;
  /** the site whose mark stands for the product (the product list's icon) */
  domain?: string;
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
  /** the clock, for a test or a gallery that holds time still */
  now?: number;
}

const MARK = "size-4 shrink-0 rounded-[4px]";

/** The product's mark: the card's own icon when it came with one, else the
 * product list's site, else the first letter. */
export function RecordProductMark({ product, iconUrl, className = MARK }: { product?: RecordCardProduct; iconUrl?: string; className?: string }) {
  const name = product?.name ?? "";
  return <ServiceIcon card={{ logo: iconUrl ?? null, domain: product?.domain ?? null, label: name || "?" }} className={cn(className, "text-[10px] leading-none")} />;
}

const BUTTON = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] leading-5 text-popover-ink hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
const BUTTON_PRIMARY = cn(BUTTON, "text-popover-accent");
const ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink focus-visible:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

const TONE_CLASS: Record<RecordTone, string> = {
  open: "bg-popover-field text-popover-ink",
  waiting: "bg-warning/15 text-warning",
  done: "bg-success/15 text-success",
  alert: "bg-danger/15 text-danger",
};
const LEVEL_CLASS: Record<RecordLevel, string> = {
  urgent: "bg-danger/15 text-danger",
  high: "bg-warning/15 text-warning",
  normal: "bg-popover-field text-popover-ink-secondary",
  low: "bg-popover-field text-popover-ink-secondary",
};

function Chip({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cn("inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-4", className)}>{children}</span>;
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-popover-ink/10 motion-reduce:animate-none", className)} />;
}

/** A pane: clipped with a fade where more waits below when the card is only
 * hovered, scrolling inside when it is pinned. */
function Pane({ pinned, stack = false, className, children, ...data }: { pinned: boolean; stack?: boolean; className?: string; children: ReactNode; [key: `data-${string}`]: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  });
  return (
    <div
      ref={ref}
      {...data}
      data-more={more ? "below" : undefined}
      tabIndex={pinned && more ? 0 : undefined}
      className={cn(
        "menu-scroll min-h-0 min-w-0",
        // side by side each pane scrolls on its own; stacked, the whole body does
        stack
          ? cn("min-[35rem]:overflow-hidden", pinned ? "max-[35rem]:overflow-y-auto" : "max-[35rem]:overflow-hidden")
          : cn(pinned ? "min-[35rem]:overflow-y-auto" : "min-[35rem]:overflow-hidden", "max-[35rem]:shrink-0 max-[35rem]:overflow-visible"),
        className,
      )}
    >
      {children}
    </div>
  );
}

function PersonRow({ person }: { person: NonNullable<Card["people"]>[number] }) {
  const Icon = person.role === "owner" ? UserCheck : UserRound;
  return (
    <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-person={person.role}>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      <span className="min-w-0 flex-1 truncate" title={person.label ? `${person.label}: ${person.name}` : person.name}>
        {person.label && <span className="sr-only">{person.label}: </span>}
        <span dir="auto">{person.name}</span>
        {person.detail && <span dir="ltr" className="ms-1.5 text-popover-ink-secondary [unicode-bidi:isolate]">{person.detail}</span>}
      </span>
    </div>
  );
}

function PriorityChip({ priority }: { priority: NonNullable<Card["priority"]> }) {
  return (
    <Chip className={LEVEL_CLASS[priority.level]} title={priority.label}>
      {(priority.level === "urgent" || priority.level === "high") && <TriangleAlert size={12} aria-hidden="true" className="shrink-0" />}
      <span className="truncate">{priority.label}</span>
    </Chip>
  );
}

/** The dates and key fields as one description list. */
function Facts({ card, now, lang }: { card: Card; now: number; lang: string }) {
  const tz = card.tz;
  const rows: Array<{ label: string; value: ReactNode; gap?: boolean; key: string }> = [];
  const dates = card.dates ?? {};
  const time = (iso: string, mode: "relative" | "absolute") => (
    <time dateTime={iso} title={formatFull(iso, lang, tz)}>{mode === "relative" ? formatRelative(iso, now, lang) : formatAbsolute(iso, now, lang, tz)}</time>
  );
  if (dates.opened) rows.push({ key: "opened", label: t("recordCard.date.opened"), value: time(dates.opened, "relative") });
  if (dates.updated) rows.push({ key: "updated", label: t("recordCard.date.updated"), value: time(dates.updated, "relative") });
  if (dates.due) {
    const late = card.state?.tone === "done" || dates.closed ? null : formatLateness(dates.due, now, lang);
    rows.push({
      key: "due",
      label: t("recordCard.date.due"),
      value: late ? (
        <span className="text-danger">{time(dates.due, "absolute")}<span className="ms-1.5">{t("recordCard.late", { duration: late })}</span></span>
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
  if (!rows.length) return null;
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px] leading-[18px]" data-record-facts>
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className={cn("max-w-[9rem] truncate whitespace-nowrap text-[12px] leading-4 text-popover-ink-secondary", row.gap && "mt-1")} title={row.label}>{row.label}</dt>
            <dd className={cn("min-w-0 break-words", row.gap && "mt-1")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Notes({ card, now, lang, description, pinned }: { card: Card; now: number; lang: string; description?: string; pinned: boolean }) {
  const { notes } = card;
  if (notes.state === "forbidden") return <p className="text-[12px] leading-4 text-popover-ink-secondary">{t("recordCard.notes.forbidden")}</p>;
  if (notes.state === "unavailable") return <p className="text-[12px] leading-4 text-popover-ink-secondary">{t("recordCard.notes.unavailable")}</p>;
  // a note that is the description's own text is shown once
  const items = notes.items.filter((item) => !description || !sameText(item.text, description));
  const others = notes.total !== undefined ? Math.max(0, notes.total - notes.items.length) : 0;
  if (!items.length && !others) return null;
  return (
    <div className="flex flex-col" data-record-notes>
      <ol className="flex flex-col">
        {items.map((item, index) => (
          <li key={index} className="relative flex gap-2.5 pb-2.5 last:pb-0" data-record-note>
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
        <p className="ps-4 pt-1 text-[12px] leading-4 text-popover-ink-secondary">
          {others === 1 ? t("recordCard.notes.otherOne") : t("recordCard.notes.other", { count: others })}
        </p>
      )}
    </div>
  );
}

function Head({ card, label, kindName, product, onClose, pinned, skeleton = false }: Pick<RecordCardProps, "label" | "kindName" | "product" | "onClose"> & { card: Card | null; pinned: boolean; skeleton?: boolean }) {
  const kind = card?.kind.name ?? kindName ?? t("recordCard.kindFallback");
  const shown = card?.number ?? label;
  // a number that is the title (a company's name) is said once; a GUID never
  const hidden = isGuid(shown) || (card ? shown.trim().toLowerCase() === card.title.trim().toLowerCase() : false);
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5" data-record-head>
      <RecordProductMark product={card ? { name: card.product.name, domain: product?.domain } : product} iconUrl={card?.product.icon?.url} />
      <span className="min-w-0 shrink-0 text-[12px] leading-5 text-popover-ink-secondary">{kind}</span>
      {!hidden && <span dir="ltr" className="min-w-0 truncate font-mono text-[13px] leading-5 [unicode-bidi:isolate]" title={shown}>{shown}</span>}
      <span className="ms-auto flex shrink-0 items-center gap-1">
        {card?.priority && <PriorityChip priority={card.priority} />}
        {card?.state && <Chip className={TONE_CLASS[card.state.tone]} title={card.state.label}><span className="max-w-[12rem] truncate">{card.state.label}</span></Chip>}
        {skeleton && <Bar className="h-5 w-16 rounded-full" />}
        {pinned && onClose && (
          <button type="button" className={cn(ICON_BUTTON, "-me-1.5")} aria-label={t("recordCard.close")} title={t("recordCard.close")} onClick={onClose}>
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

function CopyNumber({ text, className = BUTTON, label }: { text: string; className?: string; label?: boolean }) {
  const [done, setDone] = useState(false);
  const run = () => {
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setDone(true);
      setTimeout(() => setDone(false), 1_500);
    });
  };
  const name = done ? t("recordCard.copied") : t("recordCard.copy");
  return (
    <button type="button" className={className} aria-label={label ? undefined : name} title={name} onClick={run} data-record-copy>
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

export function RecordCard({ record, label, kindName, product, read, pinned = false, onClose, onAsk, onConnect, onSignIn, now: clock }: RecordCardProps) {
  const lang = activeLocale();
  const now = clock ?? Date.now();
  const { card, miss, loading } = read;
  const productName = card?.product.name ?? product?.name;
  const copy = numberToCopy(card, record, label);
  const description = card?.description?.text;
  const hasNotes = Boolean(card && (card.notes.items.length > 0 || (card.notes.total ?? 0) > card.notes.items.length || card.notes.state === "forbidden" || card.notes.state === "unavailable"));
  const right = Boolean(card && (description || hasNotes));
  const split = !card || right;
  const frame = cn(
    "flex max-h-[min(20rem,calc(100vh-1rem))] flex-col overflow-hidden rounded-xl popover-surface menu-surface text-[13px] leading-5 text-popover-ink max-[35rem]:max-h-[min(32rem,calc(100vh-1rem))]",
    split ? "w-[min(40rem,calc(100vw-1rem))]" : "w-[min(22rem,calc(100vw-1rem))]",
  );
  const data = { "data-record-card-body": "", "data-layout": split ? "split" : "compact", "data-record-state": card ? "card" : miss ? miss.state : "loading" };

  // no card: the head, then one icon, one sentence and its one action
  if (!card && miss) {
    const { icon: Icon } = MISS[miss.state];
    const action = (() => {
      if (miss.state === "org_ask") return <button type="button" className={BUTTON_PRIMARY} onClick={read.confirm} data-hover-card-first="">{t("recordCard.readRecord")}</button>;
      if (miss.state === "down") return <button type="button" className={BUTTON_PRIMARY} onClick={read.refresh} data-hover-card-first="">{t("recordCard.retry")}</button>;
      if (miss.state === "not_connected" && onConnect) return <button type="button" className={BUTTON_PRIMARY} onClick={onConnect} data-hover-card-first="">{t("recordCard.connect")}</button>;
      if (miss.state === "sign_in" && onSignIn) return <button type="button" className={BUTTON_PRIMARY} onClick={onSignIn} data-hover-card-first="">{t("recordCard.signIn")}</button>;
      return null;
    })();
    return (
      <div className={frame} {...data}>
        <Head card={null} label={label} kindName={kindName} product={product} onClose={onClose} pinned={pinned} />
        <div role="status" className="flex flex-col items-center gap-1 px-6 pb-1 pt-4 text-center" title={miss.rule?.text}>
          <Icon size={16} aria-hidden="true" className="text-popover-ink-secondary" />
          <p className="max-w-[28rem] text-[13px] leading-5">{missSentence(miss, product)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 px-2 pb-2.5 pt-1">
          {action}
          <CopyNumber text={copy} label className={action ? BUTTON : cn(BUTTON, "text-popover-accent")} />
        </div>
      </div>
    );
  }

  // loading: the head at once, a skeleton in each pane
  if (!card) {
    return (
      <div className={frame} {...data} aria-busy="true">
        <Head card={null} label={label} kindName={kindName} product={product} onClose={onClose} pinned={pinned} skeleton />
        <div className="px-3 pb-2.5 pt-1.5"><Bar className="h-5 w-3/5" /></div>
        <div className="flex min-h-0 flex-1 border-t border-popover-hairline max-[35rem]:flex-col">
          <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 min-[35rem]:flex-[2_1_0%] min-[35rem]:border-e min-[35rem]:border-popover-hairline">
            <Bar className="h-4 w-4/5" />
            <Bar className="h-4 w-3/5" />
            <Bar className="h-4 w-2/5" />
          </div>
          <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 min-[35rem]:flex-[3_1_0%] max-[35rem]:border-t max-[35rem]:border-popover-hairline">
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-11/12" />
            <Bar className="h-4 w-2/3" />
          </div>
        </div>
        <span role="status" className="sr-only">{t("recordCard.loading")}</span>
      </div>
    );
  }

  const people = card.people ?? [];
  const owner = people.find((person) => person.role === "owner");
  const others = people.filter((person) => person !== owner);
  // the priority rides the last row of people; with no one, the company's
  const showPeopleBlock = Boolean(card.company || people.length);
  const openUrl = card.openUrl;
  const clockText = (card.asOf ?? (read.at ? new Date(read.at).toISOString() : undefined));
  const productLabel = productName ?? product?.name;

  return (
    <div className={frame} {...data} aria-busy={loading ? "true" : undefined}>
      <Head card={card} label={label} kindName={kindName} product={product} onClose={onClose} pinned={pinned} />
      <p dir="auto" className="line-clamp-2 break-words px-3 pb-2 pt-0.5 text-[15px] font-semibold leading-5" title={card.title}>{card.title}</p>
      <Pane pinned={pinned} stack className="flex flex-1 border-t border-popover-hairline max-[35rem]:flex-col" data-record-panes="">
        <Pane pinned={pinned} data-record-pane="left" className={cn("flex flex-col gap-2 px-3 py-2", right ? "min-[35rem]:flex-[2_1_0%] min-[35rem]:border-e min-[35rem]:border-popover-hairline max-[35rem]:border-b max-[35rem]:border-popover-hairline" : "flex-1")}>
          {showPeopleBlock && (
            <div className="flex flex-col gap-1">
              {card.company && (
                <div className="flex min-w-0 items-center gap-2 leading-[18px]" data-record-company>
                  <Building2 size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
                  <span dir="auto" className="min-w-0 flex-1 truncate" title={card.company.name}>{card.company.name}</span>
                </div>
              )}
              {others.map((person, index) => <PersonRow key={`${person.role}-${index}`} person={person} />)}
              {owner && <PersonRow person={owner} />}
            </div>
          )}
          <Facts card={card} now={now} lang={lang} />
        </Pane>
        {right && (
          <Pane pinned={pinned} data-record-pane="right" className="flex flex-col gap-2 px-3 py-2 min-[35rem]:flex-[3_1_0%]">
            {description && <p dir="auto" className={cn("whitespace-pre-line break-words", pinned ? "" : "line-clamp-4")} data-record-description>{description}</p>}
            {description && hasNotes && <hr className="border-0 border-t border-popover-hairline" />}
            {hasNotes && <Notes card={card} now={now} lang={lang} description={description} pinned={pinned} />}
          </Pane>
        )}
      </Pane>
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-0 border-t border-popover-hairline px-1.5 py-1" data-record-actions>
        {openUrl && (
          <button type="button" className={cn(BUTTON_PRIMARY, "max-w-[16rem]")} onClick={() => { void openExternalLink(openUrl); }} data-hover-card-first="" data-record-open>
            <span className="truncate">{productLabel ? t("recordCard.openIn", { product: productLabel }) : t("recordCard.open")}</span>
            <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
          </button>
        )}
        {onAsk && (
          <button type="button" className={BUTTON} onClick={onAsk} title={t("recordCard.askTitle")} data-record-ask {...(openUrl ? {} : { "data-hover-card-first": "" })}>
            <MessageSquareText size={14} aria-hidden="true" className="shrink-0" />
            <span>{t("recordCard.ask")}</span>
          </button>
        )}
        <CopyNumber text={copy} className={ICON_BUTTON} />
        <span className="ms-auto flex items-center gap-0.5 ps-2 text-[12px] leading-4 text-popover-ink-secondary">
          {clockText && <time dateTime={clockText} title={formatFull(clockText, lang, card.tz)} className="whitespace-nowrap">{t("recordCard.upToDate", { time: formatClock(clockText, lang, card.tz) })}</time>}
          <button type="button" className={ICON_BUTTON} aria-label={t("recordCard.refresh")} title={t("recordCard.refresh")} onClick={read.refresh} data-record-refresh>
            <RotateCw size={14} aria-hidden="true" className={cn(loading && "animate-spin motion-reduce:animate-none")} />
          </button>
        </span>
      </div>
    </div>
  );
}
