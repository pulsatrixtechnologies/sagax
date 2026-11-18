import { failedTurnCause } from "../../shared/failed-turn.ts";
import { parseAskChoiceInput } from "../../shared/options-card.ts";
import { clipReadable } from "../../shared/routine-result.ts";
import type { RoutineProblemCardInput } from "./routine-problem-card.ts";
import { isRoutineProblemRun, type RoutineNeedsPerson } from "../../shared/routines.ts";
import { recordsText } from "../records-block.ts";
import { redactSecretsInText } from "../redact.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import type { Message } from "../store.ts";

/** Keep a single episode even if the next failure is different or auto-pauses the routine. */
export function investigationNeed(runs: readonly RoutineRun[]): RoutineNeedsPerson | null {
  const settled = runs.filter(run => run.finishedAt !== undefined).sort((a, b) => b.finishedAt! - a.finishedAt! || b.createdAt - a.createdAt);
  const firstGood = settled.findIndex(run => !isRoutineProblemRun(run));
  const streak = firstGood < 0 ? settled : settled.slice(0, firstGood);
  if (streak.length < 3) return null;
  const last = streak[0]!;
  return { kind: "problem", since: streak.at(-1)!.finishedAt!, runId: last.id, failures: streak.length, text: last.error || last.problems || "" };
}

export function investigationPrompt(routine: Routine, runs: readonly RoutineRun[], locale: string, pauseLabel: string,
  computer: unknown, rows: (run: RoutineRun) => readonly Message[]): string {
  const facts = runs.map(run => {
    const tools = rows(run).flatMap(({ at, tool }) => tool && at >= (run.startedAt ?? run.createdAt) && at <= run.finishedAt!
      ? [{ at, name: tool.name, connector: tool.product, ok: tool.ok, summary: tool.summary, result: tool.output && clipReadable(redactSecretsInText(tool.output), 1000) }] : []);
    return recordsText("failed run", redactSecretsInText(JSON.stringify({
      id: run.id, scheduledFor: run.scheduledFor, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status,
      error: run.error, problems: run.problems, readiness: run.readiness, requirements: run.requires, runOn: run.runOn,
      tools: tools.sort((a, b) => Number(b.ok === false) - Number(a.ok === false)),
    })), 12000);
  });
  return [
    `Investigate this routine yourself with your tools. Find the cause from live evidence, fix what you can in the person's environment, rerun the routine and verify the result. Write in ${locale}.`,
    `If still broken, use ask_choice once. Title it with the problem. Say which routine, the cause and evidence (or what is still unknown), and what you tried. Write two or three concrete choices for this case and include "${pauseLabel}" if the routine is enabled. Other is built in. If fixed, finish with one short line for run history.`,
    recordsText("routine configuration", redactSecretsInText(JSON.stringify({
      routine: { id: routine.id, name: routine.name, prompt: routine.prompt, enabled: routine.enabled, requires: routine.requires, precheck: routine.precheck, runOn: routine.runOn, computer },
    })), 10000),
    ...facts,
  ].join("\n\n");
}

/** Scope the native card tool to the investigation that actually called it. */
export class InvestigationTurns {
  private active = new Map<string, { run: RoutineRun; verification?: string; resume?: () => void; publish: (input: Record<string, unknown>) => { ok: boolean; error?: string; messageId?: string } }>();

  start(threadId: string, run: RoutineRun, prompt: string, deps: {
    ask(card: Pick<RoutineProblemCardInput, "title" | "question" | "options" | "details">): string | undefined;
    unavailable(reason: string): void;
    readRun(id: string): RoutineRun | undefined;
    messages(): readonly Message[];
    stillBroken(): boolean;
    incomplete(): void;
    recovered(check: RoutineRun): void;
    dispatch(prompt: string, settled: () => void, failed: (reason: string) => void): Promise<unknown>;
  }): void {
    let asked = false;
    let continuedFor: string | undefined;
    const check = () => {
      const id = this.active.get(threadId)?.verification;
      return id ? deps.readRun(id) : undefined;
    };
    const recovered = (receipt: RoutineRun | undefined) => receipt && !receipt.problems
      && (receipt.status === "completed" || receipt.status === "nothing_to_report");
    this.active.set(threadId, { run: { ...run, threadId }, publish: input => {
      const parsed = parseAskChoiceInput(input);
      if (!parsed.ok) return parsed;
      if (!("value" in parsed) || !parsed.value.options.length) return { ok: false, error: "Use one question with concrete choices." };
      const verification = check();
      if (verification && (verification.finishedAt === undefined || recovered(verification))) {
        return { ok: false, error: "End this turn. The verification run will report its result." };
      }
      const { title, subtitle, options, details } = parsed.value;
      const messageId = deps.ask({ title, question: subtitle, options, details: details ?? [] });
      if (!messageId) return { ok: false, error: "This question is already posted or its failure streak has ended." };
      asked = true;
      return { ok: true, messageId };
    } });
    const fail = (reason: string) => {
      if (!this.active.delete(threadId) || asked) return;
      deps.unavailable(clipReadable(redactSecretsInText(reason), 400));
    };
    const dispatch = (text: string) => {
      void deps.dispatch(text, settled, fail).catch(error => fail(String(error)));
    };
    const settled = () => {
      const turn = this.active.get(threadId);
      if (!turn) return;
      if (asked) { this.active.delete(threadId); return; }
      const receipt = check();
      if (receipt && receipt.finishedAt === undefined) { turn.resume = settled; return; }
      if (receipt && recovered(receipt)) {
        this.active.delete(threadId);
        deps.recovered(receipt);
        return;
      }
      if (!deps.stillBroken()) { this.active.delete(threadId); return; }
      const last = deps.messages().findLast(row => row.role === "bot" && (row.tool && failedTurnCause(row.tool.name) || row.text && (!row.kind || row.kind === "text")));
      if (last?.tool || !last && !receipt) { fail(last?.tool ? failedTurnCause(last.tool.name) ?? "" : ""); return; }
      const result = receipt ? recordsText("verification run", redactSecretsInText(JSON.stringify({
        id: receipt.id, status: receipt.status, error: receipt.error, problems: receipt.problems, readiness: receipt.readiness,
      }))) : "";
      const attempt = receipt?.id ?? run.id;
      if (continuedFor === attempt) {
        this.active.delete(threadId);
        deps.incomplete();
        return;
      }
      continuedFor = attempt;
      setImmediate(() => dispatch("Continue the investigation. There is no verified recovery. Use ask_choice with the evidence and concrete next steps if still broken. " + result));
    };
    dispatch(prompt);
  }

  context(threadId: string) { return this.active.get(threadId)?.run; }

  question(botId: string, threadId: string, input: Record<string, unknown>) {
    const turn = this.active.get(threadId);
    if (turn?.run.botId === botId) return turn.publish(input);
    return undefined;
  }

  verifying(threadId: string, run: RoutineRun) {
    const turn = this.active.get(threadId);
    if (turn && turn.run.routineId === run.routineId) turn.verification = run.id;
  }

  changed(run: RoutineRun) {
    if (run.finishedAt === undefined) return;
    for (const turn of this.active.values()) {
      if (turn.verification !== run.id || !turn.resume) continue;
      const resume = turn.resume;
      delete turn.resume;
      queueMicrotask(resume);
    }
  }

}
