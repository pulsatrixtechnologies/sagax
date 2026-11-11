// The quiet centered line every bot-to-bot trace of a turn uses (#3270,
// #3289): a muted verb, then each bot as its small face and its name in the
// app's neutral ink, joined with the locale's conjunction; past three names,
// "and N others" shows the whole list and then folds it back. A name with
// somewhere to go opens the exchange in this column (the caller's sheet),
// never another conversation (unified chat). The Messaged line, the Asking /
// Asked line of a hand-off and of a routine run's teammates draw with
// NamesLine; a request one bot received from another draws with ActorLine
// ("[face] A asked “first words”"), the same row, faces and ink.
import { useState, type ReactNode } from "react";
import type { Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mausInk, type MausColor } from "@/lib/mascot";
import { conjunctionParts, MESSAGED_LINE_SHOWN } from "@/lib/messaged-line";
import { QUIET_LINE, QUIET_LINE_ROW, QuietLineParty } from "./ConversationLink";

const MORE_BUTTON = "-mx-1 shrink-0 rounded-full px-1 font-medium text-ink hover:bg-raised";
const NAME_BUTTON = "-mx-1 flex min-w-0 items-center gap-1.5 rounded-full px-1 hover:bg-raised";

/** One bot named on a line. */
export interface LineParty {
  key: string;
  botId?: string;
  name: string;
  color?: string;
  /** The tooltip (the name, else more: the model, the state). */
  title?: string;
  /** Opens the exchange with this bot; absent, the name is said and opens nothing. */
  onOpen?: () => void;
  /** What a screen reader says of the click (default: open the exchange). */
  label?: string;
  /** Attributes of the name (what it opens, for tests and captures). */
  data?: Record<string, string>;
}

/** The names, as the locale lists them ("A, B and C", "A, B et C"). */
export function listNames(names: readonly string[]): string {
  try {
    return new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

function inkColor(color: string | undefined): MausColor {
  return color && mausInk(color) ? (color as MausColor) : "blue";
}

/** The bot's face and its name, in the neutral ink. */
function PartyFace({ party, bots, nameClassName }: { party: LineParty; bots: readonly Bot[]; nameClassName?: string }) {
  const bot = party.botId ? bots.find((candidate) => candidate.id === party.botId) : bots.find((candidate) => candidate.name === party.name);
  const color = inkColor(bot?.color ?? party.color);
  return (
    <QuietLineParty
      bot={bot ?? { name: party.name, color }}
      agentId={party.botId}
      name={party.name}
      color={color}
      tone="neutral"
      nameClassName={nameClassName ?? "min-w-0 max-w-[16rem] truncate"}
    />
  );
}

/** A party as the line draws it: a button when it opens something. */
function PartyName({ party, bots, testId }: { party: LineParty; bots: readonly Bot[]; testId: string }) {
  if (!party.onOpen) {
    return (
      <span data-testid={testId} {...party.data} title={party.title ?? party.name} className="flex min-w-0 items-center gap-1.5">
        <PartyFace party={party} bots={bots} />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      {...party.data}
      title={party.title ?? party.name}
      aria-label={party.label ?? t("sendReceipt.open", { name: party.name })}
      onClick={party.onOpen}
      className={NAME_BUTTON}
    >
      <PartyFace party={party} bots={bots} />
    </button>
  );
}

/** What the line still says after the names: a state, a failure. */
function Tail({ children, tone }: { children: ReactNode; tone?: "danger" | "accent" }) {
  return (
    <>
      <span aria-hidden="true" className="shrink-0">·</span>
      <span data-line-tail="" className={cn("min-w-0 truncate", tone === "danger" && "text-danger", tone === "accent" && "text-accent-text")}>{children}</span>
    </>
  );
}

export function NamesLine({ testId, verb, parties, bots, tail, tailTone, mid, data, className, align = "center", children }: {
  /** The line's test id; its names are `<testId>-recipient`, the toggle `<testId>-more`. */
  testId: string;
  verb: ReactNode;
  parties: readonly LineParty[];
  bots: readonly Bot[];
  tail?: ReactNode;
  tailTone?: "danger" | "accent";
  mid?: string;
  data?: Record<string, string>;
  /** Extra classes of the row (a line inside a card spans its width). */
  className?: string;
  /** "start": a line inside a card, flush with the card's own lines (its
   * title, words and items), also when it wraps. The chat's own quiet
   * lines stay centered. */
  align?: "center" | "start";
  /** Drawn beside the line: the opened exchange's sheet. */
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const folded = !expanded && parties.length > MESSAGED_LINE_SHOWN;
  const shown = folded ? parties.slice(0, MESSAGED_LINE_SHOWN) : parties;
  const others = parties.length - shown.length;
  const othersLabel = others > 0 ? t(others === 1 ? "chat.messagedOthers.one" : "chat.messagedOthers.other", { count: others }) : null;
  const parts = conjunctionParts(shown.length + (othersLabel ? 1 : 0), activeLocale());
  // opened: the whole list, then the control that folds it back
  const foldable = expanded && parties.length > MESSAGED_LINE_SHOWN;
  return (
    <div className={cn(QUIET_LINE_ROW, align === "start" && "justify-start", className)} data-testid={testId} data-mid={mid} {...data}>
      <div className={cn(QUIET_LINE, "min-w-0 max-w-full", align === "start" && "px-0", expanded ? cn("flex-wrap", align === "start" ? "justify-start" : "justify-center") : "overflow-hidden whitespace-nowrap")}>
        <span className="shrink-0">{verb}</span>
        {parts.map((part, index) => {
          if (part.type === "literal") {
            // the row's gap stands for the spaces; a comma hugs the name before it
            const words = part.value.trim();
            return <span key={`l${index}`} className={cn("shrink-0", words.startsWith(",") && "-ml-1.5")}>{words}</span>;
          }
          const party = shown[part.index];
          if (party) return <PartyName key={party.key} party={party} bots={bots} testId={`${testId}-recipient`} />;
          return (
            <button
              key="others"
              type="button"
              data-testid={`${testId}-more`}
              aria-expanded={false}
              title={parties.slice(shown.length).map((entry) => entry.name).join(", ")}
              onClick={() => setExpanded(true)}
              className={MORE_BUTTON}
            >
              {othersLabel}
            </button>
          );
        })}
        {foldable && (
          <button type="button" data-testid={`${testId}-more`} aria-expanded={true} onClick={() => setExpanded(false)} className={MORE_BUTTON}>
            {t("chat.showLess")}
          </button>
        )}
        {tail ? <Tail tone={tailTone}>{tail}</Tail> : null}
      </div>
      {children}
    </div>
  );
}

/** One bot that did something: "[face] Scout asked “first words”". */
export function ActorLine({ testId, party, verb, words, bots, tail, tailTone, mid, data, children }: {
  testId: string;
  party: LineParty;
  verb: ReactNode;
  /** The first words of what was asked, the whole text in the tooltip. */
  words?: string;
  bots: readonly Bot[];
  tail?: ReactNode;
  tailTone?: "danger" | "accent";
  mid?: string;
  data?: Record<string, string>;
  children?: ReactNode;
}) {
  const said = words?.replace(/\s+/g, " ").trim();
  return (
    <div className={QUIET_LINE_ROW} data-testid={testId} data-mid={mid} {...data}>
      <div className={cn(QUIET_LINE, "min-w-0 max-w-full overflow-hidden whitespace-nowrap")}>
        <PartyName party={party} bots={bots} testId={`${testId}-recipient`} />
        <span className="shrink-0">{verb}</span>
        {said ? <span data-line-words="" title={words} className="min-w-0 max-w-[28rem] truncate">{t("chat.askLine.words", { words: said })}</span> : null}
        {tail ? <Tail tone={tailTone}>{tail}</Tail> : null}
      </div>
      {children}
    </div>
  );
}
