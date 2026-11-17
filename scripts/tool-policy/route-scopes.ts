// Every route of the server with what a person's session needs for it (#4471):
// `client` (the person's own, CLIENT_ALLOW), a permission (PERMISSION_ROUTES),
// `admin` (reserved, ADMIN_ROUTES, with its reason) or `other` (not opened by
// a person's session: OTHER_AUTH_ROUTES, with its reason). A route in none of
// them is `unclassed`; server/auth/route-scopes.test.ts fails on one.
//   node --experimental-strip-types scripts/tool-policy/route-scopes.ts > table.md
import { fileURLToPath } from "node:url";
import { routeInventory, type InventoryRoute } from "./route-inventory.ts";
import { routeSamples } from "./route-sample.ts";
import { CLIENT_ALLOW, requiredScope, routePermissions, type ClientFeatures } from "../../server/auth/request-auth.ts";
import { ADMIN_ROUTES, OTHER_AUTH_ROUTES, type HeldRoute } from "../../server/auth/admin-routes.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
/** Every feature on: the widest set of client routes a server can have. */
const FEATURES: ClientFeatures = { sharedComputers: true, orgPairing: true, orgDirectory: true, serverCatalogue: true };

/** Files whose `/api/` matchers are not routes: the gate's own checks (who
 * sees a bot, a thread, a room), the audit and achievement labels, a push's
 * link, a bot's act copy. The routes they name are answered elsewhere. */
export const NOT_ROUTE_FILES: Readonly<Record<string, string>> = {
  "server/bots/bot-visibility.ts": "the subject of a path, for the visibility gate",
  "server/request-pipeline/authenticate.ts": "the gate itself",
  "server/achievements/achievements.ts": "which requests earn an achievement",
  "server/admin/admin-audit-plan.ts": "which admin requests are audited",
  "server/push/payload.ts": "the link a push notification carries",
  "server/people/member-tool-scope.ts": "which routes a member's tool may call",
  "server/index-leaves/adminAnswersPendingApproval.ts": "the admin's answer to a card that waits for an admin",
  "server/index-leaves/performBotActRoute.ts": "the routes a bot's act copy may not call",
  "server/bots/bot-plugins-answer.ts": "how a bot's act shapes a plugin answer; the routes are server/routes/bot-plugins.ts",
};

/** Matchers the sample cannot stand for: a guard that passes a path on to
 * a module that no longer exists, or an id whose real forms a precise row
 * names. */
export const NOT_ROUTE_PATTERNS: Readonly<Record<string, string>> = {
  "^\\/api\\/groups\\/[\\w-]+\\/bots\\/": "server/routes/groups-http.ts passes it on; no route answers it",
  // the same route as the client row that names its two id forms (user:pr_..., team:...)
  "^\\/api\\/bots\\/([\\w-]+)\\/grants\\/([^/]+)$": "server/bots/bot-grants.ts: a grant's target, classed by its CLIENT_ALLOW row",
};

/** A method the inventory reads next to a form of a route that belongs to a
 * neighbouring form of the same handler (an id or a suffix the sample does
 * not carry, a sibling path in the same `if`). Keyed `METHOD path` on the
 * sampled path (route-sample.ts), `ANY` for a route the inventory reads no
 * method for; the method is classed on the form that answers it.
 * route-scopes.test.ts fails on an entry no longer needed, so the list
 * never hides a real method. */
export const NOT_ROUTE_METHODS: Readonly<Record<string, string>> = {
  "POST /api/me/about-me": "server/routes/bot-memory.ts: the POST is .../learned/:id/remove",
  "POST /api/profile/learned": "server/routes/bot-memory.ts: the POST is .../learned/:id/remove",
  "PUT /api/profile/learned": "server/routes/bot-memory.ts: the PUT is /api/me/about-me",
  "GET /api/profile/learned/a/remove": "server/routes/bot-memory.ts: the GET is /api/profile/learned",
  "PUT /api/profile/learned/a/remove": "server/routes/bot-memory.ts: the PUT is /api/me/about-me",
  "PUT /api/me/voice-keys": "server/routes/provider-accounts.ts: PUT and DELETE take a provider, /api/me/voice-keys/:provider",
  "DELETE /api/me/voice-keys": "server/routes/provider-accounts.ts: PUT and DELETE take a provider, /api/me/voice-keys/:provider",
  "DELETE /api/bots/a/command-allowlist": "server/routes/bots-mutate-small.ts: DELETE takes a rule id",
  "GET /api/bots/a/command-allowlist/a": "server/routes/bots-mutate-small.ts: the GET is the list, without a rule id",
  "GET /api/bots/a/history/rollback": "server/routes/bot-history.ts: the GET is .../history",
  "POST /api/bots/a/history": "server/routes/bot-history.ts: the POST is .../history/rollback",
  "PATCH /api/bots/a/projects": "server/routes/bots-core-projects.ts: PATCH takes a folder id",
  "DELETE /api/bots/a/projects": "server/routes/bots-core-projects.ts: DELETE takes a folder id",
  "POST /api/bots/a/projects/a": "server/routes/bots-core-projects.ts: POST makes a folder, without an id",
  "GET /api/bots/a/requests/AAAAAAAAAAAAAAAA/interrupt": "server/routes/bots-mutate-delete.ts: the GET is the request itself",
  "POST /api/bots/a/requests/AAAAAAAAAAAAAAAA": "server/routes/bots-mutate-delete.ts: the POST is .../interrupt",
  "PATCH /api/groups/a/projects": "server/routes/group-folders.ts: PATCH takes a folder id",
  "GET /api/me/blocks/a": "server/routes/moderation.ts: the GET is /api/me/blocks",
  "POST /api/me/credentials/aaaaaaaa": "server/routes/credential-vault.ts: the POST is .../notes or .../grants",
  "POST /api/me/credentials/aaaaaaaa/notes/a": "server/routes/credential-vault.ts: notes take no id",
  "POST /api/me/credentials/aaaaaaaa/grants/a": "server/routes/credential-vault.ts: a grant's id is for DELETE only",
  "POST /api/me/mcp/servers/a": "server/routes/person-connections.ts: the POST is .../oauth/start or .../oauth/disconnect",
  "POST /api/me/mcp/servers/aa": "server/routes/person-connections.ts: the POST is .../oauth/start or .../oauth/disconnect",
  "GET /api/routines/a/check": "server/routes/routines-http.ts: the GET is /api/routines/:id",
  "POST /api/routines/a": "server/routes/routines-http.ts: the POST is /api/routines/:id/check",
  // a dispatcher's forms that name no route: each real path below it has its own row
  "ANY /api/bots/import/upload/preview": "server/routes/bot-zip.ts: a preview takes a staged import id",
  "ANY /api/bots/import/agent/preview": "server/routes/bot-zip.ts: a preview takes a staged import id",
  "ANY /api/bots/a/roles/": "server/routes/perspicax-roles.ts: the roles routes are rules, held, routine-coverage and missing/send",
  "ANY /api/bots/a/roles/a": "server/routes/perspicax-roles.ts: the roles routes are rules, held, routine-coverage and missing/send",
  "ANY /api/bots/a/artifacts/a": "server/routes/artifacts.ts: an artifact id starts art_",
  "ANY /api/bots/a/artifacts/a/refresh": "server/routes/artifacts.ts: an artifact id starts art_",
  "ANY /api/bots/a/plugins/install/A": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/plugins/install/A/update": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/plugins/install/A/credential": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/plugins/install/AA": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/plugins/install/AA/update": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/plugins/install/AA/credential": "server/routes/bot-plugins.ts: install takes no name",
  "ANY /api/bots/a/background-brief/a": "server/routes/background-brief.ts: a suggestion is answered with .../reject, .../keep or .../feedback",
  "ANY /api/bots/a/background-brief/a/a": "server/routes/background-brief.ts: only reject, keep and feedback follow a suggestion",
};

export type RouteScope =
  | { kind: "client" }
  | { kind: "permission"; permissions: readonly string[] }
  | { kind: "admin" | "other"; reserved: string }
  | { kind: "unclassed" };

function held(list: readonly HeldRoute[], method: string, path: string): HeldRoute | undefined {
  return list.find((rule) => rule.methods.includes(method) && rule.path.test(path));
}

/** What one request needs, first match wins in the gate's order. */
export function scopeOf(method: string, path: string, features: ClientFeatures = FEATURES): RouteScope {
  if (requiredScope(method, path, features) === "client") return { kind: "client" };
  const permissions = routePermissions(method, path, features);
  if (permissions) return { kind: "permission", permissions };
  const admin = held(ADMIN_ROUTES, method, path);
  if (admin) return { kind: "admin", reserved: admin.reserved };
  const other = held(OTHER_AUTH_ROUTES, method, path);
  if (other) return { kind: "other", reserved: other.reserved };
  return { kind: "unclassed" };
}

export interface RouteScopeRow {
  route: InventoryRoute;
  /** Every form of the route (each branch of each alternation, each
   * optional part present and absent): each is judged on its own (#4471). */
  samples: string[];
  /** The class of each method the route is guarded with (every method when
   * the inventory reads none), on each form. */
  scopes: Array<{ method: string; sample: string; scope: RouteScope }>;
  /** Every method the inventory read for it is classed on every form (a
   * `METHOD path` listed in NOT_ROUTE_METHODS belongs to a neighbouring
   * route). A route the inventory reads no method for (`ANY`) answers only
   * some of them, so one classed method per form is enough there. */
  classed: boolean;
}

/** The `METHOD path` forms of a route the inventory read that nothing classes. */
export function unclassedForms(route: InventoryRoute, scopes: RouteScopeRow["scopes"]): string[] {
  if (route.method === "ANY") {
    const samples = [...new Set(scopes.map(({ sample }) => sample))];
    return samples.filter((sample) => !scopes.some((s) => s.sample === sample && s.scope.kind !== "unclassed")).map((sample) => `ANY ${sample}`).filter((form) => !(form in NOT_ROUTE_METHODS));
  }
  return scopes.filter(({ scope }) => scope.kind === "unclassed").map(({ method, sample }) => `${method} ${sample}`).filter((form) => !(form in NOT_ROUTE_METHODS));
}

/** One route of the inventory, judged on each of its forms. */
export function judgeRoute(route: InventoryRoute, samples: readonly string[], features: ClientFeatures = FEATURES): RouteScopeRow {
  const methods = route.method === "ANY" ? [...METHODS] : [route.method];
  const scopes = samples.flatMap((sample) => methods.map((method) => ({ method, sample, scope: scopeOf(method, sample, features) })));
  return { route, samples: [...samples], scopes, classed: samples.length > 0 && unclassedForms(route, scopes).length === 0 };
}

function dispatcher(route: InventoryRoute): boolean {
  return route.kind === "prefix" || /(?:\(\?:\\\/\|\$\)|\\\/)$/.test(route.route);
}

export function routeScopeTable(root: string): RouteScopeRow[] {
  const routes = routeInventory(root).filter((route) => !(route.file in NOT_ROUTE_FILES) && !(route.route in NOT_ROUTE_PATTERNS));
  const sampled = routes.map((route) => ({ route, samples: routeSamples(route.kind, route.route) }));
  const rows: RouteScopeRow[] = [];
  for (const { route, samples } of sampled) {
    if (samples === null) {
      rows.push({ route, samples: [route.route], scopes: [], classed: false });
      continue;
    }
    // A prefix that hands its paths to more precise routes is not a route.
    const stem = (route.kind === "prefix" ? route.route : samples[0]!).replace(/\/$/, "");
    if (dispatcher(route) && sampled.some((other) => other.route !== route && !dispatcher(other.route) && other.samples?.some((sample) => sample.startsWith(stem)))) continue;
    rows.push(judgeRoute(route, samples));
  }
  return rows;
}

function cell(scope: RouteScope): string {
  if (scope.kind === "client") return "client";
  if (scope.kind === "permission") return `permission ${scope.permissions.join(" or ")}`;
  if (scope.kind === "unclassed") return "not classed: a method this route does not answer (it falls to admin)";
  return `${scope.kind}: ${scope.reserved}`;
}

/** The feature a client route needs, when the server may lack it: on a
 * server without that feature the same route is an admin's for a member
 * (the orgDirectory rows, for example, on a personal server). */
function featureNote(method: string, path: string): string {
  const upper = method.toUpperCase();
  const rule = CLIENT_ALLOW.find((r) => r.path.test(path) && r.methods.includes(upper));
  if (!rule?.feature || requiredScope(method, path, {}) === "client") return "";
  return ` (only on a server with ${rule.feature}; without it the route is an administrator's)`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const lines = ["| Method | Route | Needs | Source |", "|---|---|---|---|"];
  for (const row of routeScopeTable(root)) {
    for (const { method, sample, scope } of row.scopes) {
      const note = scope.kind === "client" ? featureNote(method, sample) : "";
      lines.push(`| ${method} | \`${sample}\` | ${(cell(scope) + note).replace(/\|/g, "\\|")} | ${row.route.file}:${row.route.line} |`);
    }
  }
  console.log(lines.join("\n"));
}
