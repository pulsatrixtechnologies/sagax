// A voice-mode call is one card. The spoken lines stay stored so the bot
// can answer, and they do not render as chat bubbles.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const at = 1_700_000_000_000;
const message = (id: string, text: string, extra: Partial<Message> = {}): Message =>
  ({ id, role: "user", kind: "text", text, at, ...extra }) as Message;

const bot = (messages: Message[]): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages,
  modelSelection: { instanceId: "test", model: "m" },
});

describe("voice call card", () => {
  it("shows one collapsed card and keeps the spoken lines out of the bubbles", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, {
      bot: bot([
        message("u", "hello there", { voiceCall: { callId: "call-1" } }),
        message("b", "hi back", { role: "bot", at: at + 34_000 }),
        message("t", "after the call", { at: at + 40_000 }),
      ]),
    }));
    expect(markup).toContain("Voice · 00:34");
    expect(markup).toContain('data-voice-call="call-1"');
    expect(markup).toContain('data-voice-open="false"');
    expect(markup).toContain("after the call");
    expect(markup).not.toContain("hello there");
    expect(markup).not.toContain("hi back");
    expect(markup.match(/data-voice-call=/g)).toHaveLength(1);
  });

  it("leaves a Live via-call line as its own bubble", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, {
      bot: bot([
        // a Live call stamps its call id on each spoken line; a "call" line
        // without one is a phone-line request, the Asked by row (#4112)
        message("live", "spoken on live", { via: "call", callId: "live-1" }),
        message("u", "hello there", { voiceCall: { callId: "call-1" } }),
        message("b", "hi back", { role: "bot", at: at + 34_000 }),
      ]),
    }));
    expect(markup).toContain("spoken on live");
    expect(markup).toContain(">via call<");
    expect(markup).toContain("Voice · 00:34");
    expect(markup).not.toContain("hello there");
    expect(markup).not.toContain("hi back");
  });
});
