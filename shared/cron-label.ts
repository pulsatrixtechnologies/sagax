import { describeCron, type CronLocale } from "./cron-describe.ts";
import type { RoutineCronSchedule } from "./routine-schedule.ts";

const WEEKDAYS = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};
const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

/** The raw expression, for a tooltip or a Copy button. */
export function cronRawText(schedule: RoutineCronSchedule): string {
  return `${schedule.expression} · ${schedule.timeZone}`;
}

/** True when the label is a sentence rather than the raw expression. */
export function cronIsDescribed(schedule: RoutineCronSchedule, locale: CronLocale = "en"): boolean {
  return !cronScheduleLabel(schedule, locale).startsWith("Cron ");
}

/** Describe the expression in words (fr or en); keep the exact expression
 * when it cannot be said clearly. Presentation only, never a second parser
 * or source of scheduling truth. */
export function cronScheduleLabel(schedule: RoutineCronSchedule, locale: CronLocale = "en"): string {
  const fr = locale === "fr";
  const [minute, hour, day, month, weekday] = schedule.expression.trim().split(/\s+/);
  let label: string | null = null;
  if (/^\d+$/.test(minute ?? "") && Number(minute) <= 59 && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    label = fr ? `Toutes les heures à :${minute!.padStart(2, "0")}` : `Every hour at :${minute!.padStart(2, "0")}`;
  }
  if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "") && Number(minute) <= 59 && Number(hour) <= 23) {
    const time = fr ? `${Number(hour)} h ${minute!.padStart(2, "0")}` : `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}`;
    const monthDay = /^\d+$/.test(day ?? "") ? Number(day) : null;
    if (weekday === "*" && month === "*") {
      if (day === "*") label = fr ? `Tous les jours à ${time}` : `Every day at ${time}`;
      else if (day === "L") label = fr ? `Le dernier jour du mois à ${time}` : `Monthly on the last day at ${time}`;
      else if (monthDay !== null) label = fr ? `Le ${monthDay === 1 ? "1er" : monthDay} du mois à ${time}` : `Monthly on day ${monthDay} at ${time}`;
    } else if (weekday === "*" && /^\d+$/.test(month ?? "") && monthDay !== null) {
      const name = MONTHS[locale][Number(month) - 1];
      if (name) label = fr ? `Chaque année, le ${monthDay === 1 ? "1er" : monthDay} ${name}, à ${time}` : `Yearly on ${name} ${monthDay} at ${time}`;
    } else if (day === "*" && month === "*") {
      if (weekday === "1-5" || weekday?.toUpperCase() === "MON-FRI") label = fr ? `Du lundi au vendredi à ${time}` : `Every weekday at ${time}`;
      else if (/^[0-7]$/.test(weekday ?? "")) label = fr ? `Chaque ${WEEKDAYS.fr[Number(weekday) % 7]} à ${time}` : `Weekly on ${WEEKDAYS.en[Number(weekday) % 7]} at ${time}`;
      else {
        const nth = /^([0-7])#([1-5]|L)$/i.exec(weekday ?? "");
        if (nth) {
          const index = Number(nth[2]);
          const last = nth[2]!.toUpperCase() === "L";
          const weekdayName = WEEKDAYS[locale][Number(nth[1]) % 7];
          if (fr) {
            const order = last ? "dernier" : index === 1 ? "premier" : ["", "", "deuxième", "troisième", "quatrième", "cinquième"][index];
            label = `Le ${order} ${weekdayName} du mois à ${time}`;
          } else {
            label = `Monthly on the ${last ? "last" : ["", "first", "second", "third", "fourth", "fifth"][index]} ${weekdayName} at ${time}`;
          }
        }
      }
    }
  }
  label ??= describeCron(schedule.expression, locale) ?? `Cron ${schedule.expression}`;
  return `${label} · ${schedule.timeZone}`;
}
