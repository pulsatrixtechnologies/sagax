// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { activeLocale, setLocale } from "@/lib/i18n";
import { niceTime } from "@/lib/schedule-label";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";
import { botVersions } from "../../../shared/bot-versions";
import { HistorySection, historyField, historySummary, historyWho, lineDiff, versionFields, type HistoryRow } from "./HistorySection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Scout",
  title: "Scout",
  description: "",
  notifications: false,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
};

// newest first, as the server sends them: v3 renames, v2 changes the
// Personality and the label together, v1 names the bot
const v3: HistoryRow = { id: "r4", at: 3000, actor: "bot", via: "api", field: "name", summary: "", before: "Ada", after: "Aria" };
const v2soul: HistoryRow = { id: "r2", at: 2000, actor: "user", via: "ui", field: "soul", summary: "", before: "Be brief.\nCite sources.", after: "Be thorough.\nCite sources.", canRestore: true };
const v2title: HistoryRow = { id: "r3", at: 2000, actor: "user", via: "ui", field: "title", summary: "", before: "", after: "Research" };
const v1: HistoryRow = { id: "r1", at: 1000, actor: "user", via: "ui", field: "name", summary: "", before: "Bot", after: "Ada" };
const rows = [v3, v2title, v2soul, v1];

type Props = Parameters<typeof HistorySection>[0];

function render(list: HistoryRow[] | null, props: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(HistorySection, { bot, rows: list, onRestore: vi.fn(), ...props }));
}
const versionIds = (html: string) => [...html.matchAll(/data-history-version="([\w-]+)"/g)].map((m) => m[1]);

/** Twelve Personality edits in a row by the person, then a rename by the
 * bot (the current version), all on one morning. */
function runOfEdits(): { list: HistoryRow[]; edits: HistoryRow[] } {
  const start = new Date(2026, 10, 6, 9, 0).getTime();
  const edits: HistoryRow[] = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i + 1}`, at: start + i * 60_000, actor: "user", via: "ui", field: "soul", summary: "",
    before: `Draft ${i}`, after: `Draft ${i + 1}`, canRestore: true,
  }));
  const renamed: HistoryRow = { id: "n1", at: start + 3_600_000, actor: "bot", via: "api", field: "name", summary: "", before: "Ada", after: "Aria" };
  return { list: [renamed, ...[...edits].reverse()], edits };
}

/** 25 saves that alternate between the name and the Personality: no two
 * fold together, so 25 rows. */
const many: HistoryRow[] = Array.from({ length: 25 }, (_, i): HistoryRow => ({
  id: `m${i + 1}`, at: 1000 + i * 1000, actor: "user", via: "ui", field: i % 2 ? "soul" : "name", summary: "",
  before: `${i}`, after: `${i + 1}`, ...(i % 2 ? { canRestore: true } : {}),
})).reverse();

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(list: HistoryRow[], props: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(HistorySection, { bot, rows: list, onRestore: vi.fn(), ...props })));
  return host;
}
const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => (element as HTMLElement).click());
};

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  setLocale("en");
});

describe("HistorySection helpers", () => {
  it("names who changed it and the field, an unknown one as sent", () => {
    expect(historyWho({ actor: "bot" })).toBe("The bot");
    expect(historyWho({ actor: "cron" })).toBe("cron");
    expect(historyField("soul")).toBe("Personality");
    expect(historyField("color")).toBe("color");
  });

  it("sums a change up from its own before and after, else the server's words", () => {
    expect(historySummary(v1)).toBe('Name: "Bot" → "Ada"');
    expect(historySummary(v2soul)).toMatch(/^Personality: \d+ B → \d+ B$/);
    expect(historySummary({ ...v1, before: undefined, after: undefined, summary: "Renamed" })).toBe("Renamed");
  });

  it("lists the fields of a version and diffs lines", () => {
    expect(versionFields(botVersions(rows)[1]!)).toBe("Personality, Label");
    expect(lineDiff("Keep\nOld", "Keep\nNew")).toEqual([
      { kind: "same", text: "Keep" },
      { kind: "removed", text: "Old" },
      { kind: "added", text: "New" },
    ]);
  });
});

describe("HistorySection: the bot's versions", () => {
  it("shows Loading… before rows arrive, and one row for the empty state", () => {
    expect(render(null)).toContain("Loading…");
    const empty = render([]);
    expect(empty).toContain("No changes recorded yet.");
    expect(empty).toContain('data-settings-group="history"');
    expect(empty).toContain(">Changes</h3>");
  });

  it("lists one row per save, newest first, with an icon, what changed, who and when", () => {
    const html = render(rows);
    expect(html).toContain("data-history-versions");
    expect(versionIds(html)).toEqual(["r4", "r2", "r1"]);
    expect(html).toContain("Name changed");
    expect(html).toContain("Personality, Label changed");
    expect(html).toContain(`The bot · ${niceTime(3000)}`);
    expect(html).toContain(`You · ${niceTime(2000)}`);
    expect(html).toContain('title="api"');
    expect(html).toContain("lucide-");
    // the newest is the current version: a discreet badge, no restore
    expect(html.match(/data-history-current/g)?.length).toBe(1);
    expect(html).toMatch(/data-history-current="" class="shrink-0 rounded-full bg-control px-2 text-\[11px\] leading-4 text-ink-secondary">Current version</);
    expect(html.indexOf("data-history-current")).toBeLessThan(html.indexOf('data-history-version="r2"'));
    expect(html).not.toContain('data-history-restore="r4"');
  });

  it("groups the versions by day: Today, Yesterday, then the date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 15, 0));
    const today = new Date(2026, 10, 6, 14, 30).getTime();
    const yesterday = new Date(2026, 10, 5, 9, 15).getTime();
    const older = new Date(2026, 10, 2, 8, 0).getTime();
    const html = render([
      { id: "d3", at: today, actor: "user", via: "ui", field: "name", summary: "", before: "Ada", after: "Aria" },
      { id: "d2", at: yesterday, actor: "user", via: "ui", field: "name", summary: "", before: "Bot", after: "Ada" },
      { id: "d1", at: older, actor: "user", via: "ui", field: "name", summary: "", before: "", after: "Bot" },
    ]);
    expect([...html.matchAll(/data-history-day="([\d-]+)"/g)].map((m) => m[1])).toEqual(["2026-11-06", "2026-11-05", "2026-11-02"]);
    expect(html).toMatch(/data-history-day="2026-11-06" class="m-0 px-4 pb-1 pt-3 text-\[12px\] font-normal leading-4 text-ink-secondary">Today</);
    expect(html).toMatch(/data-history-day="2026-11-05"[^>]*>Yesterday</);
    const date = new Intl.DateTimeFormat(activeLocale(), { weekday: "short", month: "short", day: "numeric" }).format(new Date(older));
    expect(html).toMatch(new RegExp(`data-history-day="2026-11-02"[^>]*>${date}<`));
    // the same author and field on different days never fold together
    expect(html).not.toContain("data-history-group");
    expect(versionIds(html)).toEqual(["d3", "d2", "d1"]);
  });

  it("folds consecutive versions with the same author and fields into one row ×N", () => {
    const { list, edits } = runOfEdits();
    const html = render(list);
    expect(html).toContain('data-history-group="s12"');
    expect(html).toContain('data-history-count="12"');
    expect(html).toContain("Personality changed");
    expect(html).toContain(">×12<");
    expect(html).toContain(`You · ${niceTime(edits[0]!.at)} to ${niceTime(edits[11]!.at)}`);
    expect(html).toContain('data-history-expand="s12"');
    // folded: the current version alone shows, its twelve stay one row
    expect(versionIds(html)).toEqual(["n1"]);
  });

  it("unfolds a folded row on demand, each version with its time, restore and diff", () => {
    const { list, edits } = runOfEdits();
    const opened = render(list, { defaultOpen: "s5" });
    expect(versionIds(opened)).toEqual(["n1", ...edits.map((row) => row.id).reverse()]);
    expect(opened).toContain('data-history-restore="s5"');
    expect(opened).toContain('data-history-compare="s5"');
    expect(opened).toContain(`>${niceTime(edits[4]!.at)}<`);

    const page = mount(list);
    expect(page.querySelectorAll("[data-history-version]")).toHaveLength(1);
    click(page.querySelector('[data-history-expand="s12"]'));
    expect(page.querySelectorAll("[data-history-version]")).toHaveLength(13);
    expect(page.querySelectorAll("[data-history-restore]")).toHaveLength(12);
    click(page.querySelector('[data-history-version="s3"] button[aria-expanded]'));
    expect(page.querySelector('[data-history-compare="s3"]')).not.toBeNull();
    click(page.querySelector('[data-history-expand="s12"]'));
    expect(page.querySelectorAll("[data-history-version]")).toHaveLength(1);
  });

  it("shows ten rows, then Show N more, ten per click", () => {
    const html = render(many);
    expect(versionIds(html)).toHaveLength(10);
    expect(html).toMatch(/data-history-more=""[^>]*>Show 15 more</);

    const page = mount(many);
    click(page.querySelector("[data-history-more]"));
    expect(page.querySelectorAll("[data-history-version]")).toHaveLength(20);
    expect(page.querySelector("[data-history-more]")?.textContent).toBe("Show 5 more");
    click(page.querySelector("[data-history-more]"));
    expect(page.querySelectorAll("[data-history-version]")).toHaveLength(25);
    expect(page.querySelector("[data-history-more]")).toBeNull();
    // a folded run counts as one row
    expect(render(runOfEdits().list)).not.toContain("data-history-more");
    // a version opened past the first ten still shows
    expect(versionIds(render(many, { defaultOpen: "m1" }))).toHaveLength(25);
  });

  it("compares an opened version with the current one: a line diff of the Personality, then and now for the rest", () => {
    const html = render(rows, { defaultOpen: "r1" });
    expect(html).toContain('data-history-compare="r1"');
    expect(html).toContain('data-history-diff="soul"');
    expect(html).toContain('data-history-diff="name"');
    expect(html).toContain('data-history-diff="title"');
    expect(html).toMatch(/data-diff="removed"[^>]*>- Be brief\./);
    expect(html).toMatch(/data-diff="added"[^>]*>\+ Be thorough\./);
    expect(html).toMatch(/data-diff="same"[^>]*> {2}Cite sources\./);
    expect(html).toContain(">Ada</dd>");
    expect(html).toContain(">Aria</dd>");
    expect(html).toContain("(empty)");
    expect(html).toContain("Name: &quot;Bot&quot; → &quot;Ada&quot;");
  });

  it("says when nothing has changed since a version", () => {
    const back: HistoryRow = { id: "r5", at: 4000, actor: "user", via: "restore", field: "name", summary: "", before: "Aria", after: "Ada" };
    expect(render([back, v3, v1], { defaultOpen: "r1" })).toContain("Nothing has changed since this version.");
  });

  it("offers Restore on every older version, and asks with what comes back", () => {
    const html = render(rows);
    expect(html).toMatch(/data-history-restore="r2"[^>]*>Restore</);
    expect(html).toContain('data-history-restore="r1"');
    expect(html).not.toMatch(/data-history-restore="r2"[^>]*disabled=""/);

    const onRestore = vi.fn();
    const page = mount(rows, { onRestore });
    click(page.querySelector('[data-history-restore="r2"]'));
    expect(onRestore).toHaveBeenCalledWith("r2", "Name");
  });

  it("disables restore while one runs, and names what the history cannot give back", () => {
    expect(render(rows, { restoring: true })).toMatch(/data-history-restore="r2"[^>]*disabled=""/);
    const redacted = [v3, { ...v2soul, canRestore: false }, v2title, v1];
    const html = render(redacted, { defaultOpen: "r1" });
    expect(html).toContain("Left as it is (the history keeps no exact copy): Personality");
  });

  it("marks a version that is itself a restore", () => {
    const restore: HistoryRow = { id: "r5", at: 4000, actor: "user", via: "restore", field: "name", summary: "", before: "Aria", after: "Ada" };
    expect(render([restore, ...rows])).toContain("Version restored");
  });

  it("notes a failed refresh in a plain grey line", () => {
    expect(render(rows, { refreshError: true })).toMatch(/role="note" class="[^"]*text-ink-secondary[^"]*">Couldn’t refresh history\.</);
  });

  it("draws no border under the plain surface, folds and runs open", () => {
    const { list } = runOfEdits();
    const html = renderToStaticMarkup(createElement(SettingsSurfaceProvider, {
      surface: "plain",
      children: createElement(
        Fragment,
        null,
        createElement(HistorySection, { bot, rows: [...list, ...many], onRestore: vi.fn(), defaultOpen: "s5", refreshError: true }),
        createElement(HistorySection, { bot, rows, onRestore: vi.fn(), defaultOpen: "r1" }),
      ),
    }));
    expect(html).toContain("rounded-2xl bg-card py-1");
    expect(html).toContain("data-history-more");
    expect(html).toContain("rounded-lg bg-inset px-3 py-2");
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    expect(classes.filter((name) => /^(border|ring-1|divide-)/.test(name))).toEqual([]);
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = render(rows, { defaultOpen: "r2" });
    expect(html).toContain("Version actuelle");
    expect(html).toContain(">Restaurer<");
    expect(html).toContain("Modifié : Personnalité, Libellé");
  });
});
