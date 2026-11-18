// The "Book a call" card (shared/widget-booking.ts), the Booking node of a
// widget: the meeting type with the person's own avatar, the bookings already on
// their calendar, the days that have a free slot and that day's times. A time is
// a press of the Booking's own Button child (`book_slot`), which settles the card
// and has the bot book it with its calendar tool; the card then stays in place
// showing the booked time as confirmed. The days and times are written in the
// person's time zone, in their language.
import { useMemo, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { useStoreSelector } from "@/state/store-selector";
import {
  bookingDate, bookingDayKind, bookingDays, bookingMoment, bookingShortDate, bookingTile, bookingTime, BOOKING_LIMITS,
} from "../../../shared/widget-booking";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { PersonAvatar } from "../MessageAuthor";
import { profileInitials } from "../SidebarProfileMenu";
import { useWidgetForm, WidgetGlyph, widgetCanPress } from "./WidgetControls";
import { kids } from "./widget-style";

interface Slot {
  ref: string;
  start: string;
  label: string;
}

/** The chip's own words: the label a press is recorded as. */
const CHIP =
  "inline-flex h-9 min-w-[4.5rem] items-center justify-center gap-1 rounded-full px-3.5 text-[14px] font-medium leading-5 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function slotsOf(node: WidgetNode): Slot[] {
  const out: Slot[] = [];
  for (const child of kids(node)) {
    const payload = child.onClickAction && typeof child.onClickAction === "object" ? (child.onClickAction as { payload?: unknown }).payload : undefined;
    const start = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { start?: unknown }).start : undefined;
    if (child.type === "Button" && typeof start === "string") out.push({ ref: child.id, start, label: widgetString(child, "label") ?? "" });
  }
  return out;
}

export function WidgetBooking({ node }: { node: WidgetNode }) {
  const form = useWidgetForm();
  const profile = useStoreSelector((state) => state.config?.profile);
  const viewer = useStoreSelector((state) => state.config?.viewer);
  const zone = widgetString(node, "timeZone");
  const locale = activeLocale();
  const slots = useMemo(() => slotsOf(node), [node]);
  const days = useMemo(() => bookingDays(slots.map((slot) => slot.start), zone), [slots, zone]);
  const bySlot = useMemo(() => new Map(slots.map((slot) => [slot.start, slot])), [slots]);
  const booked = form.settledRef ? slots.find((slot) => slot.ref === form.settledRef) : undefined;
  const bookedDay = booked ? days.find((day) => day.slots.includes(booked.start)) : undefined;

  const [picked, setPicked] = useState(days[0]?.key);
  const [windowStart, setWindowStart] = useState(0);
  /** Times shown of the picked day, in steps of five: More times shows the next ones. */
  const [steps, setSteps] = useState(1);
  const day = bookedDay ?? days.find((candidate) => candidate.key === picked) ?? days[0];
  if (!day) return null;
  const dayIndex = days.indexOf(day);
  const shown = day.slots.slice(0, BOOKING_LIMITS.timesShown * steps);
  const hasMoreInDay = shown.length < day.slots.length;
  const nextDay = days[dayIndex + 1];
  const canMore = !booked && (hasMoreInDay || nextDay !== undefined);
  // the five tiles in view; the window follows the picked day
  const start = Math.min(Math.max(0, windowStart), Math.max(0, days.length - BOOKING_LIMITS.daysShown));
  const tiles = days.slice(start, start + BOOKING_LIMITS.daysShown);
  const overflow = days.length > BOOKING_LIMITS.daysShown;

  const pickDay = (key: string) => {
    setPicked(key);
    setSteps(1);
  };
  const more = () => {
    if (hasMoreInDay) return setSteps((count) => count + 1);
    if (!nextDay) return;
    pickDay(nextDay.key);
    const at = days.indexOf(nextDay);
    if (at >= start + BOOKING_LIMITS.daysShown) setWindowStart(at - BOOKING_LIMITS.daysShown + 1);
  };

  const upcoming = Array.isArray(node.upcoming) ? node.upcoming as Array<{ name: string; start: string }> : [];
  const listed = upcoming.slice(0, BOOKING_LIMITS.upcomingShown);
  const rest = Math.max(0, upcoming.length - listed.length) + (widgetNumber(node, "upcomingMore") ?? 0);
  const minutes = widgetNumber(node, "durationMinutes");
  const detail = widgetString(node, "detail") ?? (minutes ? t("widget.booking.minutes", { minutes }) : undefined);
  const title = widgetString(node, "title") ?? t("widget.booking.title");
  const meeting = widgetString(node, "meetingType") ?? t("widget.booking.meeting");
  const kind = bookingDayKind(day.key, Date.now(), zone);
  const dayDate = bookingShortDate(day.at, zone, locale);
  const dayLine = kind === "today" ? t("widget.booking.today", { date: dayDate })
    : kind === "tomorrow" ? t("widget.booking.tomorrow", { date: dayDate })
      : t("widget.booking.day", { weekday: bookingTile(day.at, zone, locale).weekday, date: dayDate });

  return (
    <section data-widget-booking="" aria-label={title} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-inset text-ink-secondary">
          <WidgetGlyph name="calendar" size={16} />
        </span>
        <div dir="auto" className="min-w-0 truncate text-[15px] font-semibold leading-6 text-ink">{title}</div>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <PersonAvatar avatarUrl={profile?.avatarUrl} initials={profileInitials({ name: profile?.name?.trim() || viewer?.name?.trim(), email: profile?.email?.trim() || viewer?.email?.trim() })} size={36} />
        <div className="min-w-0">
          <div dir="auto" className="truncate text-[14px] font-medium leading-5 text-ink">{meeting}</div>
          {detail && <div dir="auto" className="truncate text-[12.5px] leading-[18px] text-ink-secondary">{detail}</div>}
        </div>
      </div>

      {listed.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("widget.booking.upcoming")}</div>
          <ul className="flex min-w-0 flex-col gap-1">
            {listed.map((item, index) => (
              <li key={`${item.start}-${index}`} dir="auto" className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">
                <bdi className="font-semibold text-ink">{item.name}</bdi>
                <span aria-hidden="true"> · </span>
                <span>{t("widget.booking.at", { date: bookingShortDate(item.start, zone, locale), time: bookingTime(item.start, zone, locale) })}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <div className="text-[13px] leading-[18px] text-ink-tertiary">{t("widget.booking.more", { count: rest })}</div>}
        </div>
      )}

      <div className="flex min-w-0 items-stretch gap-1.5">
        {overflow && (
          <button
            type="button"
            aria-label={t("widget.booking.earlier")}
            disabled={start === 0}
            onClick={() => setWindowStart(Math.max(0, start - 1))}
            className="flex w-6 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors enabled:hover:bg-ink/[0.07] enabled:hover:text-ink disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
        )}
        <div role="radiogroup" aria-label={t("widget.booking.days")} className="grid min-w-0 flex-1 grid-cols-5 gap-2">
          {tiles.map((tile) => {
            const on = tile.key === day.key;
            const parts = bookingTile(tile.at, zone, locale);
            return (
              <button
                key={tile.key}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={bookingDate(tile.at, zone, locale)}
                disabled={booked !== undefined}
                onClick={() => pickDay(tile.key)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  on ? "bg-ink/[0.09] text-ink" : "text-ink-secondary inset-ring inset-ring-ink/[0.16] enabled:hover:bg-ink/[0.05]",
                  booked !== undefined && !on && "opacity-60",
                )}
              >
                <span className="max-w-full truncate text-[12px] leading-4">{parts.weekday}</span>
                <span className="text-[16px] font-semibold leading-5 tabular-nums">{parts.day}</span>
              </button>
            );
          })}
        </div>
        {overflow && (
          <button
            type="button"
            aria-label={t("widget.booking.later")}
            disabled={start + BOOKING_LIMITS.daysShown >= days.length}
            onClick={() => setWindowStart(start + 1)}
            className="flex w-6 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors enabled:hover:bg-ink/[0.07] enabled:hover:text-ink disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        )}
      </div>

      <div role="group" aria-label={dayLine} className="flex min-w-0 flex-wrap gap-2">
        {shown.map((start) => {
          const slot = bySlot.get(start)!;
          const chosen = booked?.start === start;
          const entry = form.actions.get(slot.ref);
          const sending = form.pendingRef === slot.ref;
          return (
            <button
              key={start}
              type="button"
              data-widget-ref={slot.ref}
              aria-label={slot.label}
              aria-pressed={booked ? chosen : undefined}
              aria-busy={sending || undefined}
              disabled={!chosen && !widgetCanPress(form, entry)}
              onClick={() => form.press(slot.ref)}
              className={cn(
                CHIP,
                chosen ? "bg-accent text-accent-ink" : "text-ink inset-ring inset-ring-ink/[0.16] enabled:hover:bg-ink/[0.07]",
                sending && "bg-ink/[0.09]",
                booked && !chosen && "opacity-45",
              )}
            >
              {chosen && <CalendarCheck aria-hidden="true" size={14} />}
              {bookingTime(start, zone, locale)}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        {booked ? (
          <p role="status" dir="auto" className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-[18px] text-success">
            <CalendarCheck aria-hidden="true" size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{t("widget.booking.booked", { when: bookingMoment(booked.start, zone, locale) })}</span>
          </p>
        ) : (
          <div dir="auto" className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">{dayLine}</div>
        )}
        {canMore && (
          <button
            type="button"
            disabled={form.locked}
            onClick={more}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] px-4 text-[14px] font-medium leading-5 text-ink transition-colors enabled:hover:bg-ink/[0.12] disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("widget.booking.moreTimes")}
          </button>
        )}
      </div>
    </section>
  );
}
