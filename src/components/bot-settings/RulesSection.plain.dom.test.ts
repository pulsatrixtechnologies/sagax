// @vitest-environment happy-dom
// Rules on the bot's profile page (#2313, plain surface): one card labelled
// "Rules" in grey above it, each set a row (line icon, name in 14px, the
// counter grey under it, its switch and buttons at the right), the selected
// set's editor unfolding under its row on one filled surface, no outline;
// Add a pill at the label's right. Custom rules: the same, one card, the
// rules its rows, the editor on a plain field with pill buttons.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { RuleSetWire, RulesListing } from "@/lib/rule-sets";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: fixture.api,
  useStore: () => ({ state: { bots: [{ id: "pepper", name: "Pepper" }] }, dispatch: () => {} }),
}));

const { RulesSection, RULES_TEMPLATE } = await import("./RulesSection");
const { CustomRulesCard } = await import("./CustomRulesCard");

const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const ruleSet = (patch: Partial<RuleSetWire>): RuleSetWire => ({
  id: "rules", name: null, enabled: true, file: "RULES.md", text: "", hash: "h", exists: true, lines: 0, bytes: 0, over: false, loads: true, ...patch,
});
const listing = (sets: RuleSetWire[]): RulesListing => ({
  budgets: { set: { maxLines: 100, maxBytes: 12_000 }, total: { maxLines: 250, maxBytes: 24_000 } },
  maxSets: 20,
  maxNameLength: 60,
  template: RULES_TEMPLATE,
  sets,
  total: { lines: 0, bytes: 0, over: false },
});

const plainSurface = (element: ReactElement) => createElement(SettingsSurfaceProvider, { surface: "plain", children: element });
// the HelpTip popovers (<details>) carry the app's popover outline
const stripHelp = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, "");
const expectPlain = (raw: string) => {
  const html = stripHelp(raw);
  expect(html).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
  expect(html).not.toContain("underline");
  expect(html).not.toContain("ui-button-primary");
  expect(html).not.toContain("font-medium");
  expect(html).not.toContain("font-semibold");
  expect(html).not.toContain("bg-elevated");
  expect(html).not.toContain("bg-raised");
};

beforeEach(() => setLocale("en"));

describe("Rules on the profile page (plain)", () => {
  const renderRules = (initial: RulesListing) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(plainSurface(createElement(RulesSection, { bot, active: false, initial })));
    return host;
  };

  it("is one card labelled Rules, a set a row with its icon, its counter grey under the name, Add a pill at the label", () => {
    const host = renderRules(listing([
      ruleSet({ text: "# Rules\n\n- Never quote a price.\n" }),
      ruleSet({ id: "emails", name: "Client emails", file: "rules/emails.md", text: "- Sign every email.\n" }),
    ]));
    const section = host.querySelector("[data-rules-section]")!;
    expect(section.querySelector("h3")?.textContent).toBe("Rules");
    const cards = section.querySelectorAll("[data-settings-surface]");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.className).toContain("bg-card");
    // Add sits at the label's right, a plain pill
    const add = section.querySelector<HTMLElement>("[data-rules-add]")!;
    expect(cards[0]!.contains(add)).toBe(false);
    expect(add.className).toContain("ui-button");
    // a set: a row of the card, the line icon, the name in 14px, the counter grey under it
    const set = cards[0]!.querySelector('[data-rule-set="emails"]')!;
    expect(set.querySelector("svg")).not.toBeNull();
    expect(set.querySelector("[data-rule-set-name]")!.className).toContain("text-[14px]");
    expect(set.querySelector("[data-rule-set-counter]")!.className).toContain("text-ink-secondary");
    expect(set.querySelector('[role="meter"]')).not.toBeNull();
    expect(host.textContent).toContain("Sets that are on, in all");
    expectPlain(host.innerHTML);
  });

  it("unfolds the selected set's editor under its row, on one filled surface, Save a pill", () => {
    const host = renderRules(listing([ruleSet({ exists: false })]));
    const set = host.querySelector('[data-rule-set="rules"]')!;
    // the starter note sits in the label's help
    expect(host.querySelector("[data-rules-section] [data-rules-starter]")).not.toBeNull();
    expect(set.textContent).toContain("Never send an email to a client without showing me the draft first.");
    const editor = set.querySelector(".markdown-editor")!;
    expect(editor.className).toContain("bg-inset");
    expect(editor.className).not.toMatch(/\bborder\b/);
    const save = set.querySelector<HTMLElement>("[data-rules-save]")!;
    expect(save.textContent).toBe("Save");
    expect(save.className).toContain("ui-button");
    expectPlain(host.innerHTML);
  });
});

describe("Custom rules on the profile page (plain)", () => {
  let root: Root;
  let container: HTMLDivElement;
  const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

  beforeEach(() => {
    fixture.api.mockReset();
    fixture.api.mockResolvedValue({
      rules: [
        { id: "r1", when: "reading files", behavior: "allow", botId: "pepper", enabled: true, riskScope: [], startedBy: null, compiled: { recognized: true, commands: [] } },
        { id: "r2", when: "sending an email", behavior: "deny", botId: null, enabled: true, riskScope: [], startedBy: null, org: true, compiled: { recognized: true, commands: [] } },
      ],
      orgPolicy: { alwaysAllow: true },
      products: [],
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is one card labelled Custom rules, a rule a row, Add a pill, the editor a plain field with pill buttons", async () => {
    act(() => root.render(plainSurface(createElement(CustomRulesCard, { bot }))));
    await flush();
    const section = container.querySelector("[data-custom-rules]")!;
    expect(section.getAttribute("data-custom-rules")).toBe("2");
    expect(section.querySelector("h3")?.textContent).toBe("Custom rules");
    const card = section.querySelector("[data-settings-surface]")!;
    expect(card.className).toContain("bg-card");
    expect(card.querySelector("[data-custom-rules-reviewer]")).not.toBeNull();
    expect(card.querySelectorAll("[data-custom-rule-row]")).toHaveLength(2);
    expect(card.querySelector("[data-org-rule-row]")!.textContent).toContain("sending an email");
    expect(card.querySelector('[aria-label="Edit"]') ?? card.querySelector('button[title]')).not.toBeNull();
    expectPlain(container.innerHTML);

    const add = section.querySelector<HTMLElement>("[data-custom-rule-add]")!;
    expect(card.contains(add)).toBe(false);
    expect(add.className).toContain("ui-button");
    await act(async () => { add.click(); });
    await flush();
    const form = card.querySelector("[data-custom-rule-form]")!;
    expect(form).not.toBeNull();
    expect(form.className).not.toContain("bg-inset");
    expect(form.querySelector("textarea")!.className).toContain("bg-inset");
    expect(form.querySelector<HTMLElement>("[data-rule-test-run]")!.className).toContain("ui-button");
    const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Cancel" || button.textContent === "Save rule");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.className).toContain("ui-button");
    // Add hides while the new rule is being written
    expect(section.querySelector("[data-custom-rule-add]")).toBeNull();
    expectPlain(container.innerHTML);
  });
});
