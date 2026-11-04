// Selector reads over the app store. `useStore()` hands out the whole state
// through one context, so every consumer renders on every dispatch (a bot
// frame, an unread mark, a presence tick). A component that reads a slice
// with `useStoreSelector` renders only when that slice changes: the provider
// publishes each state it renders to a small external store, and
// useSyncExternalStore compares the selected value.
//
// Outside a provider that publishes one (a test that mocks `useStore`), the
// hooks read `useStore()` instead, so a migrated component keeps working
// under the existing mocks.
import { useContext, useRef, useSyncExternalStore, type Dispatch } from "react";
import { useStore, type Action, type AppState } from "./store";
import { StoreCommandsContext, StoreSourceContext, type StoreCommands, type StoreSource } from "./store-source";

export { createStoreSource, StoreSourceContext, usePublishedStoreSource, type PublishingStoreSource, type StoreSource } from "./store-source";

/** Shallow equality for a selected object or array of plain values. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
}

/** Read `selector(state)` from a source; renders only when the selection
 * changes by `isEqual`. Exported for tests and for a scoped source. */
export function useSourceSelector<S, T>(
  source: Pick<StoreSource<S, unknown>, "getState" | "subscribe">,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const held = useRef<{ state: S; selector: (state: S) => T; value: T } | null>(null);
  const getSnapshot = () => {
    const state = source.getState();
    const last = held.current;
    if (last && last.state === state && last.selector === selector) return last.value;
    const next = selector(state);
    if (last && isEqual(last.value, next)) {
      held.current = { state, selector, value: last.value };
      return last.value;
    }
    held.current = { state, selector, value: next };
    return next;
  };
  return useSyncExternalStore(source.subscribe, getSnapshot, getSnapshot);
}

/** A slice of the app state. Pass `shallowEqual` when the selector builds a
 * new object or array each time. */
export function useStoreSelector<T>(selector: (state: AppState) => T, isEqual?: (a: T, b: T) => boolean): T {
  const source = useContext(StoreSourceContext);
  // A tree has a source or it does not for the life of the component, so the
  // hooks called below stay the same from one render to the next.
  if (!source) return selector(useStore().state);
  return useSourceSelector(source as StoreSource<AppState, unknown>, selector, isEqual);
}

/** The store's dispatch, without subscribing to the state. */
export function useStoreDispatch(): Dispatch<Action> {
  const source = useContext(StoreSourceContext);
  if (!source) return useStore().dispatch;
  return source.dispatch as Dispatch<Action>;
}

/** The latest state, read when called (an event handler, an effect), without
 * subscribing to it. */
export function useStoreGetter(): () => AppState {
  const source = useContext(StoreSourceContext);
  if (!source) {
    const state = useStore().state;
    return () => state;
  }
  return source.getState as () => AppState;
}

/** Store services without a subscription to reducer state. */
export function useStoreCommands(): StoreCommands {
  const commands = useContext(StoreCommandsContext);
  if (commands) return commands;
  const { flushBotPatches, refreshInstances, refreshModels } = useStore();
  return { flushBotPatches, refreshInstances, refreshModels };
}
