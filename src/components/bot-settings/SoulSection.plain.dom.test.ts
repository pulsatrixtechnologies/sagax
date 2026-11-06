// @vitest-environment happy-dom
// Personality on the bot's profile page (#2313, plain surface): the card
// labelled "Personality" in grey above it, the editor's label a 14px row
// title, the file-drift notice a filled box with pill buttons; "Do not
// finish until" its own labelled card, the condition a plain field, Save and
// Clear pills. No outline, no underline, no heavy weight.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

// one store value: SoulField re-reads the soul file when flushBotPatches changes
const store = vi.hoisted(() => ({ state: { bots: [] }, dispatch: () => {}, flushBotPatches: () => Promise.resolve() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => store,
}));

const { SoulSection } = await import("./SoulSection");
const { BotEditorContext } = await import("./BotEditorContext");

const bot = {
  id: "pepper",
  name: "Pepper",
  description: "Answers the front desk.",
  soul: "Be brief and kind.",
  finishUntil: "the summary is sent",
} as unknown as Bot;

const request = vi.fn(async (path: string) => {
  if (path.endsWith("/soul")) {
    return { soul: "Be brief and kind.", revision: "r1", bytes: 18, limit: 12_000, file: "SOUL.md", drift: true, fileText: "Be brief." };
  }
  return {};
});

const plainSurface = (element: ReactElement) => createElement(SettingsSurfaceProvider, { surface: "plain", children: element });
// the HelpTip popovers (<details>) carry the app's popover outline
const stripHelp = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, "");
const expectPlain = (raw: string) => {
  const html = stripHelp(raw);
  expect(html).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
  expect(html).not.toMatch(/\bborder-warning/);
  expect(html).not.toContain("underline");
  expect(html).not.toContain("ui-button-primary");
  expect(html).not.toContain("font-medium");
  expect(html).not.toContain("font-semibold");
};

describe("Personality on the profile page (plain)", () => {
  let root: Root;
  let container: HTMLDivElement;
  const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

  beforeEach(() => {
    setLocale("en");
    request.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("labels the Personality card and the Do not finish until card, pills and a plain field, no outline", async () => {
    act(() => root.render(plainSurface(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SoulSection, { bot, patch: () => {} }),
    }))));
    await flush();

    const soul = container.querySelector("[data-soul-section]")!;
    expect(soul.querySelector("h3")?.textContent).toBe("Personality");
    const label = soul.querySelector<HTMLLabelElement>(`#bot-soul-label-${bot.id}`)!;
    expect(label.className).toContain("text-[14px]");
    // the file drift: a filled box, its two choices pills
    const useFile = [...soul.querySelectorAll("button")].find((button) => button.textContent === "Use the file");
    expect(useFile?.className).toContain("ui-button");
    expect(useFile?.parentElement?.parentElement?.className).toContain("bg-warning/10");

    const finish = container.querySelector("[data-bot-finish-until]")!;
    expect(finish.querySelector("h3")?.textContent).toBe("Do not finish until");
    expect(finish.querySelector("[data-settings-surface]")!.className).toContain("bg-card");
    expect(finish.querySelector("[data-finish-until-input]")!.className).toContain("bg-inset");
    expect(finish.querySelector("[data-finish-until-save]")!.className).toContain("ui-button");
    expect(finish.querySelector("[data-finish-until-clear]")!.className).toContain("ui-button");

    expectPlain(container.innerHTML);
  });

  it("keeps the bordered look off the profile page", async () => {
    act(() => root.render(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SoulSection, { bot, patch: () => {} }),
    })));
    await flush();
    expect(container.querySelector("[data-soul-section]")).toBeNull();
    expect(container.querySelector("[data-finish-until-save]")!.className).not.toContain("ui-button");
  });
});
