import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import fr from "./fr.json";

// Product rule: the French button and every mention of it reads
// « Toujours permettre » (« Toujours permis » once granted), never
// « Toujours autoriser » nor « Toujours autorisé ».
// Android's own USB debugging prompt keeps its system label.
const SYSTEM_LABELS = new Set(["computer.android.step3b", "computer.android.unauthorized"]);

it("fr: approval wording is Toujours permettre", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .filter(([key, value]) => !SYSTEM_LABELS.has(key) && /toujours autoris(?:er|é)/i.test(value) && !value.includes("pouvez toujours autoriser"))
    .map(([key]) => key);
  expect(bad).toEqual([]);
});

it("iOS fr: approval wording is Toujours permettre", () => {
  const xc = readFileSync(new URL("../../ios/App/Localizable.xcstrings", import.meta.url), "utf8");
  expect(/Toujours autoris(?:er|é)/i.test(xc)).toBe(false);
});

it("settings search keywords: toujours permis and toujours permettre", () => {
  const nav = readFileSync(new URL("../components/settings/settings-nav.ts", import.meta.url), "utf8");
  expect(nav).not.toMatch(/toujours autorisé/i);
  expect(nav).toContain("toujours permis");
  expect(nav).toContain("toujours permettre");
  const keywords = (fr as Record<string, string>)["settings.developer.botKeywords"];
  expect(keywords).toContain("toujours permis");
  expect(keywords).toContain("toujours permettre");
});
