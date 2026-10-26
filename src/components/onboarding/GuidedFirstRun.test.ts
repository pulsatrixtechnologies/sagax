import { createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WELCOME_VERSION } from "@/lib/onboarding";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      fixture.values[index],
      (next: unknown) => {
        fixture.values[index] = typeof next === "function" ? (next as (p: unknown) => unknown)(fixture.values[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (_effect: EffectCallback) => {},
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
const focus = vi.hoisted(() => ({ composer: vi.fn(() => true) }));
vi.mock("@/lib/composer-focus", () => ({ focusComposer: focus.composer }));
// Heavy children: their own tests cover them; here they stand in as markers.
vi.mock("./beats/EnginesBeat", () => ({ EnginesBeat: () => null }));
vi.mock("@/components/Avatar", () => ({ MausAvatar: () => null }));
vi.mock("@/components/PulsatrixMark", () => ({ PulsatrixMark: () => null }));
vi.mock("./ProgressDots", () => ({ ProgressDots: () => null }));
import { GuidedFirstRun } from "./GuidedFirstRun";
import { EnginesBeat } from "./beats/EnginesBeat";

type El = ReactElement<Record<string, unknown> & { onClick?: () => void; children?: ReactNode }>;
function render(props: Parameters<typeof GuidedFirstRun>[0]) {
  fixture.index = 0;
  let tree: ReactNode = null;
  function Capture() {
    tree = GuidedFirstRun(props);
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree: tree as unknown as El };
}
function collect(node: ReactNode): El[] {
  if (!isValidElement(node)) return [];
  const el = node as El;
  const children = el.props.children;
  const kids = Array.isArray(children) ? children : [children];
  return [el, ...kids.flatMap(collect)];
}
/** The clickable whose visible label contains `text`. */
function button(tree: El, text: string): El {
  const found = collect(tree).find((el) => typeof el.props.children === "string" && (el.props.children as string).includes(text));
  if (!found) throw new Error(`no control labelled ${JSON.stringify(text)}`);
  return found;
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const readyInstance = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", install: {}, snapshot: { state: "available", authenticated: true } };
const bot = { id: "bot_1", name: "Atlas", color: "green", hidden: false };

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  store.dispatch.mockReset();
  store.api.mockReset();
  focus.composer.mockClear();
  store.state = { instances: [], bots: [], selectedId: null };
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => void cb(0));
  setLocale("en");
});
afterEach(() => vi.unstubAllGlobals());

describe("which step the guide opens on", () => {
  it("is a dedicated dismissible dialog, not a widget in the conversation", () => {
    const { tree, html } = render({ onDone: vi.fn() });
    const dialog = collect(tree).find((el) => el.props.role === "dialog")!;
    expect(dialog).toBeDefined();
    expect(dialog.props["aria-modal"]).toBe("true");
    expect(html).toContain('role="dialog"');
  });

  it("starts on connecting an engine when none is ready, reusing the engines card", () => {
    const { tree, html } = render({ onDone: vi.fn() });
    expect(collect(tree).some((el) => el.type === EnginesBeat)).toBe(true);
    expect(html).toContain("Step 1 of 3");
  });

  it("skips the engine step and starts on the bot when an engine is already connected", () => {
    store.state = { ...store.state, instances: [readyInstance] };
    const { tree, html } = render({ onDone: vi.fn() });
    expect(collect(tree).some((el) => el.type === EnginesBeat)).toBe(false);
    expect(() => button(tree, "Create my first bot")).not.toThrow();
    expect(html).toContain("Step 2 of 3");
  });

  it("lands straight on the first message when an engine and a bot already exist", () => {
    store.state = { ...store.state, instances: [readyInstance], bots: [bot] };
    const { html } = render({ onDone: vi.fn() });
    expect(html).toContain("Step 3 of 3");
  });
});

describe("create my first bot", () => {
  it("creates an Auto bot and lands in its chat", async () => {
    store.state = { ...store.state, instances: [readyInstance], bots: [] };
    store.api.mockImplementation(async (path: string) => {
      if (path === "/api/bot-defaults") return { modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true }, approvalMode: "ask" };
      if (path === "/api/bots") return { bot };
      return {};
    });
    const first = render({ onDone: vi.fn() });
    button(first.tree, "Create my first bot").props.onClick!();
    await flush();
    // the New bot dialog's create path: Auto selection, approval untouched
    const createCall = store.api.mock.calls.find((c) => c[0] === "/api/bots")!;
    const body = JSON.parse(createCall[1].body as string);
    expect(body.modelSelection).toEqual({ instanceId: "claude", model: "claude-sonnet-5", auto: true });
    expect(body).not.toHaveProperty("approvalMode");
    // the same dispatch the dialog uses: it selects the bot and opens its chat
    expect(store.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot });
    // advanced path stays one place: the full New bot dialog
    expect(() => button(first.tree, "More options")).not.toThrow();
    // and the guide has advanced to the message step
    const again = render({ onDone: vi.fn() });
    expect(again.html).toContain("Step 3 of 3");
  });

  it("offers the real next action instead of a broken create when no engine is ready", () => {
    // forced onto the bot step with no engine (e.g. continued past engines)
    const { tree } = render({ onDone: vi.fn(), initialStep: "bot" });
    expect(() => button(tree, "Create my first bot")).toThrow();
    expect(() => button(tree, "Connect an engine")).not.toThrow();
  });
});

describe("send your first message", () => {
  it("drops into the bot's chat, focuses the composer, and persists completion", async () => {
    store.state = { ...store.state, instances: [readyInstance], bots: [bot], selectedId: null };
    store.api.mockResolvedValue({ config: { onboarding: { completedAt: "x", version: WELCOME_VERSION } } });
    const onDone = vi.fn();
    const { tree } = render({ onDone });
    button(tree, "Start writing").props.onClick!();
    await flush();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "bot_1" });
    expect(onDone).toHaveBeenCalled();
    expect(focus.composer).toHaveBeenCalled();
    const put = store.api.mock.calls.find((c) => c[0] === "/api/config")!;
    expect(put[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(put[1].body as string).onboarding.version).toBe(WELCOME_VERSION);
  });
});

describe("dismiss", () => {
  it("persists first-run as done and closes, so it never reappears", async () => {
    store.api.mockResolvedValue({ config: {} });
    const onDone = vi.fn();
    const { tree } = render({ onDone });
    button(tree, "Skip tour").props.onClick!();
    await flush();
    expect(onDone).toHaveBeenCalled();
    const put = store.api.mock.calls.find((c) => c[0] === "/api/config")!;
    expect(put[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(put[1].body as string).onboarding.version).toBe(WELCOME_VERSION);
  });
});
