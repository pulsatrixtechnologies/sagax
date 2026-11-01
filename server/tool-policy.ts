// The securable tool layer (B, /docs/tool-policy.md): every HTTP route the
// server answers has one policy entry: its tier, whether it only reads, the
// scope a caller needs, and whether it is enabled for agent tools by default.
// The table is server/tool-policy.generated.ts (scripts/tool-policy/generate.ts
// writes new rows and keeps reviewed ones); the coverage test fails when a
// route has no row. B1 only declares: nothing enforces the table yet.
//
// A deletion is admin by default, with one exception the guard reads at
// call time: a route that removes something a person owns (their bot, its
// workspace files, projects and queue, their webhooks, their routine runs)
// is `ownerScoped`, and the guard lets the owner (or a bot speaking for
// them) through without a grant. Organization, admin, billing, keys and
// rights routes are never owner-scoped.
import { TOOL_POLICY_ROWS } from "./tool-policy.generated.ts";
import type { PolicyMethod, ToolPolicy, ToolTier } from "./tool-policy-types.ts";

export type { PolicyKind, PolicyMethod, ToolPolicy, ToolTier } from "./tool-policy-types.ts";

export const policyKey = (p: { method: string; kind: string; route: string }): string => `${p.method} ${p.kind} ${p.route}`;

const plain = (route: string) => route.replace(/\\\//g, "/").replace(/\\(.)/g, "$1");
const ADMIN_AREA = /^\^?\/api\/(org|admin|business|billing|usage|license|fleet|operator|engines|providers|keys|sso|scim|audit)(\b|[-/])/;
const ADMIN_PART = /\/(admin|billing|rights|roles|members|invites?|secrets?|keys?|tokens?|credentials?|wipe|reset|purge|export|import|transfer|owner)(\b|\/|\$|\)|$)/;
const DESTRUCTIVE = /\/(delete|remove|wipe|purge|reset|revoke|archive)(\b|\/|\$|\)|$)/;
const BILLING = /\/(billing|usage|spend-cap|invoices?|subscription|payments?|checkout|credits)(\b|\/|\$|\)|$)/;

// What a person owns, as the plain route text reads after `/api/`
// (`([w-]+)` is the id). Matched without the `/api/` prefix so the route
// inventory (scripts/tool-policy/route-inventory.ts) does not read these
// as routes.
const OWNER_SCOPED: readonly RegExp[] = [
  /^bots\/\([^)]*\)$/,
  /^bots\/\([^)]*\)\/(workspace\/file|projects|queue)(\b|\/|\(|$)/,
  /^webhooks\/\([^)]*\)/,
  /^routine-runs$/,
];

/** A deletion of something one person owns (their bot, its workspace
 * files, projects and queue, their webhooks, their routine runs). Never an
 * organization, admin, billing, keys or rights route. */
export function ownerScopedRoute(route: string): boolean {
  const text = plain(route);
  const bare = text.replace(/^\^/, "").replace(/\$$/, "");
  if (!bare.startsWith("/api/") || ADMIN_AREA.test(text) || ADMIN_PART.test(text) || BILLING.test(text)) return false;
  const rest = bare.slice("/api/".length);
  return OWNER_SCOPED.some((pattern) => pattern.test(rest));
}

/** These handlers derive the account owner from the authenticated person,
 * never a caller-provided person id. Their own keys/endpoints need no admin. */
export function personalProviderRoute(route: string): boolean {
  return /^\^?\/api\/me\/(?:providers|voice-keys)(?:\/|\$|$)/.test(plain(route));
}

/** The default classification of a route (generate.ts): GET reads; a DELETE,
 * a deletion verb, org/admin/billing/credentials are admin; everything else,
 * an unguarded method included, writes. A deletion of something one person
 * owns stays admin for everyone else and is `ownerScoped` for its owner.
 * Personal provider handlers bind every operation to the signed-in person,
 * so those reads/writes, including DELETE, need no administrator. */
export function classifyRoute(method: PolicyMethod, route: string): Omit<ToolPolicy, "method" | "kind" | "route"> {
  const text = plain(route);
  const destructive = method === "DELETE" || DESTRUCTIVE.test(text);
  const billing = BILLING.test(text);
  const admin = !personalProviderRoute(route) && (destructive || billing || ADMIN_AREA.test(text) || ADMIN_PART.test(text));
  const tier: ToolTier = admin ? "admin" : method === "GET" ? "read" : "write";
  const area = (/^\^?\/api\/(?:\(\?:)?([a-z][a-z0-9-]*)/.exec(text)?.[1] ?? "other");
  const ownerScoped = tier === "admin" && destructive && ownerScopedRoute(route);
  return {
    tier,
    readOnly: method === "GET" && !destructive,
    scope: `${area}:${tier}`,
    defaultEnabled: tier !== "admin",
    ...(destructive ? { destructive: true as const } : {}),
    ...(billing ? { billing: true as const } : {}),
    ...(ownerScoped ? { ownerScoped: true as const } : {}),
  };
}

const ROWS: readonly ToolPolicy[] = TOOL_POLICY_ROWS;
const compiled = ROWS.map((row) => ({ row, re: row.kind === "pattern" ? new RegExp(row.route) : null }));

/** An unknown route is a write: never read-only, never on by default. */
export const UNKNOWN_ROUTE_POLICY: Omit<ToolPolicy, "method" | "kind" | "route"> = { tier: "write", readOnly: false, scope: "unknown:write", defaultEnabled: false };

/** The most specific row that matches a request (exact, then pattern, then
 * the longest prefix; a method-guarded row before an ANY one; the stricter
 * tier on a tie), or the unknown-route policy. */
export function policyFor(method: string, path: string): Omit<ToolPolicy, "method" | "kind" | "route"> & { matched: boolean } {
  const rank: Record<ToolTier, number> = { read: 0, write: 1, admin: 2 };
  const specificity = (row: ToolPolicy) =>
    (row.kind === "exact" ? 3_000_000 : row.kind === "pattern" ? 2_000_000 : 1_000_000 + row.route.length * 10)
    + (row.method === "ANY" ? 0 : 5) + rank[row.tier];
  let best: ToolPolicy | null = null;
  for (const { row, re } of compiled) {
    if (row.method !== "ANY" && row.method !== method) continue;
    const hit = row.kind === "exact" ? row.route === path : row.kind === "prefix" ? path.startsWith(row.route) : re!.test(path);
    if (hit && (!best || specificity(row) > specificity(best))) best = row;
  }
  if (!best) return { ...UNKNOWN_ROUTE_POLICY, matched: false };
  const { method: _m, kind: _k, route: _r, ownerScoped: stored, ...policy } = best;
  // Reviewed rows predate the field: it is read from the route itself.
  const ownerScoped = policy.tier === "admin" && policy.destructive === true && (stored ?? ownerScopedRoute(best.route));
  return { ...policy, ...(ownerScoped ? { ownerScoped: true as const } : {}), matched: true };
}

export function toolPolicyRows(): readonly ToolPolicy[] { return ROWS; }
