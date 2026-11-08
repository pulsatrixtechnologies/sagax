import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import fr from "./fr.json";

// Product rule: the French button and every mention of it reads
// « Toujours permettre », never « Toujours autoriser ».
// Android's own USB debugging prompt keeps its system label.
const SYSTEM_LABELS = new Set(["computer.android.step3b", "computer.android.unauthorized"]);

it("fr: approval wording is Toujours permettre", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .filter(([key, value]) => !SYSTEM_LABELS.has(key) && value.includes("Toujours autoriser"))
    .map(([key]) => key);
  expect(bad).toEqual([]);
});

it("iOS fr: approval wording is Toujours permettre", () => {
  const xc = readFileSync(new URL("../../ios/App/Localizable.xcstrings", import.meta.url), "utf8");
  expect(xc.includes("Toujours autoriser")).toBe(false);
});
