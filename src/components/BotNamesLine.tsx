// The quiet centered line every bot-to-bot trace of a turn uses (#3270,
// #3289): a muted verb, then each bot as its small face and its name in the
// app's neutral ink, joined with the locale's conjunction; past three names,
// "and N others" shows the whole list and then folds it back. A name with
// somewhere to go opens the exchange in this column (the caller's sheet),
// never another conversation (unified chat). Every trace between bots draws
// with NamesLine, in both directions (#3581): Messaged, Asking / Asked (a
// hand-off, a routine run's teammates), and Asked by, Message from, Answer
// from (HandoffRow's IncomingLine). Never a quoted request on the line.
// A name is never cut: a narrow row draws fewer names and a larger "and N
// others" (lib/messaged-line messagedLineNames), the count always whole.
// A party with a detail (a phone line's number, #4112) keeps it whole too:
// on a narrow row only the words before it (the source, "Text Message")
// give way, and the names give way before the line's tail.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mausInk, type MausColor } from "@/lib/mascot";
import { conjunctionParts, messagedLineNames, tailOnOwnLine, type NamesFit } from "@/lib/messaged-line";
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
  /** Words after the name that never give way (a phone line's number,
   * "(555 010-0142)"): on a narrow row only the name before them is cut. */
  detail?: string;
}

/** The party's whole name, its detail included. */
function fullName(party: Pick<LineParty, "name" | "detail">): string {
  return party.detail ? `${party.name} ${party.detail}` : party.name;
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
    <>
      <QuietLineParty
        bot={bot ?? { name: party.name, color }}
        agentId={party.botId}
        name={party.name}
        color={color}
        tone="neutral"
        nameClassName={nameClassName ?? "min-w-0 max-w-[16rem] truncate"}
      />
      {party.detail ? <span data-line-detail="" className="-ms-[3px] shrink-0 font-medium text-ink">{party.detail}</span> : null}
    </>
  );
}

/** A party as the line draws it: a button when it opens something. */
function PartyName({ party, bots, testId }: { party: LineParty; bots: readonly Bot[]; testId: string }) {
  if (!party.onOpen) {
    return (
      <span data-testid={testId} {...party.data} title={party.title ?? fullName(party)} className="flex min-w-0 items-center gap-1.5">
        <PartyFace party={party} bots={bots} />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      {...party.data}
      title={party.title ?? fullName(party)}
      aria-label={party.label ?? t("sendReceipt.open", { name: fullName(party) })}
      onClick={party.onOpen}
      className={NAME_BUTTON}
    >
      <PartyFace party={party} bots={bots} />
    </button>
  );
}

const FACE = 16;
const NAME_MAX = 256;

let measuring: CanvasRenderingContext2D | null | undefined;

/** The width of words in the line's font, or null where nothing draws (tests). */
function textWidth(words: string, style: CSSStyleDeclaration, weight: string): number | null {
  if (measuring === undefined) {
    try {
      measuring = document.createElement("canvas").getContext("2d");
    } catch {
      measuring = null;
    }
  }
  if (!measuring) return null;
  measuring.font = `${weight} ${style.fontSize} ${style.fontFamily}`;
  return measuring.measureText(words).width;
}

interface Measured {
  widths: number[];
  others: number[];
  available: number;
  /** The tail's width with its dot, when the line has one. */
  tail: number;
}

/** What the folded line has room for (messagedLineNames decides from it):
 * each name whole with its face and the words that join it, each count,
 * and the row's width less the verb and the tail. */
function measureLine(row: HTMLElement, line: HTMLElement, verb: HTMLElement, names: readonly Pick<LineParty, "name" | "detail">[], othersLabel: (count: number) => string, locale: string): Measured | null {
  const rowStyle = getComputedStyle(row);
  const style = getComputedStyle(line);
  const room = row.clientWidth - parseFloat(rowStyle.paddingLeft || "0") - parseFloat(rowStyle.paddingRight || "0");
  if (!(room > 0)) return null;
  const gap = parseFloat(style.columnGap) || 6;
  const word = (words: string, weight = "500") => textWidth(words, style, weight);
  // the widest of the locale's joins (", ", " and ", ", and "): a comma
  // hugs the name before it, a word sits after a gap
  const joiners = [...conjunctionParts(2, locale), ...conjunctionParts(3, locale)].flatMap((part) => (part.type === "literal" ? [part.value.trim()] : []));
  let join = 0;
  for (const joiner of joiners) {
    const width = word(joiner, style.fontWeight);
    if (width === null) return null;
    join = Math.max(join, joiner.startsWith(",") ? width : gap + width);
  }
  const tail = line.querySelector<HTMLElement>("[data-line-tail]");
  const tailWidth = tail ? 2 * gap + (word("·", style.fontWeight) ?? 0) + (word(tail.textContent ?? "", style.fontWeight) ?? 0) : 0;
  // a name: the gap before it, its face, a gap, its words (and its detail
  // after a gap); joined to the one before
  const widths = names.map((name, index) => (index > 0 ? join : 0) + gap + FACE + gap + Math.min(NAME_MAX, word(name.name) ?? 0)
    + (name.detail ? gap + (word(name.detail) ?? 0) : 0));
  const others = names.map((_, count) => (count === 0 ? 0 : join + gap + (word(othersLabel(count)) ?? 0)));
  const padding = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
  // a little room to spare, so rounding never cuts the last letter
  const available = Math.floor(room - padding - verb.getBoundingClientRect().width - tailWidth - 4);
  return { widths: widths.map(Math.ceil), others: others.map(Math.ceil), available, tail: Math.ceil(tailWidth) };
}

const measuredKey = (measured: Measured | null) => (measured ? `${measured.available}|${measured.tail}|${measured.widths.join(",")}|${measured.others.join(",")}` : "");

/** What the line still says after the names: a state, a failure, a count.
 * It gives way only once the names before it have (#4112). */
function Tail({ children, tone, own = false }: { children: ReactNode; tone?: "danger" | "accent"; own?: boolean }) {
  const toneClass = cn(tone === "danger" && "text-danger", tone === "accent" && "text-accent-text");
  // its own line under the names, whole, when even one name and the count
  // of the others leave it no room on theirs
  if (own) return <span data-line-tail="" data-line-tail-own="" className={cn("basis-full", toneClass)}>{children}</span>;
  return (
    <>
      <span aria-hidden="true" className="shrink-0">·</span>
      <span data-line-tail="" className={cn("min-w-0 shrink-[0.01] truncate", toneClass)}>{children}</span>
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
  const rowRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const verbRef = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [width, setWidth] = useState(0);
  const locale = activeLocale();
  const othersText = (count: number) => t(count === 1 ? "chat.messagedOthers.one" : "chat.messagedOthers.other", { count });
  // #3581: a name is never cut. The row's width is watched; the line folds
  // to the names it has room for, whole.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(row.clientWidth));
    observer.observe(row);
    setWidth(row.clientWidth);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const line = lineRef.current;
    const verbBox = verbRef.current;
    const next = !expanded && width > 0 && row && line && verbBox
      ? measureLine(row, line, verbBox, parties, othersText, locale)
      : null;
    setMeasured((current) => (measuredKey(current) === measuredKey(next) ? current : next));
  });
  // #4112: one name whole and the count of the others leave the tail no room
  // (a phone line's number on a phone-width row): the tail takes a line of
  // its own under the names instead of being cut
  const others = (count: number) => measured?.others[count] ?? measured?.others.at(-1) ?? 0;
  const ownTail = !expanded && measured !== null && tailOnOwnLine(parties.length, { widths: measured.widths, available: measured.available, others }, Boolean(tail) && measured.tail > 0);
  const fit: NamesFit | undefined = measured
    ? { widths: measured.widths, available: measured.available + (ownTail ? measured.tail : 0), others }
    : undefined;
  const { shown, others: hidden } = messagedLineNames(parties, expanded, fit);
  const othersLabel = hidden > 0 ? othersText(hidden) : null;
  const parts = conjunctionParts(shown.length + (othersLabel ? 1 : 0), locale);
  // opened (only a folded line opens): the whole list, then the control that folds it back
  const foldable = expanded;
  return (
    <div ref={rowRef} className={cn(QUIET_LINE_ROW, align === "start" && "justify-start", className)} data-testid={testId} data-mid={mid} {...data}>
      <div ref={lineRef} className={cn(QUIET_LINE, "min-w-0 max-w-full", align === "start" && "px-0", expanded || ownTail ? cn("flex-wrap", align === "start" ? "justify-start text-start" : "justify-center text-center") : "overflow-hidden whitespace-nowrap", ownTail && "gap-y-0.5 overflow-hidden whitespace-nowrap")}>
        <span ref={verbRef} className="shrink-0">{verb}</span>
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
              title={parties.slice(shown.length).map(fullName).join(", ")}
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
        {tail ? <Tail tone={tailTone} own={ownTail}>{tail}</Tail> : null}
      </div>
      {children}
    </div>
  );
}
