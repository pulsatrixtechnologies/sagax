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
    "settings/MyConnectionsSettings.tsx",
    "settings/OrgSharing.tsx",
    "CacheKeepWarmSettings.tsx",
    "ComputerSharingSettings.tsx",
    "ConnectedWorkspacesSettings.tsx",
    "CustomDomainSettings.tsx",
    "MailSettings.tsx",
    "ServerModeSettings.tsx",
  ],
  roundedBorder: [
    "settings/AccountCard.tsx",
    "settings/OrgSharing.tsx",
    "settings/OwnAvatarField.tsx",
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

  it("draws the pages of the final rail (Updates, Experimental and App), no Grok Import card", async () => {
    const { SECTIONS, CARD_KEYWORDS } = await import("./settings-nav");
    expect(SECTIONS).toHaveLength(15);
    // #2090 Updates + #2080 App (id about); every page has its intro line
    expect(SECTIONS.every((entry) => entry.introKey === `settings.intro.${entry.id}`)).toBe(true);
    expect(SECTIONS.find((entry) => entry.id === "about")?.introKey).toBe("settings.intro.about");
    expect(Object.keys(CARD_KEYWORDS)).toEqual(expect.arrayContaining(["about.help", "about.holding"]));
    expect(Object.keys(CARD_KEYWORDS)).not.toContain("backups.import");
    expect(Object.keys(CARD_KEYWORDS)).not.toContain("about.updates");
  });
});
