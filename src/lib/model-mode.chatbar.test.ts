// The chat bar's modes on the desktop (owner 2026-11-25, M-20261125-073,
// M-20261125-075): Auto, Fast, Expert, Heavy. Build left the menu; a bot or
// a conversation still set on it reads as Auto. The chip under the message
// box names the mode, then the reasoning level in use (M-20261125-074).
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { resetTime } from "@/lib/limit-resets";
import type { ModeResolution, ModelMode } from "../../shared/model-mode";
import { chatBarChipLabel, modeModelsLine, modeTooltip, offeredModes, shownMode } from "./model-mode";

const pick = { instanceId: "grok", model: "grok-4.7", engineLabel: "Grok", modelLabel: "Grok 4.7" };
const all = (): Record<ModelMode, ModeResolution> => ({
  auto: { mode: "auto", pick }, fast: { mode: "fast", pick, effort: "low" }, expert: { mode: "expert", pick, effort: "high" },
  heavy: { mode: "heavy", pick, effort: "high" },
});
/** What a server from before D-20261126-005 still answers. */
const withBuild = () => ({ ...all(), build: { mode: "build", pick } }) as unknown as Record<ModelMode, ModeResolution>;

beforeEach(() => setLocale("en"));

describe("the chat bar's modes", () => {
  it("offers Auto, Fast, Expert and Heavy, never Build, before and after the server answers", () => {
    expect(offeredModes(undefined)).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(offeredModes(all())).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(offeredModes(withBuild())).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(offeredModes({ ...all(), heavy: { mode: "heavy", pick: null } })).toEqual(["auto", "fast", "expert"]);
  });

  it("a selection still set on Build reads as Auto; the others read as they are", () => {
    expect(shownMode({ auto: true, mode: "build" } as never)).toBe("auto");
    expect(shownMode({ auto: true, mode: "expert" })).toBe("expert");
    expect(shownMode({ auto: true })).toBe("auto");
    expect(shownMode({})).toBeNull();
  });

  it("the chip names the mode, then the reasoning level in use", () => {
    expect(chatBarChipLabel("expert", "high")).toBe("Expert · High");
    expect(chatBarChipLabel("fast", "low")).toBe("Fast · Low");
    // Auto reads alone until the person chooses a level (D-20261124-022)
    expect(chatBarChipLabel("auto", undefined)).toBe("Auto");
    expect(chatBarChipLabel("auto", "medium")).toBe("Auto · Medium");
    // a mode whose level is not known yet reads alone, never a guessed level
    expect(chatBarChipLabel("heavy", undefined)).toBe("Heavy");
  });
});

// M-20261126-101 (review M1): with every account at its usage limit a mode's
// tooltip names no model: it says none can be used now, and when one is back.
describe("a mode's tooltip when every account is at its limit", () => {
  const now = Date.parse("2026-11-26T15:00:00");
  const until = Date.parse("2026-11-26T20:40:00");
  const limited = (mode: "auto" | "fast" | "expert" | "heavy"): ModeResolution => ({ mode, pick: null, limited: { until } });
  const all = { auto: limited("auto"), fast: limited("fast"), expert: limited("expert"), heavy: limited("heavy") };

  it("names no model, says none can be used and when one is back", () => {
    for (const mode of ["fast", "expert", "heavy", "auto"] as const) {
      const line = modeModelsLine(mode, all[mode], now);
      expect(line).toBe(`${t("model.cascade.none")} · ${t("limits.resets", { time: resetTime(until, now) })}`);
      expect(modeTooltip(mode, all[mode], now)).toContain(line!);
    }
    // no reset known: the plain sentence alone
    expect(modeModelsLine("heavy", { mode: "heavy", pick: null, limited: { until: null } }, now)).toBe(t("model.cascade.none"));
  });

  it("keeps every mode in the menu: the turn still runs and its refusal says when", () => {
    expect(offeredModes(all)).toEqual(["auto", "fast", "expert", "heavy"]);
    // a mode with nothing usable and no limit is still not offered
    expect(offeredModes({ ...all, heavy: { mode: "heavy", pick: null } })).toEqual(["auto", "fast", "expert"]);
  });
});
