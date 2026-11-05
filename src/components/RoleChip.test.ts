// @vitest-environment happy-dom
// Visible roles (2026-11-05): the role chip on a Perspicax step, its "why",
// the "Agit comme" card and the banner of a refused write.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";

const posted: Array<{ path: string; body: unknown }> = [];
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string, init?: RequestInit) => { posted.push({ path, body: JSON.parse(String(init?.body ?? "null")) }); return { ok: true }; },
}));

const { ToolActivity } = await import("./ToolActivity");
const { RoleTransitionCard } = await import("./RoleTransitionCard");
const { RoleNoticeRow } = await import("./RoleNoticeRow");

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });
function mount(element: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}
beforeAll(() => setLocale("fr"));

describe("role chip", () => {
  it("no role anywhere on a chat step, even when the detail is open (JC #2033)", () => {
    const tool = { name: "cw_psa_find_tickets", ok: true, role: { slug: "service-desk", name: "Service Desk", reason: "routine" as const } };
    const view = mount(createElement(ToolActivity, { tool, defaultOpen: true }));
    expect(view.querySelector("[data-role-chip]")).toBeNull();
    expect(view.querySelector("[data-testid='tool-step-role']")).toBeNull();
    expect(view.textContent).not.toContain("Service Desk");
    expect(view.textContent).not.toContain("Agit comme");
  });
});

describe("Agit comme card", () => {
  const message = (choice?: "stay"): Message => ({
    id: "m1", role: "bot", kind: "options", at: 0, text: "",
    card: { title: "", subtitle: "", options: ["Continuer", "Rester en Service Desk", "Toujours ainsi pour ce bot"], ...(choice ? { answered: "Rester en Service Desk" } : {}),
      roleTransition: { botId: "b1", botName: "Nova", person: "Alex Martin", from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, reason: "fallback", refusedTool: "cw_psa_query", path: "schedule/holidayLists", canAlways: true, ...(choice ? { choice } : {}) } },
  } as Message);

  it("says who switches, why and on whose behalf, and answers on its own route", () => {
    posted.length = 0;
    const view = mount(createElement(RoleTransitionCard, { message: message(), threadId: "t1" }));
    expect(view.querySelector("[data-role-transition-text]")!.textContent).toMatch(/^Nova passe de Service Desk à Moi : .+ est refusé \(403\)\. Au nom d.Alex Martin\.$/);
    const choices = [...view.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")];
    expect(choices.map((choice) => choice.textContent)).toEqual(["AContinuer", "BRester en Service Desk", "CToujours ainsi pour ce bot"]);
    flushSync(() => choices[2]!.click());
    expect(posted).toEqual([{ path: "/api/bots/b1/cards/m1/role-transition", body: { threadId: "t1", choice: "always" } }]);
  });

  it("shows the answer once settled", () => {
    const view = mount(createElement(RoleTransitionCard, { message: message("stay"), threadId: "t1" }));
    expect(view.textContent).toContain("Reste en Service Desk");
    expect(view.querySelectorAll("[data-ask-choice]:not(:disabled)").length).toBe(0);
  });
});

describe("role notice", () => {
  it("names the missing permission and the member's security role", () => {
    const view = mount(createElement(RoleNoticeRow, { botName: "Nova", notice: { kind: "write_refused", role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_log_time", target: "cw_member:nova", permission: { path: "time/entries", module: "Time & Expense", func: "Time Entry", operation: "Add" } } }));
    expect(view.textContent).toContain("Écriture refusée sous Service Desk. Nova s'est arrêté.");
    expect(view.textContent).toContain("Permission manquante : Time & Expense › Time Entry (time/entries) · Ajouter");
    expect(view.textContent).toContain("Rôle de sécurité de nova");
  });
});

describe("owner role rules", async () => {
  const { roleRuleText } = await import("./bot-settings/RoleRulesCard");
  it("reads a saved rule in plain words", () => {
    expect(roleRuleText({ id: "r", ownerId: "o", createdAt: 0, from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, path: "schedule/holidayLists" }))
      .toBe("Quand Service Desk est refusé en lecture sur schedule/holidayLists, lire comme Moi.");
  });
});
