import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: null as Partial<AppState> | null, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { GroupView } = await import("./GroupView");

afterEach(() => {
  fixture.state = null;
  vi.clearAllMocks();
});

const bot = (patch: Partial<Bot> = {}): Bot => ({
  id: "aleta", threadId: "t-aleta", name: "Aleta", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  ...patch,
});

const group = (patch: Partial<Group> = {}): Group => ({
  id: "room", threadId: "room-thread", name: "Job search", memberIds: ["aleta"],
  defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1,
  messages: [],
  ...patch,
});

const render = (members: Bot[], g: Group, extra: Partial<AppState> = {}) => {
  fixture.state = { bots: members, ...extra };
  return renderToStaticMarkup(createElement(GroupView, { group: g }));
};

describe("GroupView: computer/browser session visibility", () => {
  it("loads a screenshot message through the image route, matching the 1:1 ChatView", () => {
    const markup = render([bot()], group({
      messages: [{ id: "shot", role: "bot", kind: "screen", requested: true, hasImage: true, mime: "image/png", at: 1, from: { botId: "aleta", name: "Aleta", color: "green" } }] as Message[],
    }));
    expect(markup).toContain('src="/api/threads/room-thread/messages/shot/image"');
  });

  it("loads inline pixels through the image route too, never as a data URL", () => {
    const markup = render([bot()], group({
      messages: [{ id: "shot", role: "bot", kind: "screen", requested: true, png: "PRIVATE_BASE64_PIXELS", mime: "image/png", at: 1, from: { botId: "aleta", name: "Aleta", color: "green" } }] as Message[],
    }));
    expect(markup).toContain('src="/api/threads/room-thread/messages/shot/image"');
    expect(markup).not.toContain("PRIVATE_BASE64_PIXELS");
  });

  it("drops a screen message with no image, same as ChatView", () => {
    const markup = render([bot()], group({
      messages: [{ id: "shot", role: "bot", kind: "screen", at: 1, from: { botId: "aleta", name: "Aleta", color: "green" } }] as Message[],
    }));
    expect(markup).not.toContain("/messages/shot/image");
  });

  it("marks a busy member working a concrete place (e.g. browser) with that place's icon", () => {
    const markup = render([bot({ busy: true, computer: "browser" })], group({ busyBotId: "aleta", dm: true }));
    expect(markup).toMatch(/width="9"[^>]*height="9"/);
  });

  it("gives the place badge an accessible label naming the place", () => {
    const markup = render([bot({ busy: true, computer: "browser" })], group({ busyBotId: "aleta", dm: true }));
    expect(markup).toContain('aria-label="Where this conversation works: Browser"');
  });

  it("falls back to the plain working dot when the busy member's place is Auto", () => {
    const markup = render([bot({ busy: true })], group({ busyBotId: "aleta", dm: true }));
    expect(markup).not.toMatch(/width="9"[^>]*height="9"/);
  });

  it("shows no place badge at all for an idle member", () => {
    const markup = render([bot({ computer: "browser" })], group({ busyBotId: null }));
    expect(markup).not.toMatch(/width="9"[^>]*height="9"/);
  });

  it("hides tool-call chips on iOS even when the server flag is on", () => {
    const previous = globalThis.navigator;
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    const from = { botId: "aleta", name: "Aleta", color: "green" as const };
    try {
      const markup = render(
        [bot()],
        group({
          messages: [
            { id: "ok", role: "bot", kind: "activity", at: 1, tool: { name: "Read", ok: true }, from },
            { id: "run", role: "bot", kind: "activity", at: 2, tool: { name: "Bash" }, from },
            { id: "bad", role: "bot", kind: "activity", at: 3, tool: { name: "Write", ok: false }, from },
            { id: "notice", role: "bot", kind: "activity", at: 4, tool: { name: "notice: waiting on the model", ok: true }, from },
            { id: "err", role: "bot", kind: "activity", at: 5, tool: { name: "error: boom", ok: false }, from },
            { id: "comm", role: "bot", kind: "activity", at: 6, tool: { name: "Messaged @Ada" }, comm: { groupId: "g", withBotId: "ada", withName: "Ada", withColor: "teal" }, from },
            { id: "txt", role: "bot", kind: "text", at: 7, text: "hello there", from },
          ] as Message[],
        }),
        { config: { features: { showToolCalls: true } } as AppState["config"] },
      );
      expect(markup).not.toContain('data-testid="tool-activity"');
      expect(markup).not.toContain('data-mid="ok"');
      expect(markup).not.toContain('data-mid="run"');
      expect(markup).not.toContain('data-mid="bad"');
      expect(markup).toContain("waiting on the model");
      expect(markup).toContain("boom");
      expect(markup).toContain("Messaged @Ada");
      expect(markup).toContain("hello there");
    } finally {
      vi.stubGlobal("navigator", previous ?? { userAgent: "", maxTouchPoints: 0 });
    }
  });
});
