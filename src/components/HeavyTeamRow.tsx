// A Heavy run in the chat (#4901, #5089, the reference app's Heavy): the
// row's small avatars are the run itself. While the team works, the bot's
// own mascot divides in place into one cell per expert (HeavyDivision, owner
// 2026-11-26, M-20261126-122), "Experts critiquing · round 2 of 5 · 6s"
// against it and a live preview of what each one writes, then the leader's
// step; an expert that failed stays dimmed in the pile and in the preview.
// Once they are done, the same pile and one quiet line, "Thought for 8s",
// and how it ended (agreed in round 2, or the leader decided after 5); it
// opens the Thoughts panel. A bot whose mascot is a character, not a shape,
// keeps the pile of owls (the one speaking at work, as the orbit drew it)
// and divides into nothing; while its leader picks the team the row shows
// the bot itself. When Auto chose Heavy on its own it says so in one line
// above. The final answer is the leader's ordinary reply under it. State:
// shared/heavy-team.ts.
import { createContext, use, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  AGENT_COLORS, agentPreview, expertName, failedPreview, heavyAutoText, heavyHeader, heavyIsRunning, heavyOutcomeText, leaderNow, leaderStepText, refusalText,
} from "@/lib/heavy-team";
import { toggleThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import type { Message } from "@/state/store";
import type { HeavyAgentLine, HeavyTeamLine } from "../../shared/heavy-team";
import { BotAvatar, MausAvatar, type BotAvatarProps } from "./Avatar";
import { HeavyDivision, useDivisionArt } from "./HeavyDivision";

/** The bot of the conversation, the team's leader: its mascot is what divides (ChatViewShell provides it). */
export const HeavyLeaderContext = createContext<BotAvatarProps["bot"] | null>(null);

/** An expert that failed mid-run is dimmed, as the orbit dimmed it. */
const FAILED_OPACITY = 0.45;

/**
 * The experts' owls, overlapping, each in its own plumage: the pile of a bot
 * whose mascot is no shape. While the run goes they are alive, the one
 * speaking at work (as the orbit drew them); one that failed is dimmed.
 */
export function AgentAvatars({ agents, running = false, size = 22 }: { agents: readonly Pick<HeavyAgentLine, "n" | "status" | "speaking">[]; running?: boolean; size?: number }) {
  return (
    <span data-heavy-avatars="" role="img" aria-label={t("heavy.avatars", { count: agents.length })} className="flex shrink-0 items-center">
      {agents.map((agent, index) => {
        const speaking = running && agent.speaking === true;
        return (
          <span key={agent.n} data-heavy-owl={agent.n} data-heavy-failed={agent.status === "failed" ? "" : undefined}
            className={cn("flex items-center justify-center rounded-full bg-app ring-2 ring-app", index > 0 && "-ml-1.5")}>
            <span className="flex" style={agent.status === "failed" ? { opacity: FAILED_OPACITY } : undefined}>
              <MausAvatar color={AGENT_COLORS[index % AGENT_COLORS.length]!} size={size} state={speaking ? "thinking" : "idle"} animated={running} trackPointer={false} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The bot alone while its leader picks the team, at the pile's size: a bot whose mascot is no shape (a shape's is the division's first cell). */
function LeaderAvatar({ bot, size = 22 }: { bot: BotAvatarProps["bot"] | null; size?: number }) {
  return (
    <span data-heavy-leader-avatar="" aria-hidden="true" className="flex shrink-0 items-center">
      {bot ? <BotAvatar bot={bot} size={size} trackPointer={false} /> : <MausAvatar color="white" size={size} state="thinking" animated trackPointer={false} />}
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
  // the bot's mascot when it is a shape: it divides into the experts; undefined for a character, which keeps the owls
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
            {art
              ? (running || line.agents.length > 0) && <HeavyDivision art={art} count={line.agents.length} running={running} runId={message.id} settled={settled} failed={failed} />
              : art === undefined && (line.agents.length > 0 ? <AgentAvatars agents={line.agents} running={running} /> : running && <LeaderAvatar bot={leader} />)}
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
