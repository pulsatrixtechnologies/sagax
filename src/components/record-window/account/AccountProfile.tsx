// The Profile tab of a company's and a contact's window (M-20261127-123,
// M-20261127-140): drawn after the owner's mockup in Sagax's own blocks, not
// after the product's screen. A head with the record's mark, its context and
// round buttons to call, write, open its site and its LinkedIn page; four
// figures that open their tab; at the left what comes (dated cards) and what
// moved (a timeline, one icon per kind); at the right the key contacts with
// their role, then how to reach it (a contact: its preferences). A part with
// nothing to say is not drawn (M-20261127-143).
import type { ReactNode } from "react";
import { Activity, Building2, CalendarDays, ChevronRight, FolderKanban, Globe, Handshake, Mail, MapPin, Monitor, Paperclip, Phone, Printer, Receipt, StickyNote, Tag, Ticket, TrendingUp, UserRound } from "lucide-react";
import { FieldValue, RecordRefChip, useOpenRef } from "@/components/RecordCard";
import { RECORD_ICON_BUTTON, RECORD_LINK_ACTION, RecordAvatar, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordName } from "@/components/record-window/ticket/parts";
import { REF_PILL_CLASS } from "@/components/ref-pill";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatFull, formatRelative } from "@/lib/record-card-format";
import type { SheetFeed, SheetFeedKind, SheetReach, SheetReachKind, SheetTile, SheetUpcoming } from "@/lib/record-detail";
import type { RecordRef, RecordTone } from "../../../../shared/record-cards";
import { mailAddress, phoneAddress, webAddress, type AccountKind, type AccountTab, type ProfileView } from "./account-model";

/** The record's tz and the clock, for every date of the tab. */
export interface When { now: number; tz?: string }

const DAY = 86_400_000;

/** A moment as people say it: "29 min ago", "yesterday", then its day. */
export function whenWords(at: string | undefined, fallback: string, { now, tz }: When): string {
  if (!at) return fallback;
  const lang = activeLocale();
  return Math.abs(now - Date.parse(at)) < 2 * DAY ? formatRelative(at, now, lang, tz) : formatAbsolute(at, now, lang, tz, { time: false });
}

// an icon's tone (never the words'): the tone's own token
const TONE_INK: Record<RecordTone, string> = { open: "text-popover-ink-secondary", waiting: "text-warning", done: "text-success", alert: "text-danger" };

const FEED_ICON: Record<SheetFeedKind, typeof Activity> = {
  note: StickyNote, ticket: Ticket, attachment: Paperclip, invoice: Receipt, activity: CalendarDays, agreement: Handshake,
  contact: UserRound, project: FolderKanban, opportunity: TrendingUp, configuration: Monitor, other: Activity,
};

/** LinkedIn's two letters in a tile of the ink (no brand mark is drawn). */
function LinkedInGlyph({ size = 16 }: { size?: number }) {
  return <span aria-hidden="true" className="inline-flex items-center justify-center rounded-[4px] border-[1.5px] border-current font-semibold leading-none" style={{ width: size, height: size, fontSize: size * 0.55 }}>in</span>;
}

const REACH_ICON: Record<SheetReachKind, (size: number) => ReactNode> = {
  phone: (size) => <Phone size={size} aria-hidden="true" />,
  fax: (size) => <Printer size={size} aria-hidden="true" />,
  email: (size) => <Mail size={size} aria-hidden="true" />,
  web: (size) => <Globe size={size} aria-hidden="true" />,
  linkedin: (size) => <LinkedInGlyph size={size} />,
  address: (size) => <MapPin size={size} aria-hidden="true" />,
  site: (size) => <Building2 size={size} aria-hidden="true" />,
  id: (size) => <Tag size={size} aria-hidden="true" />,
};

const ROUND = cn(RECORD_ICON_BUTTON, "size-9 rounded-full bg-popover-field");

/** The head's round buttons: call, write, the site, LinkedIn (each only when the record has it). */
function QuickActions({ view }: { view: ProfileView }) {
  const first = (kind: SheetReachKind) => view.reach.find((row) => row.kind === kind);
  const phone = first("phone"), email = first("email"), web = first("web"), linkedin = first("linkedin");
  const call = phone && phoneAddress(phone.value);
  const write = email && mailAddress(email.value);
  const site = web && webAddress(web.value);
  const page = linkedin && webAddress(linkedin.value);
  type Quick = { key: string; label: string; icon: ReactNode; url: string };
  const actions: Quick[] = [];
  if (call) actions.push({ key: "call", label: t("recordWindow.account.call", { number: phone!.value }), icon: <Phone size={16} aria-hidden="true" />, url: call });
  if (write) actions.push({ key: "write", label: t("recordWindow.account.write", { name: email!.detail || email!.value }), icon: <Mail size={16} aria-hidden="true" />, url: write });
  if (site) actions.push({ key: "web", label: t("recordWindow.account.website", { site: web!.value }), icon: <Globe size={16} aria-hidden="true" />, url: site });
  if (page) actions.push({ key: "linkedin", label: t("recordWindow.account.linkedin"), icon: <LinkedInGlyph />, url: page });
  if (!actions.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2" data-record-quick-actions="">
      {actions.map((action) => (
        <button key={action.key} type="button" className={ROUND} aria-label={action.label} title={action.label} data-record-quick={action.key}
          onClick={() => { void openExternalLink(action.url).catch(() => {}); }}>{action.icon}</button>
      ))}
    </div>
  );
}

function Hero({ kind, view }: { kind: AccountKind; view: ProfileView }) {
  const open = useOpenRef(view.company?.ref);
  const company = view.company && (view.company.ref && open ? <RecordRefChip name={view.company.name} refTo={view.company.ref} onOpen={open} slot="company" /> : <span dir="auto">{view.company.name}</span>);
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-4" data-record-hero="">
      <span className="[&>[data-record-avatar]]:size-14 [&>[data-record-avatar]]:bg-popover-field [&>[data-record-avatar]]:text-[18px]"><RecordAvatar name={view.name} size="lg" square={kind === "company"} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p dir="auto" className="break-words text-[18px] font-semibold leading-6">{view.name}</p>
        {kind === "contact" && (view.title || company) && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[14px] leading-5 text-popover-ink-secondary" data-record-hero-title="">
            {view.title && company ? <>{t("recordWindow.account.titleAt", { title: view.title })} {company}</> : view.title ? <span dir="auto">{view.title}</span> : company}
          </p>
        )}
        {view.context.length > 0 && <p dir="auto" className="text-[14px] leading-5 text-popover-ink-secondary" data-record-hero-context="">{view.context.join(" · ")}</p>}
        {view.roles.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1.5" data-record-roles="">
            {view.roles.map((role) => <span key={role} className="inline-flex h-6 items-center rounded-full bg-popover-field px-2.5 text-[13px] leading-[18px]">{role}</span>)}
          </span>
        )}
      </div>
      <QuickActions view={view} />
    </div>
  );
}

/** A figure: a click opens its tab (when the window shows that tab). */
function TileCard({ tile, onTab }: { tile: SheetTile; onTab?: () => void }) {
  const body = (
    <>
      <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{tile.label}</span>
      <span dir="auto" className="text-[22px] font-semibold leading-7 tabular-nums">{tile.value}</span>
      {tile.share !== undefined && (
        <span role="progressbar" aria-label={tile.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={tile.share} className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-popover-hover">
          <span className="block h-full rounded-full bg-popover-accent" style={{ width: `${tile.share}%` }} />
        </span>
      )}
      {tile.detail && (
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-popover-ink-secondary">
          {tile.tone && tile.tone !== "open" && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tile.tone === "alert" ? "bg-danger" : tile.tone === "waiting" ? "bg-warning" : "bg-success")} />}
          <span dir="auto" className="min-w-0 break-words">{tile.detail}</span>
        </span>
      )}
    </>
  );
  const box = "flex min-w-0 flex-col gap-1 rounded-xl bg-popover-field p-4 text-start";
  return onTab
    ? <button type="button" className={cn(box, "hover:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} onClick={onTab} data-record-tile={tile.tab}>{body}</button>
    : <div className={box} data-record-tile="">{body}</div>;
}

export function Tiles({ tiles, shown, onTab }: { tiles: readonly SheetTile[]; shown: ReadonlySet<AccountTab>; onTab: (tab: AccountTab) => void }) {
  if (!tiles.length) return null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[64rem]:grid-cols-4" data-record-tiles="">
      {tiles.map((tile, index) => {
        const tab = tile.tab as AccountTab | undefined;
        return <TileCard key={`${tile.label}-${index}`} tile={tile} onTab={tab && shown.has(tab) ? () => onTab(tab) : undefined} />;
      })}
    </div>
  );
}

/** A pod's link to its tab, at the right of its head ("Activities ›"). */
function TabLink({ label, onOpen }: { label: string; onOpen?: () => void }) {
  if (!onOpen) return null;
  return <button type="button" className={cn(RECORD_LINK_ACTION, "text-popover-ink-secondary hover:text-popover-ink")} onClick={onOpen}>{label}<ChevronRight size={14} aria-hidden="true" className="rtl:-scale-x-100" /></button>;
}

/** The day of a dated card: its number and its month, in the record's zone. */
export function DateBlock({ at, tz }: { at?: string; tz?: string }) {
  if (!at) return <span aria-hidden="true" className="flex w-11 shrink-0 justify-center text-popover-ink-secondary"><CalendarDays size={18} /></span>;
  const lang = activeLocale(), date = new Date(at), zone = tz ? { timeZone: tz } : {};
  return (
    <time dateTime={at} title={formatFull(at, lang, tz)} className="flex w-11 shrink-0 flex-col items-center leading-none">
      <span className="text-[20px] font-semibold leading-6 tabular-nums">{new Intl.DateTimeFormat(lang, { ...zone, day: "numeric" }).format(date)}</span>
      <span className="text-[12px] leading-4 text-popover-ink-secondary">{new Intl.DateTimeFormat(lang, { ...zone, month: "short" }).format(date)}</span>
    </time>
  );
}

function Upcoming({ items, tz, onActivities }: { items: readonly SheetUpcoming[]; tz?: string; onActivities?: () => void }) {
  if (!items.length) return null;
  return (
    <RecordPod title={t("recordWindow.account.upcoming")} actions={<TabLink label={t("recordWindow.account.tabs.activities")} onOpen={onActivities} />} data-record-upcoming="">
      <ul className="grid min-w-0 grid-cols-1 gap-2 @min-[44rem]:grid-cols-2 @min-[72rem]:grid-cols-3">
        {items.map((item, index) => (
          <li key={item.id ?? index} className="flex min-w-0 items-start gap-2 rounded-lg bg-popover-hover/60 p-3" data-record-upcoming-item="">
            <DateBlock at={item.at} tz={tz} />
            <span className="flex min-w-0 flex-col">
              <span dir="auto" className="break-words font-medium">{item.subject}</span>
              <span className="break-words text-[13px] leading-[18px] text-popover-ink-secondary">{[item.at ? "" : item.date, item.type, item.assigned].filter(Boolean).join(" · ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </RecordPod>
  );
}

/** A record a line names after its words (#300124, F-10391): one pill that never breaks, opened in the window when the person may. */
function RefLabel({ label, recordRef }: { label: string; recordRef: RecordRef }) {
  const open = useOpenRef(recordRef);
  if (!open) return <span dir="ltr" className="ms-1.5 whitespace-nowrap font-mono text-[0.88em] [unicode-bidi:isolate]">{label}</span>;
  return <button type="button" dir="ltr" className={cn(REF_PILL_CLASS, "ms-1.5 cursor-pointer")} title={label} onClick={() => open(recordRef, label)} data-record-ref-link="">{label}</button>;
}

function FeedRow({ item, last, when }: { item: SheetFeed; last: boolean; when: When }) {
  const Icon = FEED_ICON[item.kind];
  const shown = whenWords(item.at, item.date, when);
  return (
    <li className="relative flex min-w-0 gap-3 pb-4 last:pb-0" data-record-feed={item.kind}>
      <span aria-hidden="true" className="relative flex shrink-0 flex-col items-center">
        <span className={cn("inline-flex size-7 items-center justify-center rounded-full bg-popover-hover", TONE_INK[item.tone ?? "open"])}><Icon size={14} /></span>
        {!last && <span className="absolute bottom-[-16px] top-8 w-px bg-popover-hairline" />}
      </span>
      <p className="min-w-0 flex-1 break-words pt-[3px]">
        {item.who && <span className="me-1 font-semibold"><RecordName name={item.who} recordRef={item.whoRef} /></span>}
        <span dir="auto">{item.text}</span>
        {item.ref && item.label && <RefLabel label={item.label} recordRef={item.ref} />}
      </p>
      {shown && <span className="shrink-0 whitespace-nowrap pt-[3px] text-[13px] leading-[18px] text-popover-ink-secondary">{item.at ? <time dateTime={item.at} title={formatFull(item.at, activeLocale(), when.tz)}>{shown}</time> : shown}</span>}
    </li>
  );
}

function Feed({ items, when }: { items: readonly SheetFeed[]; when: When }) {
  if (!items.length) return null;
  return (
    <RecordPod title={t("recordWindow.account.moved")} data-record-moved="">
      <ol className="flex min-w-0 flex-col">{items.map((item, index) => <FeedRow key={index} item={item} last={index === items.length - 1} when={when} />)}</ol>
    </RecordPod>
  );
}

function People({ people, count, onContacts }: { people: ProfileView["people"]; count?: number; onContacts?: () => void }) {
  if (!people.length) return null;
  return (
    <RecordPod title={t("recordWindow.account.keyContacts")} actions={<TabLink label={count ? t("recordWindow.account.allContacts", { count }) : t("recordWindow.account.tabs.contacts")} onOpen={onContacts} />} data-record-key-contacts="">
      <ul className="flex min-w-0 flex-col gap-3">
        {people.map((person, index) => (
          <li key={`${person.name}-${index}`} className="flex min-w-0 items-center gap-3" data-record-key-contact="">
            <RecordAvatar name={person.name} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="min-w-0 font-medium"><RecordName name={person.name} recordRef={person.ref} /></span>
              {person.detail && <span dir="auto" className="break-words text-[13px] leading-[18px] text-popover-ink-secondary">{person.detail}</span>}
            </span>
            {person.role && <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]">{person.role}</span>}
          </li>
        ))}
      </ul>
    </RecordPod>
  );
}

function ReachValue({ row }: { row: SheetReach }) {
  const site = row.kind === "web" || row.kind === "linkedin" ? webAddress(row.value) : undefined;
  if (site) return <button type="button" dir="auto" className="min-w-0 break-all text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => { void openExternalLink(site).catch(() => {}); }}>{row.value}</button>;
  return <span dir="auto" className="min-w-0 whitespace-pre-line break-words">{row.value}</span>;
}

function Reach({ reach }: { reach: readonly SheetReach[] }) {
  if (!reach.length) return null;
  return (
    <RecordPod title={t("recordWindow.account.reach")} data-record-reach="">
      <ul className="flex min-w-0 flex-col gap-3">
        {reach.map((row, index) => (
          <li key={`${row.kind}-${index}`} className="flex min-w-0 items-start gap-3" data-record-reach-row={row.kind}>
            <span className="flex h-[22px] shrink-0 items-center text-popover-ink-secondary" title={t(`recordWindow.account.reachKind.${row.kind}` as "recordWindow.account.reachKind.phone")}>{REACH_ICON[row.kind](16)}</span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2"><ReachValue row={row} />{row.kind === "phone" && row.detail && <span className="text-[13px] text-popover-ink-secondary">{row.detail}</span>}</span>
              {row.kind !== "phone" && row.detail && <span dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{row.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </RecordPod>
  );
}

/** The card's facts (a console that sends no sheet): label and value, drawn by each field's type. */
function Facts({ view, when }: { view: ProfileView; when: When }) {
  if (!view.facts.length) return null;
  const lang = activeLocale();
  return (
    <RecordPod title={t("recordWindow.account.details")} data-record-facts-pod="">
      <dl className="grid min-w-0 grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5">
        {view.facts.map((field, index) => (
          <div key={`${field.label}-${index}`} className="contents">
            <dt className="break-words text-[13px] leading-[22px] text-popover-ink-secondary">{field.label}</dt>
            <dd className="min-w-0 break-words"><FieldValue field={field} label={field.label} now={when.now} lang={lang} tz={when.tz} /></dd>
          </div>
        ))}
      </dl>
    </RecordPod>
  );
}

function Prefs({ prefs }: { prefs: ProfileView["prefs"] }) {
  if (!prefs.length) return null;
  return (
    <RecordPod title={t("recordWindow.account.prefs")} data-record-prefs="">
      <dl className="grid min-w-0 grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5">
        {prefs.map((pref) => (
          <div key={pref.label} className="contents">
            <dt className="break-words text-[13px] leading-[22px] text-popover-ink-secondary">{pref.label}</dt>
            <dd dir="auto" className="min-w-0 break-words">{pref.value}</dd>
          </div>
        ))}
      </dl>
    </RecordPod>
  );
}

export function AccountProfile({ kind, view, when, shown, contacts, onTab, notice }: {
  kind: AccountKind;
  view: ProfileView;
  when: When;
  /** the tabs the window shows: a figure or a pod's link opens only one of them */
  shown: ReadonlySet<AccountTab>;
  /** how many contacts the company has */
  contacts?: number;
  onTab: (tab: AccountTab) => void;
  /** a quiet line under the head (the sheet still loading, or not read) */
  notice?: string;
}) {
  const go = (tab: AccountTab) => (shown.has(tab) ? () => onTab(tab) : undefined);
  const left = [<Upcoming key="upcoming" items={view.upcoming} tz={when.tz} onActivities={go("activities")} />, <Feed key="feed" items={view.feed} when={when} />];
  const right = [
    <People key="people" people={view.people} count={contacts} onContacts={go("contacts")} />,
    <Reach key="reach" reach={view.reach} />, <Prefs key="prefs" prefs={view.prefs} />, <Facts key="facts" view={view} when={when} />,
  ];
  // nothing that comes or moved (a card alone): the other blocks take the whole width, two by two
  const timeline = view.upcoming.length > 0 || view.feed.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5" data-record-profile={kind}>
      <Hero kind={kind} view={view} />
      {notice && <p role="status" className="text-[13px] leading-[18px] text-popover-ink-secondary">{notice}</p>}
      <Tiles tiles={view.tiles} shown={shown} onTab={onTab} />
      {timeline ? (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 @min-[56rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4" data-record-profile-side="left">{left}</div>
          <div className="flex min-w-0 flex-col gap-4 empty:hidden" data-record-profile-side="right">{right}</div>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 @min-[56rem]:grid-cols-2" data-record-profile-side="all">{right}</div>
      )}
    </div>
  );
}
