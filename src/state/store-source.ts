// The external store behind selector reads (store-selector.ts): the provider
// publishes each state it renders here. Kept apart from store-selector.ts so
// store.tsx can provide it without importing the hooks, which read
// `useStore` from "./store" (a test that mocks the store reaches them there).
import type { BotAnnouncement } from "./store/model";
import { createContext, useLayoutEffect, useRef, type Dispatch } from "react";

/** What selector reads subscribe to: the latest rendered state and the store's dispatch.
 * The state and action types stay with the caller, so this module does not
 * import the store (#1381). */
export interface StoreSource<S, A> {
  getState(): S;
  subscribe(listener: () => void): () => void;
  dispatch: Dispatch<A>;
}

export interface PublishingStoreSource<S, A> extends StoreSource<S, A> {
  /** Make `state` what getState returns, without telling anyone yet. */
  publish(state: S): void;
  /** Tell every subscriber to compare its selection again. */
  notify(): void;
  /** Forward `dispatch` to this function from now on (a scoped editor store may hand a new one). */
  setDispatch(dispatch: Dispatch<A>): void;
}

export function createStoreSource<S, A>(initial: S, dispatch: Dispatch<A>): PublishingStoreSource<S, A> {
  let state = initial;
  let send = dispatch;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // stable identity; forwards to the dispatch of the latest render
    dispatch: (action) => send(action),
    publish(next) { state = next; },
    // a copy: a listener may unsubscribe while we call the others
    notify() { for (const listener of Array.from(listeners)) listener(); },
    setDispatch(next) { send = next; },
  };
}

/** The context erases the state type. The selectors in store-selector.ts put
 * `AppState` and `Action` back; naming them here would import the store. */
export const StoreSourceContext = createContext<StoreSource<unknown, never> | null>(null);

/** Imperative services have identities independent of reducer frames. */
export interface StoreCommands {
  flushBotPatches(botId: string): Promise<BotAnnouncement | null>;
  refreshInstances(options?: { reportErrors?: boolean }): Promise<void>;
  refreshModels(instanceId: string): Promise<void>;
}
export const StoreCommandsContext = createContext<StoreCommands | null>(null);

/** One source per provider, holding the state this render draws. Publishing
 * during render lets children rendered in the same pass read that state;
 * subscribers that did not render are told once the commit lands. */
export function usePublishedStoreSource<S, A>(state: S, dispatch: Dispatch<A>): StoreSource<S, A> {
  const ref = useRef<PublishingStoreSource<S, A> | null>(null);
  if (!ref.current) ref.current = createStoreSource(state, dispatch);
  const source = ref.current;
  source.publish(state);
  source.setDispatch(dispatch);
  useLayoutEffect(() => {
    // the committed state, in case a render that published another was dropped
    source.publish(state);
    source.notify();
  }, [source, state]);
  return source;
}
