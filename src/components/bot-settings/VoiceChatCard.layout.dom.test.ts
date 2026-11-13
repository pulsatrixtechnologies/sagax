// @vitest-environment happy-dom
// #4194: in the bot panel's Voice chat card a row's label is never cut before
// its control. The label keeps its whole word (it never shrinks) and the pill
// select gives way instead: every box from the row down to the pill's text may
// shrink (min-width 0, no shrink-0) and the text ends with an ellipsis. One row
// component draws Voice, Speed and Language, so the rule holds for all three.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { VoiceChatCard } from "./VoiceChatCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

function render() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const bot = { id: "osprey", name: "Osprey", voiceSpeed: 1, voiceLanguage: "auto" } as unknown as Bot;
  act(() => root!.render(createElement(VoiceChatCard, { bot, onPatch: () => {} })));
  return host;
}

const classes = (element: Element) => new Set((element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

describe("Voice chat card rows (#4194)", () => {
  it("draws the three rows with one row component", () => {
    const rows = [...render().querySelectorAll("[data-voice-chat-row]")];
    expect(rows.map((row) => row.getAttribute("aria-label"))).toHaveLength(3);
  });

  it("never lets a row's label shrink or truncate", () => {
    for (const row of render().querySelectorAll("[data-voice-chat-row]")) {
      const label = row.querySelector("[data-voice-chat-label]")!;
      expect(label, "label").toBeTruthy();
      const set = classes(label);
      expect(set.has("shrink-0"), `label of ${row.getAttribute("aria-label")} keeps its width`).toBe(true);
      expect(set.has("whitespace-nowrap")).toBe(true);
      expect(set.has("truncate")).toBe(false);
      expect(set.has("min-w-0")).toBe(false);
    }
  });

  it("lets the select give way: every box from the row to the pill's text may shrink, the text ends with an ellipsis", () => {
    for (const row of render().querySelectorAll("[data-voice-chat-row]")) {
      const trigger = row.querySelector("[data-pill-select]")!;
      const text = trigger.querySelector("span")!;
      expect(classes(text).has("truncate")).toBe(true);
      // the chain of flex items between the row and the pill's text
      for (let node: Element | null = text; node && node !== row; node = node.parentElement) {
        const set = classes(node);
        expect(set.has("min-w-0"), `${node.tagName.toLowerCase()} [${[...set].join(" ")}] in ${row.getAttribute("aria-label")} can shrink`).toBe(true);
        expect(set.has("shrink-0"), `${node.tagName.toLowerCase()} [${[...set].join(" ")}] does not refuse to shrink`).toBe(false);
      }
    }
  });
});
