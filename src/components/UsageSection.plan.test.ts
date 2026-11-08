// @vitest-environment happy-dom
// Settings > Usage, 2026-10-16: the Plan card was gone from the owner's desktop
// (0.5.7, after #583): only Cost was drawn. The card returned nothing while it
// loaded, after a failed read and when no provider answered, so any of those
// erased it. It is now always drawn under Cost, with the 5-hour session and
// the week each on their own gauge, for an admin and a member, in an
// organization and solo. Since #2080 (2026-11-05) it is a folded row of
// Detail, under the headline.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { PlanProvider, PlanUsageReport } from "@/lib/plan-usage";

const scene = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  org: null as unknown,
  plan: null as unknown,
  planFails: false,
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async (path: string) => {
    if (path.startsWith("/api/plan-usage")) {
      if (scene.planFails) throw new Error("forbidden");
      return scene.plan;
    }
    return { groups: [], total: { key: "total", label: "Total", turns: 4, costUsd: 12 } };
  }),
  useStore: () => ({ state: { instances: [], bots: [], config: scene.config }, dispatch: () => {} }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => scene.org,
}));

import { UsageSection } from "./UsageSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const claude: PlanProvider = {
  id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null,
  access: "subscription", instanceId: "claude", failure: null, state: "windows",
  fiveHour: { available: true, remainingPercent: 73, usedPercent: 27, resetsAt: "2026-10-16T18:00:00Z" },
  weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: "2026-10-21T23:59:00Z" },
  extra: [], models: [],
};
const report: PlanUsageReport = { providers: [claude] };
const ORG = { org: { identity: { issuer: "https://px.example.test" } } };

let host: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(UsageSection)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

beforeEach(() => {
  setLocale("fr");
  scene.plan = report;
  scene.planFails = false;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  setLocale("en");
});

const roles = [
  { name: "admin d'organisation", org: ORG, config: { viewer: { role: "admin" } } },
  { name: "membre d'organisation", org: ORG, config: { viewer: { role: "member", capabilities: { viewUsage: false } } } },
  { name: "admin solo", org: null, config: { viewer: { role: "owner" } } },
];

describe("Réglages > Utilisation : Forfait dans Détail, sous la carte de tête", () => {
  for (const role of roles) {
    it(`${role.name} : Forfait avec la session de 5 heures et la semaine`, async () => {
      scene.org = role.org;
      scene.config = role.config;
      const page = await mount();
      const html = page.innerHTML;
      const head = html.indexOf('data-settings-card="usage.headline"');
      const plan = html.indexOf('data-settings-card="usage.planDetail"');
      expect(head).toBeGreaterThanOrEqual(0);
      expect(plan).toBeGreaterThan(head);
      expect(page.querySelector("[data-usage-cost]")?.textContent).toContain("12,00");
      const card = page.querySelector('[data-settings-card="usage.planDetail"]')!;
      expect(card.textContent).toContain("Forfait");
      expect(card.querySelector('[data-plan-row="claude"]')).not.toBeNull();
      expect(card.querySelector('[data-plan-window-kind="fiveHour"]')?.textContent).toContain("Session de 5 heures");
      expect(card.querySelector('[data-plan-window-kind="weekly"]')?.textContent).toContain("Semaine · se renouvelle ");
      expect(card.textContent).toContain("27 % utilisé");
      expect(card.textContent).toContain("73 % restant");
      expect(card.textContent).toContain("40 % utilisé");
      expect(card.textContent).toContain("60 % restant");
      expect(card.querySelectorAll('[role="meter"]')).toHaveLength(2);
      expect(page.querySelector('[data-usage-unavailable]')).toBeNull();
    });
  }

  it("membre solo : la carte reste, avec une ligne claire, sans demander au serveur", async () => {
    scene.org = null;
    scene.config = { viewer: { role: "member", capabilities: { viewUsage: false } } };
    const page = await mount();
    const card = page.querySelector('[data-settings-card="usage.plan"]');
    expect(card).not.toBeNull();
    expect(card!.querySelector('[data-plan-status="unavailable"]')?.textContent).toContain("Forfait indisponible pour ce compte.");
  });

  it("une lecture qui échoue laisse la carte avec « Forfait indisponible pour ce compte »", async () => {
    scene.org = ORG;
    scene.config = { viewer: { role: "admin" } };
    scene.planFails = true;
    const page = await mount();
    expect(page.querySelector('[data-plan-status="unavailable"]')?.textContent).toContain("Forfait indisponible pour ce compte.");
  });

  it("aucun fournisseur listé : « Connecte un abonnement »", async () => {
    scene.org = ORG;
    scene.config = { viewer: { role: "member" } };
    scene.plan = { providers: [] };
    const page = await mount();
    expect(page.querySelector('[data-plan-status="none"]')?.textContent).toContain("Connecte un abonnement");
  });

  it("abonnement déconnecté : la ligne reste avec Connecter (#1774)", async () => {
    scene.org = ORG;
    scene.config = { viewer: { role: "member" } };
    scene.plan = { providers: [{ ...claude, state: "signed-out", ok: false, plan: null }] };
    const page = await mount();
    const row = page.querySelector('[data-plan-row="claude"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-plan-state="signed-out"]')?.textContent).toContain("Non connecté");
    expect(page.querySelector('[data-plan-status]')).toBeNull();
  });

  it("fournisseur en erreur (429) : la ligne reste avec la raison et Réessayer (#1774)", async () => {
    scene.org = ORG;
    scene.config = { viewer: { role: "admin" } };
    scene.plan = { providers: [{ ...claude, state: "error", ok: false, plan: null, failure: { kind: "http", status: 429 } }] };
    const page = await mount();
    const row = page.querySelector('[data-plan-row="claude"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-plan-state="error"]')?.textContent).toMatch(/429/);
    expect(row!.textContent).toContain("Réessayer");
    expect(page.querySelector('[data-plan-status]')).toBeNull();
  });
});
