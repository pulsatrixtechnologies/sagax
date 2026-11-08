// @vitest-environment happy-dom
// Details > Permissions (2026-11-05): no Roles tab; a recent refusal is ONE
// row (label, grey state, "Envoyer à l'admin"), the roles graph and an edge's
// history behind its disclosure. Nothing shows without a recent refusal.
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
const { setShowThreads } = await import("@/lib/thread-preferences");
const { setShowPermissions, SHOW_PERMISSIONS_KEY } = await import("@/lib/panel-visibility");
const { RolePermissionsSection, RolePermissionsView, placeNodes, easternTime } = await import("./RolePermissionsSection");

const AT = Date.UTC(2026, 10, 5, 19, 3);
const body: RolesTabBody = {
  journal: "perspicax",
  nodes: [{ slug: "", name: "", calls: 12 }, { slug: "service-desk", name: "Service Desk", id: "prof-desk", calls: 30 }],
  edges: [
    { from: "service-desk", to: "", count: 3, history: [{ at: AT, source: "both", threadId: "th-1", reason: "fallback", refusedTool: "cw_psa_query" }] },
    { from: "", to: "service-desk", count: 2, history: [] },
  ],
  missing: [
    { id: "r1", role: { slug: "dispatch-agent", name: "Dispatch Agent" }, permission: { module: "", func: "service.tickets", path: "service.tickets", operation: "Edit" }, kind: "write", tools: ["cw_psa_update_ticket"], lastAt: AT, count: 1 },
    { id: "r2", role: { slug: "service-desk", name: "Service Desk" }, permission: { module: "Time & Expense", func: "Time Entry", path: "time/entries", operation: "Add" }, kind: "write", member: "nova", tools: ["cw_psa_log_time"], lastAt: AT - 3_600_000, count: 2 },
  ],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("fr");
  setShowPermissions(true);
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

const visibleText = () => [...host.querySelectorAll("text, p, h2, h3, span, button, summary, li")].map((el) => el.textContent).join(" ");
const openDetails = () => { (host.querySelector("[data-missing-details]") as HTMLDetailsElement).open = true; };

describe("Details > Permissions", () => {
  it("shows one row in French: label, grey state, the send action; no path twice, no uppercase header, no id", () => {
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body, now: AT })));
    expect(host.querySelectorAll("[data-missing-permission-row]")).toHaveLength(1);
    expect(host.querySelector("h2")?.textContent).toBe("Permissions");
    expect(host.querySelector("[data-missing-label]")?.textContent).toBe("Dispatch Agent ne peut pas modifier les billets");
    expect(host.querySelector("[data-missing-state]")?.textContent).toBe(`refusé 1 fois, dernier ${easternTime(AT)} · 1 autre permission`);
    expect(easternTime(AT)).toMatch(/^5 nov\.? 14:03$/);
    expect(host.querySelector("[data-missing-send]")?.textContent).toBe("Envoyer à l'admin");
    const text = visibleText();
    expect(text).not.toContain("service.tickets");
    expect(text).not.toMatch(/Roles this bot used|Missing permissions|Refused|journal/);
    expect(host.querySelector(".uppercase")).toBeNull();
    expect(text).not.toContain("prof-desk");
  });

  it("says the plural right", () => {
    const one = { ...body, missing: [body.missing[1]!] };
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body: one, now: AT })));
    expect(host.querySelector("[data-missing-label]")?.textContent).toBe("Service Desk ne peut pas ajouter les entrées de temps");
    expect(host.querySelector("[data-missing-state]")?.textContent).toContain("refusé 2 fois, dernier");
  });

  it("shows nothing without a recent refusal", () => {
    const old = { ...body, missing: body.missing.map((entry) => ({ ...entry, lastAt: AT - 8 * 24 * 3_600_000 })) };
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body: old, now: AT })));
    expect(host.querySelector("[data-bot-settings-section]")).toBeNull();
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body: { ...body, missing: [] }, now: AT })));
    expect(host.innerHTML).toBe("");
  });

  it("keeps the graph, the refusals and the security role to fix behind the disclosure, never the internal journal line", () => {
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body: { ...body, journal: "local" }, now: AT })));
    openDetails();
    const details = host.querySelector("[data-missing-details]")!;
    expect(details.querySelectorAll("[data-missing-permission]")).toHaveLength(2);
    expect(details.textContent).toContain("Rôle de sécurité de nova");
    expect(details.textContent).toContain("Rôle de sécurité derrière Dispatch Agent");
    const nodes = [...host.querySelectorAll("[data-role-node]")].map((node) => node.querySelector("text")?.textContent);
    expect(nodes).toEqual(["Moi", "Service Desk"]);
    expect(host.querySelector('[data-role-edge="service-desk→"]')!.getAttribute("aria-label")).toBe("De Service Desk à Moi : 3 fois");
    expect(host.querySelector('[data-role-node="service-desk"] title')?.textContent).toContain("prof-desk");
    expect(details.textContent).not.toContain("Perspicax");
  });

  async function edgeHistory(): Promise<Element> {
    apiMock.mockResolvedValue({ ...body, missing: body.missing.map((entry) => ({ ...entry, lastAt: Date.now() })) });
    flushSync(() => root.render(createElement(RolePermissionsSection, { botId: "nova" })));
    await settle();
    flushSync(() => {});
    openDetails();
    flushSync(() => (host.querySelector('[data-role-edge="service-desk→"]') as unknown as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    return host.querySelector("[data-role-edge-history]")!;
  }

  it("never links to another thread in the unified chat (Show threads off)", async () => {
    setShowThreads(false);
    const history = await edgeHistory();
    expect(history.textContent).toContain("Lecture refusée, relue une fois en Moi");
    expect(history.querySelector("[data-role-thread]")).toBeNull();
    expect(history.textContent).not.toContain("Ouvrir la conversation");
  });

  it("reads the bot's roles, shows an edge's history and opens its conversation in thread mode", async () => {
    setShowThreads(true);
    apiMock.mockResolvedValue({ ...body, missing: body.missing.map((entry) => ({ ...entry, lastAt: Date.now() })) });
    flushSync(() => root.render(createElement(RolePermissionsSection, { botId: "nova" })));
    await settle();
    flushSync(() => {});
    expect(apiMock).toHaveBeenCalledWith("/api/bots/nova/roles");
    openDetails();
    flushSync(() => (host.querySelector('[data-role-edge="service-desk→"]') as unknown as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const history = host.querySelector("[data-role-edge-history]")!;
    expect(history.textContent).toContain("Service Desk vers Moi");
    expect(history.textContent).toContain("Lecture refusée, relue une fois en Moi");
    expect(history.textContent).toMatch(/14:03/);
    flushSync(() => (history.querySelector("[data-role-thread]") as HTMLButtonElement).click());
    expect(dispatchMock).toHaveBeenCalledWith({ type: "switchTask", botId: "nova", threadId: "th-1" });
    expect(dispatchMock).toHaveBeenCalledWith({ type: "revealThread", threadId: "th-1" });
    setShowThreads(false);
  });

  it("shows nothing when the roles cannot be read", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    flushSync(() => root.render(createElement(RolePermissionsSection, { botId: "nova" })));
    await settle();
    flushSync(() => {});
    expect(host.innerHTML).toBe("");
  });

  it("sends every unsent refusal to the admins and then says when, in grey", async () => {
    apiMock.mockResolvedValue({ ok: true, sentAt: AT + 60_000 });
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body, now: AT })));
    flushSync(() => (host.querySelector("[data-missing-send]") as HTMLButtonElement).click());
    await settle();
    await settle();
    flushSync(() => {});
    expect(apiMock).toHaveBeenCalledWith("/api/bots/nova/roles/missing/send", { method: "POST", body: JSON.stringify({ id: "r1" }) });
    expect(apiMock).toHaveBeenCalledWith("/api/bots/nova/roles/missing/send", { method: "POST", body: JSON.stringify({ id: "r2" }) });
    expect(host.querySelector("[data-missing-send]")).toBeNull();
    expect(host.querySelector("[data-missing-sent]")?.textContent).toBe(`Envoyé ${easternTime(AT + 60_000)}`);
  });

  it("says Tu, never Moi, when the person's own credentials were refused", () => {
    const own = { ...body, missing: [{ ...body.missing[0]!, role: { slug: "", name: "" } }] };
    flushSync(() => root.render(createElement(RolePermissionsView, { botId: "nova", body: own, now: AT })));
    expect(host.querySelector("[data-missing-label]")?.textContent).toBe("Tu ne peux pas modifier les billets");
  });

  describe("Settings > Appearance > Show permissions (the owner 2026-11-07)", () => {
    const render = async () => {
      apiMock.mockResolvedValue({ ...body, missing: body.missing.map((entry) => ({ ...entry, lastAt: Date.now() })) });
      flushSync(() => root.render(createElement(RolePermissionsSection, { botId: "nova" })));
      await settle();
      flushSync(() => {});
    };

    it("is hidden by default: no section and no roles read", async () => {
      localStorage.removeItem(SHOW_PERMISSIONS_KEY);
      await render();
      expect(host.querySelector('[data-bot-settings-section="permissions"]')).toBeNull();
      expect(apiMock).not.toHaveBeenCalled();
    });

    it("stays hidden when switched off", async () => {
      setShowPermissions(false);
      await render();
      expect(host.querySelector('[data-bot-settings-section="permissions"]')).toBeNull();
    });

    it("shows the section when switched on, and hides it again live", async () => {
      setShowPermissions(true);
      await render();
      expect(host.querySelector('[data-bot-settings-section="permissions"]')).not.toBeNull();
      flushSync(() => setShowPermissions(false));
      expect(host.querySelector('[data-bot-settings-section="permissions"]')).toBeNull();
    });
  });

  it("places one node in the middle and several on a circle", () => {
    expect(placeNodes([{ slug: "", name: "", calls: 0 }])[0]).toMatchObject({ x: 160, y: 115 });
    const three = placeNodes([{ slug: "", name: "", calls: 0 }, { slug: "a", name: "A", calls: 1 }, { slug: "b", name: "B", calls: 1 }]);
    expect(three[0]!.y).toBeLessThan(three[1]!.y);
  });
});
