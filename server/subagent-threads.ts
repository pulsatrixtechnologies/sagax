// start_thread on yourself as a sub-agent (Grok Bot parity D1). Grok Bot's
// sub-agent tool takes a type, a model, read-only, a background flag and the
// id of an earlier sub-agent to resume. In Sagax a thread a bot opens on
// itself is that sub-agent: `report_back` already runs it in the background
// as a parallel task, and Auto picks the model of every hand-off
// (model.auto). This adds the other two:
//   - read_only: the thread starts in Ask, whatever the bot's level, and its
//     first line says so, so any change it would make waits for the person;
//   - resume: the bot sends a follow-up into a thread it opened on itself
//     earlier, by id, instead of opening a fresh one (the thread keeps its
//     history, its level and its row).
// Pure: the route in server/index.ts does the work.

/** The first line of a read-only sub-agent's request, in the words the
 * model reads before the bot's own. */
export const READ_ONLY_TASK_LINE = "[Read-only task: look, read and report. Do not create, edit, delete, send or buy anything. If the work needs a change, stop and say what you would change.]";

/** The request a sub-agent thread opens (or resumes) with. */
export function subagentRequest(message: string, readOnly: boolean): string {
  return readOnly ? `${READ_ONLY_TASK_LINE}\n\n${message}` : message;
}

export interface ResumableTask {
  threadId: string;
  title: string;
  openedBy?: { botId: string; delegationId?: string };
  parallelOf?: unknown;
  ownerPrincipalId?: string;
}

/** Where the resume is asked from. `visible`: the thread may be named from
 * here at all, by the rules list_threads applies (on a Cloud home's lending
 * view only threads the owner alone wrote in; a confidential thread only in
 * itself). `ownerPrincipalId`, present only on a server with private
 * threads: the person the current work is for (openedThreadOwner). */
export interface ResumeScope {
  visible: boolean;
  ownerPrincipalId?: string;
}

const NOT_FOUND = { status: 404, error: "you have no thread with that id: use list_threads, or open a new one with start_thread" };

/** Whether a bot may resume this thread of its own: one it opened itself on
 * itself (start_thread without report_back), visible from here, and for the
 * same person as the current work. The person's own threads, a thread a
 * teammate opened, and a parallel task (whose card and report back already
 * closed) are not. A thread not visible from here reads as absent, so the
 * refusal names nothing. */
export function resumeRefusal(task: ResumableTask | undefined, botId: string, fromThreadId: string, scope: ResumeScope): { status: number; error: string } | null {
  if (!task || !scope.visible) return NOT_FOUND;
  if (task.threadId === fromThreadId) return { status: 409, error: "that is this conversation: carry on here" };
  if (task.parallelOf) return { status: 409, error: "a parallel task cannot be resumed: open a new one with report_back" };
  if (task.openedBy?.botId !== botId || task.openedBy.delegationId) {
    return { status: 403, error: "only a thread you opened yourself on yourself can be resumed" };
  }
  // private threads: never feed one person's work into another's thread
  if ("ownerPrincipalId" in scope && task.ownerPrincipalId !== scope.ownerPrincipalId) {
    return { status: 403, error: "that thread was opened for someone else's work: open a new one with start_thread" };
  }
  return null;
}

/** A follow-up the bot sends into its own earlier thread, marked as its own
 * words like the thread's first line. */
export function resumeOpening(message: string, sourceTitle: string, readOnly: boolean): string {
  return `[Follow-up you sent yourself${sourceTitle ? ` from #${sourceTitle}` : ""}. The request below is your own words, not the person's.]\n\n${subagentRequest(message, readOnly)}`;
}
