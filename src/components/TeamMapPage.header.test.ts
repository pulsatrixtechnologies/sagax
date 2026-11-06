// @vitest-environment happy-dom
// JC 2026-11-06: Team map's header is THE Tools page standard, through the
// shared PageHeader: icon, title, count, subtitle, then an outlined + Add.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ bots: [] as Bot[] }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }) };
});
const { TeamMapPage } = await import("./TeamMapPage");

const bot = (id: string): Bot => ({
  id, threadId: `${id}-chat`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  messages: [], modelSelection: { instanceId: "fake", model: "test" }, tasks: [{ threadId: `${id}-chat`, title: "Chat", createdAt: 1 }],
});

describe("TeamMapPage header", () => {
  it("renders the shared header: icon, title, count, subtitle, then an outlined + Add", () => {
    fixture.bots = [bot("atlas"), bot("scout")];
    const html = renderToStaticMarkup(createElement(TeamMapPage));
    const header = html.slice(html.indexOf("data-page-header"));
    expect(header).toMatch(/<h1 class="[^"]*text-\[17px\] font-semibold[^"]*">Team map<\/h1>/);
    expect(header).toMatch(/data-page-count=""[^>]*>2 bots</);
    expect(header).toMatch(/data-page-subtitle=""[^>]*>Your bots, their teams, and how they work together\.</);
    expect(header).toMatch(/data-page-actions=""/);
    expect(header).toContain("lucide-plus");
  });
});
