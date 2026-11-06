import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import en from "./en.json";

// The product words: the tenant is an "Organization" (US spelling, as in
// Admin), and one running Sagax is an "installation". A remote one saved
// in the desktop is a "server" and a bot's or task's directory is a "folder".
// "Workspace" survives only as Slack's own term, or another product's term.
const ALLOWED = new Set([
  "engines.account.apiKey", // the Anthropic Console's "workspace API key"
  "engineSetup.device.enableHint", // a ChatGPT "workspace admin"
  "serverEnvironment.help", // the /workspace folder path inside a server environment
  "serverEnvironment.reset.confirm", // the same /workspace path
  "orgComputer.confirmRunning", // the same /workspace path
  "sandboxDesktop.outdated", // the same /workspace path
  // Owner 2026-10-15 : the bot's work location is called Workspace
  "botPanel.access.browserOff",
  "botPanel.access.browserOffShort",
  "botWorkplace.help",
  "composer.plus.workspace",
  "computer.worksOn",
  "computer.worksOnPointer",
  "orgComputer.whereHelp",
  "orgComputer.why.notConnected",
  "orgComputer.worksOn",
  "place.fromBot",
  "place.offHint",
  "toolTarget.workingOn",
  // The bot wizard names the same work location.
  "botWizard.step.tools.intro",
  "botWizard.tools.questionHint",
  "botWizard.recap.tools.workspace",
  // Auto-model picker: the bot's work location is called Workspace.
  "model.auto.exclude.capabilities",
  // The claude_artifact copy prompt names the bot work location.
  "rich.claudeArtifact.copyPrompt",
  // Keys another branch adds with its own wording go here until reviewed.
]);

it("English copy says Organization and installation, not Organisation or workspace", () => {
  const offending = Object.entries(en)
    .filter(([key, value]) => !ALLOWED.has(key) && (/organis/i.test(value) || /(?<!Slack )\bworkspaces?\b/i.test(value)))
    .map(([key]) => key);
  expect(offending).toEqual([]);
});

// Copy that is hardcoded rather than in en.json: menus, native dialogs, errors
// and a few labels. Code identifiers, IPC channels, menu ids and error codes
// keep "workspace", so the guard names the retired phrases, not the word.
const HARDCODED = [
  "electron/environments.cjs", "electron/main.mjs", "electron/computer-sharing.mjs", "electron/shared-computer-access.mjs",
  "electron/company-backups.mjs", "electron/company-backup-schedule.mjs", "electron/managed-desktop.mjs", "electron/organization-entry.mjs",
  "src/components/DesktopWorkspaceSwitcher.tsx", "src/components/ConnectedWorkspacesSettings.tsx", "src/components/LocalVmWorkspace.tsx",
  "src/components/VoiceSettings.tsx", "src/components/bot-settings/AccessSection.tsx",
  "src/components/BrowserPanel.tsx", "src/lib/call-capability.ts", "server/computer/container-computer.ts",
];
const RETIRED = [
  // saved servers and the switcher
  "hosted workspace", "Switch workspace", "Could not open workspaces", "Your workspaces", "Workspace address", "Connect workspace",
  "load saved workspaces", "Saved workspaces", "Loading workspaces", "Switching workspaces", "workspace connection", "update workspaces",
  "HTTPS workspace address", "Workspace sign-in", "workspace pairing", "another workspace", "for this workspace", "with this workspace",
  "Connected workspaces", "Workspace controls", "`Workspace: ", "Workspace response", "Workspace request", "The selected workspace",
  "this workspace’s bots", "Bots from this workspace", "This workspace is no longer",
  // this installation, its backups and its admins
  "local workspace", "Local workspace", "workspace replacement", "Your workspace has", "The workspace changed", "The workspace could not",
  "entire workspace", "encrypted workspace backup", "when the workspace is", "Workspace default", "shared by the workspace", "workspace administrators",
  // folders and the two-desktop view
  "Private bot workspace", "durable workspace", "Local VM workspace", "two-desktop workspace", "desktop workspace bridge",
  "desktop workspace belongs", "desktop workspace is available", "The workspace stayed open",
  // US spelling
  "Organisation sign-in", "organisation sign-in", "your organisation", "an organisation", "organisation's Admin", "organisation connection",
];

it("hardcoded copy does not bring back the retired workspace and Organisation phrases", () => {
  const offending = HARDCODED.flatMap((file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    return RETIRED.filter((phrase) => source.includes(phrase)).map((phrase) => `${file}: ${phrase}`);
  });
  expect(offending).toEqual([]);
});

// Prefs: never em dash or en dash in UI / i18n. English and French are the
// reviewed catalogs; other packs may still be catching up.
const DASH = /[\u2013\u2014]/;
it("English and French UI catalogs have no em or en dashes", () => {
  const fr = JSON.parse(readFileSync(new URL("./fr.json", import.meta.url), "utf8")) as Record<string, string>;
  const offending = [
    ...Object.entries(en).filter(([, value]) => DASH.test(value)).map(([key]) => `en ${key}`),
    ...Object.entries(fr).filter(([, value]) => DASH.test(value)).map(([key]) => `fr ${key}`),
  ];
  expect(offending).toEqual([]);
});

// iOS String Catalogs (App + Widgets): keys and localized values.
it("iOS string catalogs have no em or en dashes", () => {
  const catalogs = [
    new URL("../../ios/App/Localizable.xcstrings", import.meta.url),
    new URL("../../ios/Widgets/Localizable.xcstrings", import.meta.url),
  ];
  const offending: string[] = [];
  for (const url of catalogs) {
    const raw = JSON.parse(readFileSync(url, "utf8")) as {
      strings?: Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>;
    };
    const label = url.pathname.includes("/Widgets/") ? "widgets" : "app";
    for (const [key, entry] of Object.entries(raw.strings ?? {})) {
      if (DASH.test(key)) offending.push(`${label} key: ${key.slice(0, 80)}`);
      for (const [lang, loc] of Object.entries(entry.localizations ?? {})) {
        const value = loc.stringUnit?.value ?? "";
        if (DASH.test(value)) offending.push(`${label} ${lang}: ${value.slice(0, 80)}`);
      }
    }
  }
  expect(offending).toEqual([]);
});

// Plugins (2026-10-30 Capabilities; renamed #2104): one name for the page that adds plugins, skills,
// MCP servers and connectors, and no text that points to a tab that is gone.
it("names the Plugins page and no retired tab", () => {
  const fr = JSON.parse(readFileSync(new URL("./fr.json", import.meta.url), "utf8")) as Record<string, string>;
  const retiredEn = [/Connect apps/i, /Connected apps/i, /Plugins →/, /Manage > Advanced/, /> Manage\b/, /Managed on Grok/, /under Plugins/];
  const retiredFr = [/Connecter des app/i, /Applications connectées/i, /plugiciel/i, /Gérer > Avancé/, /Géré dans Grok/];
  const offending = [
    ...Object.entries(en).filter(([, value]) => retiredEn.some((word) => word.test(value))).map(([key]) => `en ${key}`),
    ...Object.entries(fr).filter(([, value]) => retiredFr.some((word) => word.test(value))).map(([key]) => `fr ${key}`),
  ];
  expect(offending).toEqual([]);
});
