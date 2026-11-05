// @vitest-environment happy-dom
// Visible roles, batch 5: the bot panel's Roles tab draws the person's roles
// and transitions, lists an edge's history on click, groups the missing
// permissions by role and sends one to the admins.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RolesTabBody } from "../../../shared/role-graph";

const dispatchMock = vi.fn();
const apiMock = vi.fn();
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => dispatchMock }));
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => apiMock(...args) }));

const { setLocale } = await import("@/lib/i18n");
const { RolesTab, RolesTabView, placeNodes } = await import("./RolesTab");

const AT = Date.UTC(2026, 10, 5, 19, 3);
const body: RolesTabBody = {
  journal: "perspicax",
  nodes: [{ slug: "", name: "", calls: 12 }, { slug: "service-desk", name: "Service Desk", id: "prof-desk", calls: 30 }],
  edges: [
    { from: "service-desk", to: "", count: 3, history: [{ at: AT, source: "both", threadId: "th-1", reason: "fallback", refusedTool: "cw_psa_query" }] },
    { from: "", to: "service-desk", count: 2, history: [] },
  ],
  missing: [{ id: "r1", role: { slug: "service-desk", name: "Service Desk" }, permission: { module: "Time & Expense", func: "Time Entry", path: "time/entries", operation: "Add" }, kind: "write", member: "nova", tools: ["cw_psa_log_time"], lastAt: AT, count: 2 }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("fr");
  dispatchMock.mockReset();
  apiMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Roles tab", () => {
  it("draws role names and counts, never a profile id outside a tooltip", () => {
    flushSync(() => root.render(createElement(RolesTabView, { botId: "nova", body })));
    const nodes = [...host.querySelectorAll("[data-role-node]")].map((node) => node.querySelector("text")?.textContent);
    expect(nodes).toEqual(["Moi", "Service Desk"]);
    const edge = host.querySelector('[data-role-edge="service-desk→"]')!;
    expect(edge.getAttribute("aria-label")).toBe("De Service Desk à Moi : 3 fois");
    // the id only in the node's <title> tooltip
    const visible = [...host.querySelectorAll("text, p, h2, h3, span, button")].map((el) => el.textContent).join(" ");
    expect(visible).not.toContain("prof-desk");
    expect(host.querySelector('[data-role-node="service-desk"] title')?.textContent).toContain("prof-desk");
  });

  it("shows an edge's history on click and opens its conversation", async () => {
    apiMock.mockResolvedValue(body);
    flushSync(() => root.render(createElement(RolesTab, { botId: "nova" })));
    await settle();
    flushSync(() => {});
    flushSync(() => (host.querySelector('[data-role-edge="service-desk→"]') as unknown as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const history = host.querySelector("[data-role-edge-history]")!;
    expect(history.textContent).toContain("Service Desk vers Moi");
    expect(history.textContent).toContain("Lecture refusée, relue une fois en Moi");
    expect(history.textContent).toMatch(/14 h 03|14:03/);
    flushSync(() => (history.querySelector("[data-role-thread]") as HTMLButtonElement).click());
    expect(dispatchMock).toHaveBeenCalledWith({ type: "switchTask", botId: "nova", threadId: "th-1" });
    expect(dispatchMock).toHaveBeenCalledWith({ type: "revealThread", threadId: "th-1" });
  });

  it("groups missing permissions by role, names the security role, and sends to the admins", async () => {
    apiMock.mockResolvedValue({ ok: true, sentAt: AT + 60_000 });
    flushSync(() => root.render(createElement(RolesTabView, { botId: "nova", body })));
    const group = host.querySelector('[data-missing-role="service-desk"]')!;
    expect(group.textContent).toContain("Time & Expense › Time Entry");
    expect(group.textContent).toContain("time/entries");
    expect(group.textContent).toContain("Ajouter");
    expect(group.textContent).toContain("Rôle de sécurité de nova");
    expect(group.textContent).toContain("Refusé 2 fois");
    flushSync(() => (host.querySelector('[data-missing-send="r1"]') as HTMLButtonElement).click());
    await settle();
    flushSync(() => {});
    expect(apiMock).toHaveBeenCalledWith("/api/bots/nova/roles/missing/send", { method: "POST", body: JSON.stringify({ id: "r1" }) });
    expect(host.querySelector("[data-missing-sent]")?.textContent).toContain("Envoyé");
  });

  it("says in one quiet line when the counts come from Sagax alone", async () => {
    apiMock.mockResolvedValue({ ...body, journal: "local" });
    flushSync(() => root.render(createElement(RolesTab, { botId: "nova" })));
    await settle();
    flushSync(() => {});
    expect(apiMock).toHaveBeenCalledWith("/api/bots/nova/roles");
    expect(host.querySelector("[data-roles-local]")?.textContent).toContain("Le journal de Perspicax n'a pas répondu");
  });

  it("places one node in the middle and several on a circle", () => {
    expect(placeNodes([{ slug: "", name: "", calls: 0 }])[0]).toMatchObject({ x: 160, y: 115 });
    const three = placeNodes([{ slug: "", name: "", calls: 0 }, { slug: "a", name: "A", calls: 1 }, { slug: "b", name: "B", calls: 1 }]);
    expect(three[0]!.y).toBeLessThan(three[1]!.y);
  });
});
