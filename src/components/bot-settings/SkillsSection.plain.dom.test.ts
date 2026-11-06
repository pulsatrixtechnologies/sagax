// @vitest-environment happy-dom
// Skills on the bot's profile page (#2313, plain surface): one card labelled
// "Skills" in grey above it, Add a pill at the label's right, each skill a
// row of the card (book icon, name in 14px, where it comes from and what it
// does grey under it, its switch and menu at the right). No "Manage in
// Plugins" link here: the library is managed from Access. Write a command
// and the organization's skills: their own labelled cards, pill buttons,
// plain fields. No outline, no underline, no heavy weight.
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { bots: [], config: { features: {} } }, dispatch: () => {}, flushBotPatches: () => Promise.resolve() }),
}));

const { SkillsSection } = await import("./SkillsSection");
const { SkillUploadPreview } = await import("./SkillUpload");
const { BotEditorContext } = await import("./BotEditorContext");

const bot = { id: "pepper", name: "Pepper", description: "" } as unknown as Bot;

const request = vi.fn(async (path: string) => {
  if (path === `/api/bots/${bot.id}/skills`) {
    return {
      skills: [
        { name: "weekly-report", description: "Writes the weekly report.", enabled: true, source: "https://example.test/skills/weekly-report", warnings: [], origin: "private" },
        { name: "meeting-notes", description: "Keeps meeting notes.", enabled: true, source: "", warnings: [], origin: "me", assignedBots: [{ id: "pepper", name: "Pepper" }, { id: "juniper", name: "Juniper" }] },
        { name: "intake", description: "Sorts new requests.", enabled: false, source: "", warnings: ["changed after review"], origin: "private" },
      ],
      staged: [],
      library: [{ name: "invoice-check", description: "Checks an invoice." }],
      assignedSkills: [],
    };
  }
  if (path.startsWith("/api/org-library/skills")) {
    return {
      organization: { name: "Harbor Team" },
      skills: [{ installId: "i1", packageName: "harbor-pack", publisher: "Harbor", release: "1.0.0", name: "triage", description: "Sorts tickets.", added: false }],
    };
  }
  return {};
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
};

describe("Skills on the profile page (plain)", () => {
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

  const render = async () => {
    act(() => root.render(plainSurface(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SkillsSection, { bot }),
    }))));
    await flush();
    await flush();
  };

  it("is one card labelled Skills, a skill a row, Add a pill at the label, no Manage in Plugins link", async () => {
    await render();
    const section = container.querySelector("[data-skills-section]")!;
    expect(section.querySelector("h3")?.textContent).toBe("Skills");
    const cards = section.querySelectorAll(":scope [data-settings-surface]");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.className).toContain("bg-card");

    const add = section.querySelector<HTMLElement>("[data-skills-add]")!;
    expect(add.className).toContain("ui-button");
    expect(card.contains(add)).toBe(false);

    const rows = card.querySelectorAll("[data-skill-row]");
    expect(rows).toHaveLength(3);
    const report = card.querySelector('[data-skill-row="weekly-report"]') ?? rows[0]!;
    expect(report.querySelector("svg")).not.toBeNull();
    expect(report.querySelector("[data-skill-name]")!.className).toContain("text-[14px]");
    expect(report.querySelector("[data-skill-origin]")).not.toBeNull();
    expect(report.textContent).toContain("Writes the weekly report.");
    expect(report.querySelector("[data-skill-source] [data-inline-fold]")).not.toBeNull();
    // the shared skill names the other bots still linked to it
    expect(card.textContent).toContain("Juniper");
    // a skill changed after its review: Review changes a pill
    const review = card.querySelector("[data-skill-warning] button");
    expect(review?.className).toContain("ui-button");
    // the upload sits in the card, its button a pill
    expect(card.querySelector<HTMLElement>("[data-skill-upload-button]")!.className).toContain("ui-button");

    expect(container.querySelector("[data-manage-in-connect-apps]")).toBeNull();
    expectPlain(container.innerHTML);
  });

  it("draws Write a command and the organization's skills as their own labelled cards", async () => {
    await render();
    const write = container.querySelector("[data-write-command]")!;
    expect(write.querySelector("h3")?.textContent).toBe("Write a command");
    const form = write.querySelector("form[data-settings-surface]")!;
    expect(form.className).toContain("bg-card");
    for (const field of form.querySelectorAll("input, textarea")) expect(field.className).toContain("bg-inset");
    const save = [...form.querySelectorAll("button")].find((button) => button.textContent === "Save command");
    expect(save?.className).toContain("ui-button");

    const org = container.querySelector("[data-org-skills]")!;
    expect(org.querySelector("h3")?.textContent).toBe("From Harbor Team");
    const offered = org.querySelector('[data-org-skill="triage"]')!;
    expect(offered.querySelector("button")!.className).toContain("ui-button");
    expectPlain(container.innerHTML);
  });

  it("keeps Manage in Plugins on the bordered surface", async () => {
    act(() => root.render(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SkillsSection, { bot }),
    })));
    await flush();
    await flush();
    expect(container.querySelector("[data-skills-section]")).toBeNull();
    expect(container.querySelector('[data-manage-in-connect-apps="skills"]')).not.toBeNull();
  });

  it("shows an upload's preview as filled tiles, the skill name in 14px", () => {
    const html = renderToStaticMarkup(plainSurface(createElement(SkillUploadPreview, {
      items: [{ file: "triage.md", kind: "markdown", errors: [], ignored: [], ignoredCount: 0, skills: [{ name: "triage", description: "Sorts tickets.", path: "SKILL.md", bytes: 120, warnings: [], skippedFiles: [], skippedCount: 0 }] }],
      onRemove: () => {},
    })));
    const host = document.createElement("div");
    host.innerHTML = html;
    const tile = host.querySelector("[data-skill-upload-item]")!;
    expect(tile.className).toContain("bg-card");
    expect(tile.textContent).toContain("triage");
    expect(html).toContain("text-[14px]");
    expectPlain(html);
  });
});
