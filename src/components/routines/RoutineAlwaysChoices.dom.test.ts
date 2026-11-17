// @vitest-environment happy-dom
// #4558: the routine page lists the person's "always" answers on its cards
// and removes one; nothing shows when there is none.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ calls: [] as string[], choices: [] as Array<{ kind: string; answer: string; at: number }> }));
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
    fixture.choices = [{ kind: "ticket", answer: "Approuver", at: Date.UTC(2026, 10, 17, 15) }, { kind: "inbox-review", answer: "Archiver", at: Date.UTC(2026, 10, 16, 15) }];
    await act(async () => { root.render(createElement(RoutineAlwaysChoices, { routineId: "r1" })); });
    await settle();
    expect(fixture.calls).toEqual(["GET /api/routines/r1/always-choices"]);
    expect(host.querySelector("h3")?.textContent).toBe("Réponses « toujours »");
    const rows = [...host.querySelectorAll("[data-routine-always-choice]")];
    expect(rows.map((row) => row.getAttribute("data-routine-always-choice"))).toEqual(["ticket", "inbox-review"]);
    expect(rows[0]!.textContent).toContain("Approuver");
    expect(rows[0]!.textContent).toContain("Choisie le");
    await act(async () => { (rows[0]!.querySelector("[data-routine-always-remove]") as HTMLButtonElement).click(); });
    await settle();
    expect(fixture.calls).toContain("DELETE /api/routines/r1/always-choices/ticket");
    expect([...host.querySelectorAll("[data-routine-always-choice]")].map((row) => row.getAttribute("data-routine-always-choice"))).toEqual(["inbox-review"]);
  });

  it("shows nothing when the person has no \"always\" answer", async () => {
    fixture.choices = [];
    await act(async () => { root.render(createElement(RoutineAlwaysChoices, { routineId: "r1" })); });
    await settle();
    expect(host.innerHTML).toBe("");
  });
});
