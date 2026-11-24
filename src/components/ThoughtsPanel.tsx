// The Thoughts panel of a Heavy run (#4901, #5089, #5090): the right-hand
// detail panel (DetailPanel, the one every page's detail uses) with what the
// team wrote. The leader's steps first, how it ended (agreed, or decided with
// the points still in dispute), then each expert with its persona and seat,
// collapsible: a one-line preview closed, every round's message open. The
// final answer stays in the chat.
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AGENT_COLORS, agentPreview, agentStatusText, expertName, heavyLineOf, heavyOutcomeText, leaderStepText, refusalSaysText, refusalText } from "@/lib/heavy-team";
import { closeThoughts, useOpenThoughts } from "@/lib/thoughts-panel";
import { formatElapsed } from "@/lib/working-time";
import type { Message } from "@/state/store";
import type { HeavyAgentLine, HeavyTeamLine } from "../../shared/heavy-team";
import { MausAvatar } from "./Avatar";
import { DetailPanel } from "./DetailPanel";

function AgentSection({ agent, index, running }: { agent: HeavyAgentLine; index: number; running: boolean }) {
  // an agent still writing is open; a finished one folds to its preview, the person opens it
  const [open, setOpen] = useState(agent.status === "working");
  const live = agent.status === "working" && running;
  const bodyId = `thoughts-agent-${agent.n}`;
  return (
    <section data-thoughts-agent={agent.n} data-thoughts-agent-status={agent.status} className="border-b border-hairline/40 last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={bodyId} aria-label={t("heavy.agent.toggle", { agent: expertName(agent) })}
        onClick={() => setOpen((on) => !on)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left outline-none hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:ring-2 focus-visible:ring-focus">
        <span className="flex shrink-0 items-center justify-center rounded-full bg-app ring-2 ring-app">
          <MausAvatar color={AGENT_COLORS[index % AGENT_COLORS.length]!} size={24} state={live ? "thinking" : "idle"} animated={live} trackPointer={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-1.5 text-[14px] leading-5 text-ink">
            <span className="shrink-0">{expertName(agent)}</span>
            <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">{agent.modelLabel}{agent.engineLabel && agent.engineLabel !== agent.modelLabel ? ` · ${agent.engineLabel}` : ""}</span>
          </span>
          {!open && <span data-thoughts-preview="" className="truncate text-[13px] leading-5 text-ink-secondary">{agentPreview(agent)}</span>}
        </span>
        <span data-thoughts-status="" className={cn("shrink-0 text-[12px]", agent.status === "failed" ? "text-danger" : "text-ink-tertiary")}>{agentStatusText(agent)}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={bodyId} data-thoughts-messages="" className="flex flex-col gap-3 px-4 pb-3 pl-[54px]">
          {agent.messages.map((text, at) => (
            <div key={at} data-thoughts-round={at + 1} className="flex flex-col gap-0.5">
              <span className="text-[12px] leading-4 text-ink-tertiary">{t("heavy.roundLabel", { round: at + 1 })}</span>
              <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">{text}</p>
            </div>
          ))}
          {agent.live && <p data-thoughts-live="" className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">{agent.live}</p>}
          {agent.error && <p className="text-[13px] leading-5 text-danger">{agent.error}</p>}
          {!agent.messages.length && !agent.live && !agent.error && <p className="text-[13px] leading-5 text-ink-tertiary">{agentPreview(agent)}</p>}
        </div>
      )}
    </section>
  );
}

export function ThoughtsPanel({ line, running, onClose }: { line: HeavyTeamLine; running: boolean; onClose: () => void }) {
  return (
    <DetailPanel label={t("heavy.panel.title")} title={t("heavy.panel.title")} onClose={onClose} data-thoughts-panel="" bodyClassName="py-1">
      <section data-thoughts-leader="" className="border-b border-hairline/40 px-4 py-3">
        <div className="flex items-baseline gap-1.5 text-[14px] leading-5 text-ink">
          <span>{t("heavy.leader")}</span>
          <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">{line.leader.modelLabel}</span>
        </div>
        <ol className="mt-1.5 flex flex-col gap-1">
          {line.leader.steps.map((step, at) => (
            <li key={at} data-thoughts-step={step.kind} className="flex items-baseline gap-2 text-[13px] leading-5">
              <span className="w-9 shrink-0 text-ink-tertiary tabular-nums">{formatElapsed(step.at - line.startedAt)}</span>
              <span className={cn(at === line.leader.steps.length - 1 && running ? "text-ink" : "text-ink-secondary")}>{leaderStepText(step)}</span>
            </li>
          ))}
        </ol>
        {heavyOutcomeText(line) && <p data-thoughts-outcome="" className="mt-2 text-[13px] leading-5 text-ink">{heavyOutcomeText(line)}</p>}
        {line.outcome === "decided" && (line.disagreements?.length ?? 0) > 0 && (
          <div data-thoughts-disputes="" className="mt-1.5">
            <p className="text-[12px] leading-4 text-ink-secondary">{t("heavy.disputes")}</p>
            <ul className="mt-1 list-disc pl-5 text-[13px] leading-5 text-ink">
              {line.disagreements!.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </div>
        )}
        {(line.refusals?.length ?? 0) > 0 && (
          <div data-thoughts-refusals="" className="mt-2">
            <p className="text-[12px] leading-4 text-ink-secondary">{t("heavy.refusals")}</p>
            <ul className="mt-1 flex flex-col gap-1.5 text-[13px] leading-5">
              {line.refusals!.map((refusal, at) => (
                <li key={at} data-thoughts-refusal={refusal.cause}>
                  <span className="text-ink">{refusalText(refusal)}</span>
                  {refusalSaysText(refusal) && <span className="block text-ink-secondary">{refusalSaysText(refusal)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {line.agents.map((agent, index) => <AgentSection key={agent.n} agent={agent} index={index} running={running} />)}
    </DetailPanel>
  );
}

/** Draws the panel of the run whose row opened it, in the right-hand slot; gone with its message. */
export function ThoughtsPanelHost({ messages, busy }: { messages: readonly Message[]; busy: boolean }) {
  const id = useOpenThoughts();
  const message = id ? messages.find((candidate) => candidate.id === id) : undefined;
  const line = message ? heavyLineOf(message) : null;
  useEffect(() => {
    if (id && !line) closeThoughts();
  }, [id, line]);
  if (!id || !line) return null;
  return <ThoughtsPanel line={line} running={busy && (line.phase === "planning" || line.phase === "agents" || line.phase === "leader")} onClose={closeThoughts} />;
}
