// Confidential threads ("Fil confidentiel", server/threads/confidential-threads.ts).
// A thread marked confidential is never remembered, exported or shared
// beyond its owner, and it stays confidential until it is deleted: the
// server refuses any change back, so the client offers none. To work
// normally the person opens a new thread.

/** The PATCH body that makes a thread confidential: the person confirmed it
 * is permanent. There is no body that turns it off. */
export function makeConfidentialBody(): { confidential: true; confirmConfidential: true } {
  return { confidential: true, confirmConfidential: true };
}

export function isConfidentialTask(task: { confidential?: unknown } | null | undefined): boolean {
  return task?.confidential === true;
}

/** Whether the thread open on a bot (its threadId) is confidential. */
export function openThreadConfidential(bot: { threadId?: string; tasks?: ReadonlyArray<{ threadId: string; confidential?: unknown }> } | null | undefined): boolean {
  if (!bot?.threadId) return false;
  return isConfidentialTask(bot.tasks?.find((task) => task.threadId === bot.threadId));
}

export interface NewThreadChoice {
  /** What the New thread menu item sends as `confidential`. */
  confidential: boolean;
  /** i18n key of its label. */
  label: "task.newShort" | "confidential.new" | "confidential.newOrdinary";
  lock: boolean;
}

/** The New thread menu's items: the ordinary item first, then the other
 * kind. With the organization's default on, the plain item already makes a
 * confidential thread, so the second one is an explicit ordinary thread. */
export function newThreadChoices(confidentialByDefault: boolean | undefined): NewThreadChoice[] {
  return confidentialByDefault
    ? [
      { confidential: true, label: "confidential.new", lock: true },
      { confidential: false, label: "confidential.newOrdinary", lock: false },
    ]
    : [
      { confidential: false, label: "task.newShort", lock: false },
      { confidential: true, label: "confidential.new", lock: true },
    ];
}

/** The window title with the confidential mark, so a screenshot or the
 * window switcher shows it too. */
export function confidentialTitle(title: string, confidential: boolean, mark: string): string {
  if (!confidential) return title;
  return title ? `🔒 ${mark} · ${title}` : `🔒 ${mark}`;
}
