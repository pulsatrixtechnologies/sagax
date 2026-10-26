import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, BrowserProfile } from "@/state/store";

const fixture = vi.hoisted(() => ({ profiles: [] as BrowserProfile[], bots: [] as Bot[], member: false }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
  useStore: () => ({
    state: {
      config: fixture.member
        ? { browserProfiles: fixture.profiles, personalSettings: true, viewer: { role: "member" } }
        : { browserProfiles: fixture.profiles },
      bots: fixture.bots,
    },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { BrowserProfilesManager } from "./BrowserProfilesManager";

const bot = { id: "pepper", name: "Pepper", browserProfile: "work" } as Bot;
beforeEach(() => {
  fixture.member = false;
  fixture.profiles = [{ id: "work", name: "Work", partitionId: "LegacyWork" }];
  fixture.bots = [bot, { id: "scout", name: "Scout", browserProfile: "work" } as Bot];
});

describe("browser profile manager", () => {
  it("renders on the web without an Electron bridge and never exposes internal partition ids", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager));
    expect(html).toContain("Create profile");
    expect(html).toContain("Work");
    expect(html).toContain("used by Pepper, Scout");
    expect(html).not.toContain("LegacyWork");
    expect(html).toMatch(/<details[^>]*\bopen/);
  });

  it("offers own, shared and temporary sessions without changing the current selection", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain('value="">Own browser</option>');
    expect(html).toContain('value="work" selected="">Work</option>');
    expect(html).toContain('value="guest"');
    expect(html).toContain("Bots on a shared profile use the same logins.");
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    // Initial auth is unresolved: never offer active mutations until owner
    // scope has been checked, including on a self-hosted browser origin.
    expect(html.match(/<select[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("explains busy bot restrictions and deletion effects in accessible controls", () => {
    fixture.bots = [{ ...bot, busy: true }];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("Stop this bot&#x27;s turn before switching browser profiles.");
    expect(html).toContain('aria-label="Delete Work"');
    expect(html).toContain("Pepper is still running.");
    expect(html).toContain('maxLength="40"');
  });

  it("keeps a disappeared selection explicit instead of silently displaying another login", () => {
    fixture.profiles = [];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("This profile was removed.");
    expect(html).toContain('value="work" disabled="" selected=""');
    expect(html).toContain("Each bot still has its own browser.");
  });

  it("on an organization server, a member manages their own profiles and picks from theirs and the server's (#1098)", () => {
    fixture.member = true;
    fixture.profiles = [{ id: "work", name: "Work" }, { id: "mine-0123456789abcdef0123456789abcdef", name: "My bank", personal: true }];
    const manager = renderToStaticMarkup(createElement(BrowserProfilesManager));
    expect(manager).toContain("My bank");
    expect(manager).not.toContain("Work");
    const picker = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(picker).toContain(">My bank</option>");
    expect(picker).toContain(">Work</option>");
  });

  it("lists the bot's own browser's signed-in sites, and none for a temporary browser", () => {
    fixture.bots = [{ ...bot, browserProfile: undefined }];
    const own = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot: fixture.bots[0] }));
    expect(own).toContain("Signed-in sites");
    fixture.bots = [{ ...bot, browserProfile: "guest" }];
    const guest = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot: fixture.bots[0] }));
    expect(guest.match(/Signed-in sites/g)?.length ?? 0).toBeLessThan(own.match(/Signed-in sites/g)!.length);
  });
});
