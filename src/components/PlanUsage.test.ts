// Settings > Usage > Plan usage: every row state, the row de-duplication,
// and the refresh spinner (src/lib/plan-usage.ts, PlanUsageView).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { connectedPlanRows, planRows, type PlanProvider, type PlanUsageReport } from "@/lib/plan-usage";
import type { MyEngine } from "@/lib/perspicax-org";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {}, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));

import { PlanUsageView, type PlanUsageViewProps } from "./PlanUsage";

const CLOSED = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };

function row(patch: Partial<PlanProvider>): PlanProvider {
  return {
    id: "claude", name: "Claude", driver: "claude", plan: null, ok: false, error: null,
    access: "subscription", instanceId: "claude", failure: null,
    fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [], ...patch,
  };
}

function render(report: PlanUsageReport | null, patch: Partial<PlanUsageViewProps> = {}): string {
  return renderToStaticMarkup(createElement(PlanUsageView, {
    report, loading: false, now: Date.parse("2026-10-02T09:00:00Z"),
    onRefresh: () => {}, myEngines: null, issuer: "", onOpenEngines: () => {}, ...patch,
  }));
}

const engine = (patch: Partial<MyEngine> = {}): MyEngine => ({
  instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
  subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", {});
});

describe("Plan usage rows", () => {
  it("windows: each reported window, per-model usage under Details, plan name as subtitle; an unreported window is left out", () => {
    const html = render({
      providers: [row({
        state: "windows", ok: true, plan: "Pro",
        fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: null },
        models: [{ name: "Sonnet", windows: [{ label: "Weekly", remainingPercent: 30, usedPercent: 70, resetsAt: null }] }],
      })],
    });
    expect(html).toContain("68% left");
    expect(html).toContain("70% used");
    expect(html).toContain('data-plan-window-kind="fiveHour"');
    expect(html).not.toContain('data-plan-window-kind="weekly"');
    expect(html).toContain(">Pro<");
    expect(html).toContain('aria-valuenow="32"');
    expect(html).not.toContain("Sign in again");
  });

  it("no windows: the plan reports none, and an API key has none", () => {
    const html = render({
      providers: [
        row({ id: "grok", name: "Grok", driver: "grok", instanceId: "grok", state: "no-windows", ok: true }),
        row({ id: "claudeApi", name: "Claude (API key)", access: "api-key", instanceId: "claudeApi", state: "no-windows", error: "API key: no plan windows" }),
      ],
    });
    expect(html).toContain("No plan windows for this provider");
    expect(html).toContain("Claude (API key)");
    expect(html).toContain("API key: no plan windows");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("Connect");
  });

  it("not signed in, solo: Not signed in and a Connect button to Providers", () => {
    const html = render({ providers: [row({ state: "signed-out", error: "Not signed in" })] });
    expect(html).toContain('data-plan-row="claude"');
    expect(html).toContain("Not signed in");
    expect(html).toContain('data-plan-connect="claude"');
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("Sign in again");
  });

  it("not signed in, organization: the person's own engine card with its Connect button", () => {
    const html = render(
      { providers: [row({ state: "signed-out", error: "Not signed in" })] },
      { myEngines: [engine()], issuer: "https://px.example.test" },
    );
    expect(html).toContain("Not signed in");
    expect(html).toContain('data-engine-connect="claude"');
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("data-plan-connect");
  });

  it("error: the real reason in the person's language, with Try again", () => {
    const html = render({
      providers: [
        row({ state: "error", error: "Could not reach Claude: rate limited (429), try again in a minute", failure: { kind: "http", status: 429 } }),
        row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "error", failure: { kind: "network", code: "ENOTFOUND" } }),
      ],
    });
    expect(html).toContain('data-plan-row="claude"');
    expect(html).toContain('data-plan-row="codex"');
    expect(html).toContain("Could not reach Claude: rate limited (429), try again in a minute");
    expect(html).toContain("Could not reach Codex: network error (ENOTFOUND)");
    expect(html.match(/Try again/g)).toHaveLength(2);
    setLocale("fr");
    const fr = render({ providers: [row({ state: "error", failure: { kind: "timeout", seconds: 8 } })] });
    expect(fr).toContain("Impossible de joindre Claude : aucune réponse en 8 s");
    expect(fr).toContain("Réessayer");
  });

  // #1774: an expired access token next to a refresh token used to drop the
  // row, so only the engine used most recently stayed listed.
  it("expired token (renewing): the row stays with its reason and Try again, next to a working engine", () => {
    const html = render({
      providers: [
        row({
          id: "grok", name: "Grok", driver: "grok", instanceId: "grok",
          state: "error", failure: { kind: "renewing" },
        }),
        row({
          state: "windows", ok: true, plan: "Max",
          weekly: { available: true, remainingPercent: 84, usedPercent: 16, resetsAt: null },
        }),
      ],
    });
    expect(html).toContain('data-plan-row="grok"');
    expect(html).toContain('data-plan-row="claude"');
    expect(html).toContain('data-plan-state="error"');
    expect(html).toContain("Could not reach Grok: the sign-in token expired and renews on the next turn; refresh after it");
    expect(html).toContain("Try again");
    expect(html).toContain(">16%</span>");
    expect(html).not.toContain('data-plan-status=');
  });

  // 2026-10-16: the card vanished in these cases and the owner lost his 5-hour and
  // weekly limits; it now stays with one line saying why.
  it("no provider row: the card stays with one line, also while loading and after a failed read", () => {
    expect(render({ providers: [] })).toContain("Connect a subscription");
    expect(render(null, { loading: true })).toContain('data-plan-status="loading"');
    expect(render(null, { failed: true })).toContain("Plan unavailable for this account.");
    const noAccess = render(null, { unavailable: true });
    expect(noAccess).toContain("Plan unavailable for this account.");
    expect(noAccess).not.toContain("data-plan-refresh");
  });

  it("organization: the card ends with Manage my keys in Perspicax; solo has no such link", () => {
    const report = { providers: [row({ state: "no-windows", ok: true })] };
    const org = render(report, { issuer: "https://px.example.test" });
    expect(org).toContain("data-plan-keys-link");
    expect(org).toContain("Manage my keys in Perspicax");
    expect(render(report)).not.toContain("data-plan-keys-link");
  });

  it("refresh: a spinner while it fetches, the rows stay", () => {
    const report = { providers: [row({ state: "windows", ok: true, fiveHour: { available: true, remainingPercent: 50, usedPercent: 50, resetsAt: null } })] };
    const busy = render(report, { loading: true });
    expect(busy).toContain("data-plan-spinner");
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("50% left");
    expect(render(report)).not.toContain("data-plan-spinner");
  });
});

describe("planRows", () => {
  it("one row per provider: an older server's duplicates with the same outcome fold", () => {
    const legacy = (id: string, name: string, driver: string, error: string) => ({ id, name, driver, plan: null, ok: false, error, fiveHour: CLOSED, weekly: CLOSED, extra: [] });
    const rows = planRows({
      providers: [
        legacy("grok", "Grok", "grok", "Sign in again in Grok"),
        legacy("claude", "Claude", "claude", "Sign in again in Claude"),
        legacy("codex", "Codex", "codex", "Sign in again in Codex"),
        legacy("chatgpt", "ChatGPT plan", "codex", "Sign in again in Codex"),
        legacy("claudeApi", "Claude (API key)", "claude", "Sign in again in Claude"),
      ],
    });
    expect(rows.map((entry) => [entry.id, entry.name, entry.state])).toEqual([
      ["grok", "Grok", "signed-out"],
      ["claude", "Claude", "signed-out"],
      ["codex", "Codex", "signed-out"],
    ]);
  });

  it("keeps rows that differ, and lists API-key rows after the subscriptions", () => {
    const rows = planRows({
      providers: [
        row({ id: "claudeApi", name: "Claude (API key)", access: "api-key", state: "no-windows" }),
        row({ id: "claude", state: "windows", ok: true, plan: "Max" }),
        row({ id: "work", name: "Work Claude", state: "signed-out" }),
      ],
    });
    expect(rows.map((entry) => [entry.id, entry.name, entry.state])).toEqual([
      ["claude", "Claude", "windows"],
      ["work", "Work Claude", "signed-out"],
      ["claudeApi", "Claude (API key)", "no-windows"],
    ]);
  });

  it("connectedPlanRows keeps only the providers that answer (sidebar meters)", () => {
    const rows = connectedPlanRows({
      providers: [
        row({ id: "a", state: "windows", ok: true }),
        row({ id: "b", name: "B", state: "no-windows", ok: true }),
        row({ id: "c", name: "C", state: "signed-out" }),
        row({ id: "d", name: "D", state: "error" }),
      ],
    });
    expect(rows.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("an older server's real error stays an error, not a sign-in", () => {
    const [entry] = planRows({ providers: [{ id: "claude", name: "Claude", driver: "claude", ok: false, error: "Could not reach Claude" }] });
    expect(entry).toMatchObject({ state: "error", message: "Could not reach Claude" });
  });

  it("listing keeps every subscription after one token expired (#1774)", () => {
    const rows = planRows({
      providers: [
        row({ id: "claude", state: "windows", ok: true, plan: "Max" }),
        row({ id: "grok", name: "Grok", driver: "grok", instanceId: "grok", state: "error", failure: { kind: "renewing" } }),
        row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "signed-out" }),
      ],
    });
    expect(rows.map((entry) => [entry.id, entry.state])).toEqual([
      ["claude", "windows"],
      ["grok", "error"],
      ["codex", "signed-out"],
    ]);
    expect(rows.find((entry) => entry.id === "grok")?.message).toContain("expired");
  });
});

describe("Plan usage stars (2026-11-03)", () => {
  const report: PlanUsageReport = {
    providers: [
      row({ id: "grok", name: "Grok", driver: "grok", instanceId: "grok", state: "windows", ok: true, plan: "SuperGrok Heavy", weekly: { available: true, remainingPercent: 13, usedPercent: 87, resetsAt: null } }),
      row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "windows", ok: true, plan: "self_serve_business_prolite", fiveHour: { available: true, remainingPercent: 0, usedPercent: 100, resetsAt: null } }),
      row({ id: "claude", state: "signed-out" }),
    ],
  };

  it("stars each plan with windows, the favorite on, and shows plan names, never ids", () => {
    const html = render(report, { favorite: { id: "grok", onToggle: () => {} } });
    expect(html.match(/data-usage-favorite="on"/g)).toHaveLength(1);
    expect(html.match(/data-usage-favorite="off"/g)).toHaveLength(1);
    expect(html).toContain("Stop showing Grok SuperGrok Heavy in the Usage menu");
    expect(html).toContain("Show Codex Business in the Usage menu");
    expect(html).not.toContain("self_serve");
  });

  it("keeps the star of a favorite that signed out, so it can be cleared", () => {
    const html = render(report, { favorite: { id: "claude", onToggle: () => {} } });
    expect(html).toContain("Stop showing Claude in the Usage menu");
  });

  it("draws no star without a favorite store", () => {
    expect(render(report)).not.toContain("data-usage-favorite");
  });
});
