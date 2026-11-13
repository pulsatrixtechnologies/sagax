// @vitest-environment happy-dom
// #4148: on the bot's profile page a skill row is as compact as every other
// row (the Settings card's ProfileRow): its glyph, its name, ONE grey line,
// a shared glyph whose tooltip and name list the bots, and the more menu.
// No switch, no "Learned ..." fold, no "Shared with" line: on and off are a
// text item of the menu, and the rest is behind the open. A skill that needs
// the person says so on the row and offers Review changes. "Learn from use"
// is the page's switch row (DescribedRow, like the Settings card's).
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSurfaceProvider } from "@/components/SettingsPrimitives";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { bots: [], config: { features: {} } }, dispatch: () => {}, flushBotPatches: () => Promise.resolve() }),
}));

const { SkillsSection } = await import("./SkillsSection");
const { BotEditorContext } = await import("./BotEditorContext");

const bot = { id: "pepper", name: "Pepper", description: "" } as unknown as Bot;
const CHANGED = "stored SKILL.md changed after review - enablement is blocked";

const skills = [
  { name: "weekly-report", description: "Writes the weekly report from the open tasks, then files it in the team folder.", enabled: true, source: "learn:inbox/thread-1", warnings: [], origin: "private" },
  { name: "meeting-notes", description: "Keeps meeting notes.", enabled: true, source: "", warnings: [], origin: "me", assignedBots: [{ id: "pepper", name: "Pepper" }, { id: "juniper", name: "Juniper" }] },
  { name: "intake", description: "Sorts new requests.", enabled: false, source: "", warnings: [], origin: "private" },
  { name: "vendor-compare", description: "Compares two quotes.", enabled: false, source: "", warnings: [CHANGED], origin: "private" },
];

const editorPayload = (name: string) => ({
  name, text: `---\nname: ${name}\ndescription: The whole description of ${name}.\n---\nDo it.`, description: `The whole description of ${name}.`,
  source: name === "weekly-report" ? "learn:inbox/thread-1" : "", enabled: true, changedAfterReview: name === "vendor-compare",
  reviewedText: name === "vendor-compare" ? "old" : null, warnings: [], files: [], editable: true, origin: "private",
});

const request = vi.fn(async (path: string, _init?: RequestInit) => {
  if (path === `/api/bots/${bot.id}/skills`) return { skills, staged: [], library: [], assignedSkills: [] };
  const own = path.match(/^\/api\/bots\/pepper\/skills\/([^/?]+)$/);
  if (own) return editorPayload(decodeURIComponent(own[1]!));
  const shared = path.match(/^\/api\/me\/skills-library\/([^/?]+)$/);
  if (shared) return { ...editorPayload(decodeURIComponent(shared[1]!)), origin: "me" };
  if (path.startsWith("/api/org-library/skills")) return { organization: { name: "Team" }, skills: [] };
  return {};
});

const plainSurface = (element: ReactElement) => createElement(SettingsSurfaceProvider, { surface: "plain", children: element });

describe("#4148 compact skill rows on the profile page", () => {
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
    for (const node of document.body.querySelectorAll("[role=menu]")) node.remove();
  });

  const render = async () => {
    act(() => root.render(plainSurface(createElement(BotEditorContext.Provider, {
      value: { request: request as never },
      children: createElement(SkillsSection, { bot }),
    }))));
    await flush();
    await flush();
  };
  const row = (name: string) => container.querySelector<HTMLElement>(`[data-skill-row="${name}"]`)!;
  const openMenu = async (name: string) => {
    await act(async () => { row(name).querySelector<HTMLButtonElement>("[data-skill-row-menu] button, button[data-skill-row-menu]")!.click(); });
    await flush();
    return [...document.querySelectorAll<HTMLElement>("[data-skill-menu-item]")];
  };

  it("draws each skill as the page's row: glyph, name, one grey line, no switch, no fold, no shared line", async () => {
    await render();
    const report = row("weekly-report");
    // the page's row (ProfileRow): one open button with the glyph and two lines
    const open = report.querySelector<HTMLButtonElement>("[data-profile-row-open]")!;
    expect(open.tagName).toBe("BUTTON");
    expect(open.querySelector("svg")).not.toBeNull();
    expect(open.querySelector("[data-profile-row-label]")?.textContent).toBe("weekly-report");
    const line = open.querySelector<HTMLElement>("[data-profile-row-state]")!;
    expect(line.className).toContain("truncate");
    expect(line.textContent).toBe("Writes the weekly report from the open tasks, then files it in the team folder.");
    // nothing else under the row
    expect(report.querySelector("[role=switch], [data-inline-fold], [data-skill-source]")).toBeNull();
    expect(report.textContent).not.toContain("Learned from inbox");
    expect(report.textContent).not.toContain("private");
    for (const node of container.querySelectorAll("[data-skill-row]")) expect(node.querySelector("[role=switch]")).toBeNull();
    expect(container.textContent).not.toContain("Shared with");
  });

  it("puts a shared glyph on a shared skill whose tooltip and name list the bots, on hover, focus and tap", async () => {
    await render();
    expect(row("weekly-report").querySelector("[data-skill-shared]")).toBeNull();
    const glyph = row("meeting-notes").querySelector<HTMLButtonElement>("[data-skill-shared]")!;
    expect(glyph.getAttribute("aria-label")).toBe("Shared with Pepper, Juniper");
    const tip = () => row("meeting-notes").querySelector("[role=tooltip]");
    expect(tip()).toBeNull();
    await act(async () => { glyph.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(tip()?.textContent).toBe("Shared with Pepper, Juniper");
    await act(async () => { glyph.parentElement!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
    expect(tip()).toBeNull();
    await act(async () => { glyph.focus(); });
    expect(tip()?.textContent).toBe("Shared with Pepper, Juniper");
    await act(async () => { glyph.blur(); });
    expect(tip()).toBeNull();
    await act(async () => { glyph.click(); });
    expect(tip()).not.toBeNull();
  });

  it("an off skill reads as off without a switch: muted name and Off on its grey line", async () => {
    await render();
    const intake = row("intake");
    expect(intake.getAttribute("data-skill-state")).toBe("off");
    expect(intake.querySelector("[data-profile-row-label]")!.className).toContain("text-ink-secondary");
    expect(intake.querySelector("[data-profile-row-state]")?.textContent).toBe("Off · Sorts new requests.");
    expect(row("weekly-report").querySelector("[data-profile-row-label]")!.className).not.toContain("text-ink-secondary");
  });

  it("turns a skill off and on from the more menu, as a text item", async () => {
    await render();
    let items = await openMenu("weekly-report");
    const off = items.find((item) => item.getAttribute("data-skill-menu-item") === "toggle")!;
    expect(off.textContent).toBe("Turn off");
    await act(async () => { off.click(); });
    await flush();
    const patch = request.mock.calls.find(([path, init]) => path === "/api/bots/pepper/skills/weekly-report" && init?.method === "PATCH");
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ enabled: false });

    items = await openMenu("intake");
    const on = items.find((item) => item.getAttribute("data-skill-menu-item") === "toggle")!;
    expect(on.textContent).toBe("Turn on");
    await act(async () => { on.click(); });
    await flush();
    // turning on still goes through the review of its text
    expect(document.querySelector("[data-skill-review-page]")).not.toBeNull();
  });

  it("a skill that needs the person says so on the row, sorts first, and offers Review changes in the menu and the open view", async () => {
    await render();
    const order = [...container.querySelectorAll("[data-skill-row]")].map((node) => node.getAttribute("data-skill-row"));
    expect(order[0]).toBe("vendor-compare");
    const blocked = row("vendor-compare");
    expect(blocked.getAttribute("data-skill-state")).toBe("needs-person");
    expect(blocked.querySelector("[data-skill-needs]")?.textContent).toBe("Needs review");
    const items = await openMenu("vendor-compare");
    const review = items.find((item) => item.getAttribute("data-skill-menu-item") === "review")!;
    expect(review.textContent).toBe("Review changes");
    await act(async () => { review.click(); });
    await flush();
    await flush();
    expect(document.querySelector("[data-skill-review-diff]")).not.toBeNull();
  });

  it("opening a row (click or Enter) shows the whole description, with whom it is shared, where it was learned and the actions", async () => {
    await render();
    const open = row("meeting-notes").querySelector<HTMLButtonElement>("[data-profile-row-open]")!;
    await act(async () => { open.click(); });
    await flush();
    await flush();
    const page = document.querySelector<HTMLElement>("[data-skill-editor-page]")!;
    expect(page).not.toBeNull();
    expect(page.querySelector("[data-skill-origin]")?.textContent).toBe("Shared with Pepper, Juniper");
    expect(page.querySelector<HTMLTextAreaElement>('[data-skill-field="description"]')?.value).toBe("The whole description of meeting-notes.");
    const actions = [...page.querySelectorAll("[data-skill-detail-action]")].map((node) => node.textContent);
    expect(actions).toEqual(["Turn off", "Stop sharing", "Remove skill"]);
    await act(async () => { page.querySelector<HTMLButtonElement>("[data-panel-page-close], button")!.click(); });
  });

  it("the open view of a learned private skill says it is private and where it was learned", async () => {
    await render();
    await act(async () => { row("weekly-report").querySelector<HTMLButtonElement>("[data-profile-row-open]")!.click(); });
    await flush();
    await flush();
    const page = document.querySelector<HTMLElement>("[data-skill-editor-page]")!;
    expect(page.querySelector("[data-skill-origin]")?.textContent).toBe("Private to this bot");
    expect(page.textContent).toContain("Learned from inbox");
    const actions = [...page.querySelectorAll("[data-skill-detail-action]")].map((node) => node.getAttribute("data-skill-detail-action"));
    expect(actions).toEqual(["toggle", "share", "remove"]);
  });

  it("draws Learn from use as the page's switch row, its glyph and its help mark", async () => {
    await render();
    const learning = container.querySelector<HTMLElement>("[data-skill-learning]")!;
    const described = learning.querySelector<HTMLElement>('[data-settings-rowkind="described"]')!;
    expect(described).not.toBeNull();
    expect(described.className).toContain("px-4");
    expect(described.querySelector("svg")).not.toBeNull();
    expect(described.querySelector("details summary")?.getAttribute("aria-label")).toBe("More about Learn from use");
    expect(described.querySelector("[role=switch]")).not.toBeNull();
    // no second padding around it, and the old label-switch row is gone
    expect(learning.className).toBe("");
    expect(learning.querySelector('[data-settings-rowkind="switch"]')).toBeNull();
  });
});
