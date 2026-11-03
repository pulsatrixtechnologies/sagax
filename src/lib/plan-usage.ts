// Settings > Usage > Plan usage: the rows GET /api/plan-usage returns, one
// state per row (server/usage/plan-usage.ts). Pure, so the card's states are
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

/** Plan ids a provider sends that have a known name (lower case). Codex
 * reports the ChatGPT plan type, Claude its subscription type. Product
 * names: the same in every language. */
const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  pro_lite: "Pro Lite",
  max: "Max",
  max5x: "Max 5x",
  max_5x: "Max 5x",
  max20x: "Max 20x",
  max_20x: "Max 20x",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  education: "Edu",
  supergrok: "SuperGrok",
  supergrok_heavy: "SuperGrok Heavy",
  premium: "Premium",
  premium_plus: "Premium+",
};

/** Words an id may lead with that name no plan (self_serve_business_...,
 * default_claude_max_20x). */
const PLAN_ID_PREFIX = /^(?:self_serve|default|claude|chatgpt|openai|grok|xai)[_-]+/;

/**
 * The plan as the person reads it, never a raw id (2026-11-03: "Codex
 * self_serve_business_prolite" was shown as is). A name the provider already
 * wrote for people ("SuperGrok Heavy") is kept. An id is looked up as sent,
 * then without its leading words; a Business or Enterprise id of any flavor
 * is that plan; anything else is cleaned and title-cased
 * ("team_annual" -> "Team Annual").
 */
export function humanPlanName(plan: string | null | undefined): string | null {
  const raw = plan?.trim();
  if (!raw) return null;
  // spaces or capitals and no id separators: already a name
  if (!/[_]/.test(raw) && (/\s/.test(raw) || /[A-Z]/.test(raw))) return raw;
  let id = raw.toLowerCase().replace(/[\s.]+/g, "_");
  if (PLAN_NAMES[id]) return PLAN_NAMES[id]!;
  for (let stripped = id.replace(PLAN_ID_PREFIX, ""); stripped !== id && stripped; stripped = id.replace(PLAN_ID_PREFIX, "")) {
    id = stripped;
    if (PLAN_NAMES[id]) return PLAN_NAMES[id]!;
  }
  const words = id.split(/[_-]+/).filter(Boolean);
  if (words.includes("enterprise")) return "Enterprise";
  if (words.includes("business")) return "Business";
  if (words.length === 0) return null;
  return words.map((word) => PLAN_NAMES[word] ?? (/^\d/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1))).join(" ");
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
    plan: humanPlanName(provider.plan),
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

/** Rows with windows to meter (sidebar Usage %, chat notices). Settings >
 * Usage draws every row via planRows, including signed-out and error
 * (#1774: an expired token must stay listed with its reason). */
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
