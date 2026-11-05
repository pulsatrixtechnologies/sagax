// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine } from "@/lib/routines";
import type { HeldRole } from "../../../shared/perspicax-roles";
import type { RoutineRoleCoverageAnswer } from "../../../shared/routine-role-coverage";
import { routineRoleCoverageAnswer } from "../../../shared/routine-role-coverage";

const fixture = vi.hoisted(() => ({ calls: [] as string[], answer: null as unknown }));
vi.mock("@/state/store", async (load) => {
  const original = await load<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    fixture.calls.push(`${init?.method ?? "GET"} ${path}${init?.body ? ` ${init.body}` : ""}`);
    if (path.includes("/roles/routine-coverage")) return fixture.answer;
    if (path.endsWith("/check")) return { ok: true, checkedAt: 1, checks: [{ kind: "flow", ok: true, code: "ready", line: "Ready." }] };
    return {};
  }), useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});
const { RoutineActAsField, RoleCoveragePreview, actAsToSave, mandateItemLabel } = await import("./RoutineActAsField");
const { RoutineDetail } = await import("./RoutineDetail");
const { RoutineConfiguration } = await import("./RoutineConfiguration");
const { loadLocale } = await import("@/lib/i18n");

const desk: HeldRole = { slug: "service-desk", name: "Service Desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true } };
const reader: HeldRole = { slug: "reader", name: "Lecture", readOnly: true, explicitOnly: false, reachable: true, can: { read: true, write: false } };
const answer = (over: Partial<Parameters<typeof routineRoleCoverageAnswer>[0]> = {}): RoutineRoleCoverageAnswer => routineRoleCoverageAnswer({
  held: [reader, desk], mandate: ["schedule_create", "status_change"], serverProfiles: ["service-desk"], refusals: [], recipe: "morning-pass", ...over,
});
const routine = { id: "r1", name: "Morning pass", botId: "nova", prompt: "Run routine: morning-pass", target: "bot", runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1] }, createdAt: 1, updatedAt: 1, nextRunAt: null, durationMinutes: 30 } as Routine;

let host: HTMLDivElement; let root: Root;
beforeAll(async () => { await loadLocale("fr"); });
beforeEach(() => { fixture.calls = []; fixture.answer = answer(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("\"Au nom de\" coverage preview (2026-11-05)", () => {
  it("is green when the role covers the mandate, items in words", () => {
    flushSync(() => root.render(createElement(RoleCoveragePreview, { answer: answer(), slug: "service-desk", onUse: () => {} })));
    expect(host.querySelector("[data-role-coverage]")?.getAttribute("data-role-coverage")).toBe("ok");
    expect(host.querySelector("[data-coverage-covered]")?.textContent).toContain("Créer des entrées de cédule");
    expect(host.querySelector("[data-coverage-covered]")?.textContent).toContain("Changer le statut des billets");
    expect(host.querySelector("[data-coverage-not-covered]")?.textContent).toContain("Rien");
    expect(host.querySelector("[data-role-use]")).toBeNull();
    expect(host.textContent).toContain("Service Desk couvre tout ce que la routine écrit.");
  });

  it("is amber for a read-only role, shows unknown items as code and known refused reads, and offers the minimal role", () => {
    const onUse = vi.fn();
    const amber = answer({ mandate: ["schedule_create", "custom_step"], refusals: [{ role: "reader", path: "schedule/holidayLists", operation: "Inquire" }] });
    flushSync(() => root.render(createElement(RoleCoveragePreview, { answer: amber, slug: "reader", onUse })));
    expect(host.querySelector("[data-role-coverage]")?.getAttribute("data-role-coverage")).toBe("partial");
    const missing = host.querySelector("[data-coverage-not-covered]")!;
    expect(missing.querySelector("[data-coverage-missing=custom_step] code")?.textContent).toBe("custom_step");
    expect(missing.textContent).toContain("rôle en lecture seule");
    expect(missing.querySelector("[data-coverage-refused-read]")?.textContent).toContain("schedule/holidayLists");
    const use = host.querySelector<HTMLButtonElement>("[data-role-use]")!;
    expect(use.textContent).toBe("Utiliser Service Desk");
    use.click();
    expect(onUse).toHaveBeenCalledWith("service-desk");
  });

  it("an empty mandate (not a Flow routine) is read only and green", () => {
    flushSync(() => root.render(createElement(RoleCoveragePreview, { answer: answer({ mandate: [], serverProfiles: [], recipe: undefined }), slug: "reader" })));
    expect(host.querySelector("[data-role-coverage]")?.getAttribute("data-role-coverage")).toBe("ok");
    expect(host.textContent).toContain("Rien à écrire : lecture seulement.");
  });

  it("the field lists Moi and the held roles, marks the suggestion while nothing is chosen", () => {
    flushSync(() => root.render(createElement(RoutineActAsField, { coverage: { answer: answer() }, value: undefined, onChange: () => {} })));
    expect(host.querySelector("[data-routine-act-as]")?.getAttribute("data-routine-act-as")).toBe("service-desk");
    expect(host.textContent).toContain("Au nom de");
    expect(host.textContent).toContain("Service Desk (suggéré)");
  });

  it("a routine that does not run a Flow recipe shows no role field and saves no role", () => {
    flushSync(() => root.render(createElement(RoutineActAsField, { coverage: { answer: answer({ recipe: undefined }) }, value: undefined, onChange: () => {} })));
    expect(host.querySelector("[data-routine-act-as]")).toBeNull();
    expect(actAsToSave(undefined, undefined, answer({ recipe: undefined }))).toBeUndefined();
  });
  it("names its mandate items and leaves unknown ones unnamed", () => {
    expect(mandateItemLabel("invoice_status")).toBe("Changer le statut des factures");
    expect(mandateItemLabel("custom_step")).toBeNull();
  });

  it("auto-picks the minimal role on save only when nothing was chosen", () => {
    expect(actAsToSave(undefined, undefined, answer())).toBe("service-desk");
    expect(actAsToSave(undefined, undefined, undefined)).toBeUndefined();
    expect(actAsToSave("", undefined, answer())).toBeUndefined();
    expect(actAsToSave("reader", undefined, answer())).toBeUndefined();
    expect(actAsToSave("reader", "", answer())).toBe("");
  });

  it("on the routine page: reads the run-as person's coverage, changes the role in place and tests it", async () => {
    const onPatch = vi.fn(async () => {});
    await act(async () => root.render(createElement(RoutineDetail, { routine: { ...routine, actAs: "reader" }, runs: [], bots: [], canRun: true, onRunNow: () => {}, onOpenRun: () => {}, onPatch })));
    expect(fixture.calls).toContain("GET /api/bots/nova/roles/routine-coverage?routineId=r1");
    expect(host.querySelector("[data-role-coverage]")?.getAttribute("data-role-coverage")).toBe("partial");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-role-use]")!.click());
    expect(onPatch).toHaveBeenCalledWith({ actAs: "service-desk" });
    expect(host.querySelector("[data-role-coverage]")?.getAttribute("data-role-coverage")).toBe("ok");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-role-test]")!.click());
    expect(fixture.calls).toContain("POST /api/routines/r1/check");
  });

  it("the routine page shows nothing on a server without roles", async () => {
    fixture.answer = {};
    await act(async () => root.render(createElement(RoutineDetail, { routine, runs: [], bots: [], onOpenRun: () => {} })));
    expect(host.querySelector("[data-routine-act-as]")).toBeNull();
  });

  it("the configuration shows the run's role, read only", () => {
    flushSync(() => root.render(createElement(RoutineConfiguration, { routine: { ...routine, actAs: "service-desk" }, run: { actAs: "" } as never, bots: [] })));
    expect(host.querySelector("[data-routine-config-act-as]")?.textContent).toBe("Au nom deMoi");
  });
});
