// The conversation panel's two counters (wait before send, first answer
// text). They live on the conversation, not in a message. 2026-10-28: a
// diagnostic, never part of the conversation: shown only when this device
// turned on Settings > Appearance > Turn timing (a developer setting,
// src/lib/turn-timing-preferences.ts). Nothing is shown until a number exists.
import { t } from "@/lib/i18n";
import { useShowTurnTiming } from "@/lib/turn-timing-preferences";
import type { WireTurnTiming } from "../../shared/wire";

/** The line's parts, main number first (#4215): send to first word, then
 * where it went, then the total. */
export function turnTimingParts(timing: WireTurnTiming | undefined): string[] {
  if (!timing) return [];
  const parts: string[] = [];
  if (typeof timing.firstWordMs === "number") parts.push(t("chat.turnTiming.firstWord", { ms: timing.firstWordMs }));
  if (typeof timing.queueMs === "number") parts.push(t("chat.turnTiming.wait", { ms: timing.queueMs }));
  if (typeof timing.engineStartMs === "number") {
    parts.push(t(timing.engineStart === "warm" ? "chat.turnTiming.engineWarm" : "chat.turnTiming.engineCold", { ms: timing.engineStartMs }));
  }
  if (typeof timing.firstResponseMs === "number") parts.push(t("chat.turnTiming.first", { ms: timing.firstResponseMs }));
  if (typeof timing.totalMs === "number") parts.push(t("chat.turnTiming.total", { ms: timing.totalMs }));
  return parts;
}

export function turnTimingLabel(timing: WireTurnTiming | undefined): string | null {
  const parts = turnTimingParts(timing);
  return parts.length ? parts.join(" · ") : null;
}

export function TurnTimingLine({ timing }: { timing?: WireTurnTiming }) {
  const shown = useShowTurnTiming();
  const parts = shown ? turnTimingParts(timing) : [];
  if (!parts.length) return null;
  // #4215: rendered below the floating header (ChatViewBanners, GroupView),
  // never under its fade. Each number keeps to one piece; when the row is
  // full the next number starts a row of its own, spaced by the gap and
  // never led by a separator. The main number is the first and the brightest.
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-0.5 px-5 pb-1 text-[11.5px] leading-snug text-ink-tertiary" data-turn-timing="">
      {parts.map((part, index) => (
        <span key={index} className={index ? "whitespace-nowrap" : "whitespace-nowrap text-ink-secondary"}>{part}</span>
      ))}
    </p>
  );
}
