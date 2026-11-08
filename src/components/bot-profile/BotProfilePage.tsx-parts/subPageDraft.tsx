// #2620: a sub-page of the bot page stages its changes. While a sub-page is
// open, every bot write of this bot (the "updateBot" the sections dispatch)
// lands in a draft instead of the workspace; the sub-page reads the bot with
// the draft applied. Save sends the draft as one write, Cancel drops it.
// Writers that call the server directly (routines, rules, files, sharing)
// keep their own Save, as before.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { BotEditorStore, reducer, useStore, type Action } from "@/state/store";
import type { BotUpdatePatch } from "@/state/bot-patch-queue";

export type SubPageDraft = {
  /** A change waits for Save. */
  dirty: boolean;
  save: () => void;
  discard: () => void;
  /** On while a sub-page is open; turning it off drops the draft. */
  setActive: (on: boolean) => void;
};

const DraftContext = createContext<SubPageDraft | null>(null);

/** The draft of the open sub-page; null outside the bot page. */
export function useSubPageDraft(): SubPageDraft | null {
  return useContext(DraftContext);
}

export function SubPageDraftStore({ botId, children }: { botId: string; children: ReactNode }) {
  const store = useStore();
  const [draft, setDraft] = useState<BotUpdatePatch | null>(null);
  const active = useRef(false);
  const parentDispatch = store.dispatch;
  const dispatch = useCallback((action: Action) => {
    if (active.current && action.type === "updateBot" && action.botId === botId) {
      setDraft((prev) => ({ ...prev, ...action.patch }));
      return;
    }
    parentDispatch(action);
  }, [parentDispatch, botId]);
  const state = useMemo(
    () => (draft ? reducer(store.state, { type: "updateBot", botId, patch: draft }) : store.state),
    [store.state, draft, botId],
  );
  const value = useMemo(() => ({ ...store, state, dispatch }), [store, state, dispatch]);
  const api = useMemo<SubPageDraft>(() => ({
    dirty: draft !== null,
    save: () => {
      if (draft) parentDispatch({ type: "updateBot", botId, patch: draft });
      setDraft(null);
    },
    discard: () => setDraft(null),
    setActive: (on) => {
      active.current = on;
      if (!on) setDraft(null);
    },
  }), [draft, parentDispatch, botId]);
  return (
    <BotEditorStore value={value}>
      <DraftContext.Provider value={api}>{children}</DraftContext.Provider>
    </BotEditorStore>
  );
}
