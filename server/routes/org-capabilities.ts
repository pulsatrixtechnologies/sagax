// Capabilities lot 4: the organization's capabilities, one owner.
//
// On a server linked to a Perspicax that serves them (its directory carries
// `capability_marketplace_policy`), Perspicax owns the organization's
// declarations, its allowed marketplaces and its marketplace policy. The
// Organization scope of Plugins (Installed, Sources) writes them through
// this server's link: the link token (which server) AND the live sign-in
// token of the admin who acts (SUBJECT_TOKEN_HEADER, who), on the same
// routes the Perspicax console uses (base /api/v1/pulsabot/capabilities).
// Perspicax refuses a member, a manager, a link without a person, or a
// sign-in it does not accept; this server only says so clearly. Nothing is
// stored here but the one-time migration mark.
//
// Unlinked (or an older Perspicax): the Organization scope keeps today's
// local behaviour and these admin routes answer `owner: "local"`.
//
// A person's own switch for an offered declaration (`/api/me/org-capabilities`)
// stays in Sagax: it writes that person's Me state only, never a global one,
// and needs no admin.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import type { CapabilityMarketplacePolicy, LinkPostResult } from "../perspicax-link.ts";
import type { OrgCapabilityView } from "../org-capabilities.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PX_CAPABILITIES_PATH = "/api/v1/pulsabot/capabilities";
export const ORG_CAPABILITIES_ROUTE = "/api/org/capabilities";
export const ME_ORG_CAPABILITIES_ROUTE = "/api/me/org-capabilities";
/** The bounds of one call (server/index.ts passes them to linkJson). */
export const ORG_CAPABILITIES_CALL = { timeoutMs: 10_000, maxBytes: 1024 * 1024 } as const;

export type HistoricalPolicy = { mode: "any" } | { mode: "list"; allow: string[] };

export type OrgCapabilityErrorCode =
  | "org_capabilities_sign_in" | "org_capabilities_admin" | "org_capabilities_link" | "org_capabilities_unreachable"
  | "org_capabilities_invalid" | "org_capabilities_conflict" | "org_capabilities_unknown" | "org_capabilities_local"
  | "org_capability_unknown" | "org_capability_imposed" | "org_capability_off" | "org_capability_not_member" | "session_required";

export interface OrgCapabilityRouteDeps {
  /** "perspicax": linked to a Perspicax that serves the capability routes;
   * "local": unlinked or an older Perspicax (today's behaviour). */
  owner: () => "perspicax" | "local";
  /** The signed-in person of an organization server (never a service, a
   * paired device without a person, or the link). */
  person: (auth: RequestAuth) => { principalId: string } | null;
  /** That person's live sign-in token for Perspicax; null when there is
   * none (signed in too long ago, signed out). Never a routine delegation. */
  subjectToken: (principalId: string) => Promise<string | null>;
  /** One link call to Perspicax (server/perspicax-link.ts linkJson). */
  call: (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown, subjectToken: string) => Promise<LinkPostResult>;
  /** A committed write: read the directory again now (Perspicax signals it
   * too; whichever comes first). */
  refreshed: () => void;
  /** The declarations from the last directory, public fields only. */
  views: () => OrgCapabilityView[];
  isMember: (principalId: string) => boolean;
  activeFor: (view: OrgCapabilityView, principalId: string) => boolean;
  setChoice: (principalId: string, id: string, enabled: boolean) => void;
  /** The policy Perspicax sends: undefined (older), null (not set). */
  policy: () => CapabilityMarketplacePolicy | null | undefined;
  /** cfg.organization.pluginMarketplaces, the historical local rule. */
  historical: () => HistoricalPolicy | undefined;
  dataDir: string;
  log?: (line: string) => void;
}

/** A local write of an organization setting Perspicax owns (one owner). */
export class OrgSettingOwnedElsewhere extends Error {
  readonly code = "org_setting_in_perspicax";
  constructor() {
    super("Perspicax owns the organization's marketplaces now: change them in Capabilities > Sources > Organization, or in the Perspicax console.");
  }
}

const MIGRATION_FILE = "marketplace-migration.json";

function migrationDone(dataDir: string): boolean {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, "org-capabilities", MIGRATION_FILE), "utf8")) as { done?: unknown };
    return value.done === true;
  } catch {
    return false;
  }
}

function markMigrated(dataDir: string, at: number): void {
  const dir = join(dataDir, "org-capabilities");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileAtomic(join(dir, MIGRATION_FILE), JSON.stringify({ done: true, at }), { mode: 0o600 });
}

/** A readable marketplace name for a historical entry: `owner/repo`,
 * `owner/*`, or an address's host and path (64 characters at most). */
export function marketplaceNameFor(source: string): string {
  let name = source;
  try {
    const url = new URL(source);
    name = `${url.hostname}${url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "")}`;
  } catch { /* owner/repo or owner/* */ }
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64) || "marketplace";
}

/** What a Perspicax refusal means for the person, as a code the screens
 * word. The message Perspicax gave a validation or conflict (it names a
 * field, never a value) is kept. */
export function refusalOf(result: Exclude<LinkPostResult, { ok: true }>): { status: number; code: OrgCapabilityErrorCode; message?: string } {
  const body = result.body && typeof result.body === "object" ? result.body as { code?: unknown; message?: unknown } : undefined;
  const message = typeof body?.message === "string" ? body.message.slice(0, 500) : undefined;
  if (result.status === 403) return body?.code === "subject" ? { status: 403, code: "org_capabilities_sign_in" } : { status: 403, code: "org_capabilities_admin" };
  if (result.error === "link") return { status: 503, code: "org_capabilities_link" };
  if (result.error === "unreachable" || result.error === "too_large") return { status: 502, code: "org_capabilities_unreachable" };
  if (result.status === 400 || result.status === 422) return { status: 400, code: "org_capabilities_invalid", ...(message ? { message } : {}) };
  if (result.status === 409) return { status: 409, code: "org_capabilities_conflict", ...(message ? { message } : {}) };
  if (result.status === 404) return { status: 404, code: "org_capabilities_unknown" };
  return { status: 502, code: "org_capabilities_unreachable" };
}

const ERROR_TEXT: Record<OrgCapabilityErrorCode, string> = {
  org_capabilities_sign_in: "Perspicax did not accept your sign-in for this change. Sign in to Sagax again, then try again.",
  org_capabilities_admin: "Only an organization admin in Perspicax can change the organization's capabilities.",
  org_capabilities_link: "This server's link to Perspicax is missing or was refused.",
  org_capabilities_unreachable: "Perspicax did not answer. Try again in a moment.",
  org_capabilities_invalid: "Perspicax refused a field of this capability.",
  org_capabilities_conflict: "Perspicax already has another capability or marketplace with this name or source.",
  org_capabilities_unknown: "Perspicax no longer has this capability.",
  org_capabilities_local: "This server is not linked to a Perspicax that owns the organization's capabilities.",
  org_capability_unknown: "The organization no longer offers this capability.",
  org_capability_imposed: "The organization imposes this capability: it stays on.",
  org_capability_off: "The organization turned this capability off.",
  org_capability_not_member: "Only an active member of the organization can use its capabilities.",
  session_required: "Sign in to change this.",
};

/** The one-time import of the historical marketplace rule into Perspicax:
 * each entry with POST /marketplaces (idempotent on its source), then the
 * policy with PUT /marketplace-policy LAST. An interruption before the PUT
 * keeps the historical rule (Perspicax's policy stays null). Recorded here
 * only after the PUT succeeded; a retry is safe. */
export async function migrateMarketplaces(deps: Pick<OrgCapabilityRouteDeps, "call" | "policy" | "historical" | "dataDir" | "log">, subjectToken: string, now = Date.now()):
  Promise<{ ok: true; done: true; imported: number } | { ok: false; refusal: ReturnType<typeof refusalOf> }> {
  if (migrationDone(deps.dataDir)) return { ok: true, done: true, imported: 0 };
  // Perspicax already has a policy (set from its console): nothing to import.
  if (deps.policy()) {
    markMigrated(deps.dataDir, now);
    return { ok: true, done: true, imported: 0 };
  }
  const historical = deps.historical();
  const entries = historical?.mode === "list" ? [...new Set(historical.allow.map((entry) => entry.trim()).filter(Boolean))] : [];
  for (const source of entries) {
    const posted = await deps.call("POST", `${PX_CAPABILITIES_PATH}/marketplaces`, { name: marketplaceNameFor(source), source, enabled: true }, subjectToken);
    if (!posted.ok) return { ok: false, refusal: refusalOf(posted) };
  }
  // no list (or any): the historical rule was "any marketplace"
  const mode = historical?.mode === "list" ? "list" : "any";
  const put = await deps.call("PUT", `${PX_CAPABILITIES_PATH}/marketplace-policy`, { mode }, subjectToken);
  if (!put.ok) return { ok: false, refusal: refusalOf(put) };
  markMigrated(deps.dataDir, now);
  deps.log?.(`[org-capabilities] historical marketplace rule moved to Perspicax (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${mode})`);
  return { ok: true, done: true, imported: entries.length };
}

function memberRow(view: OrgCapabilityView, on: boolean, member: boolean) {
  return {
    id: view.id, mount: view.mount, form: view.form, name: view.name, description: view.description,
    mode: view.mode, enabled: view.enabled, state: view.state, source: view.source,
    ...(view.transport ? { transport: view.transport } : {}), ...(view.version ? { version: view.version } : {}),
    on, canToggle: view.mode === "offered" && view.enabled && member && view.state !== "flow",
  };
}

export function createOrgCapabilityRoutes(deps: OrgCapabilityRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const me = path === ME_ORG_CAPABILITIES_ROUTE || path.startsWith(`${ME_ORG_CAPABILITIES_ROUTE}/`);
    const org = path === ORG_CAPABILITIES_ROUTE || path.startsWith(`${ORG_CAPABILITIES_ROUTE}/`);
    if (!me && !org) return PASS;
    res.setHeader("cache-control", "no-store");
    const fail = (status: number, code: OrgCapabilityErrorCode, message?: string) => json(res, status, { error: message ?? ERROR_TEXT[code], code });

    // ── a person's own switch (Me state) ──────────────────────────────
    if (me) {
      const person = deps.person(auth);
      if (method === "GET" && path === ME_ORG_CAPABILITIES_ROUTE) {
        if (!person) return json(res, 200, { owner: deps.owner(), items: [] });
        const member = deps.isMember(person.principalId);
        return json(res, 200, { owner: deps.owner(), items: deps.views().filter((view) => view.state !== "flow").map((view) => memberRow(view, deps.activeFor(view, person.principalId), member)) });
      }
      const id = decodeURIComponent(path.slice(ME_ORG_CAPABILITIES_ROUTE.length + 1));
      if (method !== "PUT" || !id || id.includes("/")) return PASS;
      if (!person) return fail(401, "session_required");
      const body = await readBody(req).catch(() => null) as { enabled?: unknown } | null;
      if (typeof body?.enabled !== "boolean") return json(res, 400, { error: "send { enabled: true | false }", code: "bad_request" });
      const view = deps.views().find((candidate) => candidate.id === id && candidate.state !== "flow");
      if (!view) return fail(404, "org_capability_unknown");
      if (!deps.isMember(person.principalId)) return fail(403, "org_capability_not_member");
      if (view.mode === "imposed") return fail(409, "org_capability_imposed");
      if (!view.enabled) return fail(409, "org_capability_off");
      deps.setChoice(person.principalId, view.id, body.enabled);
      return json(res, 200, { item: memberRow(view, deps.activeFor(view, person.principalId), true) });
    }

    // ── the organization's declarations, owned by Perspicax ───────────
    if (deps.owner() !== "perspicax") {
      if (method === "GET" && path === ORG_CAPABILITIES_ROUTE) return json(res, 200, { owner: "local" });
      return fail(409, "org_capabilities_local");
    }
    const person = deps.person(auth);
    if (!person) return fail(401, "session_required");
    const token = await deps.subjectToken(person.principalId).catch(() => null);
    if (!token) return fail(403, "org_capabilities_sign_in");
    const answer = (result: LinkPostResult, status = 200) => {
      if (!result.ok) {
        const refusal = refusalOf(result);
        return fail(refusal.status, refusal.code, refusal.message);
      }
      return json(res, status, result.body ?? {});
    };
    const rest = path.slice(ORG_CAPABILITIES_ROUTE.length);
    if (method === "GET" && rest === "") {
      const result = await deps.call("GET", PX_CAPABILITIES_PATH, undefined, token);
      if (!result.ok) return answer(result);
      const installed = new Map(deps.views().map((view) => [view.id, view] as const));
      const inventory = (result.body ?? {}) as { capabilities?: Array<{ id?: unknown }> };
      return json(res, 200, {
        owner: "perspicax", ...inventory,
        // what this server did of each declaration (installed, pending...)
        installed: Object.fromEntries((inventory.capabilities ?? []).flatMap((row) => {
          const view = typeof row.id === "string" ? installed.get(row.id) : undefined;
          return view ? [[view.id, { state: view.state, ...(view.error ? { error: view.error } : {}) }]] : [];
        })),
        migrated: migrationDone(deps.dataDir),
      });
    }
    if (method === "POST" && rest === "/migrate") {
      const migrated = await migrateMarketplaces(deps, token);
      if (!migrated.ok) return fail(migrated.refusal.status, migrated.refusal.code, migrated.refusal.message);
      deps.refreshed();
      return json(res, 200, migrated);
    }
    // Every marketplace or policy write runs the one-time import first, so
    // a first save never loses the historical list.
    if (rest === "/marketplaces" || rest.startsWith("/marketplaces/") || rest === "/marketplace-policy") {
      const migrated = await migrateMarketplaces(deps, token);
      if (!migrated.ok) return fail(migrated.refusal.status, migrated.refusal.code, migrated.refusal.message);
    }
    const target = `${PX_CAPABILITIES_PATH}${rest.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/")}`;
    const writable = (method === "POST" && (rest === "" || rest === "/marketplaces"))
      || ((method === "PUT" || method === "DELETE") && /^\/(?:marketplaces\/)?[^/]+$/.test(rest) && rest !== "/migrate")
      || (method === "PUT" && rest === "/marketplace-policy");
    if (!writable || (method === "DELETE" && rest === "/marketplace-policy")) return PASS;
    let body: unknown;
    if (method !== "DELETE") {
      body = await readBody(req, 2 * 1024 * 1024).catch(() => undefined);
      if (body === undefined || body === null || typeof body !== "object") return json(res, 400, { error: "send a JSON object", code: "bad_request" });
    }
    const result = await deps.call(method as "POST" | "PUT" | "DELETE", target, body, token);
    if (result.ok) deps.refreshed();
    if (result.ok && method === "DELETE") { res.statusCode = 204; res.end(); return; }
    return answer(result);
  };
}
