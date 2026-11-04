// #1382: one exported implementation per shared helper name across
// src/, shared/, server/ and electron/. Generated companion copies listed
// in ALLOWED stay; a second `export function <name>` elsewhere fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeApproval as sharedDescribeApproval, ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import { formatMemoryBytes } from "../../shared/format-bytes.ts";
import { parseOrgLibraryCatalog as sharedParseOrgLibraryCatalog } from "../../shared/org-library-catalog.ts";
import { generated as generatedOrgLibraryCatalog } from "../gen-electron-org-library-catalog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TREES = ["src", "shared", "server", "electron"] as const;

/** Canonical homes (and generated Electron copy). A new `export function`
 * with one of these names outside this list fails the guard. */
const ALLOWED: Record<string, readonly string[]> = {
  formatBytes: ["shared/format-bytes.ts"],
  describeApproval: [
    "shared/approval-describe.ts",
    // App locale binding: injects activeLocale/t, forwards to shared.
    "src/lib/approval-describe.ts",
  ],
  personLabel: ["src/lib/human-label.ts"],
  parseOrgLibraryCatalog: [
    "shared/org-library-catalog.ts",
    "electron/org-library-catalog.mjs",
  ],
  canonicalJson: ["shared/canonical-json.ts"],
  looksFrench: ["shared/looks-french.ts"],
};

const EXPORT_FUNCTION = (name: string) => new RegExp(String.raw`export\s+(?:async\s+)?function\s+${name}\b`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage" || name.startsWith(".")) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name) && !/\.test\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".node-test.mjs")) {
      out.push(path);
    }
  }
  return out;
}

function exportersOf(name: string): string[] {
  const pattern = EXPORT_FUNCTION(name);
  const found: string[] = [];
  for (const tree of TREES) {
    for (const file of walk(join(ROOT, tree))) {
      const text = readFileSync(file, "utf8");
      if (!pattern.test(text)) continue;
      found.push(relative(ROOT, file).replaceAll("\\", "/"));
    }
  }
  return found.sort();
}

describe("shared helpers stay unique (#1382)", () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    it(`${name} is exported as a function only from its home(s)`, () => {
      expect(exportersOf(name)).toEqual([...allowed].sort());
    });
  }
});

describe("formatBytes memory adapter matches shared formatMemoryBytes", () => {
  it("same inputs, same wording once memoryText words are supplied", () => {
    const words = {
      bytes: (count: number) => `${count} B`,
      kilobytes: (count: string) => `${count} KB`,
    };
    expect(formatMemoryBytes(120, "en", words)).toBe("120 B");
    expect(formatMemoryBytes(2_048, "en", words)).toBe("2 KB");
    expect(formatMemoryBytes(1536, "fr", words)).toBe("1,5 KB");
  });
});

describe("describeApproval app adapter matches shared with the same words", () => {
  it("same tool and input yield the same reading", async () => {
    const { describeApproval: appDescribeApproval, appWords } = await import("../../src/lib/approval-describe.ts");
    const { setLocale } = await import("../../src/lib/i18n.ts");
    setLocale("en");
    const now = new Date(2026, 9, 2, 12);
    for (const [tool, input] of [
      ["Read", "/etc/hosts"],
      ["Bash", "pnpm test"],
      ["Edit", "src/a.ts"],
    ] as const) {
      expect(appDescribeApproval(tool, input, undefined, now)).toEqual(
        sharedDescribeApproval(tool, input, undefined, now, appWords()),
      );
    }
    expect(ENGLISH_WORDS.locale).toBe("en");
  });
});

describe("personLabel needs differ (display name vs stored tag)", () => {
  it("human-label picks a readable candidate; the store accessor is a different need", async () => {
    const { personLabel } = await import("../../src/lib/human-label.ts");
    const { storedPersonLabel, resetPersonLabelsForTests } = await import("../../src/lib/person-labels.ts");
    const opaque = "11111111-1111-4111-8111-111111111111";
    resetPersonLabelsForTests({ [opaque]: "CTO" });
    expect(personLabel("Ada Lovelace", opaque)).toBe("Ada Lovelace");
    expect(personLabel(undefined, opaque)).toBe("Unknown person");
    expect(storedPersonLabel(opaque)).toBe("CTO");
    expect(storedPersonLabel("pr_missing")).toBe("");
    // Same principal id, different contracts: two names.
    expect(personLabel("Ada", opaque)).not.toBe(storedPersonLabel(opaque));
  });
});

describe("parseOrgLibraryCatalog electron copy matches shared", () => {
  it("generated electron/org-library-catalog.mjs equals the strip of shared/", () => {
    const copy = readFileSync(join(ROOT, "electron/org-library-catalog.mjs"), "utf8");
    expect(copy).toBe(generatedOrgLibraryCatalog());
  });

  it("shared and electron parsers agree on a minimal catalog", async () => {
    const electron = await import("../../electron/org-library-catalog.mjs");
    const catalog = {
      format: "openmaus.org-library",
      version: 1,
      libraryVersion: 1,
      organization: { id: "11111111-1111-4111-8111-111111111111", name: "Osprey" },
      packages: [],
    };
    expect(sharedParseOrgLibraryCatalog(catalog)).toEqual(electron.parseOrgLibraryCatalog(catalog));
    expect(sharedParseOrgLibraryCatalog(JSON.stringify(catalog))).toEqual(
      electron.parseOrgLibraryCatalog(JSON.stringify(catalog)),
    );
  });
});
