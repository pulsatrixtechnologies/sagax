// Words for dates and spans on the Remote sessions page.
import { activeLocale, t } from "@/lib/i18n";

/** "Nov 17, 20:01" in the person's language. */
export function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "42 min", "1 h 12 min", "2 d 3 h"; empty when the span is not a time. */
export function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("remoteSessions.dur.lt1");
  if (minutes < 60) return t("remoteSessions.dur.min", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? t("remoteSessions.dur.h", { hours }) : t("remoteSessions.dur.hm", { hours, minutes: minutes % 60 });
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? t("remoteSessions.dur.d", { days }) : t("remoteSessions.dur.dh", { days, hours: hours % 24 });
}
