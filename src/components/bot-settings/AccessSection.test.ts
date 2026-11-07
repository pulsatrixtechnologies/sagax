import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type ConfigStatus } from "@/state/store";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), mcpError: false, servers: null as null | Array<{ name: string; enabled: boolean }>, config: null as unknown, organization: false }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => (fixture.organization ? { org: { identity: { kind: "perspicax" } } } : null),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: fixture.config ?? original.initialState.config }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: fixture.servers, error: fixture.mcpError, refresh: vi.fn() }),
}));

// DesktopCapabilities reads `window.ogb` at module scope for its context
// default; the src test suite runs under vitest's "node" environment (no
// window), so it must be stubbed the same way SidebarBotListItem.test.ts does.
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: undefined } } }),
}));

const { AccessSection } = await import("./AccessSection");
const { SettingsSurfaceProvider } = await import("../SettingsPrimitives");

// WorkingFolder (moved into this file) reads window.ogb?.pickFolder directly
// at render time, same "node" environment gap as above: stub per test, the
// way desktop.test.ts and EngineUpdateNotice.test.ts do.
beforeEach(() => { vi.stubGlobal("window", {}); fixture.dispatch.mockReset(); fixture.mcpError = false; fixture.servers = null; fixture.config = null; fixture.organization = false; });
afterEach(() => vi.unstubAllGlobals());

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

function makeDerived(overrides: Partial<ReturnType<typeof useBotSettingsDerived>> = {}): ReturnType<typeof useBotSettingsDerived> {
  return {
    patch: vi.fn(),
    engine: undefined,
    canCoordinate: false,
    canUseVps: false,
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
    ...overrides,
  } as ReturnType<typeof useBotSettingsDerived>;
}

function render(bot: Bot, derived = makeDerived()) {
  return renderToStaticMarkup(
    createElement(StoreProvider, null, createElement(AccessSection, { bot, derived })),
  );
}

describe("an organization member", () => {
  it("hides the section when none of its fields can be saved", () => {
    const markup = render(makeBot(), makeDerived({ canEdit: () => false }));
    expect(markup).toBe("");
  });
});

describe("owner tool selection status", () => {
  it("distinguishes the legacy catalog from an explicit no-tools selection", () => {
    // #2092: one row per group with a readable status
    const legacy = render(makeBot());
    expect(legacy).toContain("Engine tools");
    expect(legacy).toMatch(/Engine tools<\/span><span[^>]*>All tools</);
    const empty = render(makeBot({ toolScope: { allow: [] } } as Partial<Bot>));
    expect(empty).toContain("No tools selected");
    expect(empty).toMatch(/Engine tools<\/span><span[^>]*>Off</);
    expect(empty).toContain("Existing approvals still apply");
  });

  it("shows corrupt saved restrictions as a blocked setup, never all tools", () => {
    const corrupt = render(makeBot({ toolScope: { allow: "native:*" } } as unknown as Partial<Bot>));
    expect(corrupt).toContain("Invalid saved selection. This bot cannot start until it is repaired.");
    expect(corrupt).toContain('role="alert"');
  });

  it("explains native restrictions that the selected engine cannot enforce", () => {
    const engine = { driverKind: "claudeAgent" } as NonNullable<ReturnType<typeof useBotSettingsDerived>["engine"]>;
    const markup = render(makeBot({ toolScope: { allow: ["native:read"] } } as Partial<Bot>), makeDerived({ engine }));
    expect(markup).toContain("This engine cannot limit native tools");
    expect(markup).toContain("native:*");
    expect(markup).toContain("will stop before sending a prompt");
  });

  it("keeps the selection editor disabled while a task is active", () => {
    const markup = render(makeBot({ busy: true }));
    // each group switch is disabled
    expect(markup).toMatch(/disabled=""[^>]*aria-label="Allow the tools of Engine tools"/);
    expect(markup).toContain("Wait until this bot finishes all active tasks before changing its tool selection.");
  });
});

describe("AccessSection always-allowed list", () => {
  it("keeps per-bot MCP changes disabled while any task is active", () => {
    fixture.servers = [{ name: "notes", enabled: true }, { name: "offline", enabled: false }];
    const markup = render(makeBot({ busy: true, mcpServers: ["notes"] }));
    expect(markup).toContain('disabled="" aria-label="Let this bot use Notes"');
    expect(markup).toContain('disabled="" aria-label="Let this bot use Offline"');
    expect(markup).toMatch(/<button type="button" disabled=""[^>]*>Use every enabled server<\/button>/);
    expect(markup).toContain("finishes all active tasks");
    expect(markup).toContain("Individual tool approvals depend on the model provider and approval mode.");
    const idle = render(makeBot({ mcpServers: ["notes"] }));
    expect(idle).not.toContain('disabled="" aria-label="Let this bot use Notes"');
    expect(idle).toContain('disabled="" aria-label="Let this bot use Offline"');
    expect(idle).not.toContain("finishes all active tasks");
  });

  it("offers a retry instead of a permanent MCP loading state after a read failure", () => {
    fixture.mcpError = true;
    fixture.servers = [{ name: "notes", enabled: true }];
    const markup = render(makeBot());
    expect(markup).toContain("Could not refresh MCP servers.");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('disabled="" aria-label="Let this bot use Notes"');
  });

  it("shows a placeholder when nothing is standing yet", () => {
    const markup = render(makeBot());
    expect(markup).toContain("Nothing allowed yet.");
  });

  it("lists each always-allowed entry with a Remove button", () => {
    const markup = render(makeBot({ alwaysAllow: ["shell.run", "fs.write"] }));
    expect(markup).toContain("shell.run");
    expect(markup).toContain("fs.write");
    expect(markup).toContain('aria-label="Remove shell.run from always allowed"');
    expect(markup).toContain('aria-label="Remove fs.write from always allowed"');
    expect(markup).not.toContain("Nothing standing yet.");
  });
});

describe("AccessSection Works on", () => {
  const places = (markup: string) => [...markup.matchAll(/>(Auto(?: \(Cloud\))?|Cloud computer|Cloud \(server environment\)|Local VM|This computer|Browser|Off)<\/button>/g)].map((match) => match[1]);
  const FLAGS = [{}, { boatComputer: true }, { vpsComputer: true }, { boatComputer: true, vpsComputer: true }];

  it("does not list Works on: that control is More > Computer", () => {
    expect(places(render(makeBot()))).toEqual([]);
    fixture.config = { cloudHome: true } as Partial<ConfigStatus>;
    expect(places(render(makeBot()))).toEqual([]);
    fixture.config = { features: { boatComputer: true } } as Partial<ConfigStatus>;
    expect(places(render(makeBot()))).toEqual([]);
    expect(render(makeBot())).not.toContain(">Workspace<");
  });

  it("has no Works on and no cloud backend on an organization server", () => {
    fixture.organization = true;
    for (const features of FLAGS) {
      fixture.config = { features } as Partial<ConfigStatus>;
      const markup = render(makeBot());
      expect(places(markup)).toEqual([]);
      expect(markup).not.toContain(">Workspace<");
      expect(markup).not.toContain("Cloud is your server environment.");
      expect(markup).not.toContain("Cloud backend");
    }
  });

  it("explains Auto and cloud computers on a solo server only when a cloud computer can be chosen", () => {
    expect(render(makeBot())).not.toContain("Auto and cloud computers.");
    expect(render(makeBot())).not.toContain("Cloud backend");
    fixture.config = { features: { boatComputer: true } } as Partial<ConfigStatus>;
    const markup = render(makeBot());
    expect(markup).toContain("Auto and cloud computers.");
    expect(markup).toContain("Cloud backend");
  });
});

// The bot's profile page (#2313): the reference look under the plain
// surface. Every card carries its own grey label, nothing is bordered,
// underlined or a primary pill, and "Manage in Plugins" shows once, as the
// MCP servers card's pill.
describe("AccessSection on the profile page (plain surface)", () => {
  const renderPlain = (bot: Bot, derived = makeDerived()) => renderToStaticMarkup(
    createElement(StoreProvider, null, createElement(SettingsSurfaceProvider, { surface: "plain", children: createElement(AccessSection, { bot, derived }) })),
  );
  // HelpTip popovers keep their own outline (a floating surface, not a card).
  const withoutPopovers = (markup: string) => markup.replace(/<div[^>]*popover-surface[\s\S]*?<\/div>/g, "");
  const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;

  it("has no border, no underline and no primary pill", () => {
    fixture.servers = [{ name: "notes", enabled: true }];
    fixture.config = { features: { boatComputer: true } } as Partial<ConfigStatus>;
    const markup = withoutPopovers(renderPlain(makeBot({ alwaysAllow: ["shell.run"] }), makeDerived({ browserSelectable: true })));
    expect(markup).not.toMatch(BORDER);
    expect(markup).not.toContain("underline");
    expect(markup).not.toContain("ui-button-primary");
  });

  it("labels every card with its grey label", () => {
    fixture.servers = [{ name: "notes", enabled: true }];
    fixture.config = { features: { boatComputer: true } } as Partial<ConfigStatus>;
    const markup = renderPlain(makeBot());
    for (const label of ["MCP servers", "Background brief", "Tool selection", "Webhooks", "Always allowed", "Working folder", "Cloud backend"]) {
      expect(markup).toContain(`>${label}<`);
    }
  });

  it("offers Manage in Plugins exactly once", () => {
    fixture.servers = [{ name: "notes", enabled: true }];
    const markup = renderPlain(makeBot({ mcpServers: ["notes"] }));
    expect(markup.match(/Manage in Plugins/g)).toHaveLength(1);
    expect(markup).toContain("Engine tools");
    expect(markup).toContain("Nothing allowed yet.");
  });
});
