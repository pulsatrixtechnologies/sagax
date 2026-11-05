// Which provisioner the Sagax server calls for one person's environment.
//
// Two provisioners run at once. The Docker one (SAGAX_SANDBOXD_URL) is the
// default. The Kubernetes one (SAGAX_SANDBOXD_K8S_URL, https, CA in
// SAGAX_SANDBOXD_TLS_CA) receives only the canary. A sandbox is one per
// person, so the person list is the switch for that whole workspace. The
// bot list routes a turn of that bot; list every bot of the person, or list
// the person, before copying the workspace.
//
// Revert is SAGAX_SANDBOX_ROUTE=docker. That wins over both lists. Unset
// the route and clear the lists for the same result. Recreate the Sagax
// process so it reads the new environment. Neither provisioner is stopped.

export const SANDBOX_BACKENDS = ["docker", "kubernetes"] as const;
export type SandboxBackend = (typeof SANDBOX_BACKENDS)[number];

const BOT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PERSON_ID_RE = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CANARY_BOTS = 32;
const MAX_CANARY_PEOPLE = 128;

export interface SandboxRoute {
  /** `docker` forces Docker even when a list matches. `kubernetes` sends everyone. */
  forced: SandboxBackend | null;
  bots: readonly string[];
  people: readonly string[];
}

function listed(raw: string | undefined, max: number, pattern: RegExp, name: string, normalize: (id: string) => string): string[] {
  const text = raw?.trim() ?? "";
  if (!text) return [];
  const ids = text.split(",").map((id) => normalize(id.trim())).filter(Boolean);
  if (ids.length > max) throw new Error(`${name} lists more than ${max}`);
  for (const id of ids) {
    if (!pattern.test(id)) throw new Error(`${name} has an invalid id`);
  }
  return [...new Set(ids)];
}

/** Bot ids whose turns use Kubernetes while the route is not forced. */
export function sandboxCanaryBotIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return listed(env.SAGAX_SANDBOX_CANARY_BOTS, MAX_CANARY_BOTS, BOT_ID_RE, "SAGAX_SANDBOX_CANARY_BOTS", (id) => id);
}

/** Principal ids whose environment uses Kubernetes while the route is not forced. */
export function sandboxCanaryPeople(env: NodeJS.ProcessEnv = process.env): string[] {
  return listed(env.SAGAX_SANDBOX_CANARY_PEOPLE, MAX_CANARY_PEOPLE, PERSON_ID_RE, "SAGAX_SANDBOX_CANARY_PEOPLE", (id) => id.toLowerCase());
}

export function sandboxRouteFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxRoute {
  const raw = env.SAGAX_SANDBOX_ROUTE?.trim() || "";
  if (raw && raw !== "docker" && raw !== "kubernetes") {
    throw new Error("SAGAX_SANDBOX_ROUTE must be docker or kubernetes");
  }
  return {
    forced: raw === "docker" || raw === "kubernetes" ? raw : null,
    bots: sandboxCanaryBotIds(env),
    people: sandboxCanaryPeople(env),
  };
}

/** Docker unless the route forces Kubernetes, the person is listed, or this bot is listed. */
export function sandboxBackendFor(route: SandboxRoute, principalId: string, botId?: string): SandboxBackend {
  if (route.forced) return route.forced;
  const person = principalId.trim().toLowerCase();
  if (person && route.people.includes(person)) return "kubernetes";
  if (botId && route.bots.includes(botId)) return "kubernetes";
  return "docker";
}
