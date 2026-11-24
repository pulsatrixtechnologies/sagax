// A connected Grok account for calls and live voice (#4567). The token is
// the person's own sign-in. It is never logged and never put in a response.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { grokAccessFrom } from "../cloud-agents/subscription-access.ts";

/** The solo server's own Grok sign-in (`GROK_HOME` or `~/.grok`), or
 * nothing. An organization server uses the person's login instead. */
export function soloGrokVoiceToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.GROK_HOME?.trim() || join(homedir(), ".grok");
  try {
    const access = grokAccessFrom(readFileSync(join(root, "auth.json"), "utf8"));
    const token = access?.accessToken?.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/** One person's connected Grok account, for every aspect that takes it: the
 * voice (#4567) and the image (#5223) ask here, so a person gets the same
 * answer on both. A person turned off in their organization has none; solo
 * is this computer's sign-in; an organization is that person's live sign-in.
 * The token is never logged and never put in a response. */
export async function personGrokAccountToken(
  person: { principalId?: string | null; disabled?: boolean },
  deps: {
    organization: boolean;
    liveAccess(principalId: string): Promise<{ ok: true; accessToken: string } | { ok: false }>;
    solo(): string | undefined;
  },
): Promise<string | undefined> {
  if (person.disabled) return undefined;
  if (!deps.organization) return deps.solo();
  if (!person.principalId) return undefined;
  const access = await deps.liveAccess(person.principalId);
  return access.ok ? access.accessToken : undefined;
}

export type NoCallLanguage = "fr" | "en";

/** French when the interface (or, failing that, the voice language) is
 * French. "auto" stays English until a locale says otherwise. */
export function voiceSentenceLanguage(locale: string | null | undefined, language: string | null | undefined): NoCallLanguage {
  if ((locale ?? "").toLowerCase().startsWith("fr")) return "fr";
  if ((language ?? "").toLowerCase().startsWith("fr")) return "fr";
  return "en";
}

type Side = "credits" | "refused" | "missing";

/** One plain sentence when a connected Grok account was tried and every
 * tried credential is out of credits or refused. Null otherwise, so a
 * voice that never tried an account keeps today's words. */
export function noCallReason(tried: readonly { source: string; failure: string }[], language: NoCallLanguage): string | null {
  if (!tried.some((entry) => entry.source === "grok-account")) return null;
  if (!tried.every((entry) => entry.failure === "quota" || entry.failure === "key")) return null;
  const account = tried.find((entry) => entry.source === "grok-account");
  const api = tried.filter((entry) => entry.source !== "grok-account");
  const accountSide: Side = account?.failure === "quota" ? "credits" : "refused";
  const apiSide: Side = api.length === 0 ? "missing" : api.every((entry) => entry.failure === "quota") ? "credits" : "refused";
  return language === "fr" ? french(accountSide, apiSide) : english(accountSide, apiSide);
}

/** One plain sentence when the provider does not know the voice name that was
 * asked for (#5179). It is never called a credit problem nor a network
 * problem: the name is what to fix, and the voice list answers it. The prefix
 * is the one the app passes through as written (src/lib/voice-mode/
 * realtime-call.ts realtimeRefusalText), so the person reads these words. */
export function voiceNameCallReason(language: NoCallLanguage): string {
  return language === "fr"
    ? "Aucun appel : xAI ne connaît pas cette voix. Recharge la liste des voix et choisis-en une autre."
    : "No call was placed: xAI does not know that voice. Refresh the voice list and choose a voice again.";
}

function english(account: Side, api: Side): string {
  const left = account === "credits" ? "the connected Grok account is out of credits" : "the connected Grok account was refused";
  const right = api === "missing" ? "and there is no xAI API key"
    : api === "credits" ? "and the xAI API key is out of credits too"
      : "and the xAI API key was refused too";
  return `No call was placed: ${left}, ${right}.`;
}

function french(account: Side, api: Side): string {
  const left = account === "credits" ? "le compte Grok connecté n'a plus de crédit" : "le compte Grok connecté a été refusé";
  const right = api === "missing" ? "et il n'y a pas de clé API xAI"
    : api === "credits" ? "et la clé API xAI non plus"
      : "et la clé API xAI a été refusée aussi";
  return `Aucun appel : ${left}, ${right}.`;
}
