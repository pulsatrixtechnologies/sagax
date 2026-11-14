// @vitest-environment happy-dom
// #4329 (lot 3): the settings under the chat bar's model list. The effort is
// one line, "Thinking effort", that opens only the levels the model takes;
// "Runs with" is a line of its own, drawn only when more than one engine can
// run the model in use.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ModelMenuSettings, type ModelMenuSettingsProps, type RunsWithChoice } from "./ModelMenuSettings";

let host: HTMLDivElement;
let root: Root;
const render = (props: ModelMenuSettingsProps) => flushSync(() => root.render(createElement(ModelMenuSettings, props)));
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const click = (target: Element) => flushSync(() => {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("Thinking effort", () => {
  it("is one line with the level in use, opening only the model's levels, Default first", () => {
    const onPick = vi.fn();
    render({ effort: { title: "Effort", levels: ["low", "medium", "high"], value: "high", modelDefault: "medium", onPick } });
    const line = $('[data-model-line="effort"]')!;
    expect(line.textContent).toBe("Thinking effortHigh");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    // no row of seven segments on the first level
    expect($("[data-model-effort-menu]")).toBeNull();
    expect($$("[data-model-line-choice]")).toEqual([]);
    click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect($$("[data-model-line-choice]").map((choice) => choice.textContent)).toEqual(["Default (Medium)", "Low", "Medium", "High"]);
    expect($('[data-model-line-choice="high"]')!.getAttribute("aria-checked")).toBe("true");
    click($('[data-model-line-choice="low"]')!);
    expect(onPick).toHaveBeenCalledWith("low");
    // the choice closes the line
    expect($$("[data-model-line-choice]")).toEqual([]);
    click(line);
    click($('[data-model-line-choice="default"]')!);
    expect(onPick).toHaveBeenLastCalledWith(undefined);
  });

  it("reads Default with the model's own level when none is set", () => {
    render({ effort: { title: "Effort", levels: ["low", "high"], modelDefault: "high", onPick: () => {} } });
    expect($('[data-model-line="effort"] [data-model-line-value]')!.textContent).toBe("Default (High)");
  });
});

describe("Runs with", () => {
  const choice = (key: string, label: string, extra: Partial<RunsWithChoice> = {}): RunsWithChoice => ({ key, label, current: false, onPick: vi.fn(), ...extra });

  it("is not drawn with a single value", () => {
    render({ runsWith: [choice("claudeAgent", "Its own tool", { current: true })] });
    expect($("[data-model-settings]")).toBeNull();
    render({ fast: { on: false, onToggle: () => {} }, runsWith: [choice("claudeAgent", "Its own tool", { current: true })] });
    expect($('[data-model-line="runs-with"]')).toBeNull();
  });

  it("names the value in use, and opens each value with its grey line and the recommended one said", () => {
    const pi = choice("piAgent", "pi", { hint: "An open engine that works with many providers" });
    render({ runsWith: [choice("claudeAgent", "Its own tool", { current: true, recommended: true, hint: "Claude Code, made by the provider" }), pi] });
    const line = $('[data-model-line="runs-with"]')!;
    expect(line.textContent).toBe("Runs withIts own tool");
    expect(host.textContent).not.toContain("Claude Code");
    click(line);
    expect($$("[data-model-line-choice]").map((entry) => entry.textContent)).toEqual([
      "Its own tool (recommended)Claude Code, made by the provider",
      "piAn open engine that works with many providers",
    ]);
    click($('[data-model-line-choice="piAgent"]')!);
    expect(pi.onPick).toHaveBeenCalledOnce();
  });
});
