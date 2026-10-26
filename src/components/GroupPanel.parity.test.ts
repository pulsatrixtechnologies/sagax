// The group's right panel and the bot's right panel must read as one design
// (JC, 2026-10-21: "le panneau de droite d'un group chat doit respecter les
// memes criteres UX que le panneau du bot"). The panel shell, the resize
// handle, the header avatar (sized by #977), the name spacing and the tab
// body all come from the same primitives and carry the same classes. These
// read the sources and render the panel: the shared tokens are the contract.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Group } from "@/state/store";

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: null }, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ padClass: "", dragProps: {} }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
}));
vi.mock("./ExportTranscriptMenu", () => ({ ExportTranscriptMenu: () => null }));

import { GroupPanel } from "./GroupPanel";
import { ChannelMembers } from "./ChannelMembers";
import { botLabel } from "@/lib/human-label";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const groupPanel = read("./GroupPanel.tsx");
const botPanel = read("./BotSettingsDialog.tsx");

describe("group panel shell matches the bot panel", () => {
  it("uses the one shared docked-panel width hook and handle, not its own copy", () => {
    for (const source of [groupPanel, botPanel]) {
      expect(source).toMatch(/useDockedPanelWidth/);
      expect(source).toMatch(/DockedPanelResizeHandle/);
    }
    // No private width store left behind in the group panel.
    expect(groupPanel).not.toMatch(/SETTINGS_WIDTH_KEY/);
    expect(groupPanel).not.toMatch(/readSettingsWidth/);
    expect(groupPanel).not.toMatch(/role="separator"/);
  });

  it("marks its top bar as a window drag region, like the bot panel", () => {
    for (const source of [groupPanel, botPanel]) {
      expect(source).toMatch(/\{\.\.\.dragProps\}\s+className=\{cn\("content-topbar relative flex h-12 shrink-0/);
    }
  });

  it("makes its card the scroll container with the same classes as the bot panel", () => {
    const body = (source: string) => source.match(/className="(content-card-body [^"]*)"/)?.[1] ?? "";
    const groupBody = body(groupPanel).split(/\s+/);
    for (const c of ["flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "overflow-x-hidden"]) {
      expect(groupBody, c).toContain(c);
    }
    expect(body(groupPanel)).toContain("[&>*]:shrink-0");
  });
});

describe("group panel header matches the bot panel header", () => {
  it("draws the header avatar at the #977 size with the same top spacing", () => {
    expect(groupPanel).toMatch(/size=\{144\}/);
    expect(botPanel).toMatch(/BotProfileAvatarCard/);
    expect(groupPanel).toMatch(/pt-5/);
  });

  it("pulls the name up to the avatar the way #977 does on the bot", () => {
    expect(groupPanel).toMatch(/-mt-1 flex max-w-full items-center justify-center/);
    expect(botPanel).toMatch(/-mt-1 flex max-w-full items-center justify-center/);
  });

  it("gives the subtitle the bot label's typography", () => {
    expect(groupPanel).toMatch(/text-\[12\.5px\] leading-4/);
  });

  it("lays Details out with the same vertical rhythm as the bot panel", () => {
    expect(groupPanel).toMatch(/flex flex-col gap-6 px-4 pb-6 pt-2/);
    expect(botPanel).toMatch(/flex flex-col gap-6 px-4 pb-6 pt-2/);
  });
});

const group = { id: "room", name: "Ops", bulletin: "", memberIds: [], messages: [], defaultResponder: { kind: "auto" } } as unknown as Group;
const render = (props: Partial<Parameters<typeof GroupPanel>[0]>) =>
  renderToStaticMarkup(createElement(GroupPanel, { group, members: [], details: null, advanced: null, canEdit: true, ...props }));

describe("group panel renders the shared header", () => {
  it("sizes the group avatar box like the bot mascot (144)", () => {
    const html = render({});
    expect(html).toMatch(/width:144px/);
    expect(html).toMatch(/height:144px/);
  });

  it("keeps the subtitle on the bot label's size", () => {
    const html = render({});
    expect(html).toContain("text-[12.5px]");
  });

  it("shows a group with no members without crashing (empty state)", () => {
    expect(() => render({ members: [] })).not.toThrow();
  });
});

describe("group member rows never show a UUID", () => {
  const UUID = "b1c0ffee-dead-4bad-8caf-0123456789ab";

  it("names a bot whose name is gone, never its id", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [],
      bots: [{ id: UUID, name: botLabel(null, UUID) }],
      canAddHuman: false,
      canAddBot: false,
      part: "bots",
    }));
    expect(html).not.toContain(UUID);
    expect(html).toContain(botLabel(null, UUID));
  });

  it("shows a present bot by its name", () => {
    const html = renderToStaticMarkup(createElement(ChannelMembers, {
      humans: [],
      bots: [{ id: UUID, name: botLabel("Aurora", UUID), title: "Lead" }],
      canAddHuman: false,
      canAddBot: false,
      part: "bots",
    }));
    expect(html).toContain("Aurora");
    expect(html).toContain("Lead");
    expect(html).not.toContain(UUID);
  });
});
