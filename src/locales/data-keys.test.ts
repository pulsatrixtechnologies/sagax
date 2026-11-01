// The Data surface's strings have been rewritten twice (#2544, #2596) and
// each pass left keys behind. Every data.* key must still be read somewhere:
// as a literal t("data.…") or map value, or through a template on its parent
// (t(`data.view.${mode}`)).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import en from "./en.json";

const root = fileURLToPath(new URL("..", import.meta.url));
// Message keys are also named in shared/ (the organization capability form).
const sharedRoot = fileURLToPath(new URL("../../shared", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [readFileSync(path, "utf8")] : [];
  });
}

// One pass over the sources: every dotted name right after a quote, and
// every template prefix (`parent.${…}`). A lookup per key is then O(1) where
// `code.includes` per key was a scan of the whole tree, 11 000 times: over
// 20 s under load, which made the merge gate time out.
const read = (() => {
  let cached: { literals: Set<string>; prefixes: Set<string> } | null = null;
  return () => {
    if (cached) return cached;
    const literals = new Set<string>();
    const prefixes = new Set<string>();
    for (const code of [...sources(root), ...sources(sharedRoot)]) {
      for (const match of code.matchAll(/["'`](?=([\w][\w.-]{0,199})["'`])/g)) literals.add(match[1]!);
      for (const match of code.matchAll(/`([\w.-]+\.)\$\{/g)) prefixes.add(match[1]!);
    }
    cached = { literals, prefixes };
    return cached;
  };
})();

function isRead(key: string): boolean {
  const { literals, prefixes } = read();
  const dot = key.lastIndexOf(".");
  const parent = dot === -1 ? "" : key.slice(0, dot + 1);
  return literals.has(key) || (parent.length > 0 && prefixes.has(parent));
}

it("keeps no Data string that nothing reads", () => {
  const unread = Object.keys(en).filter((key) => key.startsWith("data.")).filter((key) => !isRead(key));
  expect(unread).toEqual([]);
});

// Families still being sorted (#1385). Every other family must be read as a
// literal t("…") or t('…'), or through a template on its parent.
const STILL_SORTING = new Set([
  "access", "achievements", "activity", "approval", "approvalMode", "apps", "attach", "attention",
  "backup", "botAccess", "botPanel", "botSettings", "botWizard", "botZip",
  "browser", "call", "canvas", "chat", "cloudSignIn", "code", "commandAllowlist", "composer", "computer",
  "connectApps", "connectors", "customRules", "cw", "devPods", "engines", "engineSetup", "floatingBots",
  "folder", "groupPanel", "keys", "leftOut", "manageMembers", "mascot", "mcp", "model",
  "myConnections", "myEngines", "newBot", "onboarding", "org", "organization", "orgComputer",
  "orgImport", "pair", "people", "persona", "personLabel", "place", "planUsage", "pro",
  "question", "releaseNotes", "remote", "remoteControl", "remoteSession", "remoteSessionsAdmin", "room",
  "routines", "serverEnvironment", "settings", "sidebar", "star", "step", "stream", "task", "teach",
  "team", "teamBotFromThread", "toolDetail", "triggers", "update", "usage", "vm", "voice", "voiceMode",
  "whop", "worksOn",
]);

it("keeps no catalog string that nothing reads, outside the families still being sorted", () => {
  const unread = Object.keys(en).filter((key) => !STILL_SORTING.has(key.split(".")[0])).filter((key) => !isRead(key));
  expect(unread).toEqual([]);
});
