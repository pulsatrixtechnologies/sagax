// Which credentials a turn runs with on an organization server (slice 4,
// decision D8, revised 2026-10-01: the person who speaks pays). Replaces the
// slice 3 gate.
//
// Who pays (the payer):
//   - a person's turn, on their own bot or on a bot shared with them, and a
//     bot hop that speaks for that person: the person who speaks;
//   - a routine of the bot (a scheduled run, a run someone started by hand,
//     a run after someone edited the routine): always the bot's OWNER, never
//     whoever created, edited or started it;
//   - a bot hop a routine started: that routine's bot owner, carried along
//     the hops (TurnSpeaker routinePayer); else the person it speaks for;
//   - 2026-10-26 (#1137): a bot whose "who pays" is the owner
//     (shared/turn-payer.ts, `payerMode: "owner"`): the bot's OWNER for every
//     known person who writes to it (and the hops that speak for them). The
//     plan then carries `ownerPays`. An unknown person never makes the owner
//     pay. Visibility never changes, and the owner's engine connectors are
//     never mounted for the person who writes (harness-connectors.ts: the
//     payer is not the speaker, so they are "foreign").
//
// Order, first match wins:
//   1. the instance's CLI is not installed              -> engine_missing
//   2. the payer is disabled (the directory marked them
//      out, a back-channel logout)                      -> no_access (payer_disabled)
//   3. the payer is signed in to this engine with their
//      own subscription (Claude, Codex, Grok Build,
//      Kimi Code)                                       -> subscription
//      2026-10-30: a sign-in the provider refused since
//      (`subscriptionExpired`, the #1533 marker) is
//      skipped: the next steps serve, else
//                                                       -> no_access (sign_in_expired)
//   3b. pi (#4410): the payer is signed in to their own
//      Claude account (the Claude engine's sign-in, not
//      expired). It is added NEXT TO the plan of steps
//      4, 4b and 5 (`claudeAccount`) for Claude models,
//      only when no Anthropic key of that plan pays
//      them; it never takes the place of a key. When
//      none of them serves (step 6)                     -> subscription (claudeAccount)
//   4. the payer keeps a key for the engine's provider
//      in Perspicax (claudeAgent: anthropic, codex:
//      openai, grokAgent: xai, geminiAgent: google,
//      kimiAgent: moonshot, piAgent: any of them)       -> owner-key (the payer owns
//                                                          the bot) or speaker-key
//   4b. the payer pasted a key on this server, sealed
//      for that person only (engine-api-keys.ts)        -> owner-key or speaker-key
//                                                          (localKey, no provider)
//   5. the server has a key for this engine (Settings >
//      Connections, set by an admin: the organization's
//      key), used automatically, only when the payer is
//      an admin or Perspicax lists this engine on their
//      person sheet (`sagax_server_engines`, 2026-10-16)  -> org-key
//      otherwise                                        -> no_access (server_engine_not_allowed)
//      2026-10-27 (#1098): never on an engine outside the
//      organization's list (`allowedEngines`): the
//      organization's key pays only for what it allows  -> no_access (server_engine_not_allowed)
//   6. otherwise                                        -> no_access (no_credentials)
//
// 2026-10-27 (#1098): an engine outside the organization's list still runs
// on the payer's own subscription or key (steps 3 and 4): it is their bill,
// not the organization's (`paidByPerson`). Since 2026-10-30 the server asks
// this only when the organization lets own accounts through
// (`ownAccountsOutsideList`); otherwise such an engine is refused before
// this plan.
//
// Decision of 2026-10-01, superseding the 2026-09-28 decision 7 ("the owner key
// serves everyone") and the slice 3 rules: the owner's credentials never pay
// for the people the bot is shared with; there is no organization switch
// for the org key any more (it serves whenever an admin set one); and the
// server's own sign-ins no longer serve admins' bots: everyone, admins
// included, signs in their own subscription. Solo mode is unchanged: the
// server's own configuration serves every turn. 2026-10-26 (#1137): the
// owner may now choose to pay for the people the bot is shared with (per
// bot, or per group for one bot); by default the owner pays when the bot
// runs on the owner's local model or own subscription.
//
// The key itself is fetched at dispatch (materializeEngineAccess) through
// the Perspicax link, kept in memory 60 s at most, and put into that one
// turn's environment. It is never written to disk or logged.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis.
import type { PiModelServer } from "../drivers/pi-model-servers.ts";
import { join } from "node:path";
import { separateAccountInstance } from "./separate-account.ts";

import { routineLineage, speakerPrincipal, type EngineAccessRefusal, type TurnSpeaker } from "./engine-access.ts";
import type { ModelProvider, ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import type { TurnPayerMode } from "../../shared/turn-payer.ts";
import { DRIVER_KEY_PROVIDERS } from "../../shared/harness-matrix.ts";
import { ENGINE_VENDOR_ALIAS } from "../../shared/model-provider.ts";
import {
  formOfAccessVia,
  resolveCredential,
  type CredentialCandidate,
  type CredentialDecision,
  type CredentialPolicy,
  type PaidKeyConfirm,
} from "../../shared/credential-resolver.ts";

/** `server` is solo mode only (and rows written before 2026-10-01).
 * `org-account` (#5200): the organization's Grok account, after everything
 * that is the person's and before the organization's key. */
export type AccessVia = "subscription" | "owner-key" | "speaker-key" | "server" | "org-key" | "org-account";

/** Every value of AccessVia, for readers of stored rows. */
export const ACCESS_VIAS: readonly AccessVia[] = ["subscription", "owner-key", "speaker-key", "server", "org-key", "org-account"];

/** Who a turn's credentials belong to: the person who speaks, the bot's
 * owner (their own turn or the bot's routine), or the organization (the
 * server's access or the org key). */
export type AccessPayer = "speaker" | "owner" | "organization";

/** Why no credentials serve a turn. */
/** `owner_model_offline` (#1137) is decided by the server around the plan:
 * the owner pays and their computer, whose model the bot runs on, is offline. */
export type NoAccessCause = "payer_disabled" | "no_credentials" | "server_engine_not_allowed" | "owner_model_offline" | "sign_in_expired" | "act_as_personal_refused" | "confirm_paid_key" | "personal_keys_disabled";

/** A key of the payer's in Perspicax. */
export function keyVia(via: AccessVia | undefined): via is "owner-key" | "speaker-key" {
  return via === "owner-key" || via === "speaker-key";
}

/** What a driver receives for one turn (contracts.ts SendTurnInput.access). */
export interface TurnAccess {
  via: AccessVia;
  /** A non-secret label: subscription:<pid>, owner-key:<pid>:<fingerprint>,
   * speaker-key:<pid>:<fingerprint>, server, org-key. A retained engine
   * process is reused only for the same identity. */
  identity: string;
  /** Extra environment for this turn only (the payer's key). */
  environment?: Record<string, string>;
  /** A file-backed key sealed for this person (engine-api-keys.ts). The
   * key itself stays in that file; the driver reads it for this turn only. */
  localKeyPrincipal?: string;
  /** Claude: the person's own login directory (CLAUDE_CONFIG_DIR). */
  claudeConfigDir?: string;
  /** Codex: the CODEX_HOME for this turn. */
  codexHome?: string;
  /** Codex: run on the payer's OpenAI key (the pulsa_owner provider). */
  codexOwnerKey?: boolean;
  /** Grok Build, Kimi Code, Gemini CLI, pi: the payer's own home for the
   * engine (their device sign-in, or an empty one for a key), so the
   * server's own login never serves the turn (engineHomeEnv). */
  engineHome?: string;
  /** #2024, pi: the Perspicax model servers of the person served (no keys). */
  piModelServers?: PiModelServer[];
}

// One table with the app (shared/harness-matrix.ts): which keys can pay which driver.
const DRIVER_PROVIDERS = DRIVER_KEY_PROVIDERS as Readonly<Record<string, readonly ModelProvider[]>>;

/** The model providers whose key can serve a driver, in preference order. */
export function providersOfDriver(driver: string): readonly ModelProvider[] {
  return DRIVER_PROVIDERS[driver] ?? [];
}

export function providersOfInstance(instanceId: string, driver: string): readonly ModelProvider[] {
  if (driver === "openai-compat") return [instanceId === "openai" || instanceId === "openrouter" ? instanceId : `compat:${instanceId}`];
  return providersOfDriver(driver);
}

/** The model provider behind a driver, when a person's key can serve it
 * (the first one for a multi-provider engine). */
export function providerOfDriver(driver: string): ModelProvider | null {
  return providersOfDriver(driver)[0] ?? null;
}

/** #3085: the key provider behind one of pi's own provider names (the part
 * before "/" in a pi model id), or null when no Perspicax key can pay for it
 * (amazon-bedrock, github-copilot, vercel-ai-gateway...). The engines'
 * own vendor names live in shared/model-provider.ts. */
export function piKeyProvider(piProvider: string | undefined): ModelProvider | null {
  const name = piProvider?.trim().toLowerCase() ?? "";
  if (!name) return null;
  const alias = ENGINE_VENDOR_ALIAS[name] as ModelProvider | undefined;
  if (alias) return alias;
  return (DRIVER_PROVIDERS.piAgent as readonly string[]).includes(name) ? name as ModelProvider : null;
}

/** #3085: the providers whose pi models the turn's payer can really run,
 * resolved like a turn (resolveEngineAccess): the payer's own keys and their
 * Claude sign-in (#4410), else the organization's keys (`orgKeyProviders`) when the org-key step serves them.
 * Null: no filter (solo, where pi itself lists only what its keys serve).
 * Names only, never a key value. */
export function piPayerProviders(input: EngineCredentialInput, orgKeyProviders: readonly ModelProvider[]): ReadonlySet<ModelProvider> | null {
  if (input.identity !== "perspicax") return null;
  const plan = resolveEngineAccess({ ...input, orgKeyProviders });
  if (!plan.ok) return new Set();
  // #4410: the payer's Claude sign-in counts as holding the Claude provider,
  // beside the keys of the plan
  const signIn: ModelProvider[] = plan.claudeAccount ? ["anthropic"] : [];
  if (plan.via === "org-key") return new Set([...orgKeyProviders.filter((provider) => DRIVER_PROVIDERS.piAgent.includes(provider)), ...signIn]);
  if (plan.via === "subscription" && plan.claudeAccount) return new Set(signIn);
  if (keyVia(plan.via) && plan.provider && plan.payerPrincipalId) {
    const sub = payerFacts(input, plan.payerPrincipalId)?.sub;
    if (!sub) return new Set(signIn);
    return new Set([...DRIVER_PROVIDERS.piAgent.filter((provider) => input.hasKey(sub, provider)), ...signIn]);
  }
  // A personal endpoint or a file key: not a provider key; the model-server
  // rows carry it.
  return new Set(signIn);
}

/** The variable each provider's key reaches an engine as. Codex is apart: its
 * key rides SAGAX_OWNER_OPENAI_API_KEY through the pulsa_owner provider. */
export const PROVIDER_KEY_ENV: Readonly<Record<Exclude<ModelProvider, `compat:${string}`>, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  google: "GEMINI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  opencode: "OPENCODE_API_KEY",
  cursor: "CURSOR_API_KEY",
  factory: "FACTORY_API_KEY",
  minimax: "MINIMAX_API_KEY",
  glm: "GLM_API_KEY",
  zai: "ZAI_API_KEY",
  groq: "SAGAX_GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
  huggingface: "HF_TOKEN",
  nvidia: "NVIDIA_API_KEY",
  kimi: "KIMI_API_KEY",
};

/** #2024: where pi reads a provider's key when it is not PROVIDER_KEY_ENV's
 * name (pi docs, providers.md). */
const PI_KEY_ENV: Readonly<Partial<Record<Exclude<ModelProvider, `compat:${string}`>, string>>> = {
  groq: "GROQ_API_KEY",
};

function keyEnvironment(provider: ModelProvider, driver = ""): string {
  if (driver === "piAgent") {
    const own = PI_KEY_ENV[provider as Exclude<ModelProvider, `compat:${string}`>];
    if (own) return own;
  }
  return provider.startsWith("compat:") ? "SAGAX_COMPAT_SERVER_API_KEY" : PROVIDER_KEY_ENV[provider as Exclude<ModelProvider, `compat:${string}`>];
}

export type SubscriptionDriver = "claudeAgent" | "codex" | "grokAgent" | "kimiAgent";

/** Drivers a person can sign in to with their own subscription: Claude and
 * Codex through their login controllers, Grok Build (`grok login
 * --device-auth`) and Kimi Code (`kimi login`) through a device code. */
export function subscriptionDriver(driver: string): driver is SubscriptionDriver {
  return driver === "claudeAgent" || driver === "codex" || driver === "grokAgent" || driver === "kimiAgent";
}

/** Drivers whose engine home is set per turn (engineHome), not a
 * Claude config dir or a CODEX_HOME. */
export function homeDriver(driver: string): driver is "grokAgent" | "kimiAgent" | "geminiAgent" | "piAgent" {
  return driver === "grokAgent" || driver === "kimiAgent" || driver === "geminiAgent" || driver === "piAgent";
}

/** What the server knows of a person: their Perspicax subject and whether
 * they are disabled. */
export interface PersonFacts {
  sub?: string;
  disabled?: boolean;
}

export interface EngineCredentialInput {
  identity: "solo" | "perspicax";
  speaker: TurnSpeaker;
  peerOwnerPrincipalId?: string;
  owner: { principalId: string; sub?: string; disabled?: boolean };
  /** `keyOnly`: an API-key engine (`access: "api"`), which runs on a key
   * only, never on a person's subscription (#1533). */
  /** `accountOwner` (#4435): an account a person added beside the
   * provider's first one; only a turn that person pays for runs on it. */
  instance: { instanceId: string; driver: string; installed: boolean; keyOnly?: boolean; keyProvider?: ModelProvider; personalOwner?: string; accountOwner?: string };
  /** A person other than the owner, by principal id (undefined: unknown). */
  person?: (principalId: string) => PersonFacts | undefined;
  /** The person signed in to this driver with their own subscription (D10). */
  subscriptionSignedIn: (principalId: string, driver: string, instanceId: string) => boolean;
  /** 2026-10-30: that sign-in was refused by the provider since (#1533
   * marker, PrincipalEngineLogins.expired): it no longer pays. Absent means
   * never expired. */
  subscriptionExpired?: (principalId: string, driver: string, instanceId: string) => boolean;
  /** The directory lists this provider for the person (names only). */
  hasKey: (sub: string, provider: ModelProvider) => boolean;
  /** The instance's driver reads a key the server configured (Settings >
   * Connections): the organization's key. */
  keyBacked: boolean;
  /** The payer has a file-backed key on this server (engine-api-keys.ts).
   * Absent means none. It never names another person. */
  hasLocalKey?: (principalId: string, driver: string) => boolean;
  /** 2026-10-16: whether this person may run this engine instance on
   * the organization's key (an admin: always; a member: when Perspicax lists
   * it in their `sagax_server_engines`). Absent means allowed (solo, tests
   * written before). Their own subscription and keys never ask it. */
  serverEngineAllowed?: (principalId: string, instanceId: string) => boolean;
  /** 2026-10-26 (#1137): who pays for this bot's replies (shared/turn-payer.ts).
   * Absent means "speaker" (the rule since 2026-10-01). */
  payerMode?: TurnPayerMode;
  /** 2026-10-27 (#1098): the organization's list allows this engine
   * (`allowedEngines`). False: its key never serves it. Absent means allowed. */
  orgEngineAllowed?: boolean;
  /** #4410: the providers the organization's pi keys serve (names only,
   * config.ts piOrgKeyProviders). Absent means none known. */
  orgKeyProviders?: readonly string[];
  /** #5180: Act as consent, the personal-key switch, and a paid-key
   * confirmation. Absent: the order below is unchanged. */
  policy?: CredentialPolicy;
  /** An organization Grok account this caller may use (#5200). Absent: that
   * form is not a candidate. The same consent as the organization's key
   * (`sagax_server_engines`) is decided by the caller before setting this. */
  orgAccountAvailable?: boolean;
  /** Whose Grok login folder is the organization's (#5200). Materialize
   * points the Grok engine at that home; absent with orgAccountAvailable
   * means the form cannot run yet. */
  orgAccountPrincipalId?: string;
}

export type EngineCredentialPlan =
  | { ok: true; via: AccessVia; payer: AccessPayer; payerPrincipalId?: string; provider?: ModelProvider; localKey?: true; routine?: true; ownerPays?: true; claudeAccount?: true; credential?: Extract<CredentialDecision, { ok: true }> }
  | { ok: false; reason: EngineAccessRefusal; cause?: NoAccessCause; payer?: "speaker" | "owner"; payerPrincipalId?: string; routine?: true; ownerPays?: true; error?: string; confirm?: PaidKeyConfirm };

const key = (id: string | undefined) => id?.trim().toLowerCase() ?? "";

/** The person whose credentials a turn uses ("" for an unknown person, who
 * has none), and whether that is the bot's owner because the turn is the
 * bot's own routine. */
export function turnPayer(input: Pick<EngineCredentialInput, "speaker" | "owner" | "peerOwnerPrincipalId" | "payerMode">): { principalId: string; routine: boolean; ownerPays?: true } {
  // The bot's routine: its owner pays, whoever started, created or edited
  // the run (its runAs is who it acts as for MCP, not who pays).
  if (input.speaker.origin === "owner-routine") return { principalId: input.owner.principalId.trim(), routine: true };
  // A hop the routine started: still the routine's bot owner, carried along.
  if (input.speaker.origin === "peer" && input.speaker.routine && input.speaker.routinePayer) return { principalId: input.speaker.routinePayer.trim(), routine: true };
  const speaker = speakerPrincipal(input.speaker, input.owner.principalId, input.peerOwnerPrincipalId).trim();
  const routine = routineLineage(input.speaker);
  // #1137: the owner pays for every known person who writes to the bot.
  const owner = input.owner.principalId.trim();
  if (input.payerMode === "owner" && !routine && owner && speaker && key(speaker) !== key(owner)) {
    return { principalId: owner, routine, ownerPays: true };
  }
  return { principalId: speaker, routine };
}

/** #4410: the variable pi reads a Claude account's short access token from
 * (pi docs, providers.md). Set for one turn only, from the payer's own
 * sign-in; never in arguments, models.json or a file of pi's home. */
export const PI_CLAUDE_SIGN_IN_ENV = "ANTHROPIC_OAUTH_TOKEN";

/** #4410: the payer's own Claude sign-in (the Claude engine's first account
 * folder) is there and not refused since: pi may run Claude models on it. */
function claudeSignInServes(input: EngineCredentialInput, principalId: string): boolean {
  if (!principalId || !input.subscriptionSignedIn(principalId, "claudeAgent", "claudeAgent")) return false;
  return input.subscriptionExpired?.(principalId, "claudeAgent", "claudeAgent") !== true;
}

/** The resolution order above, pure. `skip.key` drops step 4 (the key went
 * away between admission and dispatch); `skip.signIn` drops step 3b (the
 * Claude sign-in could not be read at dispatch). `personalAccount` and
 * `personalKey` drop those forms for a policy pass (#5180) without
 * changing the order of what remains. */
export function resolveEngineAccess(input: EngineCredentialInput, skip: { key?: boolean; signIn?: boolean; personalAccount?: boolean; personalKey?: boolean } = {}): EngineCredentialPlan {
  if (input.identity !== "perspicax") return { ok: true, via: "server", payer: "organization" };
  const payer = turnPayer(input);
  const routine = { ...(payer.routine ? { routine: true as const } : {}), ...(payer.ownerPays ? { ownerPays: true as const } : {}) };
  const isOwner = payer.principalId !== "" && key(payer.principalId) === key(input.owner.principalId);
  const who = { payer: isOwner ? "owner" as const : "speaker" as const, ...(payer.principalId ? { payerPrincipalId: payer.principalId } : {}), ...routine };
  // who it is for: the card goes to that person only (accessCardAudience)
  if (!input.instance.installed) return { ok: false, reason: "engine_missing", ...who };
  const facts: PersonFacts | undefined = payer.principalId === "" ? undefined : isOwner ? input.owner : input.person?.(payer.principalId);
  // A disabled person's credentials serve nobody, and their turn (their
  // routines included) does not fall back on the organization either (S4-14).
  if (facts?.disabled) return { ok: false, reason: "no_access", cause: "payer_disabled", ...who };
  // A person's own server or added account (#4435) runs for them alone:
  // never another person's turn, routine or delegated hop, whoever's bot it is.
  const ownedBy = input.instance.personalOwner ?? input.instance.accountOwner;
  if (ownedBy && key(ownedBy) !== key(payer.principalId)) return { ok: false, reason: "no_access", cause: "no_credentials", ...who };
  const driver = input.instance.driver;
  const signedIn = Boolean(payer.principalId) && !input.instance.keyOnly && subscriptionDriver(driver) && input.subscriptionSignedIn(payer.principalId, driver, input.instance.instanceId);
  // An expired sign-in is skipped: the payer's key or the organization's
  // serves, else the turn asks them to reconnect.
  const expired = signedIn && input.subscriptionExpired?.(payer.principalId, driver, input.instance.instanceId) === true;
  if (signedIn && !expired && !skip.personalAccount) {
    return { ok: true, via: "subscription", ...who };
  }
  // #4410: pi on the payer's own Claude sign-in (their bill, like a key of theirs)
  const claudeAccount = !skip.signIn && !skip.personalAccount && driver === "piAgent" && !input.instance.keyOnly && !input.instance.personalOwner && claudeSignInServes(input, payer.principalId);
  const signIn = claudeAccount ? { claudeAccount: true as const } : {};
  const providers = input.instance.keyProvider ? [input.instance.keyProvider] : providersOfInstance(input.instance.instanceId, driver);
  const provider = facts?.sub ? providers.find((candidate) => input.hasKey(facts.sub!, candidate)) : undefined;
  if (!skip.key && !skip.personalKey && provider && facts?.sub) {
    return { ok: true, via: isOwner ? "owner-key" : "speaker-key", ...who, provider, ...signIn };
  }
  // #4410: the sign-in alone, only when no key of any step serves
  const signInOnly = { ok: true as const, via: "subscription" as const, ...who, provider: "anthropic" as const, claudeAccount: true as const };
  // An endpoint owned by this payer can also serve without authentication
  // (a local model server). Never substitute an org key or another file.
  if (input.instance.personalOwner) return { ok: true, via: isOwner ? "owner-key" : "speaker-key", ...who };
  if (!skip.personalKey && !input.instance.personalOwner && payer.principalId && input.hasLocalKey?.(payer.principalId, driver)) {
    // a key pasted on this server never pays pi's Claude models (pi has no file key)
    return { ok: true, via: isOwner ? "owner-key" : "speaker-key", ...who, localKey: true, ...signIn };
  }
  // #5200: the organization's Grok account, after the person's forms and
  // before the organization's key. Grok engines only (the account is a
  // Grok sign-in); same consent gate as the organization's key.
  if (input.orgAccountAvailable && input.orgAccountPrincipalId?.trim() && grokOrgAccountDriver(driver) && !input.instance.personalOwner) {
    const judged = payer.principalId || input.owner.principalId;
    if (input.orgEngineAllowed !== false && (!input.serverEngineAllowed || input.serverEngineAllowed(judged, input.instance.instanceId))) {
      return { ok: true, via: "org-account", payer: "organization", ...routine };
    }
  }
  if (input.keyBacked && !input.instance.personalOwner) {
    // The organization's key serves only the people it was given to. A turn
    // nobody is known to speak for is judged as the bot's owner's.
    const judged = payer.principalId || input.owner.principalId;
    if (input.orgEngineAllowed === false || (input.serverEngineAllowed && !input.serverEngineAllowed(judged, input.instance.instanceId))) {
      if (claudeAccount) return signInOnly;
      return { ok: false, reason: "no_access", cause: expired ? "sign_in_expired" : "server_engine_not_allowed", ...who };
    }
    // the organization's Anthropic key keeps paying Claude models
    const orgPaysClaude = input.orgKeyProviders?.includes("anthropic") === true;
    return { ok: true, via: "org-key", payer: "organization", ...routine, ...(orgPaysClaude ? {} : signIn) };
  }
  if (claudeAccount) return signInOnly;
  return { ok: false, reason: "no_access", cause: expired ? "sign_in_expired" : "no_credentials", ...who };
}

/** #5200: the organization's Grok account serves the Grok CLI (subscription
 * home). The xAI API engine (`grok`) has no login folder for an account. */
function grokOrgAccountDriver(driver: string): driver is "grokAgent" {
  return driver === "grokAgent";
}

/** The forms this engine can already run, in the order resolveEngineAccess
 * uses (#5200: org-account sits after the person's forms and before org-key). */
export function engineCredentialCandidates(input: EngineCredentialInput): CredentialCandidate[] {
  const payer = turnPayer(input);
  const driver = input.instance.driver;
  const signedIn = Boolean(payer.principalId) && !input.instance.keyOnly && subscriptionDriver(driver) && input.subscriptionSignedIn(payer.principalId, driver, input.instance.instanceId);
  const expired = signedIn && input.subscriptionExpired?.(payer.principalId, driver, input.instance.instanceId) === true;
  const claudeSignedIn = driver === "piAgent" && !input.instance.keyOnly && !input.instance.personalOwner && input.subscriptionSignedIn(payer.principalId, "claudeAgent", "claudeAgent");
  const claudeExpired = claudeSignedIn && input.subscriptionExpired?.(payer.principalId, "claudeAgent", "claudeAgent") === true;
  const isOwner = payer.principalId !== "" && key(payer.principalId) === key(input.owner.principalId);
  const facts = payer.principalId === "" ? undefined : isOwner ? input.owner : input.person?.(payer.principalId);
  const providers = input.instance.keyProvider ? [input.instance.keyProvider] : providersOfInstance(input.instance.instanceId, driver);
  const provider = facts?.sub ? providers.find((candidate) => input.hasKey(facts.sub!, candidate)) : undefined;
  const local = Boolean(!input.instance.personalOwner && payer.principalId && input.hasLocalKey?.(payer.principalId, driver));
  const candidates: CredentialCandidate[] = [];
  if (signedIn || claudeSignedIn) {
    candidates.push({
      form: "personal-account",
      via: "subscription",
      present: true,
      available: (signedIn && !expired) || (claudeSignedIn && !claudeExpired),
      ...(expired || claudeExpired ? { state: "expired" as const } : {}),
      paid: false,
    });
  }
  if (provider || local || input.instance.personalOwner) {
    candidates.push({
      form: "personal-key",
      via: isOwner ? "owner-key" : "speaker-key",
      present: true,
      available: true,
      paid: true,
      ...(provider ? { provider } : {}),
    });
  }
  const judged = payer.principalId || input.owner.principalId;
  const orgAllowed = input.orgEngineAllowed !== false && (!input.serverEngineAllowed || input.serverEngineAllowed(judged, input.instance.instanceId));
  if (input.orgAccountAvailable && input.orgAccountPrincipalId?.trim() && grokOrgAccountDriver(driver) && !input.instance.personalOwner) {
    candidates.push({
      form: "org-account",
      via: "org-account",
      present: true,
      available: orgAllowed,
      paid: false,
      ...(orgAllowed ? {} : { state: "not_allowed" as const }),
    });
  }
  if (input.keyBacked && !input.instance.personalOwner) {
    candidates.push({
      form: "org-key",
      via: "org-key",
      present: true,
      available: orgAllowed,
      paid: true,
      ...(orgAllowed ? {} : { state: "not_allowed" as const }),
    });
  }
  return candidates;
}

/** The same engine order, then the #5180 policy: Act as consent, personal
 * keys, and a confirmation before a fallback onto a paid API key. Without
 * a policy this is resolveEngineAccess. */
export function resolveGovernedEngineAccess(input: EngineCredentialInput, skip: { key?: boolean; signIn?: boolean } = {}): { plan: EngineCredentialPlan; decision: CredentialDecision | null } {
  if (!input.policy) return { plan: resolveEngineAccess(input, skip), decision: null };
  const decision = resolveCredential({
    aspect: input.policy.aspect ?? "chat",
    engine: input.instance.driver,
    candidates: engineCredentialCandidates(input),
    policy: input.policy,
  });
  const bare = resolveEngineAccess(input, skip);
  const who = bare.ok
    ? {
      ...(bare.payer === "organization" ? { payer: "owner" as const } : { payer: bare.payer }),
      ...(bare.payerPrincipalId ? { payerPrincipalId: bare.payerPrincipalId } : {}),
      ...(bare.routine ? { routine: true as const } : {}),
      ...(bare.ownerPays ? { ownerPays: true as const } : {}),
    }
    : {
      ...(bare.payer ? { payer: bare.payer } : {}),
      ...(bare.payerPrincipalId ? { payerPrincipalId: bare.payerPrincipalId } : {}),
      ...(bare.routine ? { routine: true as const } : {}),
      ...(bare.ownerPays ? { ownerPays: true as const } : {}),
    };
  if (!decision.ok) {
    // A generic "nothing serves" keeps the engine's own cause. The
    // organization not giving this engine stays server_engine_not_allowed,
    // and an expired sign-in stays sign_in_expired.
    const fromEngine = !bare.ok && bare.reason === "no_access" ? bare.cause : undefined;
    const cause: NoAccessCause = decision.reason === "confirm_paid_key"
      ? "confirm_paid_key"
      : decision.reason === "act_as_personal_refused"
        ? "act_as_personal_refused"
        : decision.reason === "personal_keys_disabled"
          ? "personal_keys_disabled"
          : fromEngine ?? "no_credentials";
    return {
      decision,
      plan: {
        ok: false,
        reason: "no_access",
        cause,
        error: decision.error,
        ...(decision.reason === "confirm_paid_key" ? { confirm: decision.confirm } : {}),
        ...who,
      },
    };
  }
  const narrowed = resolveEngineAccess(input, {
    ...skip,
    personalAccount: decision.form !== "personal-account",
    personalKey: decision.form !== "personal-key",
  });
  if (narrowed.ok && formOfAccessVia(narrowed.via) === decision.form) {
    return { plan: { ...narrowed, credential: decision }, decision };
  }
  // #5200: org-account is a first-class via; when the bare resolver missed
  // it (a skip left only that form), rebuild from the decision.
  if (decision.form === "org-account" && input.orgAccountAvailable && input.orgAccountPrincipalId?.trim() && grokOrgAccountDriver(input.instance.driver)) {
    const judged = turnPayer(input).principalId || input.owner.principalId;
    const allowed = input.orgEngineAllowed !== false && (!input.serverEngineAllowed || input.serverEngineAllowed(judged, input.instance.instanceId));
    if (allowed) {
      return {
        decision,
        plan: { ok: true, via: "org-account", payer: "organization", ...(turnPayer(input).routine ? { routine: true as const } : {}), ...(turnPayer(input).ownerPays ? { ownerPays: true as const } : {}), credential: decision },
      };
    }
    return { decision, plan: { ok: false, reason: "no_access", cause: "server_engine_not_allowed", ...who } };
  }
  return { plan: narrowed.ok ? { ...narrowed, credential: decision } : narrowed, decision };
}

/** 2026-10-27 (#1098): the plan runs on the payer's own subscription or
 * key, so the organization's engine list does not hold it. */
export function paidByPerson(plan: EngineCredentialPlan): boolean {
  return plan.ok && (plan.via === "subscription" || keyVia(plan.via));
}

/** #2373: a turn on an added account is that account's, never the first
 * account's warm session (the identity keys sessions and caches). */
export function subscriptionIdentity(payer: string, instanceId: string): string {
  return separateAccountInstance(instanceId) ? `subscription:${payer}:${instanceId}` : `subscription:${payer}`;
}

/** #4410: a person's Claude sign-in as a pi turn takes it: the short access
 * token (kept fresh by the single-flight renewal), never the refresh token. */
export interface ClaudeSignInToken {
  accessToken: string;
}

export interface MaterializeDeps {
  dataDir: string;
  resolveKey: (sub: string, provider: ModelProvider) => Promise<ProviderKeyResult>;
  invalidate: (sub: string, provider: ModelProvider) => void;
  /** The person's login directory for a driver (principal-engine-logins.ts). */
  /** #2373: an added account (`claude-<uuid>`) has its own directory. */
  loginDir: (principalId: string, driver: SubscriptionDriver, instanceId: string) => string;
  /** #4410: the payer's Claude sign-in, renewed when near its end, or null
   * when it cannot be read. Absent: no sign-in serves pi. */
  claudeSignIn?: (principalId: string) => Promise<ClaudeSignInToken | null>;
}

/** #4410: the payer's Claude sign-in as pi's variable, or null when it
 * cannot be read (the turn then runs on the plan's keys alone). */
async function claudeSignInEnvironment(deps: MaterializeDeps, principalId: string): Promise<Record<string, string> | null> {
  const signIn = await deps.claudeSignIn?.(principalId).catch(() => null);
  return signIn?.accessToken ? { [PI_CLAUDE_SIGN_IN_ENV]: signIn.accessToken } : null;
}

export type MaterializedAccess =
  | { ok: true; access: TurnAccess; plan: Extract<EngineCredentialPlan, { ok: true }> }
  | { ok: false; reason: EngineAccessRefusal; detail?: "perspicax_unreachable"; plan?: Extract<EngineCredentialPlan, { ok: false }> };

/** The payer's facts again, for the key step at dispatch. */
function payerFacts(input: EngineCredentialInput, principalId: string): PersonFacts | undefined {
  return key(principalId) === key(input.owner.principalId) ? input.owner : input.person?.(principalId);
}

/** The next plan after a key or a sign-in disappears. A policy stays in force. */
function planAfter(input: EngineCredentialInput, skip: { key?: boolean; signIn?: boolean }): EngineCredentialPlan {
  return input.policy ? resolveGovernedEngineAccess(input, skip).plan : resolveEngineAccess(input, skip);
}

/** Turn a plan into what the driver needs, fetching the payer's key when the
 * plan uses it. A key Perspicax no longer has (no_key, user_inactive) falls
 * through to the next steps; an unreachable Perspicax is no_access. */
export async function materializeEngineAccess(input: EngineCredentialInput, plan: EngineCredentialPlan, deps: MaterializeDeps, skipped: { key?: boolean; signIn?: boolean } = {}): Promise<MaterializedAccess> {
  if (!plan.ok) return { ok: false, reason: plan.reason, plan };
  const driver = input.instance.driver;
  const payer = plan.payerPrincipalId ?? "";
  if (plan.via === "subscription" && plan.claudeAccount && payer) {
    const signIn = await deps.claudeSignIn?.(payer).catch(() => null);
    // unreadable since admission: the next steps serve, else the refusal
    if (!signIn) return materializeEngineAccess(input, planAfter(input, { ...skipped, signIn: true }), deps, { ...skipped, signIn: true });
    return {
      ok: true,
      plan,
      access: {
        via: "subscription",
        identity: `subscription:${payer}:claude`,
        environment: { [PI_CLAUDE_SIGN_IN_ENV]: signIn.accessToken },
        engineHome: join(deps.dataDir, "principals", payer, `${driver}-key`),
      },
    };
  }
  if (plan.via === "subscription" && subscriptionDriver(driver) && payer) {
    const dir = deps.loginDir(payer, driver, input.instance.instanceId);
    const where = driver === "claudeAgent" ? { claudeConfigDir: dir } : driver === "codex" ? { codexHome: dir } : { engineHome: dir };
    return { ok: true, plan, access: { via: "subscription", identity: subscriptionIdentity(payer, input.instance.instanceId), ...where } };
  }
  if (keyVia(plan.via) && plan.localKey && payer) {
    const signIn = plan.claudeAccount ? await claudeSignInEnvironment(deps, payer) : null;
    return { ok: true, plan, access: { via: plan.via, identity: `${plan.via}:${payer}:local${signIn ? "+claude" : ""}`, localKeyPrincipal: payer, ...(signIn ? { environment: signIn } : {}) } };
  }
  if (keyVia(plan.via) && plan.provider && payer) {
    const facts = payerFacts(input, payer);
    const sub = facts?.sub;
    if (!sub) return materializeEngineAccess(input, planAfter(input, { ...skipped, key: true }), deps, { ...skipped, key: true });
    if (facts?.disabled) {
      // disabled since admission: never read the (cached) key
      deps.invalidate(sub, plan.provider);
      return materializeEngineAccess(input, planAfter(input, { ...skipped, key: true }), deps, { ...skipped, key: true });
    }
    const result = await deps.resolveKey(sub, plan.provider);
    if (result.ok && homeDriver(driver)) {
      // An empty home of the payer's for the engine: their key, never the
      // server's own login (a Grok cached token outranks a key).
      const environment: Record<string, string> = { [keyEnvironment(plan.provider, driver)]: result.key };
      const fingerprints = [result.fingerprint || "key"];
      if (driver === "piAgent") {
        // pi reaches every provider the payer keeps a key for; the picked
        // model decides which one a turn uses.
        for (const other of providersOfDriver(driver)) {
          if (other === plan.provider || !input.hasKey(sub, other)) continue;
          const more = await deps.resolveKey(sub, other);
          if (!more.ok) continue;
          environment[keyEnvironment(other, driver)] = more.key;
          fingerprints.push(more.fingerprint || "key");
        }
        // #4410: Claude models on the payer's sign-in when no Anthropic key of theirs pays them
        if (plan.claudeAccount && !environment[keyEnvironment("anthropic", driver)]) {
          const signIn = await claudeSignInEnvironment(deps, payer);
          if (signIn) {
            Object.assign(environment, signIn);
            fingerprints.push("claude");
          }
        }
      }
      return {
        ok: true,
        plan,
        access: {
          via: plan.via,
          identity: `${plan.via}:${payer}:${fingerprints.join("+")}`,
          environment,
          engineHome: join(deps.dataDir, "principals", payer, `${driver}-key`),
        },
      };
    }
    if (result.ok) {
      const identity = `${plan.via}:${payer}:${result.fingerprint || "key"}`;
      if (plan.provider === "anthropic") return { ok: true, plan, access: { via: plan.via, identity, environment: { ANTHROPIC_API_KEY: result.key } } };
      if (driver !== "codex") return {
        ok: true, plan,
        access: { via: plan.via, identity, environment: {
          [keyEnvironment(plan.provider)]: result.key,
          SAGAX_PERSONAL_PROVIDER_KEY: result.key,
        } },
      };
      return {
        ok: true,
        plan,
        access: {
          via: plan.via,
          identity,
          environment: { SAGAX_OWNER_OPENAI_API_KEY: result.key },
          codexHome: join(deps.dataDir, "principals", payer, "codex-key"),
          codexOwnerKey: true,
        },
      };
    }
    if (result.error === "no_key") {
      deps.invalidate(sub, plan.provider);
      return materializeEngineAccess(input, planAfter(input, { ...skipped, key: true }), deps, { ...skipped, key: true });
    }
    if (result.error === "user_inactive") {
      // Perspicax says the payer is out: refused, never the organization's
      deps.invalidate(sub, plan.provider);
      const refused = { ok: false as const, reason: "no_access" as const, cause: "payer_disabled" as const, payer: plan.payer === "owner" ? "owner" as const : "speaker" as const, payerPrincipalId: payer, ...(plan.routine ? { routine: true as const } : {}), ...(plan.ownerPays ? { ownerPays: true as const } : {}) };
      return { ok: false, reason: "no_access", plan: refused };
    }
    return { ok: false, reason: "no_access", detail: "perspicax_unreachable" };
  }
  if (plan.via === "org-account") {
    // #5200: the organization's Grok account runs from the designated
    // person's own login folder (never copied); same shape as a personal
    // Grok subscription, identity names the org form.
    const holder = input.orgAccountPrincipalId?.trim();
    if (!holder || !grokOrgAccountDriver(driver)) {
      return materializeEngineAccess(input, planAfter(input, { ...skipped, key: true }), deps, { ...skipped, key: true });
    }
    const dir = deps.loginDir(holder, driver, input.instance.instanceId);
    return {
      ok: true,
      plan,
      access: { via: "org-account", identity: `org-account:${holder}`, engineHome: dir },
    };
  }
  if (plan.via === "org-key") {
    // The organization's key comes from the instance's own environment; an
    // engine with a home of its own still gets an empty one, never the
    // server's login.
    const home = homeDriver(driver) ? { engineHome: join(deps.dataDir, "org", `${driver}-key`) } : {};
    // #4410: the turn's payer's Claude sign-in beside the organization's keys
    // (their own warm pi: the identity names them)
    const signer = plan.claudeAccount ? turnPayer(input).principalId : "";
    const signIn = signer ? await claudeSignInEnvironment(deps, signer) : null;
    if (signIn) return { ok: true, plan, access: { via: "org-key", identity: `org-key:${signer}:claude`, environment: signIn, ...home } };
    return { ok: true, plan, access: { via: "org-key", identity: "org-key", ...home } };
  }
  if (keyVia(plan.via) && input.instance.personalOwner) return { ok: true, plan, access: { via: plan.via, identity: `${plan.via}:${payer}:endpoint`, environment: {} } };
  return { ok: true, plan, access: { via: "server", identity: "server" } };
}
