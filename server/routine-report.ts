/** Routine runs work in the background (2026-10-22): "simply let it run
 * in the background, just letting know by 'Handling it' is sufficient. If the
 * routine explicitly says to stay silent you don't tell me anything in the
 * chat. I can view the logs and status in the automation page anyway."
 *
 * A run executes in its own hidden task; nothing reaches the person's
 * conversation while it is queued or running. When it ends, one concise
 * message (the bot's report, never the routine's instructions) is posted
 * only when there is something for the person: a result, a question or
 * approval waiting on them, or an error. A run that ends with nothing to
 * report posts nothing, rings nothing and marks nothing unread; its full
 * record stays in Automations > Logs.
 *
 * The bot says "nothing to report" explicitly by ending its final message
 * with ROUTINE_QUIET_MARKER (the contract is in ROUTINE_EXECUTION_PROMPT).
 * A short final message that only says nothing happened ("nothing to
 * report", "rien à signaler") counts too, so a bot that forgets the marker
 * does not ring the person for nothing. */

import type { RoutineGoalStatus, RoutineRunStatus } from "../shared/routines.ts";

export const ROUTINE_QUIET_MARKER = "NOTHING_TO_REPORT";
/** 2026-11-01: the bot's own word that the run failed or did only part of
 * its work ("RUN_STATUS: partial: the CRM refused the login"). */
export const ROUTINE_STATUS_MARKER = "RUN_STATUS:";

/** What the bot reads in its system prompt on every routine run. */
export const ROUTINE_REPORT_CONTRACT =
  ` This run works in the background: the person does not see this conversation, only your final message, and only when it needs them. Do the routine's work, then end with a short report of what you found or did that the person should know. Never restate or quote the routine's instructions. If nothing needs the person (nothing found, nothing changed, nothing to decide, or the instructions say to stay silent in this case), end your final message with the line ${ROUTINE_QUIET_MARKER} on its own: nothing is posted to their chat and the run stays in the routine logs. If a step failed or part of the work could not be done, never report it as done: begin your final message with the line ${ROUTINE_STATUS_MARKER} failed: <why> when the work could not be done, or ${ROUTINE_STATUS_MARKER} partial: <what did not work> when only part of it was.`;

/** The marker on a line of its own, in the shapes models write it in. */
const MARKER_LINE = /^[\s`*_[(<"']*nothing[\s_-]to[\s_-]report[\s`*_\])>"'.!]*$/i;

/** The no-op phrases: a message that says only that nothing happened. */
const NO_OP_PHRASES = [
  "nothing (?:new |else |more )?to (?:report|do|flag|signal)",
  "no (?:action|follow[- ]up|change)s? (?:is |are )?(?:needed|required)",
  "nothing (?:found|changed|happened|new)",
  "rien (?:de nouveau |d'autre |de plus )?à (?:signaler|faire|rapporter)",
  "rien de (?:nouveau|neuf)",
  "aucune? (?:action|suivi|changement)s? (?:n'est )?(?:requis|requise|nécessaire)",
].join("|");

/** The WHOLE message is one of those phrases (review 2026-10-22): a real
 * finding that merely contains a no-op phrase ("DB01 is down. Nothing to flag
 * on the others.") must still reach the person, so this matches the full
 * string, a short benign lead-in and trailing punctuation aside — never a
 * no-op clause tacked onto a report. */
const NO_OP_FULL = new RegExp(
  `^(?:(?:ok(?:ay)?|done|all (?:good|clear|set|quiet))[\\s,.;:—-]+)?(?:${NO_OP_PHRASES})[\\s.!…]*$`,
  "i",
);

export interface RoutineReportOutcome {
  /** Nothing for the person: post nothing. */
  quiet: boolean;
  /** The bot's final message without the marker, for the logs and the post. */
  report: string;
  /** The bot said the run failed or did only part of its work, and why. */
  declared?: { status: "failed" | "partial"; reason: string };
}

/** The status line on a line of its own, in the shapes models write it in. */
const STATUS_LINE = /^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially)\b[\s`*_]*[:—–-]?\s*(.*)$/i;

/** The bot's own status line (a line of its own, usually first or last),
 * and the message without it. */
function declaredStatus(text: string): { declared?: RoutineReportOutcome["declared"]; rest: string } {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = STATUS_LINE.exec(lines[index]!.trim());
    if (!match) continue;
    const status = /^fail/i.test(match[1]!) ? "failed" as const : "partial" as const;
    const reason = match[2]!.replace(/[`*_]+$/g, "").trim();
    const rest = lines.filter((_, at) => at !== index).join("\n").trim();
    return { declared: { status, reason: reason || (status === "failed" ? "The bot reported that the run failed" : "The bot reported that only part of the work was done") }, rest };
  }
  return { rest: text };
}

export function routineReportOutcome(output: string | undefined): RoutineReportOutcome {
  const raw = (output ?? "").trim();
  if (!raw) return { quiet: true, report: "" };
  // A run that says it failed or did part of its work is never quiet.
  const { declared, rest: text } = declaredStatus(raw);
  if (declared) return { quiet: false, report: text.replace(new RegExp(`^\\s*${ROUTINE_QUIET_MARKER}\\s*$`, "gim"), "").trim(), declared };
  const lines = text.split(/\r?\n/);
  const last = lines.findLastIndex((line) => line.trim() !== "");
  if (last >= 0 && MARKER_LINE.test(lines[last]!.trim())) {
    return { quiet: true, report: lines.slice(0, last).join("\n").trim() };
  }
  if (MARKER_LINE.test(lines[0]!.trim())) {
    return { quiet: true, report: lines.slice(1).join("\n").trim() };
  }
  // A question is always for the person; otherwise only a whole-message no-op
  // is silent (the marker is the real mechanism, this is a safety net).
  const quiet = !text.includes("?") && NO_OP_FULL.test(text);
  return { quiet, report: text };
}

export interface RoutineRunReportFacts {
  status: RoutineRunStatus;
  goalStatus?: RoutineGoalStatus;
  /** The run ended with nothing for the person (routineReportOutcome). */
  quiet?: boolean;
  /** An approval or question card in the run's task waits on the person. */
  needsPerson?: boolean;
  /** 2026-10-22 this routine posts its completed results in the
   * conversation. A completed run with a result posts only when this is on;
   * otherwise it is silent and stays in Automations. Approvals, questions and
   * errors surface whichever this is, and a quiet run never posts. */
  postResults?: boolean;
  /** 2026-11-01: the run completed with problems (RoutineRun.problems). */
  problems?: string;
  /** 2026-11-01: a person started it: its card shows from the start. */
  startedBy?: "person";
}

/** Whether a run has something for the person's conversation now. A plain
 * completed result posts only when the routine opts in (postResults); an
 * approval, a question, a team that needs input, or an error always does. */
export function routineRunReportable(run: RoutineRunReportFacts): boolean {
  if (run.goalStatus === "needs-input") return true;
  // A run a person started shows what started, while it is queued and runs
  // too; once it ends the usual rules decide (a quiet one says so in place).
  if (run.startedBy === "person" && ["queued", "running", "waiting"].includes(run.status)) return true;
  switch (run.status) {
    case "waiting": return run.needsPerson === true;
    case "failed": return true;
    // A run that completed with problems tells the person, like a failure.
    case "completed": return run.problems ? true : run.quiet !== true && run.postResults === true;
    default: return false;
  }
}
