// Slice 4 (D8), revised 2026-10-01: the person who speaks pays. The whole
// decision table of a turn's credentials on an organization server, and
// what the driver receives.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { TurnSpeaker } from "./engine-access.ts";
import { materializeEngineAccess, openCodeClaudeAuthContent, openCodeCodexAuthContent, paidByPerson, piCodexAuthContent, piPayerProviders, providerOfDriver, providersOfDriver, resolveEngineAccess, resolveGovernedEngineAccess, subscriptionDriver, turnPayer, type EngineCredentialInput, type PersonFacts } from "./engine-credentials.ts";
import type { ModelProvider, ProviderKeyResult } from "../perspicax/perspicax-link.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";
const CAROL = "pr_00000000-0000-4000-8000-000000000003";

type Facts = { signedIn?: string[]; keys?: string[]; people?: Record<string, PersonFacts> };

/** signedIn: "<pid>/<driver>"; keys: "<sub>/<provider>". */
function input(patch: Partial<EngineCredentialInput> & Facts = {}): EngineCredentialInput {
  const { signedIn = [], keys = [], people = { [BOB]: { sub: "SUB-BOB" }, [CAROL]: { sub: "SUB-CAROL" } }, ...rest } = patch;
  return {
    identity: "perspicax",
    speaker: { origin: "person", principalId: OWNER },
    owner: { principalId: OWNER, sub: "SUB-OWNER" },
    instance: { instanceId: "claude", driver: "claudeAgent", installed: true },
    person: (principalId) => people[principalId],
    subscriptionSignedIn: (principalId, driver) => signedIn.includes(`${principalId}/${driver}`),
    hasKey: (sub, provider) => keys.includes(`${sub}/${provider}`),
    keyBacked: false,
    ...rest,
  };
}

const CLAUDE = { instanceId: "claude", driver: "claudeAgent", installed: true };
const CODEX = { instanceId: "codex", driver: "codex", installed: true };
const GROK = { instanceId: "grok", driver: "grokAgent", installed: true };
const KIMI = { instanceId: "kimi", driver: "kimiAgent", installed: true };
const GEMINI = { instanceId: "gemini", driver: "geminiAgent", installed: true };
const PI = { instanceId: "pi", driver: "piAgent", installed: true };
const OPENCODE = { instanceId: "opencode", driver: "opencodeGo", installed: true };
const CURSOR = { instanceId: "cursor", driver: "cursorAgent", installed: true };
const bob: TurnSpeaker = { origin: "person", principalId: BOB };
const routine: TurnSpeaker = { origin: "owner-routine" };

describe("resolveEngineAccess: the person who speaks pays", () => {
  it("never sends another person's key to a private endpoint with the same provider id", () => {
    const instance = { instanceId: "personal-lab", driver: "openai-compat", installed: true, keyOnly: true, keyProvider: "compat:lab" as const, personalOwner: OWNER };
    expect(resolveEngineAccess(input({ instance, keys: ["SUB-OWNER/compat:lab"], keyBacked: true }))).toMatchObject({ ok: true, via: "owner-key", provider: "compat:lab" });
    expect(resolveEngineAccess(input({ instance, speaker: bob, keys: ["SUB-BOB/compat:lab"], keyBacked: true, hasLocalKey: () => true }))).toMatchObject({ ok: false, cause: "no_credentials" });
    expect(resolveEngineAccess(input({ instance, keyBacked: true, hasLocalKey: () => true }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER });
  });
  it("solo mode: the server's configuration, always", () => {
    expect(resolveEngineAccess(input({ identity: "solo", instance: { ...CLAUDE, installed: false } }))).toEqual({ ok: true, via: "server", payer: "organization" });
  });

  it("an engine that is not installed wins over everything", () => {
    expect(resolveEngineAccess(input({ signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true, instance: { ...CLAUDE, installed: false } }))).toEqual({ ok: false, reason: "engine_missing", payer: "owner", payerPrincipalId: OWNER });
    // the card names whose turn it was, so it reaches that person only
    expect(resolveEngineAccess(input({ speaker: { origin: "person", principalId: BOB }, instance: { ...CLAUDE, installed: false } }))).toEqual({ ok: false, reason: "engine_missing", payer: "speaker", payerPrincipalId: BOB });
  });

  // The decision table: speaker (owner, someone shared with) x what that
  // person has (subscription, key, nothing) x org key x engine.
  const table: Array<[string, Partial<EngineCredentialInput> & Facts, unknown]> = [
    // the owner speaking to their own bot
    ["owner, own subscription, claude", { signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER }],
    ["owner, own subscription, codex", { instance: CODEX, signedIn: [`${OWNER}/codex`] }, { ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER }],
    ["owner, own key, claude", { keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic" }],
    ["owner, own key, codex", { instance: CODEX, keys: ["SUB-OWNER/openai"] }, { ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "openai" }],
    ["owner, nothing, org key", { keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["owner, nothing, no org key", {}, { ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER }],
    // someone the bot is shared with: their own credentials, never the owner's
    ["bob, his subscription, claude", { speaker: bob, signedIn: [`${BOB}/claudeAgent`, `${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic", "SUB-BOB/anthropic"] }, { ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, his subscription, codex", { speaker: bob, instance: CODEX, signedIn: [`${BOB}/codex`] }, { ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, his key, claude", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic", "SUB-BOB/anthropic"], keyBacked: true }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic" }],
    ["bob, his key, codex", { speaker: bob, instance: CODEX, keys: ["SUB-BOB/openai"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "openai" }],
    ["bob, a key for the other provider only", { speaker: bob, instance: CODEX, keys: ["SUB-BOB/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, nothing, owner has everything, org key", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["bob, nothing, owner has everything, no org key", { speaker: bob, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    // an engine without personal sign-in or Perspicax key (Cursor, other ACP)
    ["other engine, owner signed in elsewhere", { instance: CURSOR, signedIn: [`${OWNER}/cursorAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER }],
    ["other engine, key-backed by the server", { instance: CURSOR, speaker: bob, keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    // Grok Build: the person's own grok.com sign-in, then their xAI key, then the org key
    ["bob, his Grok sign-in", { instance: GROK, speaker: bob, signedIn: [`${BOB}/grokAgent`, `${OWNER}/grokAgent`], keys: ["SUB-BOB/xai"], keyBacked: true }, { ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, his xAI key", { instance: GROK, speaker: bob, keys: ["SUB-BOB/xai", "SUB-OWNER/xai"], keyBacked: true }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "xai" }],
    ["bob, the owner's Grok sign-in never serves him", { instance: GROK, speaker: bob, signedIn: [`${OWNER}/grokAgent`], keys: ["SUB-OWNER/xai"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, nothing, the org xAI key", { instance: GROK, speaker: bob, keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    // Kimi Code: the person's own Kimi sign-in, then their Moonshot key
    ["owner, own Kimi sign-in", { instance: KIMI, signedIn: [`${OWNER}/kimiAgent`] }, { ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER }],
    ["bob, his Moonshot key", { instance: KIMI, speaker: bob, keys: ["SUB-BOB/moonshot"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "moonshot" }],
    // Gemini CLI: a Google key only (the consumer login is retired)
    ["bob, his Google key", { instance: GEMINI, speaker: bob, signedIn: [`${BOB}/geminiAgent`], keys: ["SUB-BOB/google"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "google" }],
    ["bob, a Gemini login is not a payer", { instance: GEMINI, speaker: bob, signedIn: [`${BOB}/geminiAgent`] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    ["bob, a key he pasted, before the organization key", { instance: GEMINI, speaker: bob, keyBacked: true, hasLocalKey: (id, driver) => id === BOB && driver === "geminiAgent" }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, localKey: true }],
    ["bob, a pasted key does not beat his Perspicax key", { instance: GEMINI, speaker: bob, keys: ["SUB-BOB/google"], hasLocalKey: () => true }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "google" }],
    // pi: any key the person keeps
    ["bob, pi on his xAI key", { instance: PI, speaker: bob, keys: ["SUB-BOB/xai"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "xai" }],
    ["bob, pi with no key", { instance: PI, speaker: bob, keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB }],
    // disabled people
    ["bob disabled: refused, not the org key", { speaker: bob, people: { [BOB]: { sub: "SUB-BOB", disabled: true } }, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic"], keyBacked: true }, { ok: false, reason: "no_access", cause: "payer_disabled", payer: "speaker", payerPrincipalId: BOB }],
    ["owner disabled, bob speaks: bob's own key still serves", { speaker: bob, owner: { principalId: OWNER, sub: "SUB-OWNER", disabled: true }, keys: ["SUB-BOB/anthropic"] }, { ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic" }],
    ["owner disabled, owner speaks", { owner: { principalId: OWNER, sub: "SUB-OWNER", disabled: true }, signedIn: [`${OWNER}/claudeAgent`], keyBacked: true }, { ok: false, reason: "no_access", cause: "payer_disabled", payer: "owner", payerPrincipalId: OWNER }],
    // unknown people have no credentials of their own
    ["an unknown person: the org key or nothing", { speaker: { origin: "person" }, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker" }],
    ["an unknown person, org key", { speaker: { origin: "person", principalId: "" }, keyBacked: true }, { ok: true, via: "org-key", payer: "organization" }],
    ["a person the server does not know: no subject, no key", { speaker: { origin: "person", principalId: CAROL }, people: {}, keys: ["SUB-CAROL/anthropic"] }, { ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: CAROL }],
  ];
  it.each(table)("%s", (_name, patch, expected) => {
    expect(resolveEngineAccess(input(patch))).toEqual(expected);
  });

  it("compares principal ids without case", () => {
    expect(resolveEngineAccess(input({ speaker: { origin: "person", principalId: OWNER.toUpperCase() }, keys: ["SUB-OWNER/anthropic"] }))).toMatchObject({ ok: true, via: "owner-key", payer: "owner" });
  });
});

describe("the bot's routines run on the owner's credentials", () => {
  it("a scheduled run: owner's subscription, then owner's key, then the org key", () => {
    expect(resolveEngineAccess(input({ speaker: routine, signedIn: [`${OWNER}/claudeAgent`] }))).toEqual({ ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER, routine: true });
    expect(resolveEngineAccess(input({ speaker: routine, keys: ["SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic", routine: true });
    expect(resolveEngineAccess(input({ speaker: routine, keyBacked: true }))).toEqual({ ok: true, via: "org-key", payer: "organization", routine: true });
  });

  it("a run someone else started or edited (its runAs) still runs on the owner's credentials", () => {
    // bob (run or edit level) started the run by hand: his own subscription and key never serve it
    const byBob: TurnSpeaker = { origin: "owner-routine", principalId: BOB };
    expect(turnPayer({ speaker: byBob, owner: { principalId: OWNER } })).toEqual({ principalId: OWNER, routine: true });
    expect(resolveEngineAccess(input({ speaker: byBob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic", "SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "anthropic", routine: true });
    expect(resolveEngineAccess(input({ speaker: byBob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic"] }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("an owner disabled since: the routine is refused, never the org key", () => {
    const erin = { principalId: OWNER, sub: "SUB-OWNER", disabled: true };
    expect(resolveEngineAccess(input({ speaker: routine, owner: erin, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }))).toEqual({ ok: false, reason: "no_access", cause: "payer_disabled", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("an owner with no credential and no org key: refused", () => {
    expect(resolveEngineAccess(input({ speaker: routine }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("a hop a routine started speaks, and pays, for the person that routine runs for", () => {
    // carol's routine asked the owner's bot: carol's credentials, marked routine
    const hop: TurnSpeaker = { origin: "peer", principalId: CAROL, routine: true };
    expect(resolveEngineAccess(input({ speaker: hop, keys: ["SUB-CAROL/anthropic", "SUB-OWNER/anthropic"] }))).toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: CAROL, provider: "anthropic", routine: true });
    // a person's hop: that person pays
    expect(resolveEngineAccess(input({ speaker: { origin: "peer", principalId: BOB }, keys: ["SUB-OWNER/anthropic"] }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
    // no source turn known: the asking bot's owner
    expect(resolveEngineAccess(input({ speaker: { origin: "peer" }, peerOwnerPrincipalId: BOB, keys: ["SUB-BOB/anthropic"] }))).toMatchObject({ ok: true, via: "speaker-key", payerPrincipalId: BOB });
  });

  it("the operator at this computer is the owner", () => {
    expect(resolveEngineAccess(input({ speaker: { origin: "operator" }, signedIn: [`${OWNER}/claudeAgent`] }))).toMatchObject({ ok: true, via: "subscription", payer: "owner" });
  });

  it("providers by driver", () => {
    expect(providerOfDriver("claudeAgent")).toBe("anthropic");
    expect(providerOfDriver("codex")).toBe("openai");
    expect(providerOfDriver("grokAgent")).toBe("xai");
    expect(providerOfDriver("geminiAgent")).toBe("google");
    expect(providerOfDriver("kimiAgent")).toBe("moonshot");
    // #2024: every provider pi knows natively that Perspicax keeps a key for
    expect(providersOfDriver("piAgent")).toEqual([
      "anthropic", "openai", "xai", "google", "moonshot", "openrouter", "mistral", "cerebras", "groq",
      "zai", "minimax", "opencode", "deepseek", "fireworks", "together", "huggingface", "nvidia", "kimi",
    ]);
    expect(providerOfDriver("cursorAgent")).toBe("cursor");
    expect(["claudeAgent", "codex", "grokAgent", "kimiAgent", "geminiAgent", "piAgent"].filter(subscriptionDriver)).toEqual(["claudeAgent", "codex", "grokAgent", "kimiAgent"]);
  });
});

describe("materializeEngineAccess", () => {
  const deps = (answer: ProviderKeyResult | ((sub: string, provider: ModelProvider) => ProviderKeyResult)) => {
    const invalidated: string[] = [];
    const resolved: string[] = [];
    return {
      invalidated,
      resolved,
      dataDir: "/data",
      resolveKey: async (sub: string, provider: ModelProvider) => {
        resolved.push(`${sub}/${provider}`);
        return typeof answer === "function" ? answer(sub, provider) : answer;
      },
      invalidate: (sub: string, provider: string) => { invalidated.push(`${sub}/${provider}`); },
      loginDir: (principalId: string, driver: string, instanceId?: string) => `/data/principals/${principalId}/${instanceId?.includes("-") ? `accounts/${instanceId}/` : ""}${{ claudeAgent: "claude", codex: "codex", grokAgent: "grok", kimiAgent: "kimi" }[driver]}`,
    };
  };
  const BOB_PID = BOB.toLowerCase();
  it.each([["mistral", "mistral"], ["cursorAgent", "cursor"], ["droidAgent", "factory"], ["hermesAgent", "glm"], ["groq", "groq"]] as const)("%s reads its person's %s key from Perspicax", async (driver, provider) => {
    const request = input({ speaker: bob, instance: { instanceId: driver, driver, installed: true, keyOnly: true }, keys: [`SUB-BOB/${provider}`] });
    const materialized = await materializeEngineAccess(request, resolveEngineAccess(request), deps({ ok: true, key: "lab-personal-key", fingerprint: "person-a" }));
    expect(materialized).toMatchObject({ ok: true, access: { via: "speaker-key", environment: { SAGAX_PERSONAL_PROVIDER_KEY: "lab-personal-key" } } });
    if (materialized.ok) expect(materialized.access.codexHome).toBeUndefined();
  });

  it("puts the speaker's own Anthropic key in the turn environment, read with the speaker's subject", async () => {
    const inp = input({ speaker: bob, keys: ["SUB-BOB/anthropic", "SUB-OWNER/anthropic"] });
    const d = deps({ ok: true, key: "sk-ant-test-bob-key-000001", fingerprint: "fp1" });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), d);
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fp1`, environment: { ANTHROPIC_API_KEY: "sk-ant-test-bob-key-000001" } } });
    expect(d.resolved).toEqual(["SUB-BOB/anthropic"]);
  });

  it("runs Codex on the payer's OpenAI key from an empty home of their own", async () => {
    const inp = input({ instance: CODEX, keys: ["SUB-OWNER/openai"] });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: true, key: "sk-test-openai-000000000001", fingerprint: "fp2" }));
    expect(out).toMatchObject({ ok: true, access: { via: "owner-key", identity: `owner-key:${OWNER}:fp2`, environment: { SAGAX_OWNER_OPENAI_API_KEY: "sk-test-openai-000000000001" }, codexHome: join("/data", "principals", OWNER, "codex-key"), codexOwnerKey: true } });
    const bobs = input({ speaker: bob, instance: CODEX, keys: ["SUB-BOB/openai"] });
    expect(await materializeEngineAccess(bobs, resolveEngineAccess(bobs), deps({ ok: true, key: "sk-test-openai-000000000002", fingerprint: "fp3" }))).toMatchObject({ ok: true, access: { via: "speaker-key", codexHome: join("/data", "principals", BOB_PID, "codex-key"), codexOwnerKey: true } });
  });

  it("#2373: a turn on an added account runs on that account's folder and session, never the first account's", async () => {
    const account = "claude-22222222-2222-4222-8222-222222222222";
    const asked: string[] = [];
    const onB = input({ instance: { instanceId: account, driver: "claudeAgent", installed: true }, subscriptionSignedIn: (_principalId, _driver, instanceId) => { asked.push(instanceId); return instanceId === account; } });
    expect(await materializeEngineAccess(onB, resolveEngineAccess(onB), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", identity: `subscription:${OWNER}:${account}`, claudeConfigDir: `/data/principals/${OWNER}/accounts/${account}/claude` } });
    expect(asked).toContain(account);
    // signed out of the added account: its turn does not borrow the first account
    const signedOutB = input({ instance: { instanceId: account, driver: "claudeAgent", installed: true }, subscriptionSignedIn: (_principalId, _driver, instanceId) => instanceId === "claude" });
    expect(resolveEngineAccess(signedOutB)).not.toMatchObject({ via: "subscription" });
  });

  it("a subscription points the driver at the speaker's own login directory", async () => {
    const claude = input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`] });
    expect(await materializeEngineAccess(claude, resolveEngineAccess(claude), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", identity: `subscription:${BOB_PID}`, claudeConfigDir: `/data/principals/${BOB_PID}/claude` } });
    const codex = input({ instance: CODEX, signedIn: [`${OWNER}/codex`] });
    expect(await materializeEngineAccess(codex, resolveEngineAccess(codex), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", identity: `subscription:${OWNER}`, codexHome: `/data/principals/${OWNER}/codex` } });
  });

  it("Grok and Kimi: a sign-in is the person's own engine home; a key rides in an empty home of theirs", async () => {
    const grokSub = input({ instance: GROK, speaker: bob, signedIn: [`${BOB}/grokAgent`] });
    expect(await materializeEngineAccess(grokSub, resolveEngineAccess(grokSub), deps({ ok: false, error: "no_key" }))).toEqual({ ok: true, plan: expect.anything(), access: { via: "subscription", identity: `subscription:${BOB_PID}`, engineHome: `/data/principals/${BOB_PID}/grok` } });
    const grokKey = input({ instance: GROK, speaker: bob, keys: ["SUB-BOB/xai"] });
    expect(await materializeEngineAccess(grokKey, resolveEngineAccess(grokKey), deps({ ok: true, key: "xai-test-bob-000001", fingerprint: "fx" }))).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fx`, environment: { XAI_API_KEY: "xai-test-bob-000001" }, engineHome: join("/data", "principals", BOB_PID, "grokAgent-key") } });
    const kimiSub = input({ instance: KIMI, signedIn: [`${OWNER}/kimiAgent`] });
    expect(await materializeEngineAccess(kimiSub, resolveEngineAccess(kimiSub), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "subscription", engineHome: `/data/principals/${OWNER}/kimi` } });
    const kimiKey = input({ instance: KIMI, keys: ["SUB-OWNER/moonshot"] });
    expect(await materializeEngineAccess(kimiKey, resolveEngineAccess(kimiKey), deps({ ok: true, key: "sk-moonshot-test-01", fingerprint: "fm" }))).toMatchObject({ ok: true, access: { via: "owner-key", environment: { MOONSHOT_API_KEY: "sk-moonshot-test-01" }, engineHome: join("/data", "principals", OWNER, "kimiAgent-key") } });
  });

  it("a pasted key names the person and does not fetch Perspicax", async () => {
    const inp = input({ instance: GEMINI, speaker: bob, keyBacked: true, hasLocalKey: (id, driver) => id === BOB && driver === "geminiAgent" });
    const d = deps({ ok: true, key: "should-not-be-fetched", fingerprint: "no" });
    expect(await materializeEngineAccess(inp, resolveEngineAccess(inp), d)).toMatchObject({
      ok: true,
      access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:local`, localKeyPrincipal: BOB_PID },
    });
    expect(d.resolved).toEqual([]);
  });

  it("Gemini runs on the payer's Google key as GEMINI_API_KEY", async () => {
    const inp = input({ instance: GEMINI, speaker: bob, keys: ["SUB-BOB/google"] });
    expect(await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: true, key: "AIza-test-bob-0001", fingerprint: "fg" }))).toMatchObject({ ok: true, access: { via: "speaker-key", environment: { GEMINI_API_KEY: "AIza-test-bob-0001" }, engineHome: join("/data", "principals", BOB_PID, "geminiAgent-key") } });
  });

  it("pi gets every key the payer keeps, and only theirs", async () => {
    const inp = input({ instance: PI, speaker: bob, keys: ["SUB-BOB/openai", "SUB-BOB/moonshot", "SUB-OWNER/anthropic"] });
    const d = deps((_sub, provider) => ({ ok: true, key: `key-${provider}`, fingerprint: `f-${provider}` }));
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), d);
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:f-openai+f-moonshot`, environment: { OPENAI_API_KEY: "key-openai", MOONSHOT_API_KEY: "key-moonshot" }, engineHome: join("/data", "principals", BOB_PID, "piAgent-key") } });
    expect(d.resolved).toEqual(["SUB-BOB/openai", "SUB-BOB/moonshot"]);
  });

  it("the org key gives a home engine an empty organization home, never the server's login", async () => {
    const inp = input({ instance: GROK, speaker: bob, keyBacked: true });
    expect(await materializeEngineAccess(inp, resolveEngineAccess(inp), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: true, access: { via: "org-key", identity: "org-key", engineHome: join("/data", "org", "grokAgent-key") } });
  });

  it("S4-14: a key plan for a payer disabled since never reads the (cached) key", async () => {
    const live = input({ speaker: routine, keys: ["SUB-OWNER/anthropic"], keyBacked: true });
    const plan = resolveEngineAccess(live);
    const erin = { ...live, owner: { ...live.owner, disabled: true } };
    const cached = deps({ ok: true, key: "sk-ant-test-erin-key-00001", fingerprint: "fp" });
    expect(await materializeEngineAccess(erin, plan, cached)).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "payer_disabled", payer: "owner", routine: true } });
    expect(cached.invalidated).toEqual(["SUB-OWNER/anthropic"]);
    expect(cached.resolved).toEqual([]);
  });

  it("a key Perspicax no longer has falls through to the org key; an inactive payer is refused; an unreachable Perspicax is no_access", async () => {
    const withOrg = input({ speaker: bob, keys: ["SUB-BOB/anthropic"], keyBacked: true });
    const gone = deps({ ok: false, error: "no_key" });
    expect(await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), gone)).toMatchObject({ ok: true, access: { via: "org-key", identity: "org-key" } });
    expect(gone.invalidated).toEqual(["SUB-BOB/anthropic"]);
    const noOrg = input({ speaker: bob, keys: ["SUB-BOB/anthropic"] });
    expect(await materializeEngineAccess(noOrg, resolveEngineAccess(noOrg), deps({ ok: false, error: "no_key" }))).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "no_credentials", payer: "speaker" } });
    expect(await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), deps({ ok: false, error: "user_inactive" }))).toMatchObject({ ok: false, reason: "no_access", plan: { cause: "payer_disabled", payer: "speaker" } });
    expect(await materializeEngineAccess(noOrg, resolveEngineAccess(noOrg), deps({ ok: false, error: "unreachable" }))).toEqual({ ok: false, reason: "no_access", detail: "perspicax_unreachable" });
  });

  it("never reads the owner's key for someone else's turn", async () => {
    const inp = input({ speaker: bob, keys: ["SUB-OWNER/anthropic"], keyBacked: true });
    const d = deps({ ok: true, key: "sk-ant-test-owner-key-0001", fingerprint: "fp" });
    expect(await materializeEngineAccess(inp, resolveEngineAccess(inp), d)).toMatchObject({ ok: true, access: { via: "org-key" } });
    expect(d.resolved).toEqual([]);
  });
});

// 2026-10-16 (owner): the organization's key serves only the people Perspicax
// gives the engine to (`sagax_server_engines`; an admin always).
describe("resolveEngineAccess: the organization's key per person", () => {
  const given = (list: Record<string, string[]>) => (principalId: string, instanceId: string) =>
    principalId === OWNER ? true : (list[principalId] ?? []).includes(instanceId);

  it("an admin (here the owner) runs every engine on the organization's key", () => {
    expect(resolveEngineAccess(input({ instance: GROK, keyBacked: true, serverEngineAllowed: given({}) }))).toEqual({ ok: true, via: "org-key", payer: "organization" });
  });

  it("a member the engine was not given to is refused at the organization's key", () => {
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, serverEngineAllowed: given({ [BOB]: ["claude"] }) })))
      .toEqual({ ok: false, reason: "no_access", cause: "server_engine_not_allowed", payer: "speaker", payerPrincipalId: BOB });
  });

  it("a member the engine was given to runs on the organization's key", () => {
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, serverEngineAllowed: given({ [BOB]: ["grok"] }) })))
      .toEqual({ ok: true, via: "org-key", payer: "organization" });
  });

  it("their own subscription or key still serves them, whatever the list", () => {
    const none = given({});
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, signedIn: [`${BOB}/grokAgent`], serverEngineAllowed: none })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB });
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, keys: ["SUB-BOB/xai"], serverEngineAllowed: none })))
      .toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "xai" });
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, hasLocalKey: (pid) => pid === BOB, serverEngineAllowed: none })))
      .toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, localKey: true });
  });

  it("a routine is judged on its owner's list", () => {
    const member = "pr_00000000-0000-4000-8000-000000000009";
    const owner = { principalId: member, sub: "SUB-M" };
    expect(resolveEngineAccess(input({ speaker: routine, owner, instance: GROK, keyBacked: true, serverEngineAllowed: given({}) })))
      .toEqual({ ok: false, reason: "no_access", cause: "server_engine_not_allowed", payer: "owner", payerPrincipalId: member, routine: true });
    expect(resolveEngineAccess(input({ speaker: routine, owner, instance: GROK, keyBacked: true, serverEngineAllowed: given({ [member]: ["grok"] }) })))
      .toEqual({ ok: true, via: "org-key", payer: "organization", routine: true });
  });

  it("no organization key: the list changes nothing", () => {
    expect(resolveEngineAccess(input({ speaker: bob, instance: GROK, serverEngineAllowed: given({}) })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });
});

describe("an engine outside the organization's list (#1098)", () => {
  it("runs on the person's own subscription or key, never on the organization's key", () => {
    const own = resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, signedIn: [`${BOB}/grokAgent`], orgEngineAllowed: false }));
    expect(own).toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB });
    expect(paidByPerson(own)).toBe(true);
    const key = resolveEngineAccess(input({ speaker: bob, instance: GROK, keyBacked: true, keys: ["SUB-BOB/xai"], orgEngineAllowed: false }));
    expect(paidByPerson(key)).toBe(true);
    const org = resolveEngineAccess(input({ instance: GROK, keyBacked: true, orgEngineAllowed: false }));
    expect(org).toEqual({ ok: false, reason: "no_access", cause: "server_engine_not_allowed", payer: "owner", payerPrincipalId: OWNER });
    expect(paidByPerson(org)).toBe(false);
    expect(paidByPerson(resolveEngineAccess(input({ instance: GROK, keyBacked: true })))).toBe(false);
  });
});

describe("an expired sign-in no longer pays (2026-10-30)", () => {
  const expired = (list: string[]) => (principalId: string, driver: string) => list.includes(`${principalId}/${driver}`);

  it("the person's key serves instead", () => {
    const plan = resolveEngineAccess(input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: expired([`${BOB}/claudeAgent`]), keys: ["SUB-BOB/anthropic"] }));
    expect(plan).toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic" });
  });

  it("then the organization's key", () => {
    const plan = resolveEngineAccess(input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: expired([`${BOB}/claudeAgent`]), keyBacked: true }));
    expect(plan).toEqual({ ok: true, via: "org-key", payer: "organization" });
  });

  it("nothing else: refused as an expired sign-in, so Auto leaves it out and the card says Reconnect", () => {
    const plan = resolveEngineAccess(input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: expired([`${BOB}/claudeAgent`]) }));
    expect(plan).toEqual({ ok: false, reason: "no_access", cause: "sign_in_expired", payer: "speaker", payerPrincipalId: BOB });
    expect(paidByPerson(plan)).toBe(false);
    // the organization's key not given to them: still the sign-in to fix
    expect(resolveEngineAccess(input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: expired([`${BOB}/claudeAgent`]), keyBacked: true, serverEngineAllowed: () => false })))
      .toMatchObject({ ok: false, cause: "sign_in_expired" });
  });

  it("a sign-in that did not expire pays as before", () => {
    expect(resolveEngineAccess(input({ speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: expired([]) })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB });
  });
});

// #1137 (shared/turn-payer.ts): the owner may pay for the people a bot is
// shared with. The same order, judged on the owner's credentials.
describe("resolveEngineAccess: the owner pays (#1137)", () => {
  const ownerPays = { payerMode: "owner" as const };

  it("a person writing to a bot the owner pays for runs on the owner's subscription", () => {
    const plan = resolveEngineAccess(input({ ...ownerPays, speaker: bob, instance: CODEX, signedIn: [`${OWNER}/codex`] }));
    expect(plan).toEqual({ ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER, ownerPays: true });
    expect(turnPayer({ ...ownerPays, speaker: bob, owner: { principalId: OWNER } })).toEqual({ principalId: OWNER, routine: false, ownerPays: true });
  });

  it("the owner's key (pi on the owner's keys serves a local model of the owner's computer too)", () => {
    expect(resolveEngineAccess(input({ ...ownerPays, speaker: bob, instance: PI, keys: ["SUB-OWNER/openai"] }))).toEqual({ ok: true, via: "owner-key", payer: "owner", payerPrincipalId: OWNER, provider: "openai", ownerPays: true });
  });

  it("the person who writes needs nothing of their own, and their own key is not read", () => {
    const plan = resolveEngineAccess(input({ ...ownerPays, speaker: bob, keys: ["SUB-OWNER/anthropic", "SUB-BOB/anthropic"] }));
    expect(plan).toMatchObject({ ok: true, via: "owner-key", payerPrincipalId: OWNER, ownerPays: true });
  });

  it("the organization's key is judged as the owner's, and still marks that the owner pays", () => {
    const plan = resolveEngineAccess(input({ ...ownerPays, speaker: bob, keyBacked: true, serverEngineAllowed: (pid) => pid === OWNER }));
    expect(plan).toEqual({ ok: true, via: "org-key", payer: "organization", ownerPays: true });
  });

  it("the owner without access: refused as the owner's, flagged so the person who wrote learns why", () => {
    expect(resolveEngineAccess(input({ ...ownerPays, speaker: bob }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "owner", payerPrincipalId: OWNER, ownerPays: true });
    expect(resolveEngineAccess(input({ ...ownerPays, speaker: bob, owner: { principalId: OWNER, sub: "SUB-OWNER", disabled: true }, signedIn: [`${OWNER}/claudeAgent`] })))
      .toMatchObject({ ok: false, cause: "payer_disabled", payer: "owner", ownerPays: true });
  });

  it("never an unknown person, never the owner's own turn, and routines are unchanged", () => {
    const unknown = resolveEngineAccess(input({ ...ownerPays, speaker: { origin: "person" }, signedIn: [`${OWNER}/claudeAgent`] }));
    expect(unknown).toMatchObject({ ok: false, reason: "no_access" });
    expect(unknown).not.toHaveProperty("ownerPays");
    expect(resolveEngineAccess(input({ ...ownerPays, signedIn: [`${OWNER}/claudeAgent`] }))).toEqual({ ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER });
    expect(resolveEngineAccess(input({ ...ownerPays, speaker: routine, signedIn: [`${OWNER}/claudeAgent`] }))).toEqual({ ok: true, via: "subscription", payer: "owner", payerPrincipalId: OWNER, routine: true });
  });

  it("a hop that speaks for the person is paid by the owner too", () => {
    const hop: TurnSpeaker = { origin: "peer", fromBotId: "b2", principalId: BOB };
    expect(resolveEngineAccess(input({ ...ownerPays, speaker: hop, signedIn: [`${OWNER}/claudeAgent`] }))).toMatchObject({ ok: true, via: "subscription", payerPrincipalId: OWNER, ownerPays: true });
  });

  it("each person pays: the rule since 2026-10-01, unchanged", () => {
    expect(resolveEngineAccess(input({ payerMode: "speaker", speaker: bob, signedIn: [`${OWNER}/claudeAgent`] }))).toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });

  it("isolation: the owner's key reaches the turn on the server only, read with the owner's subject", async () => {
    const inp = input({ ...ownerPays, speaker: bob, keys: ["SUB-OWNER/anthropic"] });
    const resolved: string[] = [];
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), {
      dataDir: "/data",
      resolveKey: async (sub, provider) => { resolved.push(`${sub}/${provider}`); return { ok: true, key: "sk-ant-test-owner-key-0001", fingerprint: "fp" }; },
      invalidate: () => {},
      loginDir: (principalId, driver) => `/data/principals/${principalId}/${driver}`,
    });
    expect(resolved).toEqual(["SUB-OWNER/anthropic"]);
    expect(out).toMatchObject({ ok: true, access: { via: "owner-key", identity: `owner-key:${OWNER}:fp` }, plan: { ownerPays: true } });
  });
});

describe("an API-key engine runs on a key, never on a subscription (#1533)", () => {
  const CLAUDE_API = { instanceId: "claudeApi", driver: "claudeAgent", installed: true, keyOnly: true };
  it("a member signed in to Claude pays nothing on the organization's Claude API engine: the organization does", () => {
    const plan = resolveEngineAccess(input({ instance: CLAUDE_API, signedIn: [`${OWNER}/claudeAgent`], keyBacked: true }));
    expect(plan).toEqual({ ok: true, via: "org-key", payer: "organization" });
  });
  it("their own key still comes before the organization's", () => {
    const plan = resolveEngineAccess(input({ instance: CLAUDE_API, signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true }));
    expect(plan).toMatchObject({ ok: true, via: "owner-key" });
  });
  it("the subscription engine itself is unchanged", () => {
    const plan = resolveEngineAccess(input({ instance: CLAUDE, signedIn: [`${OWNER}/claudeAgent`], keyBacked: true }));
    expect(plan).toMatchObject({ ok: true, via: "subscription" });
  });
});

describe("#4410 lot 1: pi runs Claude models on the payer's own Claude sign-in", () => {
  const BOB_PID = BOB.toLowerCase();
  const TOKEN = "sk-ant-oat01-test-sign-in-000000000000000001";
  const deps = (signIn: (principalId: string) => Promise<{ accessToken: string } | null>, key: (sub: string, provider: ModelProvider) => ProviderKeyResult = () => ({ ok: false, error: "no_key" })) => {
    const asked: string[] = [];
    return {
      asked,
      dataDir: "/data",
      resolveKey: async (sub: string, provider: ModelProvider) => key(sub, provider),
      invalidate: () => {},
      loginDir: (principalId: string) => `/data/principals/${principalId}/claude`,
      claudeSignIn: async (principalId: string) => { asked.push(principalId); return signIn(principalId); },
    };
  };

  it("a person with a Claude sign-in and no key pays a pi turn with it", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`] })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic", claudeAccount: true });
    expect(paidByPerson(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`] })))).toBe(true);
  });

  it("only the payer's own sign-in: the owner's never pays for the person who speaks", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${OWNER}/claudeAgent`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });

  it("a refused sign-in no longer pays, and other engines are unchanged", () => {
    const expired = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], subscriptionExpired: (pid, driver) => pid === BOB && driver === "claudeAgent" });
    expect(resolveEngineAccess(expired)).toMatchObject({ ok: false, cause: "no_credentials" });
    expect(resolveEngineAccess(input({ instance: CODEX, speaker: bob, signedIn: [`${BOB}/claudeAgent`] }))).toMatchObject({ ok: false });
    expect(resolveEngineAccess(input({ instance: { ...PI, keyOnly: true }, speaker: bob, signedIn: [`${BOB}/claudeAgent`] }))).toMatchObject({ ok: false });
  });

  it("with keys of theirs, the key plan carries the sign-in too", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/xai"] })))
      .toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, provider: "xai", claudeAccount: true });
  });

  it("hands the short token as ANTHROPIC_OAUTH_TOKEN in the turn's environment, in the payer's own pi home", async () => {
    const inp = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`] });
    const d = deps(async () => ({ accessToken: TOKEN }));
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), d);
    expect(out).toEqual({
      ok: true,
      plan: expect.objectContaining({ via: "subscription", claudeAccount: true }),
      access: { via: "subscription", identity: `subscription:${BOB_PID}:claude`, environment: { ANTHROPIC_OAUTH_TOKEN: TOKEN }, engineHome: join("/data", "principals", BOB_PID, "piAgent-key") },
    });
    expect(d.asked).toEqual([BOB_PID]);
    // the label never carries the token
    if (out.ok) expect(out.access.identity).not.toContain(TOKEN);
  });

  it("adds the sign-in beside the payer's keys only when no Anthropic key of theirs pays Claude", async () => {
    const keyed = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/xai"] });
    const out = await materializeEngineAccess(keyed, resolveEngineAccess(keyed), deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "xai-test-bob-000000000001", fingerprint: "fx" })));
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fx+claude`, environment: { XAI_API_KEY: "xai-test-bob-000000000001", ANTHROPIC_OAUTH_TOKEN: TOKEN } } });
    const both = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keys: ["SUB-BOB/anthropic"] });
    const d = deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "sk-ant-test-bob-key-000001", fingerprint: "fa" }));
    const keyOnly = await materializeEngineAccess(both, resolveEngineAccess(both), d);
    expect(keyOnly).toMatchObject({ ok: true, access: { environment: { ANTHROPIC_API_KEY: "sk-ant-test-bob-key-000001" } } });
    if (keyOnly.ok) expect(keyOnly.access.environment?.ANTHROPIC_OAUTH_TOKEN).toBeUndefined();
    expect(d.asked).toEqual([]);
  });

  it("the sign-in is added beside the organization's key, never in its place", async () => {
    const orgKeys = ["openai", "xai"];
    const withOrg = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keyBacked: true, orgKeyProviders: orgKeys });
    expect(resolveEngineAccess(withOrg)).toEqual({ ok: true, via: "org-key", payer: "organization", claudeAccount: true });
    expect([...piPayerProviders(withOrg, ["openai", "xai"])!].sort()).toEqual(["anthropic", "openai", "xai"]);
    const out = await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), deps(async () => ({ accessToken: TOKEN })));
    expect(out).toMatchObject({ ok: true, access: { via: "org-key", identity: `org-key:${BOB}:claude`, environment: { ANTHROPIC_OAUTH_TOKEN: TOKEN }, engineHome: join("/data", "org", "piAgent-key") } });
    // unreadable at dispatch: the organization's keys alone, as before
    const lost = await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), deps(async () => null));
    expect(lost).toMatchObject({ ok: true, access: { via: "org-key", identity: "org-key" } });
    if (lost.ok) expect(lost.access.environment).toBeUndefined();
  });

  it("the organization's Anthropic key keeps paying Claude models: no sign-in then", async () => {
    const withOrg = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keyBacked: true, orgKeyProviders: ["openai", "xai", "anthropic"] });
    expect(resolveEngineAccess(withOrg)).toEqual({ ok: true, via: "org-key", payer: "organization" });
    expect([...piPayerProviders(withOrg, ["openai", "xai", "anthropic"])!].sort()).toEqual(["anthropic", "openai", "xai"]);
    const d = deps(async () => ({ accessToken: TOKEN }));
    expect(await materializeEngineAccess(withOrg, resolveEngineAccess(withOrg), d)).toMatchObject({ ok: true, access: { via: "org-key", identity: "org-key" } });
    expect(d.asked).toEqual([]);
  });

  it("the sign-in is added beside a key saved on this server, never in its place", async () => {
    const local = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keyBacked: true, hasLocalKey: () => true, orgKeyProviders: ["anthropic"] });
    expect(resolveEngineAccess(local)).toEqual({ ok: true, via: "speaker-key", payer: "speaker", payerPrincipalId: BOB, localKey: true, claudeAccount: true });
    expect([...piPayerProviders(local, ["anthropic"])!]).toEqual(["anthropic"]);
    expect(await materializeEngineAccess(local, resolveEngineAccess(local), deps(async () => ({ accessToken: TOKEN }))))
      .toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB}:local+claude`, localKeyPrincipal: BOB, environment: { ANTHROPIC_OAUTH_TOKEN: TOKEN } } });
  });

  it("the sign-in alone serves last, also where the organization's key is not given to the person", async () => {
    const notGiven = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`], keyBacked: true, serverEngineAllowed: () => false });
    expect(resolveEngineAccess(notGiven)).toMatchObject({ ok: true, via: "subscription", claudeAccount: true });
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, keyBacked: true, serverEngineAllowed: () => false }))).toMatchObject({ ok: false, cause: "server_engine_not_allowed" });
    // a sign-in-only plan that cannot be read at dispatch is refused, never loops
    const alone = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`] });
    expect(await materializeEngineAccess(alone, resolveEngineAccess(alone), deps(async () => { throw new Error("unreadable"); }))).toMatchObject({ ok: false, reason: "no_access" });
  });
});

describe("#4410 / #5523: OpenCode runs Claude models on the payer's own Claude sign-in", () => {
  const BOB_PID = BOB.toLowerCase();
  const TOKEN = "sk-ant-oat01-test-opencode-sign-in-000000000001";
  const deps = (signIn: (principalId: string) => Promise<{ accessToken: string } | null>) => ({
    dataDir: "/data",
    resolveKey: async () => ({ ok: false as const, error: "no_key" as const }),
    invalidate: () => {},
    loginDir: (principalId: string) => `/data/principals/${principalId}/claude`,
    claudeSignIn: async (principalId: string) => signIn(principalId),
  });

  it("a person with a Claude sign-in and no key pays an OpenCode turn with it", () => {
    expect(resolveEngineAccess(input({ instance: OPENCODE, speaker: bob, signedIn: [`${BOB}/claudeAgent`] })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB, provider: "anthropic", claudeAccount: true });
  });

  it("hands the short token as OPENCODE_AUTH_CONTENT oauth in the payer's own OpenCode home", async () => {
    const inp = input({ instance: OPENCODE, speaker: bob, signedIn: [`${BOB}/claudeAgent`] });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps(async () => ({ accessToken: TOKEN })));
    expect(out).toEqual({
      ok: true,
      plan: expect.objectContaining({ via: "subscription", claudeAccount: true }),
      access: {
        via: "subscription",
        identity: `subscription:${BOB_PID}:claude`,
        environment: { OPENCODE_AUTH_CONTENT: openCodeClaudeAuthContent(TOKEN) },
        engineHome: join("/data", "principals", BOB_PID, "opencodeGo-key"),
      },
    });
    if (out.ok) {
      expect(out.access.identity).not.toContain(TOKEN);
      expect(out.access.environment?.OPENCODE_AUTH_CONTENT).toContain('"type":"oauth"');
      expect(out.access.environment?.OPENCODE_AUTH_CONTENT).toContain(TOKEN);
    }
  });

  it("only the payer's own sign-in: the owner's never pays for the person who speaks", () => {
    expect(resolveEngineAccess(input({ instance: OPENCODE, speaker: bob, signedIn: [`${OWNER}/claudeAgent`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });
});

describe("#4410 / #5525: pi runs xAI models on the payer's own Grok sign-in", () => {
  const BOB_PID = BOB.toLowerCase();
  const TOKEN = "fixture-grok-access-token-0000000000000001";
  const deps = (signIn: (principalId: string) => Promise<{ accessToken: string } | null>, key: (sub: string, provider: ModelProvider) => ProviderKeyResult = () => ({ ok: false, error: "no_key" })) => {
    const asked: string[] = [];
    return {
      asked,
      dataDir: "/data",
      resolveKey: async (sub: string, provider: ModelProvider) => key(sub, provider),
      invalidate: () => {},
      loginDir: (principalId: string) => `/data/principals/${principalId}/grok`,
      grokSignIn: async (principalId: string) => { asked.push(principalId); return signIn(principalId); },
    };
  };

  it("a person with a Grok sign-in and no key pays a pi turn with it", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`] })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB, provider: "xai", grokAccount: true });
    expect(paidByPerson(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`] })))).toBe(true);
  });

  it("only the payer's own sign-in: the owner's never pays for the person who speaks", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${OWNER}/grokAgent`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });

  it("OpenCode never takes a Grok sign-in (matrix: no)", () => {
    expect(resolveEngineAccess(input({ instance: OPENCODE, speaker: bob, signedIn: [`${BOB}/grokAgent`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });

  it("a refused sign-in no longer pays", () => {
    const expired = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`], subscriptionExpired: (pid, driver) => pid === BOB && driver === "grokAgent" });
    expect(resolveEngineAccess(expired)).toMatchObject({ ok: false, cause: "no_credentials" });
  });

  it("hands the access token as XAI_API_KEY in the payer's own pi home", async () => {
    const inp = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`] });
    const d = deps(async () => ({ accessToken: TOKEN }));
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), d);
    expect(out).toEqual({
      ok: true,
      plan: expect.objectContaining({ via: "subscription", grokAccount: true }),
      access: { via: "subscription", identity: `subscription:${BOB_PID}:xai`, environment: { XAI_API_KEY: TOKEN }, engineHome: join("/data", "principals", BOB_PID, "piAgent-key") },
    });
    expect(d.asked).toEqual([BOB_PID]);
    if (out.ok) expect(out.access.identity).not.toContain(TOKEN);
  });

  it("adds the sign-in beside the payer's other keys only when no xAI key of theirs pays", async () => {
    const keyed = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`], keys: ["SUB-BOB/anthropic"] });
    const out = await materializeEngineAccess(keyed, resolveEngineAccess(keyed), deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "sk-ant-test-bob-key-000001", fingerprint: "fa" })));
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fa+xai`, environment: { ANTHROPIC_API_KEY: "sk-ant-test-bob-key-000001", XAI_API_KEY: TOKEN } } });
    const both = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`], keys: ["SUB-BOB/xai"] });
    const d = deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "xai-test-bob-key-000001", fingerprint: "fx" }));
    const keyOnly = await materializeEngineAccess(both, resolveEngineAccess(both), d);
    expect(keyOnly).toMatchObject({ ok: true, access: { environment: { XAI_API_KEY: "xai-test-bob-key-000001" } } });
    if (keyOnly.ok) expect(d.asked).toEqual([]);
  });

  it("the Grok sign-in counts as holding xAI for the pi catalog", () => {
    expect([...piPayerProviders(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/grokAgent`] }), [])!].sort()).toEqual(["xai"]);
    expect([...piPayerProviders(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/claudeAgent`, `${BOB}/grokAgent`] }), [])!].sort()).toEqual(["anthropic", "xai"]);
  });
});

describe("#5524: pi runs OpenAI models on the payer's own Codex sign-in", () => {
  const BOB_PID = BOB.toLowerCase();
  const TOKEN = "sk-test-codex-access-token-000000000000000001";
  const deps = (signIn: (principalId: string) => Promise<{ accessToken: string; accountId?: string } | null>, key: (sub: string, provider: ModelProvider) => ProviderKeyResult = () => ({ ok: false, error: "no_key" })) => ({
    dataDir: "/data",
    resolveKey: async (sub: string, provider: ModelProvider) => key(sub, provider),
    invalidate: () => {},
    loginDir: (principalId: string) => `/data/principals/${principalId}/codex`,
    codexSignIn: async (principalId: string) => signIn(principalId),
  });

  it("a person with a Codex sign-in and no key pays a pi turn with it", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`] })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB, provider: "openai", codexAccount: true });
    expect(paidByPerson(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`] })))).toBe(true);
  });

  it("only the payer's own sign-in: the owner's never pays for the person who speaks", () => {
    expect(resolveEngineAccess(input({ instance: PI, speaker: bob, signedIn: [`${OWNER}/codex`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });

  it("hands the short token as PI_AUTH_CONTENT openai-codex oauth in the payer's own pi home", async () => {
    const inp = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`] });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps(async () => ({ accessToken: TOKEN, accountId: "acct_test" })));
    expect(out).toEqual({
      ok: true,
      plan: expect.objectContaining({ via: "subscription", codexAccount: true }),
      access: {
        via: "subscription",
        identity: `subscription:${BOB_PID}:codex`,
        environment: { PI_AUTH_CONTENT: piCodexAuthContent(TOKEN, "acct_test") },
        engineHome: join("/data", "principals", BOB_PID, "piAgent-key"),
      },
    });
    if (out.ok) {
      expect(out.access.identity).not.toContain(TOKEN);
      expect(out.access.environment?.PI_AUTH_CONTENT).toContain('"openai-codex"');
      expect(out.access.environment?.PI_AUTH_CONTENT).toContain(TOKEN);
    }
  });

  it("adds the sign-in beside the payer's keys only when no OpenAI key of theirs pays Codex", async () => {
    const keyed = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`], keys: ["SUB-BOB/xai"] });
    const out = await materializeEngineAccess(keyed, resolveEngineAccess(keyed), deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "xai-test-bob-000000000001", fingerprint: "fx" })));
    expect(out).toMatchObject({ ok: true, access: { via: "speaker-key", identity: `speaker-key:${BOB_PID}:fx+codex`, environment: { XAI_API_KEY: "xai-test-bob-000000000001", PI_AUTH_CONTENT: piCodexAuthContent(TOKEN) } } });
    const both = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`], keys: ["SUB-BOB/openai"] });
    const keyOnly = await materializeEngineAccess(both, resolveEngineAccess(both), deps(async () => ({ accessToken: TOKEN }), () => ({ ok: true, key: "sk-test-openai-bob-000001", fingerprint: "fo" })));
    expect(keyOnly).toMatchObject({ ok: true, access: { environment: { OPENAI_API_KEY: "sk-test-openai-bob-000001" } } });
    if (keyOnly.ok) expect(keyOnly.access.environment?.PI_AUTH_CONTENT).toBeUndefined();
  });

  it("the organization's OpenAI key keeps paying OpenAI models: no sign-in then", async () => {
    const withOrg = input({ instance: PI, speaker: bob, signedIn: [`${BOB}/codex`], keyBacked: true, orgKeyProviders: ["openai", "xai"] });
    expect(resolveEngineAccess(withOrg)).toEqual({ ok: true, via: "org-key", payer: "organization" });
    expect([...piPayerProviders(withOrg, ["openai", "xai"])!].sort()).toEqual(["openai", "xai"]);
  });
});

describe("#5524: OpenCode runs OpenAI models on the payer's own Codex sign-in", () => {
  const BOB_PID = BOB.toLowerCase();
  const TOKEN = "sk-test-opencode-codex-access-000000000001";
  const deps = (signIn: (principalId: string) => Promise<{ accessToken: string } | null>) => ({
    dataDir: "/data",
    resolveKey: async () => ({ ok: false as const, error: "no_key" as const }),
    invalidate: () => {},
    loginDir: (principalId: string) => `/data/principals/${principalId}/codex`,
    codexSignIn: async (principalId: string) => signIn(principalId),
  });

  it("a person with a Codex sign-in and no key pays an OpenCode turn with it", () => {
    expect(resolveEngineAccess(input({ instance: OPENCODE, speaker: bob, signedIn: [`${BOB}/codex`] })))
      .toEqual({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB, provider: "openai", codexAccount: true });
  });

  it("hands the short token as OPENCODE_AUTH_CONTENT openai oauth in the payer's own OpenCode home", async () => {
    const inp = input({ instance: OPENCODE, speaker: bob, signedIn: [`${BOB}/codex`] });
    const out = await materializeEngineAccess(inp, resolveEngineAccess(inp), deps(async () => ({ accessToken: TOKEN })));
    expect(out).toEqual({
      ok: true,
      plan: expect.objectContaining({ via: "subscription", codexAccount: true }),
      access: {
        via: "subscription",
        identity: `subscription:${BOB_PID}:codex`,
        environment: { OPENCODE_AUTH_CONTENT: openCodeCodexAuthContent(TOKEN) },
        engineHome: join("/data", "principals", BOB_PID, "opencodeGo-key"),
      },
    });
    if (out.ok) {
      expect(out.access.identity).not.toContain(TOKEN);
      expect(out.access.environment?.OPENCODE_AUTH_CONTENT).toContain('"openai"');
      expect(out.access.environment?.OPENCODE_AUTH_CONTENT).toContain('"type":"oauth"');
      expect(out.access.environment?.OPENCODE_AUTH_CONTENT).toContain(TOKEN);
    }
  });

  it("only the payer's own sign-in: the owner's never pays for the person who speaks", () => {
    expect(resolveEngineAccess(input({ instance: OPENCODE, speaker: bob, signedIn: [`${OWNER}/codex`] })))
      .toEqual({ ok: false, reason: "no_access", cause: "no_credentials", payer: "speaker", payerPrincipalId: BOB });
  });
});


describe("resolveGovernedEngineAccess (#5180)", () => {
  const policy = { aspect: "chat" as const };

  it("keeps today's order when no policy gate applies", () => {
    const base = input({ signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], keyBacked: true, policy });
    expect(resolveGovernedEngineAccess(base).plan).toMatchObject({ ok: true, via: "subscription" });
    expect(resolveGovernedEngineAccess(base).decision).toMatchObject({ ok: true, form: "personal-account" });
  });

  it("refuses a personal credential under Act as unless the person allowed it", () => {
    const acting = input({
      signedIn: [`${OWNER}/claudeAgent`],
      keys: ["SUB-OWNER/anthropic"],
      keyBacked: true,
      policy: { ...policy, actingAs: "service-desk" },
    });
    expect(resolveGovernedEngineAccess(acting).plan).toMatchObject({ ok: true, via: "org-key" });
    const onlyPersonal = input({ signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], policy: { ...policy, actingAs: "service-desk" } });
    expect(resolveGovernedEngineAccess(onlyPersonal).plan).toMatchObject({ ok: false, cause: "act_as_personal_refused" });
    const allowed = input({ signedIn: [`${OWNER}/claudeAgent`], policy: { ...policy, actingAs: "service-desk", allowPersonalWhenActingAs: true } });
    expect(resolveGovernedEngineAccess(allowed).plan).toMatchObject({ ok: true, via: "subscription" });
  });

  it("asks before an expired subscription falls back onto a paid key, and serves Claude, pi and OpenCode keys", () => {
    const expired = input({
      speaker: bob,
      signedIn: [`${BOB}/claudeAgent`],
      subscriptionExpired: () => true,
      keys: ["SUB-BOB/anthropic"],
      policy,
    });
    const asked = resolveGovernedEngineAccess(expired);
    expect(asked.plan).toMatchObject({ ok: false, cause: "confirm_paid_key" });
    expect(asked.decision).toMatchObject({ ok: false, reason: "confirm_paid_key", confirm: { from: "personal-account", to: "personal-key" } });
    const confirmed = resolveGovernedEngineAccess({ ...expired, policy: { ...policy, paidKeyConfirmed: true } });
    expect(confirmed.plan).toMatchObject({ ok: true, via: "speaker-key", provider: "anthropic" });

    for (const driver of ["claudeAgent", "piAgent", "opencodeGo"] as const) {
      const instance = driver === "claudeAgent"
        ? CLAUDE
        : driver === "piAgent"
          ? PI
          : { instanceId: "opencode", driver: "opencodeGo", installed: true };
      const provider = driver === "piAgent" ? "openai" : driver === "opencodeGo" ? "opencode" : "anthropic";
      const served = resolveGovernedEngineAccess(input({
        instance,
        speaker: bob,
        keys: [`SUB-BOB/${provider}`],
        policy: { aspect: "engine" },
      }));
      expect(served.decision).toMatchObject({ ok: true, form: "personal-key", aspect: "engine" });
    }
  });

  it("keeps server_engine_not_allowed when the organization has not given the engine", () => {
    const notGiven = input({ speaker: bob, keyBacked: true, serverEngineAllowed: () => false, policy });
    expect(resolveGovernedEngineAccess(notGiven).plan).toMatchObject({ ok: false, reason: "no_access", cause: "server_engine_not_allowed", payer: "speaker", payerPrincipalId: BOB });
  });

  it("turns personal keys off without turning a subscription off", () => {
    const off = input({ keys: ["SUB-OWNER/anthropic"], keyBacked: true, policy: { ...policy, personalKeysEnabled: false } });
    expect(resolveGovernedEngineAccess(off).plan).toMatchObject({ ok: true, via: "org-key" });
    const account = input({ signedIn: [`${OWNER}/claudeAgent`], keys: ["SUB-OWNER/anthropic"], policy: { ...policy, personalKeysEnabled: false } });
    expect(resolveGovernedEngineAccess(account).plan).toMatchObject({ ok: true, via: "subscription" });
  });

  // #5200: the organization's Grok account serves Grok engines after the
  // person's forms and before the organization's key.
  it("serves the organization's Grok account on a Grok engine before the org key (#5200)", () => {
    const org = { orgAccountAvailable: true, orgAccountPrincipalId: OWNER } as const;
    const bobGrok = input({ instance: GROK, speaker: bob, keyBacked: true, ...org, policy });
    expect(resolveEngineAccess(bobGrok)).toMatchObject({ ok: true, via: "org-account", payer: "organization" });
    expect(resolveGovernedEngineAccess(bobGrok).plan).toMatchObject({ ok: true, via: "org-account" });
    expect(resolveGovernedEngineAccess(bobGrok).decision).toMatchObject({ ok: true, form: "org-account" });
    // a personal Grok sign-in still wins
    const own = input({ instance: GROK, speaker: bob, signedIn: [`${BOB}/grokAgent`], keyBacked: true, ...org });
    expect(resolveEngineAccess(own)).toMatchObject({ ok: true, via: "subscription", payer: "speaker", payerPrincipalId: BOB });
    // Claude never takes a Grok org account
    expect(resolveEngineAccess(input({ keyBacked: true, ...org }))).toMatchObject({ ok: true, via: "org-key" });
    // not given the engine: refused, never the org key either when only the account is present
    const notGiven = input({ instance: GROK, speaker: bob, ...org, serverEngineAllowed: () => false, keyBacked: false });
    expect(resolveEngineAccess(notGiven)).toMatchObject({ ok: false, cause: "no_credentials" });
  });
});
