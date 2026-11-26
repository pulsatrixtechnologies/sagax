// @vitest-environment happy-dom
// The chat bar's one voice button (owner 2026-11-25, M-20261125-071,
// M-20261125-072, #5372): dictation and the voice conversation are one
// button. A click starts the mode kept; the mic is dictation, the waves the
// conversation; the arrow opens a menu that chooses between the two, then
// the microphone (with its live level) and the dictation's language. Both
// functions stay whole.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { COMPOSER_VOICE_MODE_KEY, DICTATION_LANGUAGE_KEY, readDictationLanguage, setComposerVoiceMode, setDictationLanguage } from "@/lib/composer-voice";
import { ComposerVoiceButton } from "./ComposerVoiceButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const dictate = vi.fn();
const call = vi.fn();
const mount = (props: Record<string, unknown> = {}) => act(() => root.render(createElement(ComposerVoiceButton, {
  dictation: createElement("button", { type: "button", "data-composer-mic": "xai", onClick: dictate }),
  conversation: createElement("button", { type: "button", "data-composer-voice": "", onClick: call }),
  engine: "xai",
  ...props,
} as never)));
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const click = (node: Element | null) => act(() => { (node as HTMLElement).click(); });
const openMenu = () => click($("[data-composer-voice-menu-toggle]"));

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  setComposerVoiceMode("dictation");
  setDictationLanguage("auto");
  dictate.mockReset();
  call.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the chat bar's voice button", () => {
  it("is one button: the mic for dictation by default, never the two side by side", () => {
    mount();
    const button = $("[data-composer-voice-button]")!;
    expect(button.dataset.mode).toBe("dictation");
    expect(button.querySelector("[data-composer-mic]")).not.toBeNull();
    expect(button.querySelector("[data-composer-voice]")).toBeNull();
    click(button.querySelector("[data-composer-mic]"));
    expect(dictate).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
  });

  it("its arrow opens a menu that chooses between Dictation and Voice conversation; the choice is kept and a click then starts it", () => {
    mount();
    openMenu();
    const rows = [...host.querySelectorAll<HTMLElement>("[data-voice-mode-row]")];
    expect(rows.map((row) => [row.dataset.voiceModeRow, row.textContent, row.getAttribute("aria-checked")])).toEqual([
      ["dictation", "Dictation", "true"],
      ["conversation", "Voice conversation", "false"],
    ]);
    click(rows[1]!);
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("conversation");
    const button = $("[data-composer-voice-button]")!;
    expect(button.dataset.mode).toBe("conversation");
    expect(button.querySelector("[data-composer-mic]")).toBeNull();
    click(button.querySelector("[data-composer-voice]"));
    expect(call).toHaveBeenCalledOnce();
    // kept from one time to the next
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    expect($("[data-composer-voice-button]")!.dataset.mode).toBe("conversation");
  });

  it("the menu then holds the microphone with its live level, and the dictation's language", () => {
    mount();
    openMenu();
    const menu = $("[data-composer-voice-menu]")!;
    expect(menu.querySelector("[data-voice-microphone]")).not.toBeNull();
    expect(menu.querySelector("[data-voice-microphone] [data-dictation-levels]")).not.toBeNull();
    expect(menu.querySelector('[data-voice-mic-row="default"]')?.getAttribute("aria-checked")).toBe("true");
    const language = menu.querySelector<HTMLSelectElement>("[data-voice-language] select")!;
    expect(language.value).toBe("auto");
    act(() => { language.value = "fr"; language.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(localStorage.getItem(DICTATION_LANGUAGE_KEY)).toBe("fr");
    expect(readDictationLanguage()).toBe("fr");
  });

  it("hides what cannot be: no mode choice where a conversation cannot start, no language under the Mac's own dictation", () => {
    setComposerVoiceMode("conversation");
    mount({ conversation: null, engine: "native" });
    expect($("[data-composer-voice-button]")!.dataset.mode).toBe("dictation");
    openMenu();
    expect(host.querySelector("[data-voice-mode-row]")).toBeNull();
    expect(host.querySelector("[data-voice-language]")).toBeNull();
    expect(host.querySelector("[data-voice-microphone]")).not.toBeNull();
    // the stored choice is not rewritten
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("conversation");
  });

  it("Escape and a press outside close the menu", () => {
    mount();
    openMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect($("[data-composer-voice-menu]")).toBeNull();
    openMenu();
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect($("[data-composer-voice-menu]")).toBeNull();
  });
});
