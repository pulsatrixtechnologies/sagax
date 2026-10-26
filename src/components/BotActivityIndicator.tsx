// The one line that says a bot is busy, in a chat and in a room.
//
// Thinking (busy, no answer text yet): three dots in the bot's colour, one
// brighter and larger at a time in a wave, then a phrase in muted grey with a
// light sheen sweeping across it. A plain thinking step rotates through our
// own short list every few seconds; a tool step keeps its own label.
// Typing (answer text is arriving): the bot's small mascot, still, then
// "Typing…" with the same sheen.
//
// Reduced motion (the system setting or :root[data-reduced-motion]): still
// dots, no sheen, the first phrase only. Screen readers hear one stable line
// ("Pepper is thinking"), never each rotation.
import { useEffect, useState, type CSSProperties } from "react";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { normalizeHex } from "@/lib/bot-accent";
import { isColorless } from "@/lib/voice-cta";
import { phraseAt } from "@/lib/live-activity";
import { BotAvatar, type BotAvatarProps } from "@/components/Avatar";
import { useReducedMotion } from "@/components/skin-fx/skin-fx";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";

/** The plain thinking step's phrases, first one first. */
export const THINKING_PHRASE_KEYS: readonly LocaleKey[] = [
  "chat.presence.phrase.thinkingItOver",
  "chat.presence.phrase.workingItOut",
  "chat.presence.phrase.pullingItTogether",
  "chat.presence.phrase.checkingTheDetails",
];

/** How long each phrase stays up. */
export const PHRASE_HOLD_MS = 3500;

/** The live-activity phase of a plain thinking step (no tool running). */
export const THINKING_PHASE = "chat.activity.thinking";

/** The dots' colour: the bot's mascot colour as #rrggbb, or null (a colourless
 * or unknown colour) for the accent. */
export function botActivityColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const hex = Object.hasOwn(MASCOT_COLOR_HEX, color)
    ? MASCOT_COLOR_HEX[color as keyof typeof MASCOT_COLOR_HEX]
    : normalizeHex(color);
  return hex && !isColorless(hex) ? hex.toLowerCase() : null;
}

/** Steps through `count` phrases every PHRASE_HOLD_MS while `active`; a new
 * `key` starts over at step 0, so a re-render never moves it. */
function useRotatingStep(key: string, count: number, active: boolean): number {
  const [clock, setClock] = useState({ key, step: 0 });
  if (clock.key !== key) setClock({ key, step: 0 });
  const step = clock.key === key ? clock.step : 0;
  useEffect(() => {
    if (!active || count < 2) return;
    const timer = setTimeout(() => setClock({ key, step: step + 1 }), PHRASE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [active, count, key, step]);
  return step;
}

// The sheen keeps its place when the phrase changes instead of restarting at
// the left edge. 2s matches --animate-shimmer; the delay is fixed on mount.
function Sheen({ text, ultracode, still }: { text: string; ultracode: boolean; still: boolean }) {
  const [delay] = useState(() => `-${Date.now() % 2000}ms`);
  return (
    <span
      data-presence-phrase=""
      className={cn(
        "whitespace-nowrap text-[13px]",
        still ? "text-ink-secondary" : cn("thinking-shimmer animate-shimmer", ultracode && "ultracode-shimmer"),
      )}
      style={still ? undefined : { animationDelay: delay }}
    >
      {text}
    </span>
  );
}

export type BotActivityMode = "thinking" | "typing";

export function BotActivityIndicator({
  bot,
  mode,
  phrases,
  phase = THINKING_PHASE,
  seed = "",
  ultracode = false,
  active = true,
}: {
  bot: BotAvatarProps["bot"];
  mode: BotActivityMode;
  /** a tool step's phrases, plain label first; the thinking step uses its own list */
  phrases?: readonly string[];
  /** stable key for the current step; a new step starts at its first phrase */
  phase?: string;
  /** turn identity, so one turn always reads the same and two turns differ */
  seed?: string;
  /** Ultracode effort: the purple sheen */
  ultracode?: boolean;
  /** false while the line leaves: stops the rotation */
  active?: boolean;
}) {
  const osReduced = useReducedMotion();
  const reduced = osReduced || prefersReducedMotion();
  const thinkingStep = phase === THINKING_PHASE || !phrases || phrases.length === 0;
  const list = thinkingStep ? THINKING_PHRASE_KEYS.map((key) => t(key)) : phrases;
  const stepKey = `${seed}|${phase}`;
  const step = useRotatingStep(stepKey, list.length, active && mode === "thinking" && !reduced);
  const phrase = mode === "typing" ? t("chat.presence.typing") : phraseAt(list, stepKey, reduced ? 0 : step);
  const name = bot.name?.trim() || t("chat.presence.someone");
  const label = mode === "typing" ? t("chat.presence.typingLabel", { name }) : t("chat.presence.thinkingLabel", { name });
  const color = botActivityColor(bot.color);

  return (
    <span
      role="status"
      aria-live="polite"
      data-bot-activity={mode}
      data-reduced-motion={reduced ? "" : undefined}
      className="bot-activity inline-flex items-center gap-2 leading-none"
      style={{ "--bot-activity-color": color ?? "var(--color-accent)" } as CSSProperties}
    >
      <span className="sr-only">{label}</span>
      {mode === "typing" ? (
        <span aria-hidden="true" data-presence-mascot="" className="inline-flex shrink-0">
          <BotAvatar bot={bot} size={20} animated={false} forward={false} trackPointer={false} />
        </span>
      ) : (
        <span aria-hidden="true" data-presence-dots="" className={cn("bot-activity-dots", !reduced && "bot-activity-wave")}>
          <span />
          <span />
          <span />
        </span>
      )}
      <span aria-hidden="true" className="flex items-baseline">
        <Sheen key={mode} text={phrase} ultracode={ultracode} still={reduced} />
      </span>
    </span>
  );
}
