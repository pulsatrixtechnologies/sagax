// @vitest-environment happy-dom
// Visible roles, batch 3 (2026-11-05): the role picked in the composer rides
// the next message of that thread only ("" = Moi), and a failed send puts it back.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";
import { pickRole, rolePick, takeRolePick } from "@/lib/role-pick";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [{ instanceId: "fake", driverKind: "claude", displayName: "Fake", capabilities: { agentsMcp: true, queueing: true } }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "nova", threadId: "nova-thread", name: "Nova", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("the composer's role pick", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => root.render(createElement(Composer, { bot })));
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    takeRolePick(bot.id, bot.threadId);
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const send = (text: string) => {
    flushSync(() => restoreComposerDraft(draftId, { text, attachments: [] }));
    const input = container.querySelector("textarea")!;
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  };
  const sends = () => fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "send");

  it("sends the pick with the next message only", () => {
    pickRole(bot.id, bot.threadId, "full-access");
    send("Ferme le billet");
    send("Et le suivant");
    expect(sends().map((action) => action.perspicaxRole)).toEqual(["full-access", undefined]);
    expect(rolePick(bot.id, bot.threadId)).toBeUndefined();
  });

  it("sends Moi as an empty slug, and nothing when nothing was picked", () => {
    send("Bonjour");
    pickRole(bot.id, bot.threadId, "");
    send("Comme moi");
    expect(sends().map((action) => "perspicaxRole" in action ? action.perspicaxRole : "absent")).toEqual(["absent", ""]);
  });

  it("puts the pick back when the send fails", () => {
    pickRole(bot.id, bot.threadId, "service-desk");
    send("Ferme le billet");
    flushSync(() => sends()[0].onError());
    expect(rolePick(bot.id, bot.threadId)).toBe("service-desk");
  });
});
