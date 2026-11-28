// Passage selected on an open page, waiting in the main composer (#5464, R4).
// Selecting text in PageSelectionAsk also parks the passage here so the person
// can send from the existing message field with dataContext.page.selection.
// Security: only PageSelectionAsk (which hears the page's own frame) writes.
import { useSyncExternalStore } from "react";

import type { PageQuote } from "../../shared/page-threads";

export interface PageCiteDraft {
  pageId: string;
  title: string;
  version?: number;
  selection: PageQuote;
}

let drafts: Readonly<Record<string, PageCiteDraft>> = {};
const listeners = new Set<() => void>();

function set(next: Readonly<Record<string, PageCiteDraft>>): void {
  drafts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: PageCiteDraft | null = null;

/** The passage waiting on this conversation's composer, or null. */
export function pageCiteDraft(threadId: string): PageCiteDraft | null {
  return drafts[threadId] ?? null;
}

export function usePageCiteDraft(threadId: string): PageCiteDraft | null {
  return useSyncExternalStore(subscribe, () => drafts[threadId] ?? EMPTY, () => EMPTY);
}

/** Park a selected passage on the composer for this conversation. */
export function setPageCiteDraft(threadId: string, draft: PageCiteDraft): void {
  if (!threadId) return;
  set({ ...drafts, [threadId]: draft });
}

export function clearPageCiteDraft(threadId: string): void {
  if (!drafts[threadId]) return;
  const { [threadId]: _gone, ...rest } = drafts;
  set(rest);
}

/** Take the parked passage for a send; `restore` puts it back if the send fails. */
export function takePageCiteDraft(threadId: string): { draft: PageCiteDraft; restore(): void } | null {
  const draft = drafts[threadId];
  if (!draft) return null;
  const { [threadId]: _taken, ...rest } = drafts;
  set(rest);
  return {
    draft,
    restore: () => {
      if (drafts[threadId]) return;
      set({ ...drafts, [threadId]: draft });
    },
  };
}

/** Tests: drop every parked passage. */
export function forgetPageCiteDrafts(): void {
  set({});
}
