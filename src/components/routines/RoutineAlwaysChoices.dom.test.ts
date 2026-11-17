// @vitest-environment happy-dom
// #4558: the routine page lists the person's "always" answers on its cards
// and removes one; nothing shows when there is none.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ calls: [] as string[], choices: [] as Array<{ id: string; answer: string; question: string; options: string[]; at: number }> }));
vi.mock("@/state/store", async (load) => {
  const original = await load<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async (path: string, init?: { method?: string }) => {
    fixture.calls.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "DELETE") return { ok: true };
    return { choices: fixture.choices };
  }) };
});
const { RoutineAlwaysChoices } = await import("./RoutineAlwaysChoices");
const { loadLocale } = await import("@/lib/i18n");

let host: HTMLDivElement; let root: Root;
beforeAll(async () => { await loadLocale("fr"); });
beforeEach(() => { fixture.calls = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}

describe("the routine page's \"always\" answers (#4558)", () => {
  it("lists each card kind with its answer and removes one", async () => {
    fixture.choices = [
      { id: "0123456789abcdef", answer: "Approuver", question: "Approuver cette entrée de temps ?", options: ["Approuver", "Refuser"], at: Date.UTC(2026, 10, 17, 15) },
      { id: "fedcba9876543210", answer: "Archiver", question: "Archiver ce courriel ?", options: [], at: Date.UTC(2026, 10, 16, 15) },
    ];
    await act(async () => { root.render(createElement(RoutineAlwaysChoices, { routineId: "r1" })); });
    await settle();
    expect(fixture.calls).toEqual(["GET /api/routines/r1/always-choices"]);
    expect(host.querySelector("h3")?.textContent).toBe("Réponses « toujours »");
    const rows = [...host.querySelectorAll("[data-routine-always-choice]")];
    expect(rows.map((row) => row.getAttribute("data-routine-always-choice"))).toEqual(["0123456789abcdef", "fedcba9876543210"]);
    // the question and the options in words, never a key
    expect(rows[0]!.textContent).toContain("Approuver cette entrée de temps ?");
    // what it covers: that question for any item of its kind, with its options
    expect(rows[0]!.textContent).toContain("Cette question pour tout objet de ce genre, avec Approuver · Refuser");
    expect(rows[1]!.textContent).toContain("Cette question pour tout objet de ce genre ·");
    expect(rows[0]!.textContent).toContain("Choisie le");
    expect(host.textContent).not.toMatch(/ticket|0123456789abcdef/);
    await act(async () => { (rows[0]!.querySelector("[data-routine-always-remove]") as HTMLButtonElement).click(); });
    await settle();
    expect(fixture.calls).toContain("DELETE /api/routines/r1/always-choices/0123456789abcdef");
    expect([...host.querySelectorAll("[data-routine-always-choice]")].map((row) => row.getAttribute("data-routine-always-choice"))).toEqual(["fedcba9876543210"]);
  });

  it("shows nothing when the person has no \"always\" answer", async () => {
    fixture.choices = [];
    await act(async () => { root.render(createElement(RoutineAlwaysChoices, { routineId: "r1" })); });
    await settle();
    expect(host.innerHTML).toBe("");
  });
});
