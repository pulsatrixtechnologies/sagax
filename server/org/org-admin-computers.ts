// Computers of the organization for the Perspicax console (2026-10-11):
// every person's server environment (sagax-sandboxd, docs/user-sandbox.md)
// and every desktop computer connected through the desktop bridge.
//
//   GET  computers?kind&state&owner&q&limit&cursor    admin
//   GET  computers/{id}                               admin
//   POST computers/{id}/start|stop|pause|resume|update  admin, {confirm?}
//   POST computers/{id}/reset|delete                  admin, {confirm: true}
//
// A person reaches their own server environment without the admin role
// (2026-10-26): the list, the detail and start, stop, pause, resume and
// reset declare the `own-computer` grant (server/oidc-rp.ts), which
// Perspicax signs for that one request with the person's own role. The
// route then answers only the person's own computers; anyone else's is not
// found. Update and delete stay an admin's.
//
// A server environment is the organization's: an admin starts, stops,
// pauses, resumes, updates, resets or deletes it with the same calls the
// person's own Computer tab makes (server/sandbox/user-sandbox-manager.ts). A
// person's desktop computer is theirs: listed read only (its name, platform,
// whether it is online, when it was last seen), never an action, never its
// files or its Local VM (Sagax reaches those only for the person, through
// their own app). Every action is one `computer` row of the admin activity
// log. Ids are opaque: `env:<principal>` and `desktop:<16 hex>`, never a
// desktop's own id, a sandbox key or a path.
import { createHash } from "node:crypto";

import type { SandboxStats } from "../sandbox/sandboxd-core.ts";
import type { UserSandboxView } from "../sandbox/user-sandbox-manager.ts";
import type { AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  enumParam,
  fail,
  isAnswer,
  matchesQuery,
  notFound,
  objectBody,
  ok,
  onlyKeys,
  pageOf,
  parsePage,
  type ConsoleAnswer,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";

export const COMPUTER_KINDS = ["server-environment", "desktop"] as const;
export type ComputerKind = (typeof COMPUTER_KINDS)[number];
export const COMPUTER_STATES = ["running", "paused", "stopped", "unavailable", "online", "offline"] as const;
export type ComputerState = (typeof COMPUTER_STATES)[number];
export const COMPUTER_ACTIONS = ["start", "stop", "pause", "resume", "update", "reset", "delete"] as const;
export type ComputerAction = (typeof COMPUTER_ACTIONS)[number];
/** Actions that erase the environment's /workspace: always confirmed. */
const DESTRUCTIVE: ReadonlySet<ComputerAction> = new Set(["reset", "delete"]);
/** What a person does on their own environment with the `own-computer`
 * grant: power and reset. Update and delete stay an admin's. */
export const OWNER_COMPUTER_ACTIONS: ReadonlySet<ComputerAction> = new Set(["start", "stop", "pause", "resume", "reset"]);
/** Actions that cut short a command running there: confirmed while one runs. */
const INTERRUPTING: ReadonlySet<ComputerAction> = new Set(["stop", "pause", "update"]);
export const COMPUTER_STATUS_TIMEOUT_MS = 3_000;
export const COMPUTER_ACTIVITY_MAX = 20;

/** One person's environment as the provisioner reports it. */
export interface EnvironmentFacts {
  view: UserSandboxView;
  busy: number;
  stats: SandboxStats | null;
}

export interface DesktopFacts {
  principalId: string;
  /** The desktop's own id (hashed before it reaches the wire). */
  desktopId: string;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt: number;
  /** It can run a Local VM for its person. */
  localVm: boolean;
  version: string | null;
}

export interface ComputersDeps {
  /** The organization's people (no service accounts). */
  people(): Array<{ principalId: string }>;
  person(principalId: string): AdminPerson;
  /** Null on a server without sagax-sandboxd. */
  environments: null | {
    /** The provisioner's facts, null when it does not answer. */
    provisioner(): Promise<{ maxRunning: number; idleMinutes: number } | null>;
    /** Each person's environment, within `timeoutMs` each; a person whose
     * environment does not exist is left out. */
    inventory(principalIds: readonly string[], timeoutMs: number): Promise<Map<string, EnvironmentFacts>>;
    power(principalId: string, action: "start" | "shutdown" | "pause" | "resume"): Promise<UserSandboxView>;
    update(principalId: string): Promise<UserSandboxView>;
    reset(principalId: string): Promise<UserSandboxView>;
    remove(principalId: string): Promise<void>;
  };
  /** A bot turn works in this person's environment right now. */
  turnRunning(principalId: string): boolean;
  desktops(): DesktopFacts[];
  /** Every bot with its owner and its Works on (`computer`, unset is Auto). */
  bots(): Array<{ id: string; name: string; ownerPrincipalId: string; computer: string | null }>;
  /** The computer rows of the admin activity log for this computer, newest
   * first, already shaped for the console. */
  activity(input: { computerId: string; principalId: string; kind: ComputerKind; limit: number }): unknown[];
}

export interface ComputerItem {
  id: string;
  kind: ComputerKind;
  name: string;
  owner: AdminPerson;
  state: ComputerState;
  lastUsedAt: number | null;
  /** Server environment: its limits and what it uses now. */
  resources: null | {
    cpus: number | null;
    memoryLimitBytes: number | null;
    diskLimitBytes: number | null;
    workspaceBytes: number | null;
    workspaceQuotaBytes: number | null;
    overQuota: boolean;
    cpuPercent: number | null;
    memoryBytes: number | null;
  };
  /** Server environment: the provisioner's image (name and tag). */
  image: string | null;
  os: string | null;
  arch: string | null;
  /** Desktop: `darwin`, `win32` or `linux`. */
  platform: string | null;
  /** Server environment: commands running there now. */
  busy: number;
  /** Server environment: deleted at this time (its person was signed out). */
  pendingDeletionAt: number | null;
  /** Desktop: whether it can run a Local VM for its person. */
  localVm: boolean;
  /** Desktop: the Sagax app's version, when it said. */
  appVersion: string | null;
  bots: Array<{ id: string; name: string }>;
  /** What an admin may do here now. Always empty for a desktop. */
  actions: ComputerAction[];
}

const envId = (principalId: string) => `env:${principalId}`;
export const desktopComputerId = (principalId: string, desktopId: string) =>
  `desktop:${createHash("sha256").update(`${principalId}\n${desktopId}`).digest("hex").slice(0, 16)}`;

/** Where a bot's Works on may send its tools: Cloud to the person's server
 * environment, This computer and Local VM to their desktop, and Auto to
 * either, since the bot picks per task (Workspace is always Auto,
 * 2026-10-18). Off reaches neither. */
function worksOn(computer: string | null, kind: ComputerKind): boolean {
  if (computer === null) return true;
  if (computer === "cloud") return kind === "server-environment";
  if (computer === "local" || computer === "vm") return kind === "desktop";
  return false;
}

function envState(view: UserSandboxView): ComputerState | null {
  if (view.state === "missing") return null;
  return view.state;
}

/** What an admin may do on an environment in this state. */
export function environmentActions(state: ComputerState, pendingDeletion: boolean): ComputerAction[] {
  const out: ComputerAction[] = [];
  if (!pendingDeletion && (state === "stopped" || state === "paused")) out.push("start");
  if (state === "running" || state === "paused") out.push("stop");
  if (state === "running") out.push("pause");
  if (state === "paused") out.push("resume");
  if (!pendingDeletion && state !== "unavailable") out.push("update", "reset");
  if (state !== "unavailable") out.push("delete");
  return out;
}

function environmentItem(principalId: string, facts: EnvironmentFacts, deps: ComputersDeps, botsOf: (principalId: string, kind: ComputerKind) => Array<{ id: string; name: string }>): ComputerItem | null {
  const state = envState(facts.view);
  if (!state) return null;
  const owner = deps.person(principalId);
  const { view, stats } = facts;
  return {
    id: envId(principalId),
    kind: "server-environment",
    name: owner.name,
    owner,
    state,
    lastUsedAt: view.lastUsedAt,
    resources: {
      cpus: view.limits?.cpus ?? null,
      memoryLimitBytes: stats?.memoryLimitBytes ?? (view.limits ? view.limits.memoryMb * 1024 * 1024 : null),
      diskLimitBytes: view.limits ? view.limits.diskMb * 1024 * 1024 : null,
      workspaceBytes: stats?.workspaceBytes ?? view.workspaceBytes,
      workspaceQuotaBytes: stats?.workspaceQuotaBytes ?? null,
      overQuota: view.overQuota,
      cpuPercent: stats?.cpuPercent ?? null,
      memoryBytes: stats?.memoryBytes ?? null,
    },
    image: stats?.image ?? null,
    os: stats?.os ?? null,
    arch: stats?.arch ?? null,
    platform: null,
    busy: facts.busy,
    pendingDeletionAt: view.pendingDeletionAt,
    localVm: false,
    appVersion: null,
    bots: botsOf(principalId, "server-environment"),
    actions: environmentActions(state, view.pendingDeletionAt !== null),
  };
}

function desktopItem(desktop: DesktopFacts, deps: ComputersDeps, botsOf: (principalId: string, kind: ComputerKind) => Array<{ id: string; name: string }>): ComputerItem {
  return {
    id: desktopComputerId(desktop.principalId, desktop.desktopId),
    kind: "desktop",
    name: desktop.name,
    owner: deps.person(desktop.principalId),
    state: desktop.online ? "online" : "offline",
    lastUsedAt: desktop.lastSeenAt,
    resources: null,
    image: null,
    os: null,
    arch: null,
    platform: desktop.platform,
    busy: 0,
    pendingDeletionAt: null,
    localVm: desktop.localVm,
    appVersion: desktop.version,
    bots: botsOf(desktop.principalId, "desktop"),
    actions: [],
  };
}

/** The listing: every environment that exists and every connected desktop. */
async function inventory(deps: ComputersDeps, only?: { principalId: string }): Promise<{ items: ComputerItem[]; environments: { configured: boolean; reachable: boolean; maxRunning: number | null; idleMinutes: number | null } }> {
  const bots = deps.bots();
  const botsOf = (principalId: string, kind: ComputerKind) => bots
    .filter((bot) => bot.ownerPrincipalId === principalId && worksOn(bot.computer, kind))
    .map((bot) => ({ id: bot.id, name: bot.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const items: ComputerItem[] = [];
  let environments = { configured: false, reachable: false, maxRunning: null as number | null, idleMinutes: null as number | null };
  if (deps.environments) {
    const provisioner = await deps.environments.provisioner();
    environments = { configured: true, reachable: provisioner !== null, maxRunning: provisioner?.maxRunning ?? null, idleMinutes: provisioner?.idleMinutes ?? null };
    if (provisioner) {
      const people = only ? [only.principalId] : [...new Set(deps.people().map((person) => person.principalId))];
      const found = await deps.environments.inventory(people, COMPUTER_STATUS_TIMEOUT_MS);
      for (const [principalId, facts] of found) {
        const item = environmentItem(principalId, facts, deps, botsOf);
        if (item) items.push(item);
      }
    }
  }
  for (const desktop of deps.desktops()) {
    if (only && desktop.principalId !== only.principalId) continue;
    items.push(desktopItem(desktop, deps, botsOf));
  }
  items.sort((a, b) => a.owner.name.toLocaleLowerCase().localeCompare(b.owner.name.toLocaleLowerCase())
    || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items, environments };
}

/** The principal an id names, and its kind. */
function parseId(id: string): { kind: ComputerKind; principalId: string | null } | null {
  if (id.startsWith("env:") && id.length > 4) return { kind: "server-environment", principalId: id.slice(4) };
  if (/^desktop:[0-9a-f]{16}$/.test(id)) return { kind: "desktop", principalId: null };
  return null;
}

async function find(deps: ComputersDeps, id: string): Promise<ComputerItem | null> {
  const parsed = parseId(id);
  if (!parsed) return null;
  if (parsed.kind === "desktop") {
    const desktop = deps.desktops().find((entry) => desktopComputerId(entry.principalId, entry.desktopId) === id);
    return desktop ? (await inventory(deps, { principalId: desktop.principalId })).items.find((item) => item.id === id) ?? null : null;
  }
  if (!deps.people().some((person) => person.principalId === parsed.principalId)) return null;
  return (await inventory(deps, { principalId: parsed.principalId! })).items.find((item) => item.id === id) ?? null;
}

function action(deps: ComputersDeps, name: ComputerAction): ConsoleRoute {
  return {
    method: "POST",
    path: `computers/{id}/${name}`,
    min: "admin",
    ...(OWNER_COMPUTER_ACTIONS.has(name) ? { ownerGrant: "own-computer" as const } : {}),
    async handle(ctx: ConsoleContext): Promise<ConsoleAnswer> {
      const body = objectBody(ctx.body ?? {});
      if (!body || onlyKeys(body, ["confirm"]) || (body.confirm !== undefined && typeof body.confirm !== "boolean")) return badRequest("Send {} or { \"confirm\": true }.");
      const id = ctx.params.id!;
      const parsed = parseId(id);
      const item = parsed ? await find(deps, id) : null;
      if (!parsed || !item || !ownedOrAny(ctx, item)) return notFound("No such computer.");
      if (item.kind === "desktop") return fail(409, "personal_computer", "This is a person's own computer: the console lists it and never acts on it.");
      const sandbox = deps.environments;
      if (!sandbox) return fail(409, "not_configured", "This server has no server environments.");
      const principalId = parsed.principalId!;
      if (!item.actions.includes(name)) return fail(409, "not_offered", `This server environment cannot ${name} while it is ${item.state}.`);
      if (DESTRUCTIVE.has(name) && body.confirm !== true) {
        return fail(400, "confirm_required", name === "delete"
          ? "Confirm the deletion: it erases the environment and its /workspace. Send { \"confirm\": true }."
          : "Confirm the reset: it erases /workspace and starts a fresh environment. Send { \"confirm\": true }.");
      }
      if (INTERRUPTING.has(name) && body.confirm !== true && (deps.turnRunning(principalId) || item.busy > 0)) {
        return fail(409, "confirm_running", "A bot is working in this server environment right now. Send { \"confirm\": true } to go on anyway.");
      }
      try {
        if (name === "start" || name === "resume") await sandbox.power(principalId, name);
        else if (name === "stop") await sandbox.power(principalId, "shutdown");
        else if (name === "pause") await sandbox.power(principalId, "pause");
        else if (name === "update") await sandbox.update(principalId);
        else if (name === "reset") await sandbox.reset(principalId);
        else await sandbox.remove(principalId);
      } catch (error) {
        const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "unavailable";
        const message = error instanceof Error && code !== "unavailable" ? error.message.slice(0, 300) : "The server environment could not be changed. Try again in a moment.";
        return fail(code === "capacity" ? 429 : code === "unavailable" || code === "unreachable" ? 502 : 409, code, message);
      }
      const after = name === "delete" ? null : await find(deps, id);
      ctx.record({
        category: "computer",
        action: `computer.${name}`,
        target: { kind: "computer", id, name: item.owner.name },
        changed: ["state"],
        before: { state: item.state },
        after: { state: after?.state ?? "deleted", ownerPrincipalId: principalId, ...(body.confirm === true ? { confirmed: true } : {}) },
      });
      return name === "delete" ? ok({ deleted: id }) : ok({ computer: after ?? { ...item, state: "unavailable" as const, actions: [] } });
    },
  };
}

/** Under the `own-computer` grant, only the viewer's own computer. */
function ownedOrAny(ctx: ConsoleContext, item: ComputerItem): boolean {
  return !ctx.ownOnly || item.owner.principalId === ctx.viewer.principalId;
}

export function computersRoutes(deps: ComputersDeps): ConsoleRoute[] {
  return [
    {
      method: "GET",
      path: "computers",
      min: "admin",
      ownerGrant: "own-computer",
      async handle(ctx) {
        const params = ctx.url.searchParams;
        const page = parsePage(params);
        if (isAnswer(page)) return page;
        const kind = enumParam(params, "kind", COMPUTER_KINDS);
        if (isAnswer(kind)) return kind;
        const state = enumParam(params, "state", COMPUTER_STATES);
        if (isAnswer(state)) return state;
        const owner = params.get("owner") || null;
        const { items, environments } = await inventory(deps);
        const filtered = items.filter((item) => ownedOrAny(ctx, item) && (!kind || item.kind === kind) && (!state || item.state === state)
          && (!owner || item.owner.principalId === owner || item.owner.sub === owner)
          && matchesQuery(page.q, item.name, item.owner.name, item.image, item.platform));
        return ok({ ...pageOf(filtered, page), environments });
      },
    },
    {
      method: "GET",
      path: "computers/{id}",
      min: "admin",
      ownerGrant: "own-computer",
      async handle(ctx) {
        const id = ctx.params.id!;
        const item = await find(deps, id);
        if (!item || !ownedOrAny(ctx, item)) return notFound("No such computer.");
        const activity = deps.activity({ computerId: id, principalId: item.owner.principalId, kind: item.kind, limit: COMPUTER_ACTIVITY_MAX });
        return ok({ computer: item, activity });
      },
    },
    ...COMPUTER_ACTIONS.map((name) => action(deps, name)),
  ];
}
