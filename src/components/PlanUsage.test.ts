// Settings > Usage > Usage limits: one line per signed-in account (#4418),
// the row de-duplication, and the refresh spinner (src/lib/plan-usage.ts,
// PlanUsageView).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { connectedPlanRows, planRows, type PlanProvider, type PlanUsageReport } from "@/lib/plan-usage";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {}, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));

import { keepLastFigures, PlanUsageView, rateLimitDelay, type KnownRow, type PlanUsageViewProps } from "./PlanUsage";

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
    onRefresh: () => {}, ...patch,
  }));
}

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", {});
});

describe("Usage limits: each signed-in account's short window and week (#4418)", () => {
  it("one line per signed-in account, under the name the person gave it, its short window with the vendor's hours and its week", () => {
    const html = render({
      providers: [
        row({ id: "claude", name: "Personal", state: "windows", ok: true, plan: "Max",
          fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: "2026-10-02T12:00:00Z", hours: 5 },
          weekly: { available: true, remainingPercent: 30, usedPercent: 70, resetsAt: "2026-10-08T12:00:00Z" } }),
        row({ id: "work", name: "Work plan", instanceId: "work", state: "windows", ok: true,
          fiveHour: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: null },
          weekly: { available: true, remainingPercent: 80, usedPercent: 20, resetsAt: null } }),
        row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "windows", ok: true,
          fiveHour: { available: true, remainingPercent: 50, usedPercent: 50, resetsAt: null, hours: 4 },
          weekly: { available: true, remainingPercent: 50, usedPercent: 50, resetsAt: null } }),
      ],
    });
    expect(html.match(/data-plan-row=/g)).toHaveLength(3);
    // #5342: each account names its provider with the address (or given name)
    expect(html).toContain(">Claude · Personal<");
    expect(html).toContain(">Claude · Work plan<");
    expect(html).toContain(">Max<");
    expect(html).toContain("5-hour session");
    expect(html).toContain("4-hour session");
    expect(html.match(/>Week</g)).toHaveLength(3);
    expect(html).toContain('aria-valuenow="32"');
    expect(html).toContain('aria-valuenow="70"');
    expect(html).toContain("Renews ");
    expect(html.match(/data-limit-figure=""/g)).toHaveLength(6);
  });

  it("nothing else: no second figure, no Details, no other window, no per-model detail", () => {
    const html = render({
      providers: [row({
        state: "windows", ok: true,
        fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: null },
        weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: null },
        extra: [{ label: "Opus week", remainingPercent: 75, usedPercent: 25, resetsAt: null }],
        models: [{ name: "Sonnet", windows: [{ label: "Weekly", remainingPercent: 30, usedPercent: 70, resetsAt: null }] }],
      })],
    });
    expect(html).not.toContain("left");
    expect(html).not.toContain("Details");
    expect(html).not.toContain("Opus week");
    expect(html).not.toContain("Sonnet");
    expect(html.match(/role="meter"/g)).toHaveLength(2);
  });

  it("a window the vendor does not report is absent, never a zero; the week keeps its column", () => {
    const html = render({
      providers: [row({ state: "windows", ok: true, weekly: { available: true, remainingPercent: 84, usedPercent: 16, resetsAt: null } })],
    });
    expect(html).not.toContain('data-plan-window-kind="fiveHour"');
    expect(html).not.toContain("session");
    expect(html).not.toContain(">0%<");
    expect(html).not.toContain("Not reported");
    expect(html).toMatch(/col-start-2[^>]*><div[^>]*data-plan-window-kind="weekly"/);
  });

  it("a provider with no signed-in account and an API key show nothing: no Connect, no Not signed in, no keys", () => {
    const html = render({
      providers: [
        row({ state: "signed-out", error: "Not signed in" }),
        row({ id: "claudeApi", name: "Claude (API key)", access: "api-key", instanceId: "claudeApi", state: "no-windows" }),
      ],
    });
    expect(html).not.toContain("data-plan-row");
    expect(html).not.toContain("Connect Claude");
    expect(html).not.toContain("Not signed in");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Manage my keys");
    expect(html).not.toContain(">Keys<");
    expect(html).toContain('data-plan-status="none"');
  });

  it("error: the signed-in account stays with the real reason in the person's language, with Try again", () => {
    const html = render({
      providers: [
        row({ state: "error", error: "Could not reach Claude: rate limited (429), try again in a minute", failure: { kind: "http", status: 429 } }),
        row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "error", failure: { kind: "network", code: "ENOTFOUND" } }),
      ],
    });
    expect(html).toContain('data-plan-row="claude"');
    expect(html).toContain('data-plan-row="codex"');
    expect(html).toContain("Claude is limiting requests, retrying shortly");
    expect(html).toContain("Could not reach Codex: network error (ENOTFOUND)");
    expect(html.match(/data-plan-retry=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Try again"');
    setLocale("fr");
    const fr = render({ providers: [row({ state: "error", failure: { kind: "timeout", seconds: 8 } })] });
    expect(fr).toContain("Impossible de joindre Claude : aucune réponse en 8 s");
    expect(fr).toContain("Réessayer");
  });

  it("in French: the short window in hours, the week, the renewal", () => {
    setLocale("fr");
    const html = render({ providers: [row({ state: "windows", ok: true,
      fiveHour: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: "2026-10-02T12:00:00Z", hours: 5 },
      weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: "2026-10-08T12:00:00Z" } })] });
    expect(html).toContain("Session de 5 h");
    expect(html).toContain(">Semaine<");
    expect(html).toContain("Se renouvelle le ");
    expect(html).toContain(">utilisé</span>");
  });

  // 2026-10-16: the card vanished in these cases and the owner lost his 5-hour and
  // weekly limits; it now stays with one line saying why.
  it("no account: the card stays with one line, also while loading and after a failed read", () => {
    expect(render({ providers: [] })).toContain("Connect a subscription");
    expect(render(null, { loading: true })).toContain('data-plan-status="loading"');
    expect(render(null, { failed: true })).toContain("Plan unavailable for this account.");
    const noAccess = render(null, { unavailable: true });
    expect(noAccess).toContain("Plan unavailable for this account.");
    expect(noAccess).not.toContain("data-plan-refresh");
  });

  it("refresh: a spinner while it fetches, the lines stay", () => {
    const report = { providers: [row({ state: "windows", ok: true, fiveHour: { available: true, remainingPercent: 50, usedPercent: 50, resetsAt: null } })] };
    const busy = render(report, { loading: true });
    expect(busy).toContain("data-plan-spinner");
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-valuenow="50"');
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
      row({ id: "grok", name: "Grok", driver: "grok", instanceId: "grok", state: "windows", ok: true, plan: "Ultra", weekly: { available: true, remainingPercent: 13, usedPercent: 87, resetsAt: null } }),
      row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "windows", ok: true, plan: "self_serve_business_prolite", fiveHour: { available: true, remainingPercent: 0, usedPercent: 100, resetsAt: null } }),
      row({ id: "claude", state: "signed-out" }),
    ],
  };

  it("stars each plan with windows, the favorite on, and shows plan names, never ids", () => {
    const html = render(report, { favorite: { id: "grok", onToggle: () => {} } });
    expect(html.match(/data-usage-favorite="on"/g)).toHaveLength(1);
    expect(html.match(/data-usage-favorite="off"/g)).toHaveLength(1);
    expect(html).toContain("Stop showing Grok Ultra in the Usage menu");
    expect(html).toContain("Show Codex Business in the Usage menu");
    expect(html).not.toContain("self_serve");
  });

  // #4418: a signed-out account has no line on Usage; its star stays stored
  // (the menu falls back until it is back, usage-favorite.ts) and starring
  // another account replaces it.
  it("a favorite that signed out has no line; the others offer their star", () => {
    const html = render(report, { favorite: { id: "claude", onToggle: () => {} } });
    expect(html).not.toContain('data-plan-row="claude"');
    expect(html.match(/data-usage-favorite="off"/g)).toHaveLength(2);
  });

  it("draws no star without a favorite store", () => {
    expect(render(report)).not.toContain("data-usage-favorite");
  });
});

// #5342 [D-20261125-015]: Settings > Usage > Usage limits names each account's provider.
describe("Usage limits: each account row names its provider (#5342)", () => {
  const week = { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: null };
  const shared: PlanUsageReport = {
    providers: [
      row({ id: "claude", name: "ada@acme.example", state: "windows", ok: true, plan: "max_20x", weekly: week }),
      row({ id: "codex", name: "ada@acme.example", driver: "codex", instanceId: "codex", state: "windows", ok: true, plan: "self_serve_business", weekly: { ...week, usedPercent: 20 } }),
      row({ id: "nimbus", name: "ada@nimbus.example", driver: "nimbus", instanceId: "nimbus", state: "windows", ok: true, weekly: { ...week, usedPercent: 10 } }),
    ],
  };
  const names = (html: string) => [...html.matchAll(/data-plan-name="">([^<]*)</g)].map((match) => match[1]);

  it("one address at two providers is two named rows, in the same order; an unknown provider keeps its name", () => {
    expect(names(render(shared))).toEqual(["Claude · ada@acme.example", "Codex · ada@acme.example", "ada@nimbus.example"]);
  });

  it("the star says which provider's account it shows", () => {
    const html = render(shared, { favorite: { id: "codex", onToggle: () => {} } });
    expect(html).toContain("Stop showing Codex · ada@acme.example Business in the Usage menu");
    expect(html).toContain("Show Claude · ada@acme.example Max 20x in the Usage menu");
    expect(html).toContain("Show ada@nimbus.example in the Usage menu");
  });
});

// 2026-11-17 (owner: "This look very bad"): the same account listed twice
// (a rate limited read and a read with figures) is one row; a failed refresh
// stays inside its own row under the bars; the last figures stay "as of".
describe("Usage limits: one row per account, a failed read inside its row", () => {
  const week = { available: true, remainingPercent: 0, usedPercent: 100, resetsAt: "2026-10-05T09:00:00Z" };
  const duplicate: PlanUsageReport = {
    providers: [
      row({ id: "a", name: "alex@example.test", state: "error", failure: { kind: "http", status: 429 }, error: "Could not reach Claude: rate limited (429), try again in a minute" }),
      row({ id: "b", name: "alex@example.test", plan: "business", ok: true, state: "windows", weekly: week }),
    ],
  };

  it("the same account twice is one row: its figures, its plan, the rate limit as a muted line with a retry icon", () => {
    const html = render(duplicate, { favorite: { id: "a", onToggle: () => {} } });
    expect(html.match(/data-plan-name=""/g)).toHaveLength(1);
    expect(html).toContain("Business");
    expect(html).toContain(">100%</span>");
    expect(html).toContain('data-plan-state="stale"');
    expect(html).toContain("Claude is limiting requests, retrying shortly");
    expect(html).not.toContain("rate limited (429)");
    expect(html.match(/data-plan-retry=""/g)).toHaveLength(1);
    // the star of either listing marks the one row
    expect(html).toContain('data-usage-favorite="on"');
    // the retry is an icon button, not a pill
    expect(html).not.toMatch(/data-plan-retry=""[^>]*>Try again</);
  });

  it("two accounts that both have figures stay two rows", () => {
    const two: PlanUsageReport = { providers: [row({ id: "a", name: "Work", state: "windows", ok: true, weekly: week }), row({ id: "b", name: "Work", state: "windows", ok: true, weekly: { ...week, usedPercent: 40 } })] };
    expect(render(two).match(/data-plan-name=""/g)).toHaveLength(2);
  });

  it("a failed refresh keeps the last figures with the time they were read, and the line says so", () => {
    const known = new Map<string, KnownRow>();
    const good: PlanUsageReport = { fetchedAt: "2026-10-02T08:40:00Z", providers: [row({ id: "claude", name: "Personal", state: "windows", ok: true, weekly: week })] };
    expect(keepLastFigures(good, known)).toEqual(good);
    const bad: PlanUsageReport = { fetchedAt: "2026-10-02T09:00:00Z", providers: [row({ id: "claude", name: "Personal", state: "error", failure: { kind: "network" } })] };
    const kept = keepLastFigures(bad, known);
    expect(kept.providers[0]).toMatchObject({ state: "windows", staleSince: "2026-10-02T08:40:00Z", failure: { kind: "network" } });
    const html = render(kept);
    expect(html).toContain(">100%</span>");
    expect(html).toMatch(/Could not reach Claude: network error · as of /);
  });

  it("a rate limit retries by itself after the provider's delay, never sooner than a minute", () => {
    expect(rateLimitDelay(duplicate)).toBe(60_000);
    expect(rateLimitDelay({ providers: [row({ state: "error", failure: { kind: "http", status: 429, retryAfterSeconds: 150 } })] })).toBe(150_000);
    expect(rateLimitDelay({ providers: [row({ state: "error", failure: { kind: "http", status: 429, retryAfterSeconds: 5 } })] })).toBe(60_000);
    expect(rateLimitDelay({ providers: [row({ state: "error", failure: { kind: "network" } })] })).toBeNull();
    expect(rateLimitDelay({ providers: [row({ state: "windows", ok: true })] })).toBeNull();
  });
});
