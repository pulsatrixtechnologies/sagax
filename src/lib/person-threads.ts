// A conversation with a person has threads like a bot (server/people/people-dms.ts).
// What the picker and the sidebar read from it, in one place.
import { t } from "@/lib/i18n";
import type { Group, GroupTask } from "@/state/store";
import { orderedThreadList } from "@/components/SidebarThreadRow";

/** The server's title for the thread a conversation was before threads. */
export const GENERAL_THREAD_TITLE = "General";

/** A thread's title as the person reads it: the migrated "General" thread in
 * their language until someone renames it, any other title as it is. */
export function personThreadTitle(task: Pick<GroupTask, "title" | "general">): string {
  return task.general && task.title === GENERAL_THREAD_TITLE ? t("task.general") : task.title;
}

/** The threads a conversation with a person lists, with their read titles,
 * pinned first then newest (the same order as a bot's). */
export function personPickerThreads(group: Pick<Group, "tasks" | "threadId" | "createdAt">): Array<GroupTask & { title: string }> {
  const tasks = group.tasks ?? [{ threadId: group.threadId, title: GENERAL_THREAD_TITLE, createdAt: group.createdAt, general: true as const }];
  return orderedThreadList(tasks.map((task) => ({ ...task, title: personThreadTitle(task) })));
}
