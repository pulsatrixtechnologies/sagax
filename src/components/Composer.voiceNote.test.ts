// @vitest-environment happy-dom
// A voice note from the composer (+ > Record a voice note, 2026-10-16): the
// pill replaces the mic and the CTA while recording; Send hands the clip as an
// audio attachment and its words as the text, through the ordinary send.
import { createElement, type ComponentProps, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  instances: [] as unknown[],
  dictation: false,
  started: 0,
  options: null as null | { botId?: string; transcribe: boolean; onReady: (note: unknown) => void },
}));
// The recorder's microphone, upload and speech to text are its own tests
// (useVoiceNoteRecorder, lib/voice-note); here it hands the composer a note.
vi.mock("./useVoiceNoteRecorder", async () => {
  const React = await import("react");
  return {
    useVoiceNoteRecorder: (options: NonNullable<typeof fixture.options>) => {
      const [phase, setPhase] = React.useState<"idle" | "recording" | "sending">("idle");
      fixture.options = options;
      return {
        phase,
        error: null,
        clearError: () => {},
        seconds: 4,
        bars: Array.from({ length: 24 }, () => 0.2),
        start: async () => { fixture.started += 1; setPhase("recording"); },
        cancel: () => setPhase("idle"),
        finish: async () => {
          setPhase("idle");
          options.onReady({
            attachment: { kind: "file", id: "a1", path: "/home/.sagax/attachments/123e4567-e89b-42d3-a456-426614174000.wav", name: "voice-note-20261016-090307.wav", size: 128_044 },
            transcript: "Peux-tu rappeler le client demain",
            durationMs: 4000,
          });
        },
      };
    },
  };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async () => ({})), useStore: () => ({
    state: { ...original.initialState, instances: fixture.instances },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: fixture.dictation }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
vi.mock("./settings/ProviderKeys", async (importOriginal) => ({
  ...await importOriginal<typeof import("./settings/ProviderKeys")>(),
  openProviderKeyDialog: vi.fn(),
}));

const { Composer } = await import("./Composer");
const { setLocale } = await import("@/lib/i18n");
const { forgetVoiceModeStatus } = await import("@/lib/voice-mode/api");

const bot = (color: string): Bot => ({
  id: "bot", threadId: "selected", name: "Harrie", title: "", description: "", color: color as Bot["color"],
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockClear();
  fixture.instances = [];
  fixture.dictation = false;
  fixture.started = 0;
  fixture.options = null;
  forgetVoiceModeStatus();
  // voice mode answers "not available" for this bot
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ provider: "xai", available: false, refusal: { cause: "no_credentials" } }), { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete window.ogb;
  vi.unstubAllGlobals();
});

describe("composer voice note", () => {
  it("is no longer offered in the + menu", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    click($("[data-composer-plus]"));
    expect($('[data-composer-plus-item="voiceNote"]')).toBeNull();
    expect(fixture.started).toBe(0);
    expect($("[data-voice-note-chip]")).toBeNull();
  });

  it("asks for a transcript only when this bot has speech to text", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    expect(fixture.options?.botId).toBe("bot");
    expect(fixture.options?.transcribe).toBe(false);
  });
});
