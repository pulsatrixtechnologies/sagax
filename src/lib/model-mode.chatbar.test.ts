// The chat bar's modes on the desktop (owner 2026-11-25, M-20261125-073,
// M-20261125-075): Auto, Fast, Expert, Heavy. Build left the menu; a bot or
// a conversation still set on it reads as Auto. The chip under the message
// box names the mode, then the reasoning level in use (M-20261125-074).
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ModeResolution, ModelMode } from "../../shared/model-mode";
import { chatBarChipLabel, modeName, offeredModes, shownMode } from "./model-mode";

const pick = { instanceId: "grok", model: "grok-4.7", engineLabel: "Grok", modelLabel: "Grok 4.7" };
const all = (): Record<ModelMode, ModeResolution> => ({
  auto: { mode: "auto", pick }, fast: { mode: "fast", pick, effort: "low" }, expert: { mode: "expert", pick, effort: "high" },
  heavy: { mode: "heavy", pick, effort: "high" }, build: { mode: "build", pick },
});

beforeEach(() => setLocale("en"));

describe("the chat bar's modes", () => {
  it("offers Auto, Fast, Expert and Heavy, never Build, before and after the server answers", () => {
    expect(offeredModes(undefined)).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(offeredModes(all())).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(offeredModes({ ...all(), heavy: { mode: "heavy", pick: null } })).toEqual(["auto", "fast", "expert"]);
  });

  it("a selection still set on Build reads as Auto; the others read as they are", () => {
    expect(shownMode({ auto: true, mode: "build" })).toBe("auto");
    expect(shownMode({ auto: true, mode: "expert" })).toBe("expert");
    expect(shownMode({ auto: true })).toBe("auto");
    expect(shownMode({ auto: false })).toBeNull();
    expect(modeName("build")).toBe("Auto");
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
