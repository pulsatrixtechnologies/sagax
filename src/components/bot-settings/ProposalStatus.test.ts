// Boundary marker: an owner-only group says it never arrives as a proposal.
// It hides when no other Chief covers the bot's section and in the draft
// editor. The removed Chief-proposable copy must stay out of every section.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { StoreProvider, api, type Bot } from "@/state/store";
import { BotEditorContext } from "./BotEditorContext";

const fixture = vi.hoisted(() => ({ bots: [] as Bot[], config: undefined as import("@/state/store").ConfigStatus | undefined }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots, config: fixture.config ?? original.initialState.config }, dispatch: vi.fn() }) };
});
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: undefined } } }),
}));
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: [] as Array<{ name: string; enabled: boolean }>, error: false, refresh: vi.fn() }),
}));

const { ProposalStatus } = await import("./ProposalStatus");
const { AccessSection } = await import("./AccessSection");
const { PermissionsSection } = await import("./PermissionsSection");
const { VisibilitySection } = await import("./VisibilitySection");

const CHIEF_COPY = "The Primary Bot can propose this";
// A lock after the section title; the sentence is its tooltip.
const OWNER_COPY = "Only the owner changes this";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Scout",
    title: "Scout",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function makeDerived(): ReturnType<typeof import("./useBotSettingsDerived").useBotSettingsDerived> {
  return {
    patch: vi.fn(),
    canEdit: () => true,
    engine: undefined,
    approvalMode: "ask",
    trustedModesAvailable: false,
    canCoordinate: false,
    canUseConnectedApps: true,
    canUseVps: false,
    connectedAppsConfigured: true,
    connectedAppsEnabled: true,
    connectorGrantState: "full",
    canUseBrowser: false,
    desktopBrowser: false,
    browserBlockedOnWindows: false,
    browserFeature: true,
    browserAllowed: true,
    browserEnabled: false,
    browserSelectable: false,
    browserDisabledReason: "The built-in browser needs the Sagax desktop app",
    sectionName: "General",
    currentChief: undefined,
    botRoutines: [],
    activeBotRoutines: 0,
    localSelectable: false,
    localDisabledReason: null,
    activeState: "idle",
    mascotMotion: null,
  } as ReturnType<typeof import("./useBotSettingsDerived").useBotSettingsDerived>;
}

function renderMarker(bot: Bot) {
  return renderToStaticMarkup(
    createElement(StoreProvider, null, createElement(ProposalStatus, { bot })),
  );
}

describe("ProposalStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    fixture.bots = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the owner-only marker when another bot is the section's Chief", () => {
    fixture.bots = [makeBot(), makeBot({ id: "chief-1", name: "Atlas", chiefOfStaff: true })];
    expect(renderMarker(makeBot())).toContain(OWNER_COPY);
  });

  it("hides the marker when no Chief covers the section", () => {
    fixture.bots = [makeBot()];
    expect(renderMarker(makeBot())).toBe("");
  });

  it("shows the marker when a Chief of another section manages this one", () => {
    fixture.bots = [
      makeBot({ section: "General" }),
      makeBot({ id: "chief-1", name: "Atlas", section: "Elsewhere", chiefOfStaff: true, managedSections: ["General"] }),
    ];
    expect(renderMarker(makeBot({ section: "General" }))).toContain(OWNER_COPY);
  });

  it("hides the marker for a Chief outside the section it does not manage", () => {
    fixture.bots = [
      makeBot({ section: "General" }),
      makeBot({ id: "chief-1", name: "Atlas", section: "Elsewhere", chiefOfStaff: true, managedSections: ["Other"] }),
    ];
    expect(renderMarker(makeBot({ section: "General" }))).toBe("");
  });

  it("hides the marker when the bot itself is the only Chief", () => {
    fixture.bots = [makeBot({ chiefOfStaff: true })];
    expect(renderMarker(makeBot())).toBe("");
  });

  it("hides the marker in the new-bot draft editor", () => {
    fixture.bots = [makeBot(), makeBot({ id: "chief-1", chiefOfStaff: true })];
    const markup = renderToStaticMarkup(createElement(
      BotEditorContext.Provider,
      { value: { request: api, draft: true } },
      createElement(ProposalStatus, { bot: makeBot() }),
    ));
    expect(markup).toBe("");
  });

  it("matches a Chief across section whitespace", () => {
    fixture.bots = [
      makeBot({ section: " General " }),
      makeBot({ id: "chief-1", section: "General", chiefOfStaff: true }),
    ];
    expect(renderMarker(makeBot({ section: " General " }))).toContain(OWNER_COPY);
  });
});

describe("Edit Profile boundary markers in sections", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    fixture.bots = [];
    fixture.config = undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks the Access groups: works-on owner-only, no Chief copy", () => {
    fixture.bots = [makeBot(), makeBot({ id: "chief-1", chiefOfStaff: true })];
    const markup = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(AccessSection, { bot: makeBot(), derived: makeDerived() })),
    );
    expect(markup).not.toContain(CHIEF_COPY);
    expect(markup).toMatch(/Browser<span role="img" data-proposal-owner=""[^>]*title="Only the owner changes this/);
    expect(markup).toContain("This server has no browser engine.");
  });

  it("shows no Access markers without a covering Chief", () => {
    fixture.bots = [makeBot()];
    const markup = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(AccessSection, { bot: makeBot(), derived: makeDerived() })),
    );
    expect(markup).not.toContain(CHIEF_COPY);
    expect(markup).not.toContain(OWNER_COPY);
  });

  it("leaves the visibility section without markers even when a Chief covers it", () => {
    fixture.bots = [makeBot(), makeBot({ id: "chief-1", chiefOfStaff: true })];
    const markup = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(VisibilitySection, { bot: makeBot() })),
    );
    expect(markup).not.toContain(CHIEF_COPY);
    expect(markup).not.toContain(OWNER_COPY);
  });

  it("marks the managed-teams group owner-only inside the Chief card", () => {
    fixture.bots = [makeBot({ chiefOfStaff: true }), makeBot({ id: "chief-1", chiefOfStaff: true })];
    const markup = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(PermissionsSection, { bot: makeBot({ chiefOfStaff: true }), derived: makeDerived() })),
    );
    expect(markup).not.toContain(CHIEF_COPY);
    expect(markup).toContain(OWNER_COPY);
  });

  it("shows no Permissions markers without a covering Chief", () => {
    fixture.bots = [makeBot({ chiefOfStaff: true })];
    const markup = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(PermissionsSection, { bot: makeBot({ chiefOfStaff: true }), derived: makeDerived() })),
    );
    expect(markup).not.toContain(CHIEF_COPY);
    expect(markup).not.toContain(OWNER_COPY);
  });

  it("a member manages their own bot's fields, the level without a lock (#1107, one approval level)", () => {
    const principal = "pr_00000000-0000-4000-8000-000000000002";
    fixture.config = { viewer: { operator: false, principalId: principal, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true } } as import("@/state/store").ConfigStatus;
    fixture.bots = [makeBot({ ownerUserId: principal, chiefOfStaff: true })];
    const own = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(PermissionsSection, { bot: makeBot({ ownerUserId: principal, chiefOfStaff: true }), derived: makeDerived() })),
    );
    expect(own).toContain("Primary Bot");
    // #1107 and the one approval level (2026-10-26): a member sets their own
    // bot's level, without a lock
    expect(own).toContain("Approval level");
    expect(own).not.toContain("data-level-org-lock");
    expect(own).toContain("Ask me before contacting other bots");
    const other = renderToStaticMarkup(
      createElement(StoreProvider, null, createElement(PermissionsSection, { bot: makeBot({ ownerUserId: "pr_other" }), derived: makeDerived() })),
    );
    expect(other).toBe("");
    fixture.config = undefined;
  });
});
