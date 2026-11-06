// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ModelSearchList, type ModelMenuSection } from "./ModelMenu";

const sections: ModelMenuSection[] = [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", detail: "best model per task", current: true }] },
  { key: "grok", label: "Grok", note: "Sign-in required", rows: [
    { key: "g", kind: "model", instanceId: "grok", modelId: "grok-4.5", label: "Grok 4.5", detail: "High", tags: ["Default"], current: false },
    { key: "l", kind: "model", instanceId: "grok", modelId: "desk::q", label: "Qwen", current: false, unavailable: "Grok cannot run it." },
  ] },
];

const many: ModelMenuSection[] = [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
  { key: "claude", label: "Claude", rows: Array.from({ length: 7 }, (_, i) => ({
    key: `c${i}`, kind: "model" as const, instanceId: "claude", modelId: `m${i}`, label: `Claude ${i}`,
    current: i === 5,
  })) },
];

const html = (variant: "popover" | "window") => renderToStaticMarkup(createElement(ModelSearchList, { sections, onPick: () => {}, variant }));

beforeEach(() => setLocale("en"));

describe("ModelSearchList", () => {
  it("draws the search, the headings and each row as a name with its muted detail", () => {
    const markup = html("popover");
    expect(markup).toContain('placeholder="Search models"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain(">Grok<");
    expect(markup).toContain(">· Sign-in required<");
    expect(markup).toMatch(/>Grok 4\.5<\/span><span data-model-row-detail="true" class="[^"]*text-popover-ink-secondary">High<\/span>/);
    expect(markup).toContain(">Default<");
  });

  it("checks the current choice, starts on it and dims what cannot run", () => {
    const markup = html("popover");
    expect(markup).toMatch(/aria-selected="true" aria-current="true"[^>]*data-model-row-key="auto"/);
    expect(markup).toMatch(/aria-disabled="true"[^>]*data-model-option="desk::q"[^>]*title="Grok cannot run it\."/);
    // the active row is the one the combobox names
    const active = /aria-activedescendant="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`id="${active}" role="option" aria-selected="true"`);
  });

  it("paints the popover from the popover tokens and the window from the page's", () => {
    expect(html("popover")).toContain("text-popover-ink");
    expect(html("window")).not.toContain("popover");
  });

  it("says when nothing matches", () => {
    const markup = renderToStaticMarkup(createElement(ModelSearchList, { sections: [], onPick: () => {}, variant: "window" }));
    expect(markup).toContain("No model matches.");
  });
});

describe("ModelSearchList footer and preview (#2181)", () => {
  let host: HTMLDivElement;
  let root: Root;
  const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T & HTMLElement>(selector);
  const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const click = (target: Element) => flushSync(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const type = (value: string) => {
    const field = $<HTMLInputElement>("[data-model-search]")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it("keeps the after footer outside the scrolling list", () => {
    const footer = createElement("div", { "data-test-footer": "" }, "Effort");
    flushSync(() => root.render(createElement(ModelSearchList, {
      sections, onPick: () => {}, variant: "popover", after: footer,
    })));
    const list = $("[data-model-list]")!;
    const foot = $("[data-model-menu-footer]")!;
    expect(foot).toBeTruthy();
    expect(foot.querySelector("[data-test-footer]")).toBeTruthy();
    expect(list.contains(foot)).toBe(false);
    expect(list.hasAttribute("data-model-list-scroll")).toBe(true);
    expect($("[data-model-list-after]")).toBeNull();
  });

  it("shows at most 4 models per provider then Show more, and keeps the current model", () => {
    flushSync(() => root.render(createElement(ModelSearchList, {
      sections: many, onPick: () => {}, variant: "popover",
    })));
    const options = $$("[data-model-section=\"claude\"] [data-model-option]").map((row) => row.dataset.modelOption);
    expect(options).toEqual(["m0", "m1", "m2", "m5"]);
    expect($("[data-model-show-more=\"claude\"]")?.textContent).toBe("Show more");
  });

  it("expands and collapses a provider with Show more / Show less", () => {
    flushSync(() => root.render(createElement(ModelSearchList, {
      sections: many, onPick: () => {}, variant: "popover",
    })));
    click($("[data-model-show-more=\"claude\"]")!);
    expect($$("[data-model-section=\"claude\"] [data-model-option]")).toHaveLength(7);
    expect($("[data-model-show-more=\"claude\"]")?.textContent).toBe("Show less");
    click($("[data-model-show-more=\"claude\"]")!);
    expect($$("[data-model-section=\"claude\"] [data-model-option]")).toHaveLength(4);
  });

  it("shows every model while searching", () => {
    flushSync(() => root.render(createElement(ModelSearchList, {
      sections: many, onPick: () => {}, variant: "popover",
    })));
    type("Claude");
    expect($$("[data-model-option]")).toHaveLength(7);
    expect($("[data-model-show-more]")).toBeNull();
  });

  it("keeps a favorite past the preview window visible", () => {
    flushSync(() => root.render(createElement(ModelSearchList, {
      sections: many, onPick: () => {}, variant: "popover",
      favorites: { keys: ["c6"], onToggle: () => {} },
    })));
    expect($$("[data-model-section=\"claude\"] [data-model-option]").map((row) => row.dataset.modelOption))
      .toEqual(["m0", "m1", "m5", "m6"]);
  });
});
