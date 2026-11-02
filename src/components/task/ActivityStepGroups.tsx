// The steps of a task as a readable list (2026-10-29): one row per group
// (src/lib/activity-step-groups.ts), drawn with the chat's own step row
// (StepRow): quiet words, a shimmer while it runs, a danger tone only when
// it failed, a count when the same step repeated ("×12"), the place it
// ran only when that changes, and one disclosure per group with every
// call inside. A sub-agent's step opens on what it was asked, its own
// grouped calls and what it reported.
//
// V10: groups come from mergeSteps (via groupActivitySteps), the same fold
// ActivityRun uses for repeated tool searches.
import { Bot, Laptop, Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activeLocale } from "@/lib/i18n";
import { activityWhereLabel, type BotActivityStep } from "@/lib/bot-activity";
import { groupActivitySteps, type ActivityStepGroup } from "@/lib/activity-step-groups";
import { StepRow } from "../StepRow";

function WhereMark({ where }: { where: NonNullable<BotActivityStep["where"]> }) {
  return (
    <span data-activity-where={where} className="flex shrink-0 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-[11px] leading-4 text-ink-secondary">
      {where === "computer" ? <Laptop size={11} aria-hidden="true" /> : <Server size={11} aria-hidden="true" />}
      {activityWhereLabel(where)}
    </span>
  );
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Every call of the group: when, its summary, its arguments; the tool's
 * id once at the top. */
function GroupDetail({ group }: { group: ActivityStepGroup }) {
  return (
    <div data-activity-technical={group.id} className="flex flex-col gap-1.5 text-[12px]">
      <div className="break-all font-mono text-[11.5px] text-ink-tertiary">{group.steps[0]!.name}</div>
      <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
        {group.steps.map((step) => (
          <li key={step.id} data-activity-step-id={step.id} className="flex min-w-0 flex-col gap-0.5 rounded-md bg-inset px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 tabular-nums text-ink-tertiary">{timeOf(step.at)}</span>
              {step.ok === false && <span className="shrink-0 text-danger">{t("step.turn.failed.one")}</span>}
              {step.summary && <span className="min-w-0 truncate text-ink" title={group.title ?? step.summary}>{step.summary}</span>}
            </div>
            {step.input && <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-secondary">{step.input}</pre>}
            {step.files && step.files.length > 0 && <div className="truncate font-mono text-[11px] text-ink-secondary">{step.files.join(", ")}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SubagentDetail({ group }: { group: ActivityStepGroup }) {
  const step = group.steps[0]!;
  return (
    <div data-activity-subagent-body={group.id} className="flex flex-col gap-2 text-[12px]">
      {step.subagent?.prompt && (
        <div>
          <h4 className="text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.prompt")}</h4>
          <p className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words text-ink">{step.subagent.prompt}</p>
        </div>
      )}
      {group.substeps && group.substeps.length > 0 && (
        <div>
          <h4 className="text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.steps")}</h4>
          <GroupList groups={group.substeps} nested />
        </div>
      )}
      <div>
        <h4 className="text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.result")}</h4>
        {step.subagent?.result
          ? <p data-activity-subagent-result className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-ink">{step.subagent.result}</p>
          : <p className="mt-0.5 text-ink-secondary">{step.ok === undefined ? t("activity.subagent.running") : "-"}</p>}
        {step.ok === undefined && <p className="mt-1 text-[11px] leading-snug text-ink-tertiary">{t("activity.subagent.engineNote")}</p>}
      </div>
      <GroupDetail group={group} />
    </div>
  );
}

function GroupList({ groups, nested = false }: { groups: readonly ActivityStepGroup[]; nested?: boolean }) {
  return (
    <ol data-activity-steps={nested ? "nested" : ""} className={cn("flex flex-col", nested ? "mt-1 gap-0" : "gap-0.5")}>
      {groups.map((group) => {
        const step = group.steps[0]!;
        const countMark = group.count > 1 ? <span data-activity-step-count={group.count} className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 text-[11px] leading-4 tabular-nums text-ink-secondary">×{group.count}</span> : null;
        return (
          <li key={group.id} data-activity-step={step.name} data-activity-step-group={group.id} data-activity-step-phase={group.phase}>
            <StepRow
              label={group.label}
              target={group.count === 1 ? group.summary : undefined}
              title={group.title}
              phase={group.phase}
              icon={group.subagent ? <Bot size={13} aria-hidden="true" className="text-accent-text" /> : undefined}
              extra={(countMark || (group.whereChanged && group.where)) ? (
                <>
                  {countMark}
                  {group.whereChanged && group.where && <WhereMark where={group.where} />}
                </>
              ) : undefined}
              data={group.subagent ? { "data-activity-subagent": group.id } : undefined}
              ariaLabel={group.count > 1 ? `${group.label} ×${group.count}` : undefined}
              wide
            >
              {() => (group.subagent ? <SubagentDetail group={group} /> : <GroupDetail group={group} />)}
            </StepRow>
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityStepGroups({ steps, truncated = false }: { steps: readonly BotActivityStep[]; truncated?: boolean }) {
  // groupActivitySteps calls mergeSteps the same way ActivityRun does, so
  // finished tool searches fold and the calls between them merge.
  const groups = groupActivitySteps(steps);
  return (
    <div className="flex flex-col gap-1">
      {truncated && <p className="pb-1 text-[11.5px] text-ink-tertiary">{t("botPanel.activity.stepsOlder")}</p>}
      <GroupList groups={groups} />
    </div>
  );
}
