import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const atlas: Bot = {
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "claude", model: "test" },
};
const fixture = vi.hoisted(() => ({ bots: [] as Bot[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }) };
});

import { endCall } from "@/lib/call";
import { configureLiveMedia, liveMedia, resetLiveMedia, startLiveCall } from "@/lib/live-call-media";
import { currentListening, startListening, stopListening } from "@/lib/listening/listening-session";
import { LiveCallChip, LiveCallPill } from "./LiveCallPill";

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, match: (props: ElementProps) => boolean): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (match(child.props)) return child;
    const found = findElement(child.props.children, match);
    if (found) return found;
  }
}

/** Render, and keep the element tree so a test can press its buttons. */
function renderPill(props: Parameters<typeof LiveCallPill>[0]) {
  let tree: ReactNode = null;
  function Capture() {
    tree = LiveCallPill(props);
    return tree;
  }
  return { markup: renderToStaticMarkup(createElement(Capture)), tree: () => tree };
}

function callAtlas() {
  // the microphone prompt never answers: the call stays "starting"
  configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
  void startLiveCall({ botId: "atlas", threadId: "thread-atlas" });
}

beforeEach(() => {
  fixture.bots = [atlas];
  vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
});
afterEach(() => {
  resetLiveMedia();
  endCall();
  vi.unstubAllGlobals();
});

describe("LiveCallPill", () => {
  it("shows nothing without a call from this window", () => {
    expect(renderPill({ onOpen: vi.fn(), currentBotId: null }).markup).toBe("");
  });

  it("shows the call, with mute and hang up, while another chat is open", () => {
    callAtlas();
    const onOpen = vi.fn();
    const { markup, tree } = renderPill({ onOpen, currentBotId: "juniper" });
    expect(markup).toContain("On a Live call with Atlas");
    expect(markup).toContain('title="Back to the call"');
    expect(markup).toContain('aria-label="Mute"');
    expect(markup).toContain('aria-label="Hang up"');

    findElement(tree(), (props) => props.title === "Back to the call")?.props.onClick?.();
    expect(onOpen).toHaveBeenCalledWith("atlas", "thread-atlas");

    findElement(tree(), (props) => props["aria-label"] === "Mute")?.props.onClick?.();
    expect(liveMedia().muted).toBe(true);
    // hung up before the harness knew the call: nothing to wait for
    findElement(tree(), (props) => props["aria-label"] === "Hang up")?.props.onClick?.();
    expect(liveMedia().phase).toBe("idle");
  });

  it("stays out of the way while the call's own chat is on screen", () => {
    callAtlas();
    expect(renderPill({ onOpen: vi.fn(), currentBotId: "atlas" }).markup).toBe("");
    // the same bot showing another of its threads is elsewhere
    fixture.bots = [{ ...atlas, threadId: "thread-other" }];
    expect(renderPill({ onOpen: vi.fn(), currentBotId: "atlas" }).markup).toContain("On a Live call with Atlas");
  });

  it("fits the icons-only sidebar as round buttons", () => {
    callAtlas();
    const { markup } = renderPill({ onOpen: vi.fn(), currentBotId: null, iconOnly: true });
    expect(markup).toContain('aria-label="On a Live call with Atlas"');
    expect(markup).toContain('aria-label="Hang up"');
    expect(markup).not.toContain('<span class="truncate">');
  });
});

describe("LiveCallPill, listening variant (#4100)", () => {
  async function listenToAtlas() {
    await startListening({ botId: "atlas", threadId: "thread-atlas", personName: "Ada" }, {
      openMicrophone: async () => ({ stop: () => {} }),
      transcriber: () => ({ connect: async () => true, onPartial: () => () => {}, begin: () => {}, push: () => {}, probe: () => false, audio: () => new Float32Array(0), finishHeard: async () => ({ text: "" }), discard: () => {}, close: () => {} }),
      models: async () => ({ vad: { probability: async () => 0, reset: () => {} }, embedder: null }),
      request: async <T,>(path: string) => (path.endsWith("/listening")
        ? { session: { sessionId: "ls_aaaaaaaaaaaaaaaaaaaa", botId: "atlas", threadId: "thread-atlas", state: "listening", startedAt: 1, lineCount: 0, lastSeq: 0, speakers: [], sources: { microphone: true, computer: false } } }
        : {}) as T,
      now: () => 1,
      setTimer: () => null,
      clearTimer: () => {},
    });
  }
  // the session listens for the window closing
  beforeEach(() => { vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) }, addEventListener: () => {}, removeEventListener: () => {} }); });
  afterEach(async () => { await stopListening(); });

  it("is the same pill in the recording red: one sentence that starts with the state, then Stop", async () => {
    fixture.bots = [{ ...atlas, name: "Atlas Operations Assistant With A Long Name" }];
    expect(renderPill({ variant: "listening", onOpen: vi.fn(), currentBotId: "juniper" }).markup).toBe("");
    await listenToAtlas();
    const onOpen = vi.fn();
    const { markup, tree } = renderPill({ variant: "listening", onOpen, currentBotId: "juniper" });
    expect(markup).toContain('data-live-pill="listening"');
    expect(markup).toContain("border-danger/40");
    expect(markup).not.toContain("border-success/40");
    // like the call pill: one sentence cut as one string, so the state word
    // leads and a long name is what gives way, never "Listening"
    expect(markup).toMatch(/<span class="truncate">Listening in Atlas Operations Assistant With A Long Name(&#x27;|')s chat<\/span>/);
    expect(markup).not.toContain("shrink-[100]");
    expect(markup).toContain('aria-label="Stop listening"');
    expect(markup).not.toContain('aria-label="Mute"');
    findElement(tree(), (props) => props.title === "Back to listening")?.props.onClick?.();
    expect(onOpen).toHaveBeenCalledWith("atlas", "thread-atlas");
    findElement(tree(), (props) => props["aria-label"] === "Stop listening")?.props.onClick?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(currentListening()).toBeNull();
  });

  it("stays out of the way in the listening chat, and fits the icons-only sidebar", async () => {
    await listenToAtlas();
    expect(renderPill({ variant: "listening", onOpen: vi.fn(), currentBotId: "atlas" }).markup).toBe("");
    const { markup } = renderPill({ variant: "listening", onOpen: vi.fn(), currentBotId: null, iconOnly: true });
    expect(markup).toContain('aria-label="Listening in Atlas&#x27;s chat"');
    expect(markup).toContain('aria-label="Stop listening"');
  });

  it("is the header chip too, back to listening", async () => {
    await listenToAtlas();
    const markup = renderToStaticMarkup(createElement(LiveCallChip, { variant: "listening", currentBotId: "juniper", onOpen: vi.fn() }));
    expect(markup).toContain("Back to listening");
    expect(markup).toContain('data-live-chip="listening"');
    expect(markup).toContain("md:hidden");
    expect(renderToStaticMarkup(createElement(LiveCallChip, { variant: "listening", currentBotId: "atlas", onOpen: vi.fn() }))).toBe("");
  });
});

describe("LiveCallChip", () => {
  it("takes the narrow window back to the call, and hides from md up", () => {
    expect(renderToStaticMarkup(createElement(LiveCallChip, { currentBotId: "juniper", onOpen: vi.fn() }))).toBe("");
    callAtlas();
    const markup = renderToStaticMarkup(createElement(LiveCallChip, { currentBotId: "juniper", onOpen: vi.fn() }));
    expect(markup).toContain("Back to the call");
    expect(markup).toContain("md:hidden");
    expect(renderToStaticMarkup(createElement(LiveCallChip, { currentBotId: "atlas", onOpen: vi.fn() }))).toBe("");
  });
});
