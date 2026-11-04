// @vitest-environment happy-dom
// Selector reads over the store: a component renders only when the slice it
// reads changes, sees the state its provider renders in the same pass, and
// a scoped provider (the bot editor) is read instead of the workspace.
import { createElement, useReducer, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, type Action, type AppState } from "./store";
import {
  createStoreSource,
  shallowEqual,
  StoreSourceContext,
  usePublishedStoreSource,
  useStoreCommands,
  useStoreDispatch,
  useStoreGetter,
  useStoreSelector,
} from "./store-selector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestAction = { type: "notice"; notice: string } | { type: "focus"; threadId: string };

function testReducer(state: AppState, action: TestAction): AppState {
  if (action.type === "notice") return { ...state, notice: { kind: "bot-gone", botName: action.notice } };
  return { ...state, revealThread: { threadId: action.threadId, nonce: 0 } };
}

let dispatchOut: ((action: TestAction) => void) | null = null;

/** A provider shaped like StoreProvider: a reducer, published to a source. */
function Provider({ children, onRender }: { children: ReactNode; onRender?: () => void }) {
  const [state, dispatch] = useReducer(testReducer, initialState);
  dispatchOut = dispatch;
  onRender?.();
  const source = usePublishedStoreSource(state, dispatch as unknown as (action: Action) => void);
  return createElement(StoreSourceContext.Provider, { value: source }, children);
}

describe("useStoreSelector", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    dispatchOut = null;
  });

  it("renders a reader only when its slice changes", () => {
    const renders = { notice: 0, reveal: 0 };
    function NoticeReader() {
      const notice = useStoreSelector((state) => state.notice);
      renders.notice++;
      return createElement("span", { "data-notice": "" }, notice?.botName ?? "none");
    }
    function RevealReader() {
      const threadId = useStoreSelector((state) => state.revealThread?.threadId ?? null);
      renders.reveal++;
      return createElement("span", { "data-reveal": "" }, threadId ?? "none");
    }
    // children passed as elements, so the provider rendering again does not
    // render them; only their own selection can
    const tree = createElement(Provider, null, createElement(NoticeReader), createElement(RevealReader));
    act(() => root.render(tree));
    expect(renders).toEqual({ notice: 1, reveal: 1 });
    act(() => dispatchOut!({ type: "notice", notice: "saved" }));
    expect(host.querySelector("[data-notice]")!.textContent).toBe("saved");
    expect(renders).toEqual({ notice: 2, reveal: 1 });
    act(() => dispatchOut!({ type: "focus", threadId: "t1" }));
    expect(host.querySelector("[data-reveal]")!.textContent).toBe("t1");
    expect(renders).toEqual({ notice: 2, reveal: 2 });
    // the same thread again: a new state object, the same selection
    act(() => dispatchOut!({ type: "focus", threadId: "t1" }));
    expect(renders).toEqual({ notice: 2, reveal: 2 });
  });

  it("keeps a selection built afresh when it is shallowly equal", () => {
    let renders = 0;
    function Pair() {
      const pair = useStoreSelector((state) => ({ hydrated: state.hydrated, view: state.activeView }), shallowEqual);
      renders++;
      return createElement("span", null, `${pair.hydrated}:${pair.view}`);
    }
    act(() => root.render(createElement(Provider, null, createElement(Pair))));
    act(() => dispatchOut!({ type: "notice", notice: "unrelated" }));
    expect(renders).toBe(1);
  });

  it("reads the state the provider renders in the same pass", () => {
    const seen: string[] = [];
    function Child({ fromProp }: { fromProp: string }) {
      const fromStore = useStoreSelector((state) => state.notice?.botName ?? "none");
      seen.push(`${fromProp}=${fromStore}`);
      return null;
    }
    function Parent() {
      const [state, dispatch] = useReducer(testReducer, initialState);
      dispatchOut = dispatch;
      const source = usePublishedStoreSource(state, dispatch as unknown as (action: Action) => void);
      const text = state.notice?.botName ?? "none";
      return createElement(StoreSourceContext.Provider, { value: source }, createElement(Child, { fromProp: text }));
    }
    act(() => root.render(createElement(Parent)));
    act(() => dispatchOut!({ type: "notice", notice: "one" }));
    // never a render where the prop and the selection disagree
    expect(seen.every((line) => line.split("=")[0] === line.split("=")[1])).toBe(true);
    expect(seen.at(-1)).toBe("one=one");
  });

  it("dispatches and reads the latest state without subscribing", () => {
    let renders = 0;
    let read: (() => AppState) | null = null;
    let send: ((action: Action) => void) | null = null;
    function Actions() {
      read = useStoreGetter();
      send = useStoreDispatch();
      renders++;
      return null;
    }
    act(() => root.render(createElement(Provider, null, createElement(Actions))));
    act(() => send!({ type: "notice", notice: "from a handler" } as unknown as Action));
    expect(read!().notice?.botName).toBe("from a handler");
    expect(renders).toBe(1);
  });

  it("keeps imperative services independent of state and scoped to their provider", async () => {
    const flush = vi.fn(async () => null);
    const innerFlush = vi.fn(async () => null);
    const services = { flushBotPatches: flush, refreshInstances: async () => {}, refreshModels: async () => {} };
    let renders = 0;
    let commands: ReturnType<typeof useStoreCommands> | undefined;
    function Reader() { commands = useStoreCommands(); renders++; return null; }
    function CommandsHost({ children }: { children: ReactNode }) {
      const [state, dispatch] = useReducer(testReducer, initialState);
      dispatchOut = dispatch;
      return createElement(BotEditorStore, { value: { state, dispatch: dispatch as unknown as (action: Action) => void, ...services }, children });
    }
    const child = createElement(Reader);
    act(() => root.render(createElement(CommandsHost, null, child)));
    act(() => dispatchOut!({ type: "notice", notice: "unrelated" }));
    expect(renders).toBe(1);
    await commands!.flushBotPatches("osprey");
    expect(flush).toHaveBeenCalledWith("osprey");
    act(() => root.render(createElement(CommandsHost, null, createElement(BotEditorStore, {
      value: { state: initialState, dispatch: () => {}, ...services, flushBotPatches: innerFlush }, children: child,
    }))));
    await commands!.flushBotPatches("wren");
    expect(innerFlush).toHaveBeenCalledWith("wren");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reads a scoped source inside it, not the outer one", () => {
    const scoped = createStoreSource<AppState, Action>({ ...initialState, activeView: "routines" }, () => {});
    function View() {
      return createElement("span", { "data-view": "" }, useStoreSelector((state) => state.activeView));
    }
    act(() => root.render(createElement(Provider, null,
      createElement(StoreSourceContext.Provider, { value: scoped }, createElement(View)))));
    expect(host.querySelector("[data-view]")!.textContent).toBe("routines");
    act(() => { scoped.publish({ ...initialState, activeView: "chat" }); scoped.notify(); });
    expect(host.querySelector("[data-view]")!.textContent).toBe("chat");
  });
});

describe("shallowEqual", () => {
  it("compares one level of keys", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1], { 0: 1 })).toBe(false);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
  });
});
