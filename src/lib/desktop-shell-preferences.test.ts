// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { botHotkeyModifierChoice, installDesktopShellPreferences } from "./desktop-shell-preferences";

afterEach(() => {
  localStorage.clear();
});

function shell(kept: { botHotkeyModifier?: "cmd-shift" | "cmd-alt" | "ctrl-alt" }) {
  const set = vi.fn(async () => null);
  window.ogb = {
    shellPreferences: {
      get: () => ({ hardwareAcceleration: true, spellcheck: true, botHotkeys: true, ...kept }),
      set,
    },
  } as unknown as NonNullable<Window["ogb"]>;
  return set;
}

describe("desktop shell shortcut chord", () => {
  it("keeps the chord already chosen on this computer and hands it to the shell", () => {
    localStorage.setItem("sagax.botHotkeyModifier.v1", "ctrl-alt");
    const set = shell({ botHotkeyModifier: "cmd-alt" });
    const stop = installDesktopShellPreferences();
    expect(botHotkeyModifierChoice.get()).toBe("ctrl-alt");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ botHotkeyModifier: "ctrl-alt" }));
    stop();
  });

  it("adopts the shell's chord when this computer has none", () => {
    const set = shell({ botHotkeyModifier: "cmd-alt" });
    const stop = installDesktopShellPreferences();
    expect(botHotkeyModifierChoice.get()).toBe("cmd-alt");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ botHotkeyModifier: "cmd-alt" }));
    stop();
  });
});
