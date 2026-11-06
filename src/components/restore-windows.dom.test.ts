// @vitest-environment happy-dom
// Restored centred windows (Edit bot, bulk edit, team bot, New bot wizard,
// Org import, Archived bots, Bot catalogue) open as dialogs.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => null,
  useOrgPeople: () => new Map(),
}));
vi.mock("./bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({
  useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn(), activeState: "idle", mascotMotion: null }),
}));
vi.mock("./bot-settings/OverviewSection", () => ({ OverviewSection: () => createElement("div", { "data-section-body": "overview" }) }));
vi.mock("./bot-settings/SoulSection", () => ({ SoulSection: () => null }));
vi.mock("./bot-settings/SkillsSection", () => ({ SkillsSection: () => null }));
vi.mock("./bot-settings/MemorySection", () => ({ MemorySection: () => null }));
vi.mock("./bot-settings/RulesSection", () => ({ RulesSection: () => null }));
vi.mock("./bot-settings/WorkspaceFilesSection", () => ({ WorkspaceFilesSection: () => null }));
vi.mock("./bot-settings/AccessSection", () => ({ AccessSection: () => null }));
vi.mock("./computer/WorksOnSetting", () => ({ WorksOnSetting: () => null }));
vi.mock("./bot-settings/ModelSection", () => ({ ModelSection: () => null }));
vi.mock("./bot-settings/PermissionsSection", () => ({ PermissionsSection: () => null }));
vi.mock("./bot-settings/VoiceSection", () => ({ VoiceSection: () => null }));
vi.mock("./bot-settings/SharingSection", () => ({ SharingSection: () => null }));
vi.mock("./bot-settings/VisibilitySection", () => ({ VisibilitySection: () => null }));
vi.mock("./bot-settings/HistorySection", () => ({ HistorySection: () => null }));
vi.mock("./bot-settings/BotAnalyticsSection", () => ({ BotAnalyticsSection: () => null }));
vi.mock("./BotProfileAvatarCard", () => ({ BotProfileAvatarCard: () => null }));
vi.mock("./appearance/AppearancePane", () => ({ AppearancePane: () => null }));
vi.mock("@/lib/mcp-servers", () => ({ useMcpServers: () => ({ servers: [] }), mcpServersForBot: () => [] }));
vi.mock("@/lib/bot-wizard", () => ({
  createDesignerBot: vi.fn(),
  createWizardBot: vi.fn(),
  deleteWizardDraft: vi.fn(),
  finishWizard: vi.fn(),
  guideBot: vi.fn(),
  listWizardDrafts: async () => [],
  openWizardThread: vi.fn(),
  patchWizardDraft: vi.fn(),
  pendingRules: () => [],
  readWizardDraft: vi.fn(),
  sendWizardMessage: vi.fn(),
  setSuggestedRule: vi.fn(),
  startWizardDraft: vi.fn(),
  wizardSuggestions: () => ({}),
}));
vi.mock("./lazy-new-bot", () => ({
  NewBotForm: () => createElement("div", { "data-stub-template": "form" }),
  NewBotDialog: () => null,
}));
vi.mock("./lazy-screens", () => ({
  NewBotDialog: Object.assign(() => null, { preload: async () => {} }),
  BotCatalogPane: Object.assign(() => null, { preload: async () => {} }),
}));
vi.mock("./BotZipImport", () => ({ BotZipImportPanel: () => null }));
vi.mock("./AgentImport", () => ({ AgentImportPanel: () => null, AgentImportSummary: () => null, packageFile: () => null }));
vi.mock("./bot-catalog/use-bot-catalog-sources", () => ({
  useBotCatalogSources: () => ({ entries: [], templates: [], loading: false, error: null, reload: () => {} }),
}));

const pepper = {
  id: "pepper",
  threadId: "t1",
  name: "Pepper",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  messages: [],
  tasks: [],
  soul: "",
  modelSelection: { instanceId: "claude", model: "opus" },
  hidden: false,
};

let storeState: Record<string, unknown> = {};
const dispatch = vi.fn();

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, ...storeState },
      dispatch,
      flushBotPatches: vi.fn(async () => null),
    }),
    api: vi.fn(async () => ({})),
  };
});

import { BulkEditBotsDialog } from "./BulkEditBotsDialog";
import { OrgImportDialog } from "./OrgImportDialog";
import { BotWizard } from "./bot-wizard/BotWizard";
import { BotCatalogModal } from "./bot-catalog/BotCatalogModal";
import { ArchivedBotsPanel } from "./Sidebar";

describe("restored windows open as dialogs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    dispatch.mockReset();
    storeState = {
      bots: [pepper],
      connected: true,
      config: { viewer: { principalId: "p-1", role: "owner", canCreateBots: true } },
      personaEditor: { botId: "pepper", section: "overview" },
      botWizard: { botId: null },
      botCatalogOpen: true,
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.querySelectorAll("[data-dialog-layer], [data-archived-bots-backdrop], [data-bot-wizard-screen], [data-bot-catalog-modal]").forEach((node) => node.remove());
  });

  it("bulk edit opens as a DialogLayer window", async () => {
    storeState = { ...storeState, personaEditor: null, botWizard: null, bots: [pepper] };
    await act(async () => {
      root.render(createElement(BulkEditBotsDialog, { botIds: ["pepper"], onClose: () => {} }));
    });
    const frame = document.querySelector('[data-bulk-edit][role="dialog"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[data-dialog-layer]")).not.toBeNull();
  });

  it("New bot wizard opens as a centred dialog", async () => {
    storeState = { ...storeState, personaEditor: null, botWizard: { botId: null } };
    await act(async () => { root.render(createElement(BotWizard)); });
    const dialog = document.querySelector('[data-bot-wizard][role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[data-bot-wizard-screen]")).not.toBeNull();
  });

  it("Org import opens as a DialogLayer window", async () => {
    storeState = { ...storeState, personaEditor: null, botWizard: null };
    await act(async () => {
      root.render(createElement(OrgImportDialog, { staged: null, onClose: () => {} }));
    });
    const frame = document.querySelector('[data-org-import][role="dialog"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("aria-modal")).toBe("true");
  });

  it("Archived bots opens as a dialog portal", async () => {
    const archived = { ...pepper, id: "old", name: "Old", hidden: true, color: "green" as const };
    storeState = { ...storeState, personaEditor: null, botWizard: null, bots: [archived] };
    await act(async () => {
      root.render(createElement(ArchivedBotsPanel, {
        bots: [archived as never],
        onClose: () => {},
        onRestored: () => {},
      }));
    });
    const dialog = document.querySelector('[data-archived-bots-panel][role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[data-archived-bots-backdrop]")).not.toBeNull();
  });

  it("Bot catalogue opens as a CATEGORY_MODAL dialog", async () => {
    storeState = { ...storeState, personaEditor: null, botWizard: null, botCatalogOpen: true };
    await act(async () => { root.render(createElement(BotCatalogModal)); });
    const dialog = document.querySelector('[data-bot-catalog-modal][role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });
});
