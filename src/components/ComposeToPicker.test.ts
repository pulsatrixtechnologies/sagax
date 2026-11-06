import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type Bot, type ConfigStatus } from "@/state/store";
import { composeRows, splitPicked } from "./ComposeToPicker";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as Bot[], config: null as ConfigStatus | null, showThreads: true }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragStyle: undefined, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots, botCreationPending: false, config: fixture.config },
      dispatch: fixture.dispatch,
    }),
  };
});

import { ComposeToPicker } from "./ComposeToPicker";

function person(id: string, name: string, extra: Partial<Bot> = {}): Bot {
  return {
    id, threadId: id, name, title: "", description: "", notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
  };
}

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; "data-compose-action"?: string; "data-compose-bot"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

describe("ComposeToPicker", () => {
  it("lists create actions and own bots in the main column, not a dialog", () => {
    fixture.bots = [
      person("aurora", "Aurora"),
      person("hidden-bot", "Hidden", { hidden: true }),
      person("vendor", "Vendor", { ownerUserId: "someone-else" }),
    ];
    fixture.dispatch.mockReset();
    const close = vi.fn();
    let tree!: ReturnType<typeof ComposeToPicker>;
    const html = renderToStaticMarkup(createElement(() => { tree = ComposeToPicker({ onClose: close }); return tree; }));
    expect(html).toContain("To:");
    expect(html).toContain("Search or create Bots");
    expect(html).toContain("Create new Bot");
    expect(html).toContain("Create group chat");
    expect(html).toContain("Aurora");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Vendor");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("fixed inset-0");
    expect(html).toContain("data-compose-to");
    expect(html).toContain("pointer-events-none");
    expect(html).not.toContain("h-full min-w-0 flex-1 flex-col bg-app");
    const rendered = nodes(tree);
    rendered.find((node) => node.props["data-compose-action"] === "create-bot")?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newBot" });
    expect(close).toHaveBeenCalled();
    fixture.dispatch.mockReset();
    // #2092: no wizard row here any more (the wizard stays in New bot)
    expect(rendered.some((node) => node.props["data-compose-action"] === "create-bot-wizard")).toBe(false);
    rendered.find((node) => node.props["data-compose-bot"] === "aurora")?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "aurora" });
    expect(html).toContain("New thread");
    fixture.dispatch.mockReset();
    rendered.find((node) => node.props["data-compose-action"] === "create-group")?.props.onClick?.();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("has no Browse Bots row: the bots follow the two create rows and take shortcuts from 3", () => {
    fixture.bots = [person("aurora", "Aurora")];
    const html = renderToStaticMarkup(createElement(() => ComposeToPicker({ onClose: vi.fn() })));
    expect(html).not.toContain("Browse Bots");
    expect(html.indexOf("Create group chat")).toBeLessThan(html.indexOf("Aurora"));
    expect(html).toMatch(/Aurora<\/span>.*?<kbd[^>]*>.*?<span>3<\/span><\/kbd>/);
    // #2092: no wizard row; the guided wizard stays in New bot
    expect(html).not.toContain("wizard");
  });

  it("offers New bot only when the server says this viewer may create one, and lists the viewer's own bots by principal", () => {
    const member = "pr_0f0f0f0f-1111-4222-8333-444455556666";
    fixture.bots = [person("scout", "Scout", { ownerUserId: member }), person("ops", "Ops", { ownerUserId: "pr_other" })];
    const render = () => renderToStaticMarkup(createElement(() => ComposeToPicker({ onClose: vi.fn() })));
    fixture.config = { viewer: { operator: false, principalId: member, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true } } as ConfigStatus;
    let html = render();
    expect(html).toContain("Create new Bot");
    expect(html).toContain("Scout");
    expect(html).not.toContain("Ops");
    fixture.config = { viewer: { operator: false, principalId: "pr_guest", email: "", name: "", role: null, canCreateBots: false } } as ConfigStatus;
    html = render();
    expect(html).not.toContain("Create new Bot");
    expect(html).toContain("Create group chat");
    fixture.config = null;
    expect(render()).toContain("Create new Bot");
    expect(composeRows("browse", [], false).map((row) => row.kind)).toEqual(["create-group"]);
  });

  describe("with threads off (Settings > Appearance)", () => {
    const pick = (bot: Bot) => {
      fixture.bots = [bot];
      fixture.dispatch.mockReset();
      const close = vi.fn();
      let tree!: ReturnType<typeof ComposeToPicker>;
      const html = renderToStaticMarkup(createElement(() => { tree = ComposeToPicker({ onClose: close }); return tree; }));
      return { html, close, rendered: nodes(tree) };
    };
    afterEach(() => { fixture.showThreads = true; });

    it("opens the bot's existing conversation like the sidebar row, never a new thread", () => {
      fixture.showThreads = false;
      const { html, close, rendered } = pick(person("vega", "Vega", {
        threadId: "main",
        // "main" is the newest topic of the single stream, where the bot opens
        tasks: [{ threadId: "main", title: "Main", createdAt: 1, updatedAt: 50 }, { threadId: "older", title: "Older", createdAt: 0, updatedAt: 10 }],
      }));
      expect(html).toContain("Open chat");
      expect(html).not.toContain("New thread");
      rendered.find((node) => node.props["data-compose-bot"] === "vega")?.props.onClick?.();
      // "main" has been silent far longer than the threshold, so coming back
      // lands on a fresh topic drawn over it (#763, src/lib/fresh-topic.ts):
      // a draft on the client, never a thread on the server
      expect(fixture.dispatch.mock.calls).toEqual([
        [{ type: "select", id: "vega" }],
        [{ type: "freshTopic", botId: "vega", threadId: "main", auto: true }],
      ]);
      expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "newTask" }));
      expect(close).toHaveBeenCalled();
    });

    it("leads back to the latest conversation when the open thread is an untouched extra", () => {
      fixture.showThreads = false;
      const { rendered } = pick(person("vega", "Vega", {
        threadId: "extra",
        // an untouched thread outside the single stream (a New topic there is
        // the live topic and stays: src/lib/single-stream.test.ts)
        tasks: [{ threadId: "main", title: "Main", createdAt: 1, updatedAt: 50 }, { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60, confidential: true }],
      }));
      rendered.find((node) => node.props["data-compose-bot"] === "vega")?.props.onClick?.();
      expect(fixture.dispatch.mock.calls).toEqual([
        [{ type: "select", id: "vega" }],
        [{ type: "switchTask", botId: "vega", threadId: "main" }],
        // "main" is long silent: a fresh topic drawn over it (#763)
        [{ type: "freshTopic", botId: "vega", threadId: "main", auto: true }],
      ]);
      expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "newTask" }));
    });

    it("keeps Create group chat as the group entry", () => {
      fixture.showThreads = false;
      const { html, rendered } = pick(person("vega", "Vega"));
      expect(html).toContain("Create group chat");
      rendered.find((node) => node.props["data-compose-action"] === "create-group")?.props.onClick?.();
      expect(fixture.dispatch).not.toHaveBeenCalled();
      expect(composeRows("browse", [person("vega", "Vega")]).map((row) => row.kind)).toEqual(["create-bot", "create-group", "bot"]);
    });
  });

  it("puts the group confirm row ahead of the bots", () => {
    const bots = [person("a", "Ara"), person("b", "Liora")];
    expect(composeRows("browse", bots).map((row) => row.kind === "bot" ? row.bot.id : row.kind)).toEqual(["create-bot", "create-group", "a", "b"]);
    expect(composeRows("group", bots).map((row) => row.kind === "bot" ? row.bot.id : row.kind)).toEqual(["create-group", "a", "b"]);
    expect(initialState.newBotOpen).toBe(false);
  });
});

describe("group mode people (#1061)", () => {
  it("lists people beside bots and splits the picked set", () => {
    const person = { principalId: "usr_1", name: "Ada", login: "ada" } as never;
    expect(composeRows("group", [], true, [person]).map((row) => row.kind)).toEqual(["create-group", "person"]);
    expect(splitPicked(["aurora", "person:usr_1"])).toEqual({ memberIds: ["aurora"], humanIds: ["usr_1"] });
  });
});
