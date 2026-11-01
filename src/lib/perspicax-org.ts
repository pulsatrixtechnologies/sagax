// The organization of a server signed in with Perspicax (slice 3): GET
// /api/org answers with `org.identity.kind === "perspicax"` there, and with
// the interim organization (or 404) on a solo server. Asked once per page
// load; null while the answer is on its way or on a solo server.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { personAvatarSrc } from "@/lib/profile-management";
import { PERSON_AVATAR_EVENT } from "@/lib/person-avatars";
import { personLabel } from "@/lib/human-label";
import { setAttachmentHostShared } from "@/lib/composer-attachments";

export interface PerspicaxOrg {
  org: { name: string; identity: { kind: "perspicax"; issuer: string; serverId?: string } };
  link: { state: "missing" | "ok" | "error"; syncedAt?: number; error?: string };
  viewerRole: "admin" | "member";
  /** orgKeyConfigured: the server has a key for at least one engine (the
   * organization's key, used automatically after the speaker's own
   * subscription and key, 2026-10-01). */
  settings: {
    orgKeyConfigured?: boolean;
    interimAttach?: { until: number | null; people: number };
    /** Whether bots may run with Full access (absent: allowed). */
    allowFullAccess?: boolean;
    /** Whether bots run their owner's commands in the owner's own isolated
     * environment without asking (absent: on). */
    memberEnvironmentAutonomy?: boolean;
    /** New threads start confidential unless the person picks an ordinary
     * one (absent: off). */
    confidentialThreadsByDefault?: boolean;
    /** Whether members' bots run Auto and Auto-accept edits as such
     * (absent: on; false: they run as Ask). */
    memberAutoApproval?: boolean;
    /** Whether people may export their credential vault in clear (absent:
     * allowed; false: Settings > Credentials > Export is refused). */
    allowVaultExport?: boolean;
    /** Where bots' Claude Code plugins may come from (any by default). */
    pluginMarketplaces?: { mode: "any" } | { mode: "list"; allow: string[] };
    /** Capabilities lot 4: "perspicax" when Perspicax owns the rule. */
    pluginMarketplacesOwner?: "perspicax" | "local";
    /** The organization's GitHub OAuth App for "Connecter GitHub". */
    github?: { clientId: string | null; fromEnvironment: boolean };
  };
}

export interface OrgDirectoryPerson {
  principalId: string;
  name: string;
  login: string;
  email?: string;
  role: "admin" | "member";
  disabled: boolean;
  /** Their Perspicax avatar as this server serves it, when they have one. */
  avatarUrl?: string;
  /** A Perspicax service account: never someone to write to. */
  service?: true;
  /** Admins only: this person's page in the Perspicax console. */
  manageUrl?: string;
  /** Their custom label (src/lib/person-labels.ts keeps the live copy). */
  label?: string;
}

let peoplePending: Promise<Map<string, OrgDirectoryPerson>> | null = null;

/** The organization's people by principal id, asked once per page load (on
 * a Perspicax server only; empty elsewhere or when the answer fails). */
export function loadOrgPeople(force = false): Promise<Map<string, OrgDirectoryPerson>> {
  if (force) peoplePending = null;
  peoplePending ??= loadPerspicaxOrg()
    .then((org) => (org ? api<{ people?: OrgDirectoryPerson[] }>("/api/org/directory") : { people: [] }))
    .then((body) => new Map((body.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), () => new Map());
  return peoplePending;
}

/** loadOrgPeople as a hook: empty until it answers. */
export function useOrgPeople(): Map<string, OrgDirectoryPerson> {
  const [people, setPeople] = useState<Map<string, OrgDirectoryPerson>>(() => new Map());
  useEffect(() => {
    let alive = true;
    void loadOrgPeople().then((value) => { if (alive) setPeople(value); });
    // A photo changed (src/lib/person-avatars.ts): read the directory again.
    const reload = () => { void loadOrgPeople(true).then((value) => { if (alive) setPeople(value); }); };
    if (typeof window === "undefined") return () => { alive = false; };
    window.addEventListener(PERSON_AVATAR_EVENT, reload);
    return () => { alive = false; window.removeEventListener(PERSON_AVATAR_EVENT, reload); };
  }, []);
  return people;
}

/** A room's person as the Gens list shows them: their display name and
 * avatar from the directory, else the id the room stores. */
export function channelHumanRow(id: string, people: ReadonlyMap<string, OrgDirectoryPerson>): { id: string; label: string; detail?: string; avatarUrl?: string } {
  const person = people.get(id.trim().toLowerCase());
  if (!person) return { id, label: personLabel(id) };
  const avatarUrl = personAvatarSrc(person.avatarUrl);
  return {
    id,
    label: personLabel(person.name, person.login, id),
    ...(person.email && person.email !== person.name ? { detail: person.email } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function isPerspicaxOrg(body: unknown): body is PerspicaxOrg {
  const org = body && typeof body === "object" ? (body as { org?: { identity?: { kind?: unknown } } }).org : undefined;
  return org?.identity?.kind === "perspicax";
}

let pending: Promise<PerspicaxOrg | null> | null = null;

export function loadPerspicaxOrg(force = false): Promise<PerspicaxOrg | null> {
  if (force) pending = null;
  pending ??= api<unknown>("/api/org").then((body) => {
    const org = isPerspicaxOrg(body) ? body : null;
    // #1098: a solo server lifts the attachment ceilings
    setAttachmentHostShared(org !== null);
    return org;
  }, () => null);
  return pending;
}

/** The Perspicax organization, or null (solo server, or still loading). */
export function usePerspicaxOrg(): PerspicaxOrg | null {
  const [org, setOrg] = useState<PerspicaxOrg | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPerspicaxOrg().then((value) => { if (alive) setOrg(value); });
    return () => { alive = false; };
  }, []);
  return org;
}

/** The people a bot owner may add: not the owner, not disabled, not already
 * granted, matching the search by name, login or address. */
export function sharePickerPeople(people: OrgDirectoryPerson[], input: { ownerId?: string; grants: string[]; query: string }): OrgDirectoryPerson[] {
  const owner = input.ownerId?.toLowerCase();
  const granted = new Set(input.grants.map((id) => id.toLowerCase()));
  const q = input.query.trim().toLowerCase();
  return people.filter((person) => {
    const id = person.principalId.toLowerCase();
    if (person.disabled || id === owner || granted.has(id)) return false;
    if (!q) return true;
    return [person.name, person.login, person.email ?? ""].some((field) => field.toLowerCase().includes(q));
  });
}

// ── slice 4: grants with levels, teams, sections, my engines ─────────────

export type GrantLevel = "use" | "run" | "edit" | "manage";
export const GRANT_LEVELS: readonly GrantLevel[] = ["use", "run", "edit", "manage"];

export interface WireGrant {
  target: string;
  level: GrantLevel;
  by: string;
  at: number;
  label: string;
  kind: "user" | "team";
  disabled?: boolean;
}

export interface GrantAdministration {
  any: boolean;
  teamIds: string[];
  maxLevel: GrantLevel;
  canAdd?: boolean;
}

export interface OrgDirectoryTeam {
  id: string;
  name: string;
  managers: string[];
  members: string[];
}

export interface OrgDirectory {
  people: (OrgDirectoryPerson & { teams?: { id: string; manager: boolean }[] })[];
  teams?: OrgDirectoryTeam[];
  viewer?: { principalId: string | null; orgRole: "admin" | "member"; perspicaxRole?: string; managedTeamIds: string[] };
}

/** Whether a level may be given by someone whose ceiling is `max`. */
export function levelAllowed(level: GrantLevel, max: GrantLevel): boolean {
  return GRANT_LEVELS.indexOf(level) <= GRANT_LEVELS.indexOf(max);
}

export interface GrantCandidate {
  target: string;
  kind: "user" | "team";
  label: string;
  detail: string;
  count?: number;
}

/** People and teams a grant (or a section member entry) may add: active
 * people other than the owner, teams, none already listed; a team manager
 * who administers only their teams sees those teams and their members. */
export function grantCandidates(directory: OrgDirectory | null, input: { ownerId?: string; taken: string[]; query: string; administer?: GrantAdministration | null }): GrantCandidate[] {
  if (!directory) return [];
  const taken = new Set(input.taken);
  const owner = input.ownerId?.toLowerCase();
  const q = input.query.trim().toLowerCase();
  const limited = input.administer && !input.administer.any ? new Set(input.administer.teamIds) : null;
  const teams = (directory.teams ?? []).filter((team) => !limited || limited.has(team.id));
  const inTeams = limited ? new Set(teams.flatMap((team) => [...team.members, ...team.managers])) : null;
  const out: GrantCandidate[] = [];
  for (const team of teams) {
    const target = `team:${team.id}`;
    if (taken.has(target) || (q && !team.name.toLowerCase().includes(q))) continue;
    out.push({ target, kind: "team", label: team.name, detail: "", count: team.members.length });
  }
  for (const person of directory.people) {
    const target = `user:${person.principalId}`;
    if (person.disabled || taken.has(target) || person.principalId.toLowerCase() === owner) continue;
    if (inTeams && !inTeams.has(person.principalId)) continue;
    if (q && ![person.name, person.login].some((field) => field.toLowerCase().includes(q))) continue;
    out.push({ target, kind: "user", label: person.name, detail: person.login });
  }
  return out;
}

export interface MyEngine {
  instanceId: string;
  driver: string;
  displayName: string;
  installed: boolean;
  /** Set when the server's image deliberately does not carry this engine
   * (engines.lock.json, notPreinstalled): why, in English, for a tooltip.
   * The line then reads "Not available on this server". */
  notAvailable?: string;
  /** `expired` (#1533): signed in, but the provider refused that sign-in
   * since and could not refresh it: the card offers Reconnect. */
  subscription: { supported: boolean; signedIn: boolean; expired?: boolean };
  /** The person's own key for this engine's provider is in Perspicax. */
  myKey: boolean;
  /** 2026-10-30: where the person's own key that serves this engine lives:
   * Perspicax, or sealed for them on this server (engine-api-keys.enc).
   * Absent with no key of their own, and on an older server. */
  keyWhere?: "perspicax" | "server";
  /** The server has a key for this engine (the organization's key) and it
   * serves this person. */
  orgKey: boolean;
  /** 2026-10-16: the organization has a key for this engine, but Perspicax
   * does not give this engine to this person (`sagax_server_engines`). */
  orgKeyNotGiven?: boolean;
  /** 2026-10-27 (#1098): outside the organization's engine list; only the
   * person's own subscription or key runs it (offered once one does). Listed
   * only when the organization lets own accounts through (2026-10-30). */
  orgNotAllowed?: boolean;
  /** What the person's own turns on this engine run with, on their bots
   * and on the bots shared with them (server/engine-credentials.ts).
   * "expired" (2026-10-30): only a sign-in the provider refused since, which
   * pays for nothing until the person reconnects. */
  myTurns: "subscription" | "key" | "org-key" | "expired" | "none";
  /** 2026-10-29: Grok on an organization server: the person's two sign-ins
   * (a personal grok.com account and a team one), what each is and the
   * grok.com connectors it brings. The first one pays their turns; the
   * bots reach the other one's connectors on their own. */
  accounts?: GrokAccountView[];
}

export interface GrokAccountView {
  slot: "primary" | "second";
  signedIn: boolean;
  expired?: boolean;
  /** from the sign-in itself: a personal account (User) or a team */
  kind?: "personal" | "team" | "unknown";
  email?: string;
  /** the grok.com connectors it brings, when known (probed after sign-in) */
  connectors?: Array<{ label: string; tools: number }>;
}

/** `<issuer>/console/credentials?kind=model`, where a person sets their model keys
 * (#1137: the console page itself; the old /console/pulsabot/keys only
 * redirects there). */
export function perspicaxKeysUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/console/credentials?kind=model`;
}

let enginesPending: Promise<MyEngine[] | null> | null = null;
let enginesGeneration = 0;
const engineListeners = new Set<(engines: MyEngine[] | null) => void>();

function loadMyEngines(): Promise<MyEngine[] | null> {
  enginesPending ??= loadPerspicaxOrg().then((org) => (org
    ? api<{ engines: MyEngine[] }>("/api/me/engines").then((body) => body.engines ?? [], () => null)
    : null));
  return enginesPending;
}

/** Ask the server again (after a personal sign-in or sign-out) and update
 * every useMyEngines on the page. */
export function reloadMyEngines(): Promise<MyEngine[] | null> {
  enginesPending = null;
  const generation = ++enginesGeneration;
  const next = loadMyEngines();
  // Only the newest answer reaches the page: a reload started before a
  // sign-in finished (opening the picker) must not land after the one
  // started by the sign-in and show the engine as not connected again.
  void next.then((value) => {
    if (generation !== enginesGeneration) return;
    for (const listener of engineListeners) listener(value);
  });
  return next;
}

/** GET /api/me/engines once per page load on a Perspicax server (again
 * after reloadMyEngines); null on a solo server or while loading. */
export function useMyEngines(): MyEngine[] | null {
  const [engines, setEngines] = useState<MyEngine[] | null>(null);
  useEffect(() => {
    let alive = true;
    const listener = (value: MyEngine[] | null) => { if (alive) setEngines(value); };
    engineListeners.add(listener);
    void loadMyEngines().then(listener);
    return () => {
      alive = false;
      engineListeners.delete(listener);
    };
  }, []);
  return engines;
}

/** #1154: the model ids the person's own subscription offers on an engine
 * (GET /api/me/engines/<id>/models), per engine. An engine with no answer is
 * absent: its menu keeps the server's list. Asked again each time the picker
 * opens (`reload`), since a sign-in or a plan change alters it. */
export function useMyEngineModels(engines: MyEngine[] | null, reload: unknown): Map<string, ReadonlySet<string>> {
  const [byEngine, setByEngine] = useState<Map<string, ReadonlySet<string>>>(new Map());
  const wanted = (engines ?? []).filter((engine) => engine.driver === "grokAgent" && engine.myTurns === "subscription").map((engine) => engine.instanceId).join("\n");
  useEffect(() => {
    if (!wanted) { setByEngine((current) => (current.size ? new Map() : current)); return; }
    let alive = true;
    void Promise.all(wanted.split("\n").map((id) => api<{ models: string[] | null }>(`/api/me/engines/${encodeURIComponent(id)}/models`)
      .then((body) => [id, body.models] as const, () => [id, null] as const)))
      .then((rows) => {
        if (!alive) return;
        const next = new Map<string, ReadonlySet<string>>();
        for (const [id, models] of rows) if (models?.length) next.set(id, new Set(models));
        setByEngine(next);
      });
    return () => { alive = false; };
  }, [wanted, reload]);
  return byEngine;
}

/** The one line saying what the person's own turns on this engine use. */
export function myTurnsText(engine: Pick<MyEngine, "myTurns" | "installed" | "notAvailable">): string {
  if (!engine.installed) return engine.notAvailable ? t("myEngines.notAvailable") : t("myEngines.notInstalled");
  if (engine.myTurns === "subscription") return t("myEngines.turns.subscription");
  if (engine.myTurns === "key") return t("myEngines.turns.key");
  if (engine.myTurns === "org-key") return t("myEngines.turns.orgKey");
  if (engine.myTurns === "expired") return t("engineConnect.signInExpired");
  return t("myEngines.turns.none");
}

/** What a turn ran with (a turn digest's `access`), named for this viewer:
 * "Your subscription" to the person who paid, "Owner's credentials" on a
 * routine, never a secret. */
export function turnAccessLabel(access: { via: string; payer: string; payerPrincipalId?: string; routine?: boolean }, viewerPrincipalId: string | null): string {
  if (access.via === "org-key") return t("turnAccess.orgKey");
  if (access.via === "server") return t("turnAccess.server");
  if (access.routine && access.payer === "owner") return t("turnAccess.ownerCredentials");
  const mine = Boolean(viewerPrincipalId && access.payerPrincipalId && viewerPrincipalId.toLowerCase() === access.payerPrincipalId.toLowerCase());
  if (access.via === "subscription") return mine ? t("turnAccess.yourSubscription") : t("turnAccess.speakerSubscription");
  return mine ? t("turnAccess.yourKey") : t("turnAccess.speakerKey");
}
