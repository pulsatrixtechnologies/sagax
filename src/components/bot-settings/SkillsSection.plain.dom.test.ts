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

type SkillsAnswer = { skills: unknown[]; staged: unknown[]; library: unknown[]; assignedSkills: string[] };
let skillsAnswer: SkillsAnswer | null = null;
const request = vi.fn(async (path: string, _init?: RequestInit) => {
  if (path === `/api/bots/${bot.id}/skills` && skillsAnswer) return skillsAnswer;
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
    skillsAnswer = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (props: Record<string, unknown> = {}) => {
    act(() => root.render(plainSurface(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SkillsSection, { bot, ...props }),
    }))));
    await flush();
    await flush();
  };

  it("is one card labelled Skills, a skill a row, one + Add a pill at the label, no Manage in Plugins link", async () => {
    await render();
    const section = container.querySelector("[data-skills-section]")!;
    expect(section.querySelector("h3")?.textContent).toBe("Skills");
    const cards = section.querySelectorAll(":scope [data-settings-surface]");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.className).toContain("bg-card");

    // #3400: one "+ Add" at the label, no library select, no separate Add, no Upload pill with its help
    const adds = section.querySelectorAll<HTMLElement>("[data-bot-profile-add]");
    expect(adds).toHaveLength(1);
    expect(adds[0]!.className).toContain("ui-button");
    expect(card.contains(adds[0]!)).toBe(false);
    expect(section.querySelector("[data-pill-select], select")).toBeNull();
    expect(card.querySelector("[data-skill-upload-button]")).toBeNull();
    expect(card.textContent).not.toContain("Upload a SKILL.md file");

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

  it("#3400: + Add opens described items (library, upload, command) that work with the arrows", async () => {
    await render();
    const section = container.querySelector("[data-skills-section]")!;
    const add = section.querySelector<HTMLButtonElement>("[data-bot-profile-add]")!;
    await act(async () => { add.focus(); add.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>("[data-bot-profile-add-item]")];
    expect(items.map((item) => item.getAttribute("data-bot-profile-add-item"))).toEqual(["library", "upload", "command"]);
    for (const item of items) expect(item.querySelector("[data-bot-profile-add-description]")?.textContent?.trim()).toBeTruthy();
    expect(document.activeElement).toBe(items[0]);
    await act(async () => { items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(items[1]);
    // From the library lists what the library still offers, each with its Add
    await act(async () => { items[0]!.click(); });
    await flush();
    const offered = container.querySelector('[data-skills-library-item="invoice-check"]');
    expect(offered?.querySelector("[data-skills-add]")).not.toBeNull();
  });

  it("#3400: no skill is one row with a title, a grey line and + Add; 'already assigned' only when the library has skills", async () => {
    skillsAnswer = { skills: [], staged: [], library: [], assignedSkills: [] };
    await render();
    const card = container.querySelector("[data-skills-section] [data-settings-surface]")!;
    const empty = card.querySelector<HTMLElement>("[data-skills-empty]")!;
    expect(empty.textContent).toContain("No skills yet");
    expect(empty.querySelector("[data-bot-profile-add]")).not.toBeNull();
    expect(container.querySelectorAll("[data-bot-profile-add]")).toHaveLength(1);
    expect(card.textContent).not.toContain("No installed skills yet.");
    expect(card.textContent).not.toContain("already assigned");

    act(() => root.unmount());
    root = createRoot(container);
    skillsAnswer = { skills: [{ name: "invoice-check", description: "Checks an invoice.", enabled: true, source: "", warnings: [], origin: "library" }], staged: [], library: [], assignedSkills: ["invoice-check"] };
    await render();
    expect(container.querySelector("[data-skills-section] [data-settings-surface]")!.textContent).toContain("already assigned");
  });

  // #4104: the owner, "make sure to only show like 3 or 4 skill and add a show more".
  const skill = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: `Does ${name}.`, enabled: true, source: "", warnings: [], origin: "private", ...extra });
  const many = (count: number) => Array.from({ length: count }, (_, index) => skill(`skill-${index + 1}`));
  const skillsCard = () => container.querySelector<HTMLElement>("[data-skills-section] [data-settings-surface]")!;
  const shownSkills = () => [...skillsCard().querySelectorAll("[data-skill-row]")].map((row) => row.getAttribute("data-skill-row"));

  it("#4104: nine skills show the first four, then Show 5 more that opens in place and folds back", async () => {
    skillsAnswer = { skills: many(9), staged: [], library: [], assignedSkills: [] };
    await render();
    expect(shownSkills()).toEqual(["skill-1", "skill-2", "skill-3", "skill-4"]);
    // the Learn from use row stays at the top of the card
    const card = skillsCard();
    const more = card.querySelector<HTMLButtonElement>("[data-skills-fold]")!;
    expect(more.tagName).toBe("BUTTON");
    expect(more.textContent).toBe("Show 5 more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("data-skills-fold")).toBe("more");
    await act(async () => { more.click(); });
    expect(shownSkills()).toHaveLength(9);
    const less = card.querySelector<HTMLButtonElement>("[data-skills-fold]")!;
    expect(less.textContent).toBe("Show less");
    expect(less.getAttribute("aria-expanded")).toBe("true");
    // the control follows the last skill
    expect(card.querySelector('[data-skill-row="skill-9"]')!.compareDocumentPosition(less) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => { less.click(); });
    expect(shownSkills()).toHaveLength(4);
    expect(container.querySelectorAll("[data-skills-section] [data-bot-profile-add]")).toHaveLength(1);
  });

  it("#4104: two or four skills show no control; French counts the hidden ones", async () => {
    skillsAnswer = { skills: many(2), staged: [], library: [], assignedSkills: [] };
    await render();
    expect(shownSkills()).toHaveLength(2);
    expect(skillsCard().querySelector("[data-skills-fold]")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    skillsAnswer = { skills: many(4), staged: [], library: [], assignedSkills: [] };
    await render();
    expect(shownSkills()).toHaveLength(4);
    expect(skillsCard().querySelector("[data-skills-fold]")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    setLocale("fr");
    skillsAnswer = { skills: many(6), staged: [], library: [], assignedSkills: [] };
    await render();
    expect(skillsCard().querySelector("[data-skills-fold]")?.textContent).toBe("Afficher 2 de plus");
  });

  it("#4104: a blocked skill beyond the fourth is never hidden: it comes first with its Review changes", async () => {
    const skills = many(9);
    skills[6] = skill("blocked-one", { enabled: false, warnings: ["changed after review"] });
    skillsAnswer = { skills, staged: [], library: [], assignedSkills: [] };
    await render();
    expect(shownSkills()).toEqual(["blocked-one", "skill-1", "skill-2", "skill-3"]);
    expect(skillsCard().querySelector('[data-skill-warning="blocked-one"] button')?.textContent).toBe("Review changes");
    expect(skillsCard().querySelector("[data-skills-fold]")?.textContent).toBe("Show 5 more");
  });

  it("#4104: a skill just added stays in view though it lands beyond the fourth", async () => {
    skillsAnswer = { skills: many(5), staged: [], library: [{ name: "invoice-check", description: "Checks an invoice." }], assignedSkills: [] };
    await render();
    expect(shownSkills()).toEqual(["skill-1", "skill-2", "skill-3", "skill-4"]);
    const add = container.querySelector<HTMLButtonElement>("[data-skills-section] [data-bot-profile-add]")!;
    await act(async () => { add.focus(); add.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await flush();
    await act(async () => { document.querySelector<HTMLElement>('[data-bot-profile-add-item="library"]')!.click(); });
    await flush();
    skillsAnswer = { skills: [...many(5), skill("invoice-check", { origin: "library" })], staged: [], library: [], assignedSkills: ["invoice-check"] };
    await act(async () => { container.querySelector<HTMLElement>('[data-skills-add="invoice-check"]')!.click(); });
    await flush();
    await flush();
    expect(shownSkills()).toContain("invoice-check");
    expect(shownSkills()).toHaveLength(4);
    expect(skillsCard().querySelector("[data-skills-fold]")?.textContent).toBe("Show 2 more");
  });

  it("#3400: To review lists each proposal, decided in place on the chat's card, or one row when none waits", async () => {
    const opened: unknown[] = [];
    skillsAnswer = {
      skills: [], library: [], assignedSkills: [],
      staged: [{ id: "st1", name: "pricing-check", gist: "Compares a quote with the last three prices.", action: "create", sha256: "a".repeat(64), card: { threadId: "th1", requestId: "rq1", messageId: "m1" } }],
    };
    await render({ review: { onOpenChat: (entry: unknown) => opened.push(entry) } });
    const reviewCard = container.querySelector<HTMLElement>('[data-settings-group="bot-profile-review"]')!;
    expect(reviewCard).not.toBeNull();
    // the To review card comes before the Skills card
    expect(reviewCard.compareDocumentPosition(container.querySelector("[data-skills-section]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = reviewCard.querySelector<HTMLElement>('[data-bot-profile-row="review-st1"]')!;
    expect(row.textContent).toContain("pricing-check");
    expect(row.textContent).toContain("Compares a quote");
    // the orange line about proposals is gone
    expect(container.textContent).not.toContain("waiting for a decision in chat");
    await act(async () => { row.querySelector<HTMLElement>("[data-bot-profile-review-open]")!.click(); });
    expect(opened).toHaveLength(1);
    skillsAnswer = { skills: [], library: [], assignedSkills: [], staged: [] };
    await act(async () => { row.querySelector<HTMLElement>("[data-bot-profile-review-allow]")!.click(); });
    await flush();
    const answer = request.mock.calls.find(([path]) => path === "/api/threads/th1/respond");
    expect(answer).toBeDefined();
    expect(JSON.parse(String((answer![1] as RequestInit).body))).toEqual({ requestId: "rq1", behavior: "allow", reviewedSha256: "a".repeat(64), via: "profile" });
    // once decided, nothing waits: the empty row
    const emptyRow = container.querySelector<HTMLElement>("[data-bot-profile-review-empty]");
    expect(emptyRow?.textContent).toContain("You're all caught up");
  });
});
