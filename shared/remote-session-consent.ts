// The install-time, organization-level consent that makes a host "unattended"
// (the ScreenConnect Access model). Consent is recorded once, by the client
// organization, when the Pulsatrix Assist "Sagax Remote Control" service is
// installed on a host, NOT per session by the end user. This module is pure:
// it defines the record the Remote Sessions page shows and the server stores,
// its validation, and whether it is still active. It keeps no secret: the
// control node key the agent binds to is referenced by presence only, never
// shown. Loi 25: the deploying organization is the data controller and informs
// its own users; Sagax / GOX is the processor.

/** How long unattended access lasts by default before it must be renewed.
 * Never infinite by default (JC). */
export const DEFAULT_UNATTENDED_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The furthest ahead an expiry may be set at install: two years. */
export const MAX_UNATTENDED_DAYS = 730;

export interface UnattendedConsent {
  /** Record version, for later migrations. */
  v: number;
  /** The host this consent covers: serial, else hostname, else support code,
   * lowercased and trimmed. One persistent install == one host == one key. */
  hostKey: string;
  /** Human label for the host (hostname or model), already cleaned. */
  hostLabel: string;
  /** The client organization that installed the service (the data controller). */
  org: string;
  /** Who recorded the consent at install (an admin identity or an org-signed
   * token id), so the install is auditable and never silent. */
  installedBy: string;
  /** When the service was installed / consent recorded (ISO-8601 UTC). */
  installedAt: string;
  /** A short note on the scope the organization agreed to (free text, bounded). */
  scope: string;
  /** When unattended access lapses unless renewed (ISO-8601 UTC, required). */
  expiresAt: string;
  /** Org option: show the on-screen "remote control in progress" banner on the
   * host during a control session. Default true. Disabling it never disables
   * the audit: every connect / control / exec / file transfer stays on the
   * Remote Sessions page. */
  bannerVisible: boolean;
  /** Org option: keep a tray / menubar presence on the host. Default true. */
  trayVisible: boolean;
  /** True when the agent's binary is reported code-signed (Windows Authenticode
   * / macOS signed + notarized). An unsigned agent is flagged on the page. */
  signed: boolean;
  /** Whether the control node key is bound (the agent ran with --allow). We
   * keep only the fact, never the key itself. */
  keyBound: boolean;
  /** Set when an admin revoked it from the page (ISO-8601 UTC). A revoked
   * record is kept for the audit until it is pruned. */
  revokedAt?: string;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // oxlint-disable-next-line no-control-regex -- a stored label never keeps control characters
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** serial, else hostname, else code: lowercased, trimmed, bounded. */
export function normalizeHostKey(value: unknown): string | null {
  const cleaned = cleanString(value, 200);
  return cleaned ? cleaned.toLowerCase() : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A default expiry, `days` from `now` (bounded by MAX_UNATTENDED_DAYS). */
export function defaultUnattendedExpiry(now: number, days = DEFAULT_UNATTENDED_DAYS): string {
  const span = Math.min(MAX_UNATTENDED_DAYS, Math.max(1, Math.round(days)));
  return new Date(now + span * DAY_MS).toISOString();
}

export interface UnattendedConsentInput {
  hostKey: unknown;
  hostLabel?: unknown;
  org: unknown;
  installedBy: unknown;
  scope?: unknown;
  installedAt?: unknown;
  expiresAt?: unknown;
  bannerVisible?: unknown;
  trayVisible?: unknown;
  signed?: unknown;
  keyBound?: unknown;
  revokedAt?: unknown;
}

/** Build a valid consent record, or null when a required field is missing or
 * the expiry is not a time after the install. Booleans default to the safe,
 * visible option (banner and tray on, not signed, key not bound). */
export function parseUnattendedConsent(input: UnattendedConsentInput, now: number): UnattendedConsent | null {
  const hostKey = normalizeHostKey(input.hostKey);
  const org = cleanString(input.org, 200);
  const installedBy = cleanString(input.installedBy, 200);
  if (!hostKey || !org || !installedBy) return null;
  const installedAt = isoOrNull(input.installedAt) ?? new Date(now).toISOString();
  const expiresAt = isoOrNull(input.expiresAt) ?? defaultUnattendedExpiry(now);
  if (Date.parse(expiresAt) <= Date.parse(installedAt)) return null;
  if (Date.parse(expiresAt) > now + (MAX_UNATTENDED_DAYS + 1) * DAY_MS) return null;
  const revokedAt = isoOrNull(input.revokedAt);
  return {
    v: 1,
    hostKey,
    hostLabel: cleanString(input.hostLabel, 200) ?? hostKey,
    org,
    installedBy,
    installedAt,
    scope: cleanString(input.scope, 400) ?? "support",
    expiresAt,
    bannerVisible: input.bannerVisible !== false,
    trayVisible: input.trayVisible !== false,
    signed: input.signed === true,
    keyBound: input.keyBound === true,
    ...(revokedAt ? { revokedAt } : {}),
  };
}

/** Unattended access is live: not revoked and not past its expiry. */
export function isUnattendedActive(consent: UnattendedConsent | null | undefined, now: number): boolean {
  if (!consent || consent.revokedAt) return false;
  return Date.parse(consent.expiresAt) > now;
}

/** Whole days left before expiry (0 when past or revoked). */
export function unattendedDaysLeft(consent: UnattendedConsent, now: number): number {
  if (consent.revokedAt) return 0;
  const left = Date.parse(consent.expiresAt) - now;
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/** A revoked copy (kept for the audit). Idempotent. */
export function revokeUnattendedConsent(consent: UnattendedConsent, now: number): UnattendedConsent {
  return consent.revokedAt ? consent : { ...consent, revokedAt: new Date(now).toISOString() };
}

/** Extend expiry by `days` from now (bounded). Never un-revokes. */
export function renewUnattendedConsent(consent: UnattendedConsent, now: number, days = DEFAULT_UNATTENDED_DAYS): UnattendedConsent {
  if (consent.revokedAt) return consent;
  return { ...consent, expiresAt: defaultUnattendedExpiry(now, days) };
}
