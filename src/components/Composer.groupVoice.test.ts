// @vitest-environment happy-dom
// Voice mode cannot start in a group chat: the composer hides the waveform
// button there and keeps it in a lone bot's chat. The mic stays in both.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const bot: Bot = {
  id: "solo-bot", threadId: "solo-bot-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const group = {
  id: "room", threadId: "room-thread", name: "Room", memberIds: [bot.id], defaultResponder: "auto",
  bulletin: "", unread: false, createdAt: 1, messages: [],
} as unknown as Group;

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], groups: [group], instances: [] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => createElement("button", { "data-voice-mode": "" }) }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => createElement("button", { "data-voice-mode": "" }) }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

describe("voice mode button in the composer", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is absent in a group chat, the mic stays", () => {
    flushSync(() => root.render(createElement(Composer, { group, members: [bot] })));
    expect(container.querySelector("[data-voice-mode]")).toBeNull();
    expect(container.querySelector("[data-composer-mic]")).not.toBeNull();
  });

  it("is present in a lone bot's chat", () => {
    flushSync(() => root.render(createElement(Composer, { bot })));
    expect(container.querySelector("[data-voice-mode]")).not.toBeNull();
    expect(container.querySelector("[data-composer-mic]")).not.toBeNull();
  });
});
