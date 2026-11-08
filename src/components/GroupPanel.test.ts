import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: null }, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
}));
vi.mock("./ExportTranscriptMenu", () => ({ ExportTranscriptMenu: () => null }));

import { GroupPanel } from "./GroupPanel";

const group = { id: "room", name: "Ops", bulletin: "Be brief.", memberIds: [], messages: [], defaultResponder: { kind: "auto" } } as unknown as Group;
const members: Bot[] = [];
const render = (props: Partial<Parameters<typeof GroupPanel>[0]>) =>
  renderToStaticMarkup(createElement(GroupPanel, { group, members, roster: null, advanced: null, canEdit: true, ...props }));

describe("group panel", () => {
  it("has no setup entry: every setting lives in its tabs", () => {
    const html = render({ advanced: createElement("p", null, "responder and folder") });
    expect(html).toContain('data-panel-tab="details"');
    expect(html).toContain('data-panel-tab="members"');
    // Instructions and Memory are hidden for now (GROUP_PANEL_HIDDEN_TABS).
    expect(html).not.toContain('data-panel-tab="instructions"');
    expect(html).not.toContain('data-panel-tab="memory"');
    expect(html).not.toContain("Set up group");
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("has no Advanced tab: those settings sit under Members", () => {
    expect(render({ advanced: createElement("p", null, "responder") })).not.toContain('data-panel-tab="advanced"');
    expect(render({ advanced: null })).not.toContain('data-panel-tab="advanced"');
  });

  it("says why it is read-only for someone who does not own the group", () => {
    const html = render({ canEdit: false, readOnlyNote: true });
    expect(html).toContain("Only the group&#x27;s owner can change these settings.");
    expect(html).not.toContain('id="group-name-room"');
  });

  it("edits the name in place for its owner, like a bot's, with the instructions behind the (i)", () => {
    const html = render({ canEdit: true });
    expect(html).toMatch(/<button[^>]*id="group-panel-title"[^>]*data-inline-edit="text"/);
    expect(html).not.toContain('id="group-name-room"');
    expect(html).toContain('data-description-info="button"');
    expect(html).toContain('title="Be brief."');
  });

  it("draws its tabs as the bot panel's pills, on one line", () => {
    const html = render({});
    expect(html).toMatch(/role="tablist"[^>]*class="mt-4 flex max-w-full items-center justify-center gap-1"/);
    expect(html).not.toMatch(/role="tablist"[^>]*flex-wrap/);
    // the selected pill is the sliding indicator (#2595), the bot panel's fill
    expect(html).toMatch(/data-panel-tab="details"[^>]*class="relative rounded-full px-3 py-\[3px\] text-\[14px\][^"]*text-ink"><span aria-hidden="true" data-tab-indicator="" class="[^"]*bg-raised"/);
  });

  it("keeps a long name inside the panel's margin, with the (i) beside it", () => {
    const html = render({ group: { ...group, name: "A very long group name, another person, a third one" } as Group });
    expect(html).toMatch(/data-group-panel-title-row=""[^>]*class="[^"]*w-full min-w-0 max-w-full/);
    expect(html).toMatch(/id="group-panel-title"[^>]*class="[^"]*min-w-0 shrink/);
  });

  it("shows the name as plain text to someone else", () => {
    const html = render({ canEdit: false });
    expect(html).toContain('<span id="group-panel-title"');
    expect(html).not.toContain('data-inline-edit="text"');
  });
});
