// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine } from "@/lib/routines";
const fixture = vi.hoisted(() => ({ calls: [] as string[], resolve: null as null | ((value: unknown) => void) }));
vi.mock("@/state/store", async (load) => {
  const original = await load<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async (path: string, init?: { method?: string }) => {
    fixture.calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/check")) return new Promise(resolve => { fixture.resolve = resolve; });
    return {};
  }), useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});
const { RoutineDetail } = await import("./RoutineDetail");
const { routineRunBlockedLine } = await import("@/lib/routine-display");
const { loadLocale } = await import("@/lib/i18n");
const routine = { id: "r1", name: "Inbox review", botId: "osprey", prompt: "Read the inbox.", target: "bot", runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1] }, createdAt: 1, updatedAt: 1, nextRunAt: null, durationMinutes: 30 } as Routine;
const checks = [
  { kind: "engine", ok: true, code: "ready", line: "Known ready." },
  { kind: "skills", ok: false, code: "skill_missing", params: { skill: "inbox-review" }, line: "EN wire error." },
  { kind: "mcp", ok: false, code: "mcp_missing", params: { server: "outlook" }, line: "EN wire error." },
  { kind: "perspicax", ok: true, code: "ready", line: "Known ready." },
  { kind: "computer", ok: true, code: "ready", line: "Known ready." },
] as const;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { fixture.calls = []; fixture.resolve = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
describe("routine readiness in the detail", () => {
  it.each(["en", "fr"])("checks on demand, shows failures first and translates codes in %s", async (lang) => {
    await loadLocale(lang);
    flushSync(() => root.render(createElement(RoutineDetail, { routine, runs: [], bots: [], canRun: true, onRunNow: () => {}, onOpenRun: () => {} })));
    const button = host.querySelector<HTMLButtonElement>("[data-routine-check]")!;
    expect(button.textContent).toBe(lang === "en" ? "Check routine" : "Vérifier la routine");
    await act(async () => button.click());
    expect(fixture.calls).toContain("POST /api/routines/r1/check");
    expect(button.disabled).toBe(true); expect(button.textContent).toContain(lang === "en" ? "Checking..." : "Vérification...");
    await act(async () => { fixture.resolve!({ ok: false, checks, checkedAt: Date.UTC(2026, 10, 4, 14, 30) }); });
    expect(button.disabled).toBe(false);
    const rows = [...host.querySelectorAll("[data-readiness-ok]")];
    expect(rows).toHaveLength(5);
    expect(rows.map(row => row.getAttribute("data-readiness-ok"))).toEqual(["false", "false", "true", "true", "true"]);
    expect(rows[0]!.textContent).toContain(lang === "en" ? "Skill `inbox-review`" : "Le skill `inbox-review`");
    expect(host.textContent).not.toContain("routineReadiness."); expect(host.textContent).not.toContain("EN wire error");
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-04T14:30:00.000Z");
    expect(routineRunBlockedLine({ readiness: [...checks] })).toContain(lang === "en" ? "Skill `inbox-review`" : "Le skill `inbox-review`");
  });
  it("does not offer checks without Run now rights", async () => {
    await loadLocale("en");
    flushSync(() => root.render(createElement(RoutineDetail, { routine, runs: [], bots: [], canRun: false, onOpenRun: () => {} })));
    expect(host.querySelector("[data-routine-check]")).toBeNull();
  });
});
