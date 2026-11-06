// The bot panel's Routines list with folders (2026-10-28): routines in no
// folder first, then each folder as a folding header with its count, in the
// bot's order; a folded folder hides its rows; the Sort by prefix offer only
// when titles have a [Prefix] and only until it is answered; the schedule
// and the switch stay on every row.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { Routine } from "@/lib/routines";

const store = { routineFolders: {} as Record<string, string[]> };
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { routinesLoadState: "ready", routineFolders: store.routineFolders }, dispatch: vi.fn() }),
}));

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
});
afterEach(() => { memory.clear(); store.routineFolders = {}; });

const { RoutineFolderList } = await import("./RoutineFolders");

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] } as unknown as Bot;
const routine = (id: string, name: string, folder?: string, enabled = true): Routine => ({
  id, name, ...(folder ? { folder } : {}), prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
});
const render = (routines: Routine[]) => renderToStaticMarkup(createElement(RoutineFolderList, {
  bot, routines, runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {},
}));

describe("RoutineFolderList", () => {
  it("shows routines in no folder first, then the folders in the bot's order with their count", () => {
    store.routineFolders = { "bot-1": ["Team", "Reports", "Empty"] };
    const html = render([routine("a", "Loose one"), routine("b", "Morning summary", "Reports"), routine("c", "Weekly numbers", "Reports"), routine("d", "Stand-up notes", "Team", false)]);
    const at = (text: string) => html.indexOf(text);
    expect(at("Loose one")).toBeLessThan(at('data-routine-folder-header="Team"'));
    expect(at('data-routine-folder-header="Team"')).toBeLessThan(at('data-routine-folder-header="Reports"'));
    expect(at('data-routine-folder-header="Reports"')).toBeLessThan(at('data-routine-folder-header="Empty"'));
    expect(html).toContain('data-routine-folder-count="2"');
    expect(html).toContain('aria-expanded="true"');
    // An empty folder stays, to be filled from its +.
    expect(html).toContain("data-routine-folder-empty");
    // A folder whose routines are all off says so in its header.
    expect(html).toContain("data-routine-folder-paused");
    // Nothing is taken away: every row keeps its schedule and its switch.
    expect(html.match(/data-routine-when=/g)).toHaveLength(4);
    expect(html.match(/role="switch"/g)?.length ?? html.match(/aria-checked/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("a folded folder keeps its header and count and hides its rows, per bot", () => {
    store.routineFolders = { "bot-1": ["Reports"] };
    memory.set("sagax.routineFolders.collapsed.v1", JSON.stringify({ "bot-1": ["reports"] }));
    const html = render([routine("b", "Morning summary", "Reports")]);
    expect(html).toContain('data-routine-folder-header="Reports"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Morning summary");
  });

  it("offers Sort by prefix only when titles start with [X], and never again once answered", () => {
    expect(render([routine("a", "[Reports] Morning summary")])).toContain("data-routine-prefix-offer");
    expect(render([routine("a", "Morning summary")])).not.toContain("data-routine-prefix-offer");
    memory.set("sagax.routineFolders.prefixOffer.v1", JSON.stringify({ "bot-1": true }));
    expect(render([routine("a", "[Reports] Morning summary")])).not.toContain("data-routine-prefix-offer");
  });

  it("without any folder the list is the list as it was: no header, no offer", () => {
    const html = render([routine("a", "Morning summary"), routine("b", "Weekly numbers")]);
    expect(html).not.toContain("data-routine-folder-header");
    expect(html).not.toContain("data-routine-prefix-offer");
  });

  // #2174: the bot panel's Upcoming card is one flat list (folder as title
  // prefix), never the folding category cards of the Routines page.
  it("with leadingClock flattens folders into one card with category prefixes", () => {
    store.routineFolders = { "bot-1": ["Home lab", "Security"] };
    const html = renderToStaticMarkup(createElement(RoutineFolderList, {
      bot, routines: [
        routine("a", "Nightly check", "Home lab"),
        routine("b", "Port scan", "Security"),
        routine("c", "Loose one"),
        routine("d", "Backup", "Home lab"),
        routine("e", "Patch", "Security"),
        routine("f", "Digest", "Home lab"),
      ], runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {},
      leadingClock: true, collapseAfter: 5,
    }));
    expect(html).toContain("data-routine-upcoming-flat");
    expect(html).not.toContain("data-routine-folder-header");
    expect(html).not.toContain("data-routine-prefix-offer");
    expect(html).toContain("[Home lab] Nightly check");
    expect(html).toContain("[Security] Patch");
    expect(html).toContain("Loose one");
    // Port scan sorts after the fifth row; Show more holds it.
    expect(html).not.toContain("[Security] Port scan");
    expect(html.match(/data-routine-row[ =>]/g)).toHaveLength(5);
    expect(html).toContain("Show more");
  });
});
