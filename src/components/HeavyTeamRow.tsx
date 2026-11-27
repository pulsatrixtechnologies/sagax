// A Heavy run in the chat (#4901, #5089, the reference app's Heavy): the
// row's small avatars are the run itself. Every expert is the conversation's
// bot, exactly as the chat's header draws it (BotAvatar, the bot unchanged:
// its character, shape, skin, colours or picture), duplicated once per expert,
// never a colour of its own, an owl or a generic shape (M-20261127-178,
// M-20261126-119, D-20261126-037). While the team works the bot's mascot
// divides in place into one cell per expert (HeavyDivision, owner 2026-11-26,
// M-20261126-122), "Experts critiquing · round 2 of 5 · 6s" against it and a
// live preview of what each one writes, then the leader's step; an expert
// that failed stays dimmed in the pile and in the preview. Once they are
// done, the same pile and one quiet line, "Thought for 8s", and how it ended
// (agreed in round 2, or the leader decided after 5); it opens the Thoughts
// panel. While its leader picks the team the row shows the bot itself, then
// its mascot divides (its own shape, or a round in its colour for a
// character or a photo), and once the pile has closed up each cell becomes
// the bot's own avatar again, stacked as the pile is (alive while the run
// goes, the one speaking at work, as the orbit drew them). When Auto chose
// Heavy on its own it says so in one line above. The final answer is the
// leader's ordinary reply under it. State: shared/heavy-team.ts.
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  agentPreview, expertName, failedPreview, HEAVY_FAILED_OPACITY, heavyAutoText, heavyHeader, heavyIsRunning, heavyOutcomeText, leaderNow, leaderStepText, refusalText,
} from "@/lib/heavy-team";
import { toggleThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import type { Message } from "@/state/store";
import type { HeavyAgentLine, HeavyTeamLine } from "../../shared/heavy-team";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { divisionPlayed, HeavyDivision, useDivisionArt, type DivisionArt } from "./HeavyDivision";
import { useReducedMotionPreference } from "./TabIndicator";

type LeaderBot = BotAvatarProps["bot"];

/** The bot of the conversation, the team's leader: its mascot is what divides, and every expert is it (ChatViewShell provides it to the transcript and the Thoughts panel). */
export const HeavyLeaderContext = createContext<LeaderBot | null>(null);

/**
 * One expert of a Heavy run, in the row's pile and in the Thoughts panel:
 * the conversation's bot exactly as the chat's header draws it (BotAvatar,
 * the bot unchanged), never a colour, an owl or a shape of its own
 * (M-20261127-178). Only its life is the expert's: at work while it speaks.
 */
export function ExpertAvatar({ bot, size, working, animated }: { bot: LeaderBot; size: number; working: boolean; animated: boolean }) {
  const state = working ? "thinking" : "idle";
  return <BotAvatar bot={bot} size={size} state={state} agentState={state} animated={animated} trackPointer={false} label="" />;
}

/**
 * The experts, overlapping: the bot's own avatar once per expert. While the
 * run goes they are alive, the one speaking at work (as the orbit drew
 * them); one that failed is dimmed.
 */
function AgentAvatars({ agents, running = false, bot, size = 22 }: { agents: readonly Pick<HeavyAgentLine, "n" | "status" | "speaking">[]; running?: boolean; bot: LeaderBot; size?: number }) {
  return (
    <span data-heavy-avatars="" role="img" aria-label={t("heavy.avatars", { count: agents.length })} className="flex shrink-0 items-center">
      {agents.map((agent, index) => (
        <span key={agent.n} data-heavy-expert-avatar={agent.n} data-heavy-failed={agent.status === "failed" ? "" : undefined}
          className={cn("flex items-center justify-center rounded-full bg-app ring-2 ring-app", index > 0 && "-ml-1.5")}>
          <span className="flex" style={agent.status === "failed" ? { opacity: HEAVY_FAILED_OPACITY } : undefined}>
            <ExpertAvatar bot={bot} size={size} working={running && agent.speaking === true} animated={running} />
          </span>
        </span>
      ))}
    </span>
  );
}

/** What the row drew a moment ago, fading out over what it draws now (the bot into its division, the division's cells into the bot's avatars); gone at once under reduced motion. */
function FadeAway({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const reduced = useReducedMotionPreference();
  useEffect(() => {
    // the animation's end, or a moment after it should have ended (a page that runs no animation)
    const timer = setTimeout(onDone, reduced ? 0 : 600);
    return () => clearTimeout(timer);
  }, [reduced, onDone]);
  if (reduced) return null;
  return <span data-heavy-fading="" aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center animate-card-fade-out" onAnimationEnd={onDone}>{children}</span>;
}

/**
 * The team out of the bot's mascot, for every bot (M-20261127-178,
 * D-20261126-037): the bot while its leader picks the team, then its mascot
 * divides (its own shape, or a round in its colour for a character or a
 * photo), and once the pile has closed up each cell becomes the bot's own
 * avatar again. A run that is over, past its first round, or already shown
 * starts as the pile.
 */
function ExpertsDivision({ art, bot, line, running, runId, settled, failed }: { art: DivisionArt | null; bot: LeaderBot; line: HeavyTeamLine; running: boolean; runId: string; settled: boolean; failed: readonly boolean[] }) {
  const count = line.agents.length;
  const [pile, setPile] = useState(() => !running || settled || divisionPlayed(runId));
  // what fades out over the drawing: the bot once its division shows, the division once the pile of its avatars shows
  const [fading, setFading] = useState<"leader" | "round" | null>(null);
  const [planned, setPlanned] = useState(count > 0);
  useEffect(() => {
    if (count > 0 && !planned) {
      setPlanned(true);
      if (!pile) setFading("leader");
    }
  }, [count, planned, pile]);
  const done = useCallback(() => setFading(null), []);
  const piled = useRef(pile);
  // the division reached its pile: the bot's avatars take its place, the division fading out over them
  const rest = useCallback(() => {
    if (piled.current) return;
    piled.current = true;
    setPile(true);
    setFading("round");
  }, []);
  const division = art && <HeavyDivision art={art} count={count} running={running} runId={runId} settled={settled} failed={failed} onRest={rest} />;
  if (pile) {
    return (
      <span data-heavy-pile="" className="relative flex shrink-0 items-center">
        <AgentAvatars agents={line.agents} running={running} bot={bot} />
        {fading === "round" && division && <FadeAway onDone={done}>{division}</FadeAway>}
      </span>
    );
  }
  if (count === 0 || !art) return <LeaderAvatar bot={bot} />;
  return (
    <span className="relative flex shrink-0 items-center">
      {division}
      {fading === "leader" && <FadeAway onDone={done}><LeaderAvatar bot={bot} /></FadeAway>}
    </span>
  );
}

/** The bot alone while its leader picks the team (or while its shape's still loads), at the pile's size. */
function LeaderAvatar({ bot, size = 22 }: { bot: LeaderBot; size?: number }) {
  return (
    <span data-heavy-leader-avatar="" aria-hidden="true" className="flex shrink-0 items-center">
      <BotAvatar bot={bot} size={size} trackPointer={false} />
    </span>
  );
}

export function HeavyTeamRow({ message, busy = false }: { message: Message; busy?: boolean }) {
  const line = message.tool?.team as HeavyTeamLine;
  const running = heavyIsRunning(line, busy);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const open = useOpenThoughts() === message.id;
  // the bot's mascot divides into the experts (its shape, or a round in its colour for a character or a photo), each the bot's own avatar
  const leader = use(HeavyLeaderContext);
  const art = useDivisionArt(leader);
  const working = (line.phase === "planning" || line.phase === "agents") && busy;
  // a row that first shows once the experts are past their first round starts as the pile: their division is long over
  const settled = line.phase === "leader" || line.rounds.some((round) => round.endedAt !== undefined);
  const failed = line.agents.map((agent) => agent.status === "failed");
  const header = heavyHeader(line, busy, now);
  const outcome = working ? null : heavyOutcomeText(line);
  const auto = heavyAutoText(line);
  return (
    <div data-heavy-team={line.phase} role="status" className="flex w-fit max-w-full flex-col">
      {auto && <p data-heavy-auto="" className="pb-1 text-[13px] leading-5 text-ink-secondary">{auto}</p>}
      <div className="flex max-w-full items-start gap-3">
        <div className="flex min-w-0 flex-col">
          <button type="button" data-heavy-open="" aria-expanded={open} aria-label={`${header}. ${t("heavy.open")}`} title={t("heavy.open")}
            onClick={() => toggleThoughts(message.id)}
            className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-xl px-1.5 py-1 text-[13px] leading-5 text-ink-secondary outline-none hover:bg-menu-hover hover:text-ink focus-visible:bg-menu-hover focus-visible:ring-2 focus-visible:ring-focus">
            {leader && (running || line.agents.length > 0) && <ExpertsDivision art={art ?? null} bot={leader} line={line} running={running} runId={message.id} settled={settled} failed={failed} />}
            <span data-heavy-header="" className="whitespace-nowrap">{header}</span>
            {outcome && <span data-heavy-outcome="" className="whitespace-nowrap text-ink-tertiary">· {outcome}</span>}
            <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform group-hover:text-ink-secondary", open && "rotate-180")} />
          </button>
          {(line.refusals?.length ?? 0) > 0 && (
            <ul data-heavy-refusals="" className="ml-1.5 flex max-w-[620px] flex-col text-[13px] leading-5 text-ink-secondary">
              {line.refusals!.map((refusal, at) => <li key={at} data-heavy-refusal={refusal.cause}>{refusalText(refusal)}</li>)}
            </ul>
          )}
          {working && line.agents.length > 0 && (
            <ul data-heavy-preview="" aria-label={t("heavy.panel.team")} className="ml-1.5 mt-0.5 flex flex-col gap-1 border-l border-hairline/60 pl-3">
              {line.agents.map((agent) => (
                <li key={agent.n} data-heavy-agent={agent.n} data-heavy-agent-status={agent.status} data-heavy-agent-speaking={agent.speaking ? "" : undefined}
                  className="flex items-baseline gap-2 text-[13px] leading-5">
                  <span className={cn("w-[132px] shrink-0 truncate", agent.status === "failed" ? "text-ink-tertiary" : agent.speaking ? "text-ink" : "text-ink-secondary")}>{expertName(agent)}</span>
                  {/* a failed expert says so first, its last words after it, dimmed */}
                  <span className={cn("min-w-0 max-w-[420px] flex-1 truncate", agent.status === "failed" || (agent.status === "working" && !agent.live && !agent.messages.length) ? "text-ink-tertiary" : "text-ink")}>{agent.status === "failed" ? failedPreview(agent) : agentPreview(agent)}</span>
                </li>
              ))}
              <li data-heavy-leader="" className="flex items-baseline gap-2 text-[13px] leading-5">
                <span className="w-[132px] shrink-0 text-ink-secondary">{t("heavy.leader")}</span>
                <span className="min-w-0 flex-1 truncate text-ink-tertiary">{leaderStepText(leaderNow(line))}</span>
              </li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
