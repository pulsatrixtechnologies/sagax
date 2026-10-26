import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type Group } from "@/state/store";
import { applyPresenceList, resetPresence } from "@/lib/presence";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true, useThreadsLocationChoice: () => "header" }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/perspicax-org")>();
  const people = new Map([["pr_ada", { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member" as const, disabled: false, avatarUrl: "/api/people/pr_ada/avatar" }]]);
  return { ...original, useOrgPeople: () => people };
});

const { BotListItem, GroupListItem } = await import("./Sidebar");

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...overrides,
});
const dm: Group = {
  id: "dm-ada", threadId: "dm-thread", name: "Ada", memberIds: [], peopleDm: true,
  humanIds: ["local-owner", "pr_ada"], defaultResponder: { kind: "mentions" }, bulletin: "",
  unread: false, createdAt: 1, messages: [],
};
const inStore = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(StoreProvider, null, node));
const row = (candidate: Bot, density: "comfortable" | "compact" | "icons" = "comfortable") =>
  inStore(createElement(BotListItem, { bot: candidate, density, onMenu: vi.fn() }));

afterEach(() => resetPresence());

describe("a bot shared with the viewer", () => {
  it("wears the sharer's face on its avatar, named in the tooltip, never an id", () => {
    const markup = row(bot({ ownerUserId: "pr_ada" }));
    expect(markup).toContain("data-sidebar-sharer");
    expect(markup).toContain('title="Shared by Ada Lovelace"');
    expect(markup).toContain("/api/people/pr_ada/avatar");
    // the id appears only inside the picture's own URL, never as text, label or tooltip
    expect(markup.replaceAll("/api/people/pr_ada/avatar", "")).not.toContain("pr_ada");
  });

  it("is absent on the viewer's own bot and where the directory hides the owner", () => {
    expect(row(bot())).not.toContain("data-sidebar-sharer");
    expect(row(bot({ ownerUserId: "local-owner" }))).not.toContain("data-sidebar-sharer");
    expect(row(bot({ ownerUserId: "pr_stranger" }))).not.toContain("data-sidebar-sharer");
  });

  it("keeps the activity dot visible at the avatar's top-right, off the face, in every density", () => {
    for (const density of ["comfortable", "compact", "icons"] as const) {
      const markup = row(bot({ ownerUserId: "pr_ada", busy: true }), density);
      expect(markup, density).toContain("data-sidebar-sharer");
      expect(markup, density).toMatch(/data-testid="working-dot"[^>]*class="[^"]*-top-0\.5/);
    }
  });

  it("does not take room from the name: the face sits on the avatar and the name still truncates", () => {
    const markup = row(bot({ name: "A very long bot name that keeps going and going", ownerUserId: "pr_ada" }));
    expect(markup).toMatch(/data-sidebar-sharer[^>]*class="[^"]*absolute/);
    expect(markup).toContain("min-w-0 truncate");
  });
});

describe("activity status in the sidebar rows", () => {
  it("a bot's activity dot sits on its row's avatar, and a shared bot keeps it", () => {
    const busy = bot({ busy: true, ownerUserId: "pr_ada", tasks: [{ threadId: "thread-atlas", title: "Chat", createdAt: 1, busy: true }] });
    const markup = row(busy);
    expect(markup).toContain('data-testid="working-dot"');
    expect(markup).toContain("data-sidebar-sharer");
    expect(row(bot({ busy: true }))).toMatch(/data-testid="working-dot"[^>]*-bottom-0\.5/);
  });

  it("a person's presence dot sits on their row, and the rail's name carries it", () => {
    applyPresenceList([{ principalId: "pr_ada", state: "online", lastSeenAt: Date.now() }]);
    const comfortable = inStore(createElement(GroupListItem, { group: dm, density: "comfortable", onMenu: vi.fn() }));
    expect(comfortable).toContain('data-presence="online"');
    const rail = inStore(createElement(GroupListItem, { group: dm, density: "icons", onMenu: vi.fn() }));
    expect(rail).toMatch(/aria-label="[^"]*Online/);
  });
});
