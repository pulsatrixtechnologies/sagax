// @ts-nocheck
/** subjectVisible (#1388). Pure move from server/index.ts. */
import { VisibleSet } from "../bots/bot-visibility.ts";
export type Host = Record<string, any>;

export function createSubjectVisible(getHost: () => Host): any {
function subjectVisible(subject: PathSubject, visible: VisibleSet) {
  const host = getHost();
  const { routineVisible } = host;

  switch (subject.kind) {
    case "bot":
      return !host.store.bot(subject.id) || visible.bot(subject.id);
    case "thread":
      return !host.threadOwner(subject.id) || visible.thread(subject.id);
    case "group":
      return !host.store.group(subject.id) || visible.group(subject.id);
    case "routine": {
      const routine = host.routines?.listRoutines().find((candidate) => candidate.id === subject.id);
      return !routine || routineVisible(routine, visible);
    }
    case "routine-run": {
      const run = host.routines?.listRuns().find((candidate) => candidate.id === subject.id);
      return !run || routineVisible(run, visible);
    }
    case "attachment":
      return visible.attachment(subject.name, host.threadsUsingAttachment);
  }

}
  return subjectVisible;
}
