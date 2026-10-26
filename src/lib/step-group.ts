// One stretch of a bot's work as a single row: "Worked 2m 53s", nothing
// more (the count of tools and failures is read by VoiceOver and seen by
// opening the row). Opened, the steps in order, each on a row of the same kind,
// with the same step repeated back to back read once with a count ("Read a
// file ×3"). While the bot still works, the row says what it is doing now.
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { isToolStep } from "@/lib/activity-runs";
import { readStep, stepDuration, stepPhase, type StepNameOf, type StepPhase } from "@/lib/step-label";

type ToolStep = Message & { tool: NonNullable<Message["tool"]> };

export type StepEntry =
  /** one tool step, or the same step repeated back to back */
  | { kind: "steps"; id: string; messages: ToolStep[]; label: string; target?: string; phase: StepPhase; durationMs?: number }
  /** anything else in the group (a settled turn's narration), as it is */
  | { kind: "message"; id: string; message: Message };

/** The steps in order, consecutive identical steps (same words, same
 * state) merged. A step still running is never merged into the ones before. */
export function mergeSteps(messages: readonly Message[], nameOf?: StepNameOf): StepEntry[] {
  const entries: StepEntry[] = [];
  // Finished tool searches (Grok's search_tool, Claude's ToolSearch) are
  // housekeeping: within one stretch of steps (no narration between) they
  // fold into the first one, which keeps its place and lists them in the
  // order they ran, so the calls they sat between merge too ("Viewed
  // tickets ×3", not six alternating rows).
  let searches: Extract<StepEntry, { kind: "steps" }> | undefined;
  for (const message of messages) {
    if (!isToolStep(message)) {
      entries.push({ kind: "message", id: message.id, message });
      // a narration splits the stretch: a later search stays after it, in
      // the order it ran
      searches = undefined;
      continue;
    }
    const reading = readStep(message.tool, nameOf);
    const phase = stepPhase(message.tool);
    const search = phase === "done" && isToolSearch(message.tool.name);
    if (search && searches) {
      searches.messages.push(message);
      if (searches.target !== reading.target) searches.target = undefined;
      searches.durationMs = searches.durationMs !== undefined && message.tool.durationMs !== undefined ? searches.durationMs + message.tool.durationMs : undefined;
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === "steps" && last.label === reading.label && last.phase === phase && phase !== "running") {
      last.messages.push(message);
      if (last.target !== reading.target) last.target = undefined;
      last.durationMs = last.durationMs !== undefined && message.tool.durationMs !== undefined ? last.durationMs + message.tool.durationMs : undefined;
      continue;
    }
    const entry: Extract<StepEntry, { kind: "steps" }> = {
      kind: "steps",
      id: message.id,
      messages: [message],
      label: reading.label,
      target: reading.target,
      phase,
      durationMs: message.tool.durationMs,
    };
    if (search) searches = entry;
    entries.push(entry);
  }
  return entries;
}

/** A tool search, by the engine's name for it. */
export function isToolSearch(name: string): boolean {
  const flat = name.trim().toLowerCase().replace(/\s+/g, "_");
  return flat === "search_tool" || flat === "toolsearch" || flat === "tool_search";
}

export type StepGroupSummary = {
  /** tool steps in the group */
  tools: number;
  /** of which failed */
  failed: number;
  /** the step running now, when the bot still works */
  running?: ToolStep;
};

export function summarizeSteps(messages: readonly Message[]): StepGroupSummary {
  let tools = 0;
  let failed = 0;
  let running: ToolStep | undefined;
  for (const message of messages) {
    if (!isToolStep(message)) continue;
    tools += 1;
    if (message.tool.ok === false) failed += 1;
    if (message.tool.ok === undefined) running = message;
  }
  return { tools, failed, running };
}

export type StepGroupWords = {
  /** "Worked 2m 53s", or the step running now */
  label: string;
  /** what the running step acts on */
  target?: string;
  /** "12 tools": not drawn on the row, only spoken */
  tools?: string;
  /** "5 failed": not drawn on the row, only spoken */
  failed?: string;
  /** the whole count for VoiceOver: "Worked 2m 53s, 12 tools, 5 failed,
   * press to see the detail" */
  ariaLabel: string;
  phase: StepPhase;
};

/** The group's one line, in the person's language. */
export function stepGroupWords(summary: StepGroupSummary, elapsedMs: number | undefined, nameOf?: StepNameOf): StepGroupWords {
  const tools = summary.tools > 0 ? t(summary.tools === 1 ? "step.turn.tools.one" : "step.turn.tools.many", { count: summary.tools }) : undefined;
  const failed = summary.failed > 0 ? t(summary.failed === 1 ? "step.turn.failed.one" : "step.turn.failed.many", { count: summary.failed }) : undefined;
  const spoken = (...parts: Array<string | undefined>) => t("step.turn.a11y", { summary: parts.filter(Boolean).join(", ") });
  if (summary.running) {
    const reading = readStep(summary.running.tool, nameOf);
    return { label: reading.label, target: reading.target, tools, failed, ariaLabel: spoken(reading.label, reading.target, tools, failed), phase: "running" };
  }
  const elapsed = elapsedMs !== undefined && elapsedMs >= 1_000 ? stepDuration(elapsedMs) : undefined;
  const label = elapsed ? t("step.turn.workedFor", { elapsed }) : t("step.turn.worked");
  return { label, tools, failed, ariaLabel: spoken(label, tools, failed), phase: "done" };
}
