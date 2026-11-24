// A Heavy run in the chat (#4901, #5089, #5090, the reference app's Heavy):
// while the team works, the experts' avatars orbit the bot's (HeavyOrbit:
// the one speaking pulses, lines link them while they critique, they merge
// into the bot on agreement), "Experts thinking · round 2 of 5 · 6s" beside
// it and a live preview of what each one writes, then the leader's step.
// Once they are done, one quiet line, "Thought for 8s", and how it ended
// (agreed in round 2, or the leader decided after 5); it opens the Thoughts
// panel. When Auto chose Heavy on its own it says so in one line above. The
// final answer is the leader's ordinary reply under it. State:
// shared/heavy-team.ts.
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  AGENT_COLORS, agentPreview, expertName, heavyAutoText, heavyHeader, heavyIsRunning, heavyOutcomeText, leaderNow, leaderStepText, orbitMerged, refusalText,
} from "@/lib/heavy-team";
import { toggleThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { MausAvatar } from "./Avatar";
import { HeavyOrbit } from "./HeavyOrbit";

/** The bot's own avatar, at the orbit's centre (ChatViewShell provides it). */
export const HeavyLeaderContext = createContext<ReactNode>(null);

/** The experts' owls, overlapping, each in its own plumage: the row at rest. */
export function AgentAvatars({ count, size = 22 }: { count: number; size?: number }) {
  return (
    <span data-heavy-avatars="" role="img" aria-label={t("heavy.avatars", { count })} className="flex shrink-0 items-center">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cn("flex items-center justify-center rounded-full bg-app ring-2 ring-app", index > 0 && "-ml-1.5")}>
          <MausAvatar color={AGENT_COLORS[index % AGENT_COLORS.length]!} size={size} state="idle" animated={false} trackPointer={false} />
        </span>
      ))}
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
  const leaderAvatar = use(HeavyLeaderContext) ?? <MausAvatar color="white" size={34} state={running ? "thinking" : "idle"} animated={running} trackPointer={false} />;
  const working = (line.phase === "planning" || line.phase === "agents") && busy;
  // the orbit while the team works, and while the leader writes after the experts merged into it
  const orbit = working || (orbitMerged(line) && line.phase === "leader" && busy);
  const header = heavyHeader(line, busy, now);
  const outcome = working ? null : heavyOutcomeText(line);
  const auto = heavyAutoText(line);
  return (
    <div data-heavy-team={line.phase} role="status" className="flex w-fit max-w-full flex-col">
      {auto && <p data-heavy-auto="" className="pb-1 text-[13px] leading-5 text-ink-secondary">{auto}</p>}
      <div className="flex max-w-full items-start gap-3">
        {orbit && <HeavyOrbit line={line} busy={busy} leader={leaderAvatar} />}
        <div className="flex min-w-0 flex-col">
          <button type="button" data-heavy-open="" aria-expanded={open} aria-label={`${header}. ${t("heavy.open")}`} title={t("heavy.open")}
            onClick={() => toggleThoughts(message.id)}
            className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-xl px-1.5 py-1 text-[13px] leading-5 text-ink-secondary outline-none hover:bg-menu-hover hover:text-ink focus-visible:bg-menu-hover focus-visible:ring-2 focus-visible:ring-focus">
            {!orbit && line.agents.length > 0 && <AgentAvatars count={line.agents.length} />}
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
                  <span className={cn("w-[132px] shrink-0 truncate", agent.speaking ? "text-ink" : "text-ink-secondary")}>{expertName(agent)}</span>
                  <span className={cn("min-w-0 max-w-[420px] flex-1 truncate", agent.status === "working" && !agent.live && !agent.messages.length ? "text-ink-tertiary" : "text-ink")}>{agentPreview(agent)}</span>
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
