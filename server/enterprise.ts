// Which features this server runs with, and the neutral hook point for an
// optional enterprise layer.
//
// Sagax is open source with no license key: without a layer, which is every
// build of this repository, the server runs the open-source edition and every
// gated feature is on (OPEN_SOURCE_FEATURES). A feature gate is never an
// authorization check: who may use a feature stays with the request's scope
// (server/request-auth.ts) and the route's own checks.
//
// The hook stays for a layer that lives outside this tree (its own folder and
// LICENSE), loaded only if that folder is present. Core never imports it
// statically; a build ships it as its own bundled file beside the server (see
// enterpriseLayerDirs for where it is looked up). A present layer alone decides
// the features: its only obligation is `register()`, which turns
// SAGAX_LICENSE_KEY into the features it grants; core keeps the resulting
// status and answers `entitled()`. The hosted workspace bridge
// (createWorkspaceAccess) only ever comes from such a layer.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRegistry } from "./sessions.ts";

import { SERVER_ROOT } from "./proxy-paths.ts";

export interface EditionStatus {
  edition: "oss" | "enterprise";
  /** Enterprise only: who the license was issued to. */
  customer?: string;
  /** The features this server runs with (sorted): OPEN_SOURCE_FEATURES in the
   * open-source edition without a layer; with a layer, what its key grants,
   * and none while it grants nothing. */
  features: string[];
  /** Enterprise only: ISO date the license stops working, null for perpetual. */
  expiresAt?: string | null;
  /** Enterprise with an expiry only: whole days until `expiresAt`, counted
   * up; zero or negative once it has passed and the grace period runs. */
  expiresInDays?: number;
  /** Enterprise in its grace period only: when the features stop. */
  graceEndsAt?: string;
  /** Why the server is not running the enterprise edition although something
   * hinted it should, or, in the grace period, that the key needs renewing. */
  notice?: string;
}

/** What the enterprise layer's register() must return; validated because it is external code. */
const layerSchema = z.object({
  customer: z.string().min(1),
  features: z.array(z.string().min(1)),
  expiresAt: z.string().nullable(),
});

/** A layer's key only (the open-source edition has none): days before expiry
 * that the startup log and /api/edition start saying so, and days after it
 * that the features keep working while the operator renews. The key and its
 * verification are the layer's: it accepts a key that expired less than the
 * grace period ago. */
export const LICENSE_WARN_DAYS = 30;
export const LICENSE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** Where the layer may be, in order. An explicit SAGAX_ENTERPRISE_DIR is the
 * only place looked at when set. Otherwise: beside the server root (a
 * checkout, where server/ and enterprise/ are siblings, and the npm package,
 * which copies the bundled layer to <package>/enterprise), then inside it
 * (the Docker image and the packaged desktop ship dist-server/ alone, and
 * scripts/bundle-server.mjs writes the layer to dist-server/enterprise). */
export function enterpriseLayerDirs(env: NodeJS.ProcessEnv = process.env, serverRoot: string = SERVER_ROOT): string[] {
  if (env.SAGAX_ENTERPRISE_DIR) return [env.SAGAX_ENTERPRISE_DIR];
  return [join(serverRoot, "..", "enterprise"), join(serverRoot, "enterprise")];
}

/** Source in a checkout, a compiled bundle in an image: same convention as proxy-paths.ts. */
function layerEntry(dir: string): string | undefined {
  return [join(dir, "server", "index.ts"), join(dir, "server", "index.js")].find((candidate) => existsSync(candidate));
}

/** Every gated feature, all on in the open-source edition: `admin` is
 * Settings > Installations (the /api/fleet routes, beside a fleet agent),
 * `billing` the operator's sell prices, `budgets` the monthly spend limit,
 * `whitelabel` brand.json. */
export const OPEN_SOURCE_FEATURES: readonly string[] = Object.freeze(["admin", "billing", "budgets", "whitelabel"]);

/** No enterprise layer: every feature on, no key involved. The notice only
 * says that a SAGAX_LICENSE_KEY set anyway has nothing to unlock. */
function openSourceEdition(notice?: string): EditionStatus {
  return { edition: "oss", features: [...OPEN_SOURCE_FEATURES], ...(notice ? { notice } : {}) };
}

// The open-source edition until loadEnterpriseLayer finds a layer, which only
// a server that installed one ever does.
let current: EditionStatus = openSourceEdition();
let workspaceAccessFactory: ((options: WorkspaceAccessOptions) => WorkspaceAccess) | undefined;

export interface WorkspaceAccessOptions {
  sessions: SessionRegistry;
  cookieName: string;
  closeSessionStreams(sessionId: string): void;
  entitled(): boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface WorkspaceAccess {
  handlePublic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  authorize(req: IncomingMessage, auth: RequestAuth): Promise<{ status: 401 | 403 | 503; error: string } | null>;
  revalidate(): Promise<void>;
}

export function hostedWorkspaceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_ADMIN_URL !== undefined || env.SAGAX_ADMIN_WORKSPACE !== undefined || env.SAGAX_ADMIN_MEMBERSHIP !== undefined;
}

/** Validate the operator's complete hosted configuration before any session
 * can delegate membership authority. A partial setting is never standalone. */
export function hostedWorkspaceConfiguration(env: NodeJS.ProcessEnv = process.env): { admin: URL; tenant: URL; workspace: string; portalMembership: boolean } | null {
  try {
    const origin = (raw: string | undefined) => {
      if (!raw || raw !== raw.trim()) throw new Error("missing origin");
      const url = new URL(raw);
      if (url.protocol !== "https:" || (raw !== url.origin && raw !== `${url.origin}/`)) throw new Error("invalid origin");
      return url;
    };
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(env.SAGAX_ADMIN_WORKSPACE ?? "")) return null;
    if (env.SAGAX_ADMIN_MEMBERSHIP !== undefined && !["local", "portal"].includes(env.SAGAX_ADMIN_MEMBERSHIP)) return null;
    return { admin: origin(env.SAGAX_ADMIN_URL), tenant: origin(env.SAGAX_PUBLIC_URL), workspace: env.SAGAX_ADMIN_WORKSPACE!, portalMembership: env.SAGAX_ADMIN_MEMBERSHIP === "portal" };
  } catch { return null; }
}

/** Perspicax wrote a link file for this organisation. The directory uses the
 * same two variables (SAGAX_IDENTITY=perspicax and SAGAX_PERSPICAX_LINK_FILE).
 * A hosted Admin workspace is a different switch. */
export function perspicaxOrganisationLinked(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax" && Boolean(env.SAGAX_PERSPICAX_LINK_FILE?.trim());
}

/** Who decides who may use this workspace, for Settings → People and
 * Remote access. On a portal-membership workspace the organisation's Admin
 * does, and `peopleUrl` opens its People page for this workspace (identifiers
 * only; Admin authorizes its own visitor). A hosted workspace never issues
 * pairing codes or email sign-in: people come in through the portal. A
 * linked Perspicax organisation does not either: people sign in with OAuth. */
export function workspaceMembership(env: NodeJS.ProcessEnv = process.env):
  { authority: "local" | "portal"; pairingCodes: boolean; peopleUrl?: string } {
  const hosted = hostedWorkspaceConfiguration(env);
  const pairingCodes = !hostedWorkspaceConfigured(env) && !perspicaxOrganisationLinked(env);
  if (!hosted?.portalMembership) return { authority: "local", pairingCodes };
  const people = new URL("/people", hosted.admin);
  people.search = new URLSearchParams({ workspace: hosted.workspace }).toString();
  return { authority: "portal", pairingCodes, peopleUrl: people.href };
}

/** An operator may authorize new Full tasks only on a dedicated,
 * portal-managed server. This is not an HTTP setting or a desktop grant. */
export function sharedWorkspaceFullAccessConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_SHARED_WORKSPACE_FULL_ACCESS === "1" && env.SAGAX_DESKTOP_PARENT !== "1" &&
    hostedWorkspaceConfiguration(env)?.portalMembership === true;
}

/** No enterprise import or portal dependency enters the core bundle. A
 * configured server without this hook must refuse hosted access, not fall
 * back to legacy email or QR credentials. The bridge runs on its own layer's
 * grant (hostedAccessEntitled), never on the open-source edition's features. */
export function createWorkspaceAccess(options: Omit<WorkspaceAccessOptions, "entitled">): WorkspaceAccess | null {
  if (!hostedWorkspaceConfigured(options.env)) return null;
  return workspaceAccessFactory?.({ ...options, entitled: () => hostedAccessEntitled() }) ?? null;
}

/** A layer is present but grants nothing (no key, a refused key, a broken
 * layer). The layer decides, so no feature is on; the notice says why. */
function layerGrantsNothing(notice: string): EditionStatus {
  current = { edition: "oss", features: [], notice };
  return current;
}

/** Resolve the edition once at startup. Never throws. No layer: the
 * open-source edition, every feature on. A broken layer or key turns every
 * feature off, with a notice that says what to fix. */
export async function loadEnterpriseLayer(
  options: { dir?: string; licenseKey?: string; env?: NodeJS.ProcessEnv; serverRoot?: string } = {},
): Promise<EditionStatus> {
  workspaceAccessFactory = undefined;
  const dirs = options.dir ? [options.dir] : enterpriseLayerDirs(options.env, options.serverRoot);
  const licenseKey = options.licenseKey ?? process.env.SAGAX_LICENSE_KEY;
  const entry = dirs.map(layerEntry).find((candidate) => candidate !== undefined);
  if (!entry) {
    // The Docker and open-source CI jobs boot with a stray key and expect
    // this notice on /api/edition: keep "no enterprise layer exists".
    current = openSourceEdition(
      licenseKey ? `SAGAX_LICENSE_KEY is set but no enterprise layer exists at ${dirs.join(" or ")}; the open-source edition needs no key` : undefined,
    );
    return current;
  }
  try {
    const loaded: unknown = await import(pathToFileURL(entry).href);
    const access: unknown = Reflect.get(Object(loaded), "createWorkspaceAccess");
    if (typeof access === "function") workspaceAccessFactory = access as (options: WorkspaceAccessOptions) => WorkspaceAccess;
    const register: unknown = Reflect.get(Object(loaded), "register");
    if (typeof register !== "function") throw new Error(`${entry} does not export register()`);
    if (!licenseKey) return layerGrantsNothing("enterprise layer present but SAGAX_LICENSE_KEY is not set");
    // graceDays is additive: a layer that ignores it refuses an expired key
    // at startup exactly as before.
    const registered: unknown = await register({ licenseKey, graceDays: LICENSE_GRACE_DAYS });
    const layer = layerSchema.parse(registered);
    current = {
      edition: "enterprise",
      customer: layer.customer,
      features: [...new Set(layer.features)].sort(),
      expiresAt: layer.expiresAt,
    };
    return current;
  } catch (error) {
    return layerGrantsNothing(`enterprise layer disabled: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** When the key stops being valid, or null for perpetual / open-source. */
function expiryAt(): number | null {
  if (current.edition !== "enterprise" || !current.expiresAt) return null;
  const at = new Date(current.expiresAt).getTime();
  return Number.isFinite(at) ? at : null;
}

/** A license that expires while the server keeps running stops granting
 * features once its grace period ends, at that moment, not at the next restart. */
function expired(now: number): boolean {
  const at = expiryAt();
  return at !== null && now >= at + LICENSE_GRACE_DAYS * DAY_MS;
}

export function editionStatus(now: number = Date.now()): EditionStatus {
  const at = expiryAt();
  if (at === null) return current;
  if (expired(now)) {
    return {
      edition: "oss",
      features: [],
      notice: `enterprise layer disabled: SAGAX_LICENSE_KEY expired on ${current.expiresAt}; renew it to keep enterprise features`,
    };
  }
  const expiresInDays = Math.ceil((at - now) / DAY_MS);
  if (now < at) return { ...current, expiresInDays };
  const graceEndsAt = new Date(at + LICENSE_GRACE_DAYS * DAY_MS).toISOString().slice(0, 10);
  return {
    ...current,
    expiresInDays,
    graceEndsAt,
    notice: `SAGAX_LICENSE_KEY expired on ${current.expiresAt}; enterprise features keep working until ${graceEndsAt} while it is renewed`,
  };
}

/** The edition as a non-admin session sees it: what is entitled, without
 * the license's countdown, grace date or operator notice. */
export function editionForMembers(status: EditionStatus): EditionStatus {
  const { expiresInDays: _days, graceEndsAt: _grace, notice: _notice, ...shared } = status;
  return shared;
}

/** Feature gates in core ask this and nothing else. True for every id of
 * OPEN_SOURCE_FEATURES in the open-source edition; with a layer, for what its
 * key grants until its grace period ends. Unknown ids are simply not granted.
 * Never a permission: the caller still checks who is asking. */
export function entitled(feature: string, now: number = Date.now()): boolean {
  return !expired(now) && current.features.includes(feature);
}

/** The hosted workspace features (portal membership and its readiness probe,
 * hosted Slack, shared-workspace Full access) run on a layer's bridge, so only
 * that layer's key turns them on: a loaded layer granting `admin`, never the
 * open-source edition's own `admin`. */
export function hostedAccessEntitled(now: number = Date.now()): boolean {
  return current.edition === "enterprise" && entitled("admin", now);
}

/** The startup warning for a key that is about to lapse or already in its
 * grace period; null when there is nothing to say. */
export function licenseWarning(status: EditionStatus): string | null {
  if (status.edition !== "enterprise" || !status.expiresAt || status.expiresInDays === undefined) return null;
  if (status.graceEndsAt) {
    return `SAGAX_LICENSE_KEY expired on ${status.expiresAt}; enterprise features keep working until ${status.graceEndsAt} — renew the key before then`;
  }
  if (status.expiresInDays > LICENSE_WARN_DAYS) return null;
  const days = status.expiresInDays === 1 ? "1 day" : `${status.expiresInDays} days`;
  return `SAGAX_LICENSE_KEY expires on ${status.expiresAt} (in ${days}); renew it before then to keep enterprise features`;
}

/** One line for the startup log. */
export function describeEdition(status: EditionStatus): string {
  if (status.edition === "enterprise") {
    const until = status.expiresAt ? ` until ${status.expiresAt}` : "";
    return `Sagax enterprise edition for ${status.customer}${until}: ${status.features.join(", ") || "no features"}`;
  }
  return `Sagax open-source edition${status.notice ? ` (${status.notice})` : ""}`;
}
