// The bot's activity receipt speaks the person's language: the day headings
// ("Today", "Yesterday"), the outcome chips ("Ran", "Needs you") and the
// panel's own copy come from the locale packs, never English written in the
// component (parity adoption of OpenMausBot #3326, adapted: our botActivity
// keys, fr Quebec).
import { afterEach, describe, expect, it } from "vitest";

import { setLocale, t } from "./i18n";
import { groupActivityByDay, outcomeChip } from "./activity";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import type { ActivityRow } from "../../shared/activity";

const KEYS = [
  "botActivity.title", "botActivity.aria", "botActivity.reload", "botActivity.reloadAria",
  "botActivity.close", "botActivity.intro", "botActivity.loadError", "botActivity.empty",
  "botActivity.loading", "botActivity.inOtherTask", "botActivity.day.today", "botActivity.day.yesterday",
  "botActivity.outcome.ran", "botActivity.outcome.failed", "botActivity.outcome.running",
  "botActivity.outcome.allowed", "botActivity.outcome.denied", "botActivity.outcome.needsYou",
] as const;

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale("en"));

describe("the bot activity catalog", () => {
  it("carries every botActivity key in English and French, with matching placeholders and no em or en dash", () => {
    for (const key of KEYS) {
      expect(en, key).toHaveProperty(key);
      expect(fr, key).toHaveProperty(key);
      expect(placeholders((en as Record<string, string>)[key]!)).toEqual(placeholders((fr as Record<string, string>)[key]!));
      for (const value of [(en as Record<string, string>)[key]!, (fr as Record<string, string>)[key]!]) {
        expect(value.includes("—") || value.includes("–"), `${key}: ${value}`).toBe(false);
      }
    }
  });
});

describe("activity outcomes and day headings resolve through i18n", () => {
  it("are English by default", () => {
    expect(outcomeChip("ran")).toEqual({ text: "Ran", tone: "ok" });
    expect(outcomeChip("waiting")).toEqual({ text: "Needs you", tone: "warn" });
    const now = new Date("2026-10-22T12:00:00");
    const rows = [{ at: now.toISOString() }] as ActivityRow[];
    expect(groupActivityByDay(rows, now)[0]!.label).toBe("Today");
  });

  it("switch to French when the locale does", () => {
    setLocale("fr");
    expect(outcomeChip("ran").text).toBe("Exécuté");
    expect(outcomeChip("waiting").text).toBe("Votre attention");
    expect(outcomeChip("denied").text).toBe("Refusé");
    const now = new Date("2026-10-22T12:00:00");
    const yesterday = new Date("2026-10-21T12:00:00");
    expect(groupActivityByDay([{ at: now.toISOString() }] as ActivityRow[], now)[0]!.label).toBe("Aujourd'hui");
    expect(groupActivityByDay([{ at: yesterday.toISOString() }] as ActivityRow[], now)[0]!.label).toBe("Hier");
    expect(t("botActivity.intro", { name: "Olive" })).toContain("Olive");
  });
});
