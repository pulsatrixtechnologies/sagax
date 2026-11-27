// #2080 (L0, 2026-11-05): the contract of the Settings redesign, as a grep
// guard over src/components/settings/** and the Settings sections of
// src/components. A page draws the shared primitives and patterns
// (SettingsPrimitives, settings/SettingsPatterns) instead of its own:
// - no accent-coloured text on a link or a button (ExternalLinkPill, PILL);
// - no legacy Card (SettingsGroup, GROUP_CARD);
// - no hand-made "rounded-xl border" card;
// - no "{admin &&" variant (org rules are read-only for everyone, with no
//   shortcut to Perspicax since 2026-11-05; solo keeps its editable row).
//   A server setting only an admin can save (the GitHub OAuth App's client
//   id) is the one exception, listed in ADMIN_SERVER_SETTINGS.
// The pages not migrated yet (lots L1 to L4) are listed below; a file that no
// longer offends must leave its list, so the lists only shrink.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const SECTION_FILE = /^(SettingsModal|[A-Za-z]*Settings)\.tsx$/;
const FILES = [
  ...walk(join(components, "settings")),
  ...readdirSync(components).filter((name) => SECTION_FILE.test(name)).map((name) => join(components, name)),
]
  .filter((path) => path.endsWith(".tsx") && !path.includes(".test."))
  // the patterns are primitives: they hold the one sanctioned card border
  .filter((path) => !path.endsWith(join("settings", "SettingsPatterns.tsx")))
  .map((path) => relative(components, path).split("\\").join("/"));

const RULES = {
  accentLink: /<(a|button)\b[^>]*\btext-accent-text\b/s,
  cardImport: /import\s*(type\s*)?\{[^}]*\bCard\b[^}]*\}\s*from\s*["'][^"']*SettingsPrimitives["']/,
  roundedBorder: /rounded-xl border/,
  adminGate: /\{admin &&/,
} as const;
type Rule = keyof typeof RULES;

/** The pages not migrated yet, by rule. Remove a file once its lot lands. */
const NOT_MIGRATED: Record<Rule, string[]> = {
  accentLink: [],
  cardImport: [
    "settings/OrgSharing.tsx",
    "ComputerSharingSettings.tsx",
    "ConnectedWorkspacesSettings.tsx",
    "CustomDomainSettings.tsx",
    "MailSettings.tsx",
    "ServerModeSettings.tsx",
  ],
  roundedBorder: [
    "settings/OrgSharing.tsx",
    "settings/ProviderKeys.tsx",
    "ConnectedWorkspacesSettings.tsx",
    "LiveCallSettings.tsx",
  ],
  adminGate: [
    "settings/OrgSharing.tsx",
  ],
};

/** Server settings only an admin can save: drawn for admins, never a
 * read-only copy of an org rule. */
const ADMIN_SERVER_SETTINGS: Partial<Record<Rule, string[]>> = {
  adminGate: ["PerspicaxOrgSettings.tsx"],
};

const offenders = (rule: Rule) => FILES.filter((file) => RULES[rule].test(readFileSync(join(components, file), "utf8")));

describe("Settings contract", () => {
  it("scans the settings folder and the Settings sections", () => {
    expect(FILES).toContain("SettingsModal.tsx");
    expect(FILES).toContain("settings/ProvidersSettings.tsx");
    expect(FILES.length).toBeGreaterThan(40);
  });

  it.each(Object.keys(RULES) as Rule[])("%s: no page outside the not-migrated list breaks it", (rule) => {
    const found = offenders(rule);
    const allowed = [...NOT_MIGRATED[rule], ...(ADMIN_SERVER_SETTINGS[rule] ?? [])];
    expect(found.filter((file) => !allowed.includes(file)), rule).toEqual([]);
    // a migrated page leaves the list
    expect(NOT_MIGRATED[rule].filter((file) => !found.includes(file)), `${rule}: no longer offends, remove it`).toEqual([]);
  });

  it("the patterns draw no accent link and no admin variant", () => {
    const patterns = readFileSync(join(components, "settings", "SettingsPatterns.tsx"), "utf8");
    expect(RULES.accentLink.test(patterns)).toBe(false);
    expect(RULES.adminGate.test(patterns)).toBe(false);
  });
});

// #2080 (L0): one word, one page. A search keyword names one page of the rail;
// a card's own keywords (CARD_KEYWORDS) may repeat its page's.
describe("Settings search keywords", () => {
  it("names each keyword on one page only", async () => {
    const { SECTIONS } = await import("./settings-nav");
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const entry of SECTIONS) {
      for (const word of entry.keywords.map((keyword) => keyword.toLowerCase())) {
        const first = seen.get(word);
        if (first && first !== entry.id) twice.push(`${word}: ${first} and ${entry.id}`);
        else seen.set(word, entry.id);
      }
    }
    expect(twice).toEqual([]);
  });

  it("draws the seven pages of the rail (#4457), each with its intro line, no Grok Import card", async () => {
    const { SECTIONS, CARD_KEYWORDS, railSections } = await import("./settings-nav");
    expect(railSections(SECTIONS)).toHaveLength(7);
    expect(SECTIONS).toHaveLength(8); // and Organization, off the rail
    // Permissions keeps the id "security"; every other page its own intro line
    expect(SECTIONS.every((entry) => entry.introKey === `settings.intro.${entry.id}`)).toBe(true);
    expect(Object.keys(CARD_KEYWORDS)).toEqual(expect.arrayContaining(["about.help", "about.about", "general.system", "general.input", "general.interface"]));
    for (const gone of ["about.holding", "about.startup", "about.input", "backups.import", "about.updates"]) {
      expect(Object.keys(CARD_KEYWORDS), gone).not.toContain(gone);
    }
  });

  // 2026-11-06 (the owner: « un gros fourre-tout ») : the old App page split, each
  // option where a person looks for it; #4457 folds those pages into the
  // seven. Nothing lost: every option is found by search on its page and on
  // no other page.
  it("puts every option of the old App page on its own page, found by search there only", async () => {
    const { SECTIONS, sectionMatches } = await import("./settings-nav");
    const { CARD_HOME, settingsTarget } = await import("@/lib/settings-sections");
    const home: Record<string, string[]> = {
      // #2636 / M-20261127-068: technical options on General > Advanced; About stays on Updates
      general: ["open at login", "app icon", "hotkey", "hardware acceleration", "send key", "spellcheck", "stockage", "advanced mode", "scheduled update", "loop guard", "diagnostics", "download logs", "cleanup", "retention", "event log", "usage meter",
        // #2658: the bot page's technical cards and the Claude Code switches
        "webhooks", "export zip", "embeddings", "skills folder", "always allowed", "daily logs"],
      security: ["people's tool access"],
      updates: ["licence", "release notes", "tours", "send feedback"],
    };
    for (const [page, queries] of Object.entries(home)) {
      for (const query of queries) {
        const found = SECTIONS.filter((entry) => sectionMatches(entry, query)).map((entry) => entry.id);
        expect(found, query).toEqual([page]);
      }
    }
    const cards: Record<string, string> = {
      "general.system": "general", "general.input": "general", "general.interface": "general", "general.bots": "general",
      "about.about": "about", "about.help": "about", "general.feedback": "about",
      "general.peopleToolAccess": "security",
      // #2636: the technical cards are on Developer
      "general.loopGuard": "developer", "general.diagnostics": "developer", "general.logs": "developer",
      "general.threadCleanup": "developer", "general.usage": "developer",
      "developer.bot": "developer", "developer.claudeCode": "developer",
      // old links of the App page land on the page that holds the card now
      "about.startup": "general", "about.input": "general", "about.holding": "general",
    };
    for (const [card, page] of Object.entries(cards)) expect(CARD_HOME[card], card).toBe(page);
    // and where they open now (M-20261127-068: Advanced on General)
    expect(settingsTarget("general", "general.loopGuard")).toEqual({ section: "general", subPage: "general.advanced" });
    expect(settingsTarget("general", "about.help")).toEqual({ section: "updates", subPage: "updates.about" });
    expect(settingsTarget("general", "general.peopleToolAccess")).toEqual({ section: "security", subPage: "security.peopleToolAccess" });
  });
});
