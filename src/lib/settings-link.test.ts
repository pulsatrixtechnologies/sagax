import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { requestAbout } from "./about-ui";
import { currentSettingsSection, mergedSettingsCard, openModelKeysSettings, openSettings, settingsLinkParts, settingsSectionLabel } from "./settings-link";

vi.mock("./about-ui", () => ({ requestAbout: vi.fn() }));

describe("settings links", () => {
  beforeEach(() => {
    vi.mocked(requestAbout).mockClear();
  });

  it("names a section with the label Settings shows", () => {
    setLocale("en");
    expect(settingsSectionLabel("engines")).toBe("Models");
    expect(settingsSectionLabel("voice")).toBe("Voice");
    // a former page names the page that holds its card now
    expect(settingsSectionLabel("connectedApps")).toBe("Models");
    // Pair devices and Activity are hidden (2026-10-14), People, Installations
    // and Email (a card of People) too (2026-10-15): their old links open Account (General is out of the navigation, 2026-10-26)
    expect(settingsSectionLabel("mail")).toBe("Account");
    expect(settingsSectionLabel("people")).toBe("Account");
    expect(settingsSectionLabel("workspaces")).toBe("Account");
    expect(settingsSectionLabel("companion")).toBe("Account");
    expect(settingsSectionLabel("activity")).toBe("Account");
    // Security and Vault are pages again (2026-10-28); Published pages are in Capabilities
    expect(settingsSectionLabel("security")).toBe("Security");
    expect(settingsSectionLabel("credentials")).toBe("Vault");
    expect(settingsSectionLabel("pages")).toBe("Plugins");
    expect(settingsSectionLabel("experimental")).toBe("Developer");
    // #2090: Updates is its own page. 2026-11-06: the App page splits into
    // General and About (the owner 2026-11-07, was Help and about); Import lands on Backups and storage
    expect(settingsSectionLabel("about")).toBe("About");
    expect(settingsSectionLabel("general")).toBe("General");
    expect(settingsSectionLabel("updates")).toBe("Updates");
    expect(settingsSectionLabel("import")).toBe("Backups and storage");
    expect(settingsSectionLabel("backups")).toBe("Backups and storage");
    setLocale("fr");
    expect(settingsSectionLabel("engines")).toBe("Modèles");
    expect(settingsSectionLabel("voice")).toBe("Voix");
    expect(settingsSectionLabel("security")).toBe("Sécurité");
    expect(settingsSectionLabel("credentials")).toBe("Coffre");
    expect(settingsSectionLabel("privacy")).toBe("Notifications");
    expect(settingsSectionLabel("memory")).toBe("Organisation");
    expect(settingsSectionLabel("about")).toBe("À propos");
    expect(settingsSectionLabel("general")).toBe("Général");
    expect(settingsSectionLabel("backups")).toBe("Sauvegardes et stockage");
    setLocale("en");
  });

  // 2026-10-14: Integrations and Models and accounts are one page; an old
  // link to Integrations opens it. Decision model, Privacy and Memory became
  // cards of that page. Connected apps stays its own section.
  it("redirects an old section link to the page and card that hold it now", () => {
    // 2026-10-30: keys are on Providers; the online computers stay on Models
    // 2026-11-05: image generation and web search are Providers > Other services
    expect(currentSettingsSection("connections")).toBe("providers");
    expect(currentSettingsSection("connections", "connections.image")).toBe("providers");
    expect(currentSettingsSection("connections", "connections.webSearch")).toBe("providers");
    expect(currentSettingsSection("connections", "connections.integrations")).toBe("engines");
    expect(currentSettingsSection("engines", "engines.keys")).toBe("providers");
    // 2026-10-28: the voice card is on the Voice page
    expect(currentSettingsSection("connections", "connections.voice")).toBe("voice");
    expect(currentSettingsSection("connections", "connections.apps")).toBe("providers");
    expect(currentSettingsSection("connectedApps")).toBe("connectedApps");
    expect(currentSettingsSection("decisionModel")).toBe("engines");
    expect(currentSettingsSection("privacy")).toBe("notifications");
    expect(currentSettingsSection("memory")).toBe("organization");
    expect(currentSettingsSection("mail")).toBe("account");
    expect(currentSettingsSection("people")).toBe("account");
    expect(currentSettingsSection("workspaces")).toBe("account");
    expect(currentSettingsSection("companion")).toBe("account");
    expect(currentSettingsSection("activity")).toBe("account");
    // 2026-10-28: Security and Vault are pages again
    expect(currentSettingsSection("security")).toBe("security");
    expect(currentSettingsSection("credentials")).toBe("credentials");
    // 2026-11-06: General is the app's system page again; the cards the
    // old App page held go where a person looks for them
    expect(currentSettingsSection("general")).toBe("general");
    expect(currentSettingsSection("general", "general.threadCleanup")).toBe("developer"); // #2636
    expect(currentSettingsSection("general", "general.peopleToolAccess")).toBe("security");
    // #2636: the usage meter and diagnostics are technical options, on Developer
    expect(currentSettingsSection("general", "general.usage")).toBe("developer");
    expect(currentSettingsSection("general", "general.diagnostics")).toBe("developer");
    expect(currentSettingsSection("about", "about.startup")).toBe("general");
    expect(currentSettingsSection("about", "about.input")).toBe("general");
    expect(currentSettingsSection("about", "about.holding")).toBe("general");
    expect(currentSettingsSection("about", "about.help")).toBe("about");
    expect(mergedSettingsCard("security")).toBeUndefined();
    expect(mergedSettingsCard("credentials")).toBeUndefined();
    expect(currentSettingsSection("usage")).toBe("usage");
    expect(mergedSettingsCard("connectedApps")).toBeUndefined();
    expect(mergedSettingsCard("decisionModel")).toBe("engines.decisionModel");
    expect(mergedSettingsCard("privacy")).toBe("notifications.privacy");
    expect(mergedSettingsCard("memory")).toBe("organization.memory");
    expect(mergedSettingsCard("mail")).toBeUndefined();
    expect(mergedSettingsCard("general")).toBeUndefined();
    // deep links to the moved pages: Security and Vault, and Published pages in Capabilities
    const moved: unknown[] = [];
    openSettings((action) => moved.push(action), "security");
    openSettings((action) => moved.push(action), "credentials");
    openSettings((action) => moved.push(action), "pages");
    expect(moved).toEqual([
      { type: "toggleAppSettings", open: true, section: "security" },
      { type: "toggleAppSettings", open: true, section: "credentials" },
      { type: "togglePlugins", open: true, page: "pages" },
    ]);
    const sent: unknown[] = [];
    openSettings((action) => sent.push(action), "connections", "connections.apps");
    openSettings((action) => sent.push(action), "decisionModel");
    expect(sent).toEqual([
      { type: "toggleAppSettings", open: true, section: "providers" },
      { type: "toggleAppSettings", open: true, section: "engines" },
    ]);
  });

  // New bot's "no model works" button opens the list of keys (PR #478).
  it("opens Providers for a model that needs a key", () => {
    const sent: unknown[] = [];
    openModelKeysSettings((action) => sent.push(action));
    expect(sent).toEqual([{ type: "toggleAppSettings", open: true, section: "providers" }]);
  });

  it("opens the About modal instead of a Settings pane", () => {
    const sent: unknown[] = [];
    openSettings((action) => sent.push(action), "about");
    expect(sent).toEqual([]);
    expect(requestAbout).toHaveBeenCalledTimes(1);
  });

  it("splits a sentence on its settings placeholders", () => {
    expect(settingsLinkParts("Check the key in {settings}.")).toEqual([
      { kind: "text", text: "Check the key in " },
      { kind: "link", name: "settings" },
      { kind: "text", text: "." },
    ]);
    expect(settingsLinkParts("No pointer here.")).toEqual([{ kind: "text", text: "No pointer here." }]);
    expect(settingsLinkParts("the card in {apiKeys}. While off, {providers}.")).toEqual([
      { kind: "text", text: "the card in " },
      { kind: "link", name: "apiKeys" },
      { kind: "text", text: ". While off, " },
      { kind: "link", name: "providers" },
      { kind: "text", text: "." },
    ]);
  });
});
