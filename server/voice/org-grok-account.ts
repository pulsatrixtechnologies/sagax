// The organization's Grok account (#5200): the fourth credential form of the
// voice, beside the person's account, the person's keys and the
// organization's key.
//
// An organization's Grok account is a Grok sign-in the organization named.
// An admin names, in Perspicax, the person whose sign-in on this server is
// the organization's; the directory carries that one name
// (`voice_org_account`, server/perspicax/perspicax-link.ts). Nothing else is
// stored: the sign-in stays the one file in that person's login folder,
// renewed by the engine's own path like any sign-in (grokLiveAccess), so the
// organization's account never expires for want of a renewal and no token
// is ever copied, pasted or kept anywhere else.
//
// The account named serves whatever its kind, a team's (`principal_type:
// Team`) or a personal one (`User`): the kind the Grok login file names
// (server/engines/principal-engine-logins.ts readGrokAccountIdentity) is
// told beside the answer, for the screen that shows it, and never refuses.
//
// Pure of HTTP and of the store: server/index.ts wires it to the directory,
// the people and the logins. The value is never logged.
import type { GrokAccountKind, GrokLiveAccess } from "../engines/principal-engine-logins.ts";

export type OrgGrokAccountError =
  /** the organization named nobody */
  | "no_org_account"
  /** the person it named is not known on this server */
  | "unknown_person"
  /** the person it named is turned off, or not active in the directory */
  | "user_inactive"
  /** they have no Grok sign-in on this server */
  | "no_sign_in"
  /** the provider refused the sign-in and the engine could not renew it */
  | "sign_in_refused";

export type OrgGrokAccess =
  | { ok: true; accessToken: string; expiresAt: number | null; principalId: string; kind: GrokAccountKind }
  | { ok: false; error: OrgGrokAccountError };

export interface OrgGrokAccountDeps {
  /** The Perspicax user id the organization named, from the directory. */
  designated(): string | undefined;
  /** That person on this server, or null when unknown here. */
  person(sub: string): { principalId: string; active: boolean } | null;
  /** What their Grok sign-in is, or null when they have none here. */
  accountKind(principalId: string): GrokAccountKind | null | undefined;
  /** Their sign-in for one live use, renewed first when it is about to expire. */
  grokSignIn(principalId: string): Promise<GrokLiveAccess>;
}

/** The organization's Grok account for one live use, or why there is none.
 * `candidate`: the Perspicax user id of a person about to be named, judged
 * by the same rules before the organization names them (the console's test
 * before it connects); the named one otherwise. */
export async function orgGrokAccess(deps: OrgGrokAccountDeps, candidate?: string): Promise<OrgGrokAccess> {
  const sub = (candidate ?? deps.designated())?.trim();
  if (!sub) return { ok: false, error: "no_org_account" };
  const person = deps.person(sub);
  if (!person) return { ok: false, error: "unknown_person" };
  if (!person.active) return { ok: false, error: "user_inactive" };
  const kind = deps.accountKind(person.principalId);
  if (!kind) return { ok: false, error: "no_sign_in" };
  let access: GrokLiveAccess;
  try {
    access = await deps.grokSignIn(person.principalId);
  } catch {
    access = { ok: false, error: "sign_in_refused" };
  }
  if (!access.ok) return access;
  return { ok: true, accessToken: access.accessToken, expiresAt: access.expiresAt, principalId: person.principalId, kind };
}
