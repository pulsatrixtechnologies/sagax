// The steps of a task as the sheet lists them (2026-10-29, task sheet
// redesign; V10 2026-11: fold tool searches via mergeSteps like ActivityRun):
// the same step repeated back to back reads once with a count, finished
// tool searches fold so the calls between them merge too, a step still
// running or a sub-agent's step never merges, a failure never hides inside
// a run of successes, and the place a step ran is marked once, then only
// when it changes. Pure: the sheet, the routine run detail and any other
// list of tool calls draw from these groups.
import type { Message } from "@/state/store";
import type { BotActivityStep } from "../../shared/bot-activity";
import { isSubagentStep, stepTree } from "./activity-steps";
import { mergeSteps } from "./step-group";
import { readStep } from "./step-label";
import { workingStepFor, type WorkingStep } from "../../shared/working-step";

export type ActivityStepPhase = "running" | "done" | "failed";

export interface ActivityStepGroup {
  /** The first step's id. */
  id: string;
  /** The step's name in words (readStep), the same for every step inside. */
  label: string;
  steps: BotActivityStep[];
  count: number;
  phase: ActivityStepPhase;
  /** The one summary when every step inside shares it (or there is one). */
  summary?: string;
  /** Full target for tooltip when the quiet summary is a shortened command. */
  title?: string;
  where?: BotActivityStep["where"];
  /** Draw the place: the first group with one, or a place other than the
   * previous group's. */
  whereChanged: boolean;
  subagent: boolean;
  /** A sub-agent's own calls, grouped the same way. */
  substeps?: ActivityStepGroup[];
}

export function activityStepPhase(step: Pick<BotActivityStep, "ok">): ActivityStepPhase {
  return step.ok === undefined ? "running" : step.ok ? "done" : "failed";
}

function asMessage(step: BotActivityStep): Message {
  return {
    id: step.id,
    role: "bot",
    kind: "activity",
    at: step.at,
    text: "",
    tool: {
      name: step.name,
      ok: step.ok,
      input: step.input,
      summary: step.summary,
    },
  } as Message;
}

function groupsWithMerge(
  steps: readonly BotActivityStep[],
  children: Map<string, BotActivityStep[]>,
  previousWhere: BotActivityStep["where"] | undefined,
): ActivityStepGroup[] {
  const groups: ActivityStepGroup[] = [];
  let lastWhere = previousWhere;
  let buffer: BotActivityStep[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const byId = new Map(buffer.map((step) => [step.id, step]));
    for (const entry of mergeSteps(buffer.map(asMessage))) {
      if (entry.kind !== "steps") continue;
      const originals = entry.messages
        .map((message) => byId.get(message.id))
        .filter((step): step is BotActivityStep => Boolean(step));
      if (!originals.length) continue;
      const first = originals[0]!;
      const reading = readStep({ name: first.name, ok: first.ok, input: first.input, summary: first.summary });
      const whereChanged = first.where !== undefined && first.where !== lastWhere;
      if (first.where !== undefined) lastWhere = first.where;
      const sharedSummary = entry.target
        ?? (originals.every((step) => step.summary === first.summary) ? first.summary : undefined);
      // Prefer the first step's place; when mergeSteps folds across places the
      // mark still shows once at the start of the group.
      groups.push({
        id: entry.id,
        label: entry.label,
        steps: originals,
        count: originals.length,
        phase: entry.phase,
        ...(sharedSummary ? { summary: sharedSummary } : {}),
        ...(reading.title && originals.length === 1 ? { title: reading.title } : {}),
        ...(first.where ? { where: first.where } : {}),
        whereChanged,
        subagent: false,
      });
    }
    buffer = [];
  };

  for (const step of steps) {
    if (isSubagentStep(step)) {
      flush();
      const phase = activityStepPhase(step);
      const reading = readStep({ name: step.name, ok: step.ok, input: step.input, summary: step.summary });
      const whereChanged = step.where !== undefined && step.where !== lastWhere;
      if (step.where !== undefined) lastWhere = step.where;
      const own = children.get(step.id);
      groups.push({
        id: step.id,
        label: reading.label,
        steps: [step],
        count: 1,
        phase,
        ...(reading.target ? { summary: reading.target } : step.summary ? { summary: step.summary } : {}),
        ...(reading.title ? { title: reading.title } : {}),
        ...(step.where ? { where: step.where } : {}),
        whereChanged,
        subagent: true,
        ...(own?.length ? { substeps: groupsWithMerge(own, children, undefined) } : {}),
      });
      continue;
    }
    buffer.push(step);
  }
  flush();
  return groups;
}

/** The top-level steps grouped, each sub-agent's calls grouped under it.
 * Finished tool searches fold through mergeSteps the same way as ActivityRun. */
export function groupActivitySteps(steps: readonly BotActivityStep[]): ActivityStepGroup[] {
  const { top, children } = stepTree(steps);
  return groupsWithMerge(top, children, undefined);
}

/** How many steps failed, over the groups and their sub-agents' steps. */
export function countFailedSteps(groups: readonly ActivityStepGroup[]): number {
  let failed = 0;
  for (const group of groups) {
    if (group.phase === "failed") failed += group.count;
    if (group.substeps) failed += countFailedSteps(group.substeps);
  }
  return failed;
}

/** The step a running task is on now: the newest call still in flight,
 * named the way the working line names it (shared/working-step.ts), or by
 * its plain name when the table only knows it as "a tool". Null once no
 * call runs. */
export function currentTaskStep(steps: readonly BotActivityStep[]): { step: WorkingStep | null; label: string; since: number } | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]!;
    if (step.ok !== undefined) continue;
    const named = workingStepFor({ name: step.name, ...(step.summary ? { summary: step.summary } : {}), ...(step.input ? { input: step.input } : {}) });
    const reading = readStep({ name: step.name, ok: step.ok, input: step.input, summary: step.summary });
    return { step: named && named.key !== "tool" ? named : null, label: reading.label, since: step.at };
  }
  return null;
}
