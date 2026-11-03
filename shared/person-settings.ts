// A person's own Settings > Experimental choices and browser profiles on an
// organization server (#1098, 2026-10-27): set by the person, with no right
// to edit the installation. Server: server/people/person-settings.ts and
// GET/PATCH /api/me/experimental (server/routes/person-settings.ts). The
// app reads them in its config (`features` and `browserProfiles`, the
// person's own marked `personal`), the same way it reads the installation's.

/** The Experimental switches that are a person's own: what they see and
 * what their own turns do. The built-in browser and the meeting notetaker
 * reach the shared server, and the decision model opens the installation's
 * decider settings: those stay `server.experimental`'s. Since 2026-10-28
 * (#1098) also Settings > Appearance > Show tool calls, a display choice of
 * each person (it was the installation's, behind the right to edit it). */
export const PERSONAL_FEATURE_KEYS = ["skillAuthoring", "dataWindow", "llmThreadTitles", "showToolCalls"] as const;
export type PersonalFeature = (typeof PERSONAL_FEATURE_KEYS)[number];

const personalFeatureSet: ReadonlySet<string> = new Set(PERSONAL_FEATURE_KEYS);

export function isPersonalFeature(key: unknown): key is PersonalFeature {
  return typeof key === "string" && personalFeatureSet.has(key);
}

/** A person's own browser profile id: `mine-` and 32 hex characters, chosen
 * by the server. An installation profile never starts so. */
export const PERSONAL_BROWSER_PROFILE_PREFIX = "mine-";
const PERSONAL_BROWSER_PROFILE_ID = /^mine-[0-9a-f]{32}$/;
export const MAX_PERSONAL_BROWSER_PROFILES = 20;

export function isPersonalBrowserProfileId(id: unknown): id is string {
  return typeof id === "string" && PERSONAL_BROWSER_PROFILE_ID.test(id);
}
