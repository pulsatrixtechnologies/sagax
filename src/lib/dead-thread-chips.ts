// Navigation chips ("Go to conversation", "Messaged <bot>") that point at a
// thread which no longer exists are not drawn: they would only lead to a
// "conversation gone" notice.
//
// The viewer's own store decides when it can see the target's owner (a bot or
// room with a task list). Otherwise (an organization server, another
// person's bot) the server's read-time `gone` mark on the chip decides.
import type { Message } from "@/state/store";
import { isHandoff } from "./handoff-row";

interface Owner {
  id: string;
  threadId: string;
  tasks?: ReadonlyArray<{ threadId: string }>;
}

export interface ThreadOwners {
  bots: readonly Owner[];
  groups: readonly Owner[];
}

const owns = (owner: Owner, threadId: string) =>
  owner.threadId === threadId || (owner.tasks ?? []).some((task) => task.threadId === threadId);

/** True when the chip's target thread is known not to exist. */
export function navigationTargetGone(message: Message, owners: ThreadOwners): boolean {
  const ref = message.threadRef;
  if (ref) {
    if (owners.groups.some((owner) => owns(owner, ref.threadId)) || owners.bots.some((owner) => owns(owner, ref.threadId))) return false;
    const owner = owners.bots.find((candidate) => candidate.id === ref.botId) ?? owners.groups.find((candidate) => candidate.id === ref.botId);
    if (owner?.tasks) return true;
    return ref.gone === true;
  }
  const comm = message.comm;
  if (comm) {
    const group = owners.groups.find((candidate) => candidate.id === comm.groupId);
    if (group) {
      if (!comm.threadId) return false;
      if (owns(group, comm.threadId)) return false;
      return Boolean(group.tasks);
    }
    return comm.gone === true;
  }
  return false;
}

/** The transcript without the chips whose target is gone. Run before any
 * grouping so no fold or exchange is left holding an empty slot. */
export function withoutDeadThreadChips(messages: Message[], owners: ThreadOwners): Message[] {
  if (!messages.some((message) => message.threadRef || message.comm)) return messages;
  // A hand-off keeps its row: in the unified chat it reads the brief and the
  // teammate's verdict in place, with no link to the thread (HandoffRow).
  // With threads shown, ThreadChip still leaves out a link that leads nowhere.
  const kept = messages.filter((message) => isHandoff(message) || !navigationTargetGone(message, owners));
  return kept.length === messages.length ? messages : kept;
}
