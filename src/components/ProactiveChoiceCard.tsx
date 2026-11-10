// #3457 (lot 6 of #3408, design 3.6): the choice card a bot posts with
// propose_proactive (server/proactive/proactive-ask.ts choiceCard), in the
// compact look of the approval card (#3414): an icon, the title, one or two
// plain lines, « Oui » and « Pas maintenant », and the row « Ne plus
// proposer ». Folded details: each watch of the domain with its switch and
// the read-only tools it uses. Labels only: a watch id answers the route, a
// tool name stays in a tooltip. Answered, it folds to one quiet row, the way
// a settled proposal does.
//
// A choice card, not a permission card: its yes is the person's standing
// choice of that domain on that bot. The switches go with the yes, so a
// watch turned off here is not turned on by it.
import { useState } from "react";
import { BellRing, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OptionCardData } from "@/state/store";
import { ApprovalHeading, RiskChip } from "./ApprovalParts";
import { toolLabel } from "./ApprovalCard";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_PRIMARY_BUTTON } from "./AskCard";
import { Switch } from "./SettingsPrimitives";
import { StepRow } from "./StepRow";
import { SuggestionFeedback } from "./SuggestionFeedback";

type ChoiceWatch = NonNullable<OptionCardData["proactiveChoice"]>["watches"][number];

/** A watch's tool in words: a bare connector tool reads as the action it
 * does in its product ("view the tickets in the desk"), never its name. */
export function watchToolLabel(tool: string): string {
  const words = toolLabel(tool.includes("__") ? tool : `mcp__perspicax__${tool}`);
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : words;
}

/** The watches a yes turns on: the card's own marks, as the switches left them. */
export function watchesKeptOn(watches: readonly ChoiceWatch[], switched: Readonly<Record<string, boolean>>): string[] {
  return watches.filter((watch) => switched[watch.id] ?? watch.on).map((watch) => watch.id);
}

function WatchTools({ tools }: { tools: readonly string[] }) {
  const labels = [...new Set(tools.map(watchToolLabel).filter(Boolean))];
  if (!labels.length) return null;
  return (
    <div data-choice-watch-tools="" title={tools.join(", ")} className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-ink-secondary">
      <RiskChip risk="read" />
      <span aria-hidden="true">·</span>
      <span className="min-w-0">{labels.join(", ")}</span>
    </div>
  );
}

/** Each watch of the domain: its label, how often, and the tools it reads
 * with; open, its switch. */
function WatchList({ watches, switched, onSwitch }: {
  watches: readonly ChoiceWatch[];
  switched?: Readonly<Record<string, boolean>>;
  onSwitch?: (id: string, on: boolean) => void;
}) {
  return (
    <ul className="mt-1.5 flex flex-col divide-y divide-hairline/40 rounded-xl border border-hairline/40 bg-inset px-3">
      {watches.map((watch) => {
        const on = switched?.[watch.id] ?? watch.on;
        return (
          <li key={watch.id} data-choice-watch="" className="flex min-w-0 items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div data-choice-watch-label="" dir="auto" className="break-words text-[13px] leading-5 text-ink">{watch.label}</div>
              {watch.cadence && <div className="text-[12px] leading-4 text-ink-secondary">{watch.cadence}</div>}
              <WatchTools tools={watch.tools} />
            </div>
            {onSwitch && (
              <Switch
                checked={on}
                aria-label={watch.label}
                className="mt-0.5"
                onClick={() => onSwitch(watch.id, !on)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ProactiveChoiceCard({ card, onAnswer, onNever, showNever = true, defaultOpen = false }: {
  card: OptionCardData;
  /** the answer: a yes with the watches kept on, or « Pas maintenant » */
  onAnswer: (accept: boolean, watches: string[]) => void;
  /** « Ne plus proposer »: final for bots (the proposal feedback route) */
  onNever: () => Promise<void>;
  /** the bot's owner only, in a room too */
  showNever?: boolean;
  /** the details start unfolded (the gallery's captures) */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const choice = card.proactiveChoice;
  if (!choice) return null;
  const [yes = "", notNow = ""] = card.options;

  if (card.answered || card.expired) {
    const accepted = !card.expired && card.answered === yes;
    const said = card.expired ? t("question.status.closed") : card.answeredText ?? card.answered ?? "";
    return (
      <StepRow
        testId="proactive-choice-receipt"
        data={{ "data-proactive-choice-receipt": accepted ? "success" : "neutral" }}
        icon={accepted ? <Check size={13} aria-hidden="true" className="text-success" /> : <X size={13} aria-hidden="true" className="text-ink-tertiary" />}
        label={said}
        target={choice.label}
      >
        {() => (
          <div className="flex flex-col text-[12.5px] text-ink-secondary">
            <div className="text-ink">{card.title}</div>
            {card.subtitle && <div>{card.subtitle}</div>}
            <WatchList watches={choice.watches} />
          </div>
        )}
      </StepRow>
    );
  }

  const kept = watchesKeptOn(choice.watches, switched);
  return (
    <div
      role="group"
      aria-label={card.title}
      data-proactive-choice=""
      data-ask-card="pending"
      // #3414: the compact surface every ask of the chat shares (AskCard)
      className="w-full max-w-[600px] rounded-3xl bg-composer px-4 py-3 text-start ring-1 ring-composer-ring"
    >
      <ApprovalHeading icon={<BellRing size={15} />} title={card.title} summary={card.subtitle} />
      {choice.watches.length > 0 && (
        <div className="mt-2" data-choice-details={open ? "open" : "closed"}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md py-0.5 text-[12.5px] text-ink-secondary hover:text-ink"
          >
            <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
            {open ? t("proactiveChoice.details.hide") : t("proactiveChoice.details.show")}
          </button>
          {open && <WatchList watches={choice.watches} switched={switched} onSwitch={(id, on) => setSwitched((now) => ({ ...now, [id]: on }))} />}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2" data-choice-actions="">
        {showNever && <SuggestionFeedback choices={["never"]} value={card.feedback} onPick={onNever} />}
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => onAnswer(false, kept)} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
            {notNow}
          </button>
          {/* a yes with every watch off would turn on nothing */}
          <button type="button" disabled={!kept.length} onClick={() => onAnswer(true, kept)} className={ASK_PRIMARY_BUTTON}>
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}
