// Settings > Usage > Plan usage: the rows GET /api/plan-usage returns, one
// state per row (server/plan-usage.ts). Pure, so the card's states are
// tested without a server.
import { t } from "@/lib/i18n";

export interface PlanWindow {
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
}

export interface PlanExtra {
  label: string;
  remainingPercent: number;
  usedPercent: number;
  resetsAt: string | null;
}

export interface PlanModelUsage {
  name: string;
  windows: PlanExtra[];
}

export type PlanRowState = "windows" | "no-windows" | "signed-out" | "error";

export type PlanFailure =
  | { kind: "network"; code?: string }
  | { kind: "timeout"; seconds?: number }
  | { kind: "http"; status: number }
  | { kind: "unexpected" }
  | { kind: "renewing" }
  | { kind: "unreadable" };

/** What the server sends. `state`, `access`, `instanceId` and `failure` are
 * absent from servers older than this card; planRows derives them. */
export interface PlanProvider {
  id: string;
  name: string;
  driver?: string;
  plan?: string | null;
  ok: boolean;
  error: string | null;
  state?: PlanRowState;
  access?: "subscription" | "api-key";
  instanceId?: string | null;
  failure?: PlanFailure | null;
  fiveHour?: PlanWindow;
  weekly?: PlanWindow;
  extra?: PlanExtra[];
  models?: PlanModelUsage[];
}

export interface PlanUsageReport {
  fetchedAt?: string;
  providers: PlanProvider[];
}

/** One row as the card draws it. */
export interface PlanRow {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
  state: PlanRowState;
  access: "subscription" | "api-key";
  instanceId: string | null;
  /** state error: the sentence to show. */
  message: string | null;
  fiveHour: PlanWindow;
  weekly: PlanWindow;
  extra: PlanExtra[];
  models: PlanModelUsage[];
}

const CLOSED: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };

const PRODUCT: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok" };

function productName(row: Pick<PlanProvider, "driver" | "name">): string {
  return (row.driver && PRODUCT[row.driver]) || row.name;
}

/** The reason in the person's language. */
export function planFailureText(failure: PlanFailure): string {
  switch (failure.kind) {
    case "network": return failure.code ? t("planUsage.reason.networkCode", { code: failure.code }) : t("planUsage.reason.network");
    case "timeout": return t("planUsage.reason.timeout", { seconds: failure.seconds ?? 8 });
    case "unexpected": return t("planUsage.reason.unexpected");
    case "renewing": return t("planUsage.reason.renewing");
    case "unreadable": return t("planUsage.reason.unreadable");
    case "http":
      if (failure.status === 429) return t("planUsage.reason.rateLimited");
      if (failure.status === 403) return t("planUsage.reason.forbidden");
      if (failure.status >= 500) return t("planUsage.reason.server", { status: failure.status });
      return t("planUsage.reason.status", { status: failure.status });
  }
}

/** A row from a server older than this card: its state from ok and error.
 * "Sign in again in X" was its only way to say a login was missing. */
function legacyState(provider: PlanProvider): PlanRowState {
  if (provider.ok) return "windows";
  return /^sign in again\b/i.test(provider.error ?? "") ? "signed-out" : "error";
}

function rowOf(provider: PlanProvider): PlanRow {
  const state = provider.state ?? legacyState(provider);
  const access = provider.access ?? "subscription";
  const name = productName(provider);
  let message: string | null = null;
  if (state === "error") {
    message = provider.failure
      ? t("planUsage.couldNotReach", { name, reason: planFailureText(provider.failure) })
      : provider.error || t("planUsage.fetchError");
  }
  return {
    id: provider.id,
    name: access === "api-key" ? t("planUsage.apiKeyName", { name }) : provider.state ? provider.name : name,
    driver: provider.driver ?? "",
    plan: provider.plan ?? null,
    state,
    access,
    instanceId: provider.instanceId ?? null,
    message,
    fiveHour: provider.fiveHour ?? CLOSED,
    weekly: provider.weekly ?? CLOSED,
    extra: provider.extra ?? [],
    models: provider.models ?? [],
  };
}

function sameOutcome(a: PlanRow, b: PlanRow): boolean {
  const outcome = (row: PlanRow) => JSON.stringify([row.state, row.message, row.plan, row.fiveHour, row.weekly, row.extra, row.models]);
  return a.driver === b.driver && a.access === b.access && outcome(a) === outcome(b);
}

/** The rows to draw: one per provider. Rows of the same provider with the
 * same outcome are one row (an older server listed "Codex" and "ChatGPT
 * plan", which read the same login), and the subscription rows come before
 * the API-key rows. */
export function planRows(report: PlanUsageReport | null): PlanRow[] {
  // a report the server did not shape (an empty answer) draws nothing
  if (!report || !Array.isArray(report.providers)) return [];
  const rows: PlanRow[] = [];
  for (const provider of report.providers) {
    const row = rowOf(provider);
    if (rows.some((kept) => sameOutcome(kept, row))) continue;
    rows.push(row);
  }
  return [...rows.filter((row) => row.access !== "api-key"), ...rows.filter((row) => row.access === "api-key")];
}

/** The rows the Plan card shows (2026-10-15): only providers that are
 * connected and answer. A provider in error or not signed in is left out,
 * with no message and no Connect button; Settings > Model providers is
 * where a person signs in. */
export function connectedPlanRows(report: PlanUsageReport | null): PlanRow[] {
  return planRows(report).filter((row) => row.state === "windows" || row.state === "no-windows");
}

/** How long until a window resets ("2d 3h", "45m"); null once past. */
export function formatResetDistance(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
