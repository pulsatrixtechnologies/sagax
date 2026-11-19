// A Heavy run in the chat (#4901, the reference app's Heavy): while the agents
// work, "Agents thinking · 6s" with the agents' owls stacked beside it and a
// live preview of what each one writes ("Agent 1", "Agent 2", then the
// Leader's step: "Sent to All", "Processing…"); once they are done, one quiet
// line, "Thought for 8s", which opens the Thoughts panel. The final answer is
// the Leader's ordinary reply under it. State: shared/heavy-team.ts.
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AGENT_COLORS, agentPreview, heavyHeader, heavyIsRunning, leaderNow, leaderStepText } from "@/lib/heavy-team";
import { toggleThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { MausAvatar } from "./Avatar";

/** The agents' owls, overlapping, each in its own plumage; they think while the agents work. */
export function AgentAvatars({ count, thinking, size = 22 }: { count: number; thinking: boolean; size?: number }) {
  return (
    <span data-heavy-avatars="" role="img" aria-label={t("heavy.avatars", { count })} className="flex shrink-0 items-center">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cn("flex items-center justify-center rounded-full bg-app ring-2 ring-app", index > 0 && "-ml-1.5")}>
          <MausAvatar color={AGENT_COLORS[index % AGENT_COLORS.length]!} size={size} state={thinking ? "thinking" : "idle"} animated={thinking} trackPointer={false} />
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
  const thinking = line.phase === "agents" && busy;
  const header = heavyHeader(line, busy, now);
  return (
    <div data-heavy-team={line.phase} role="status" className="flex w-fit max-w-full flex-col">
      <button type="button" data-heavy-open="" aria-expanded={open} aria-label={`${header}. ${t("heavy.open")}`} title={t("heavy.open")}
        onClick={() => toggleThoughts(message.id)}
        className="group -ml-1.5 flex max-w-full items-center gap-2 rounded-xl px-1.5 py-1 text-[13px] leading-5 text-ink-secondary outline-none hover:bg-menu-hover hover:text-ink focus-visible:bg-menu-hover focus-visible:ring-2 focus-visible:ring-focus">
        <AgentAvatars count={line.agents.length} thinking={thinking} />
        <span data-heavy-header="" className="whitespace-nowrap">{header}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform group-hover:text-ink-secondary", open && "rotate-180")} />
      </button>
      {thinking && (
        <ul data-heavy-preview="" aria-label={t("heavy.panel.team")} className="ml-3 mt-1 flex flex-col gap-1 border-l border-hairline/60 pl-3">
          {line.agents.map((agent) => (
            <li key={agent.n} data-heavy-agent={agent.n} data-heavy-agent-status={agent.status} className="flex items-baseline gap-2 text-[13px] leading-5">
              <span className="w-[62px] shrink-0 text-ink-secondary">{t("heavy.agent", { n: agent.n })}</span>
              <span className={cn("min-w-0 max-w-[460px] flex-1 truncate", agent.status === "working" && !agent.live && !agent.messages.length ? "text-ink-tertiary" : "text-ink")}>{agentPreview(agent)}</span>
            </li>
          ))}
          <li data-heavy-leader="" className="flex items-baseline gap-2 text-[13px] leading-5">
            <span className="w-[62px] shrink-0 text-ink-secondary">{t("heavy.leader")}</span>
            <span className="min-w-0 flex-1 truncate text-ink-tertiary">{leaderStepText(leaderNow(line))}</span>
          </li>
        </ul>
      )}
    </div>
  );
}
