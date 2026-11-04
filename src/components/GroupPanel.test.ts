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
    expect(html).toContain('data-panel-tab="instructions"');
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

  it("shows the name as plain text to someone else", () => {
    const html = render({ canEdit: false });
    expect(html).toContain('<span id="group-panel-title"');
    expect(html).not.toContain('data-inline-edit="text"');
  });
});
