// #2615: the mark after the name of the viewer's own bot that reaches someone
// else. "Shared with others" (two people) when the owner gave access to the
// bot; "Partially shared" (the second person dotted) when it only talks with
// someone in a group; Shared wins. Same mark on the pinned tiles; a bot of
// someone else's, or one in no group with a person, has none.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));

vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => false,
  useThreadsLocationChoice: () => "header" as const,
  useThreadsMode: () => "header" as const,
}));

import { setLocale } from "@/lib/i18n";
import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});
const group = (id: string, name: string, memberIds: string[], humanIds: string[]) =>
  ({ id, threadId: `g-${id}`, name, memberIds, humanIds, defaultResponder: { kind: "member", botId: memberIds[0] }, bulletin: "", unread: false, createdAt: 1, messages: [] }) as unknown as Group;

const render = () => renderToStaticMarkup(
  createElement(BotEditorStore, { value: { state: { ...initialState, ...fixture.state } as AppState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: createElement(Sidebar, { open: true, onClose: () => {} }) }),
);
const rowOf = (html: string, id: string) => {
  const at = html.indexOf(`data-sidebar-bot-row="${id}"`);
  const next = html.indexOf("data-sidebar-bot-row=", at + 10);
  return html.slice(at, next > 0 ? next : undefined);
};

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("share mark after a bot's name", () => {
  it("marks a shared bot, a bot in a group with a person, and nothing else", () => {
    fixture.state = {
      bots: [bot("atlas", { grants: [{ target: "user:alex", level: "use", by: "local-owner", at: 1 }] } as Partial<Bot>), bot("iris"), bot("nova"), bot("orion", { ownerUserId: "alex" })],
      groups: [group("g1", "Desk room", ["iris", "atlas"], ["sam@example.com"]), group("g2", "Bots only", ["nova"], []), group("g3", "Theirs", ["orion"], ["sam@example.com"])],
      sections: [],
    };
    const html = render();
    const atlas = rowOf(html, "atlas");
    expect(atlas).toContain('data-bot-share="shared"');
    expect(atlas).toContain('title="Shared with others"');
    const iris = rowOf(html, "iris");
    expect(iris).toContain('data-bot-share="partial"');
    expect(iris).toContain('title="Partially shared\nShared in Desk room"');
    expect(iris).toContain('stroke-dasharray="1 3.2"');
    expect(rowOf(html, "nova")).not.toContain("data-bot-share");
    expect(rowOf(html, "orion")).not.toContain("data-bot-share");
  });

  it("counts the groups when there are several, in French too", () => {
    fixture.state = { bots: [bot("iris")], groups: [group("g1", "A", ["iris"], ["sam@example.com"]), group("g2", "B", ["iris"], ["team:ops"])], sections: [] };
    expect(rowOf(render(), "iris")).toContain('title="Partially shared\nShared in 2 conversations"');
    setLocale("fr");
    expect(rowOf(render(), "iris")).toContain('title="Partiellement partagé\nPartagé dans 2 conversations"');
  });

  it("puts the same mark on a pinned tile", () => {
    fixture.state = { bots: [bot("iris", { pinned: true })], groups: [group("g1", "Desk room", ["iris"], ["sam@example.com"])], sections: [] };
    const html = render();
    const tile = html.slice(html.indexOf('data-sidebar-tile-labels=""'));
    expect(tile).toContain('data-bot-share="partial"');
  });
});
