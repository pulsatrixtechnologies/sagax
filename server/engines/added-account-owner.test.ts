// #4435: an account a person adds beside a provider's first one is theirs.
// Proven where a turn picks its account and its sign-in folder
// (resolveEngineAccess, then materializeEngineAccess with the real
// per-person folders of PrincipalEngineLogins), not only in the lists.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LOGIN_MARKER, PrincipalEngineLogins } from "./principal-engine-logins.ts";
import { materializeEngineAccess, resolveEngineAccess, type EngineCredentialInput } from "./engine-credentials.ts";
import { accountOwnerOf, allowedWithOwnedAccounts, describeUnownedAccount, unownedAddedAccounts } from "./account-owner.ts";
import { addedAccount, providerFirstAccount, separateAccountInstance } from "../../shared/added-account.ts";
import { createOrgAdminEngines } from "../index-leaves/orgAdminEngines.ts";
import { PersonalProviderInstances } from "./personal-provider-instances.ts";
import type { TurnSpeaker } from "./engine-access.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { removeAddedAccount, type AddedAccountRemovalDeps } from "../routes/instances.ts";

const ALEX = "pr_00000000-0000-4000-8000-0000000000a1";
const SAM = "pr_00000000-0000-4000-8000-0000000000b2";
const ALEX_ACCOUNT = "claude-11111111-2222-4333-8444-555555555555";
const SAM_ACCOUNT = "chatgpt-66666666-7777-4888-9999-000000000000";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

function signIn(logins: PrincipalEngineLogins, person: string, driver: "claudeAgent" | "codex", instanceId: string): void {
  const dir = logins.loginDir(person, driver, "primary", instanceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LOGIN_MARKER), "{}");
}

function turn(logins: PrincipalEngineLogins, botOwner: string, speaker: TurnSpeaker, instanceId: string, driver: string, owner: string | undefined): EngineCredentialInput {
  return {
    identity: "perspicax",
    speaker,
    owner: { principalId: botOwner },
    instance: { instanceId, driver, installed: true, ...(owner ? { accountOwner: owner } : {}) },
    person: () => ({}),
    subscriptionSignedIn: (principalId, d, id) => logins.signedIn(principalId, d, "primary", id),
    hasKey: () => false,
    keyBacked: false,
  };
}

describe("#4435: an added account runs only for the person who added it", () => {
  it("a bot of one person never runs on the account another person added, whoever speaks", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-account-owner-"));
    dirs.push(dataDir);
    const logins = new PrincipalEngineLogins({ dataDir, instance: () => null });
    const instances = {
      [ALEX_ACCOUNT]: { driver: "claudeAgent", displayName: "Work", ownerPrincipalId: ALEX },
      [SAM_ACCOUNT]: { driver: "codex", displayName: "Plan", ownerPrincipalId: SAM, config: { authMode: "chatgpt-plan" } },
    };
    // Both people signed in to both entries: before #4435 every person saw
    // every added account and could sign in to it in their own folder.
    for (const person of [ALEX, SAM]) {
      signIn(logins, person, "claudeAgent", ALEX_ACCOUNT);
      signIn(logins, person, "codex", SAM_ACCOUNT);
    }
    const deps = { dataDir, resolveKey: async () => ({ ok: false as const, error: "no_key" as const }), invalidate: () => {}, loginDir: (p: string, d: "claudeAgent" | "codex" | "grokAgent" | "kimiAgent", id: string) => logins.loginDir(p, d, "primary", id) };
    const alexOwner = accountOwnerOf(instances, ALEX_ACCOUNT);
    expect(alexOwner).toBe(ALEX);

    // Sam's own bot, Sam speaking, on Alex's account: refused
    const samOnAlex = turn(logins, SAM, { origin: "person", principalId: SAM }, ALEX_ACCOUNT, "claudeAgent", alexOwner);
    expect(resolveEngineAccess(samOnAlex)).toMatchObject({ ok: false, reason: "no_access" });
    expect((await materializeEngineAccess(samOnAlex, resolveEngineAccess(samOnAlex), deps)).ok).toBe(false);
    // Sam's routine and a delegated hop of Sam's routine: refused too
    expect(resolveEngineAccess(turn(logins, SAM, { origin: "owner-routine" }, ALEX_ACCOUNT, "claudeAgent", alexOwner)).ok).toBe(false);
    expect(resolveEngineAccess(turn(logins, ALEX, { origin: "peer", routine: true, routinePayer: SAM } as TurnSpeaker, ALEX_ACCOUNT, "claudeAgent", alexOwner)).ok).toBe(false);
    // Alex's bot, Sam speaking (Sam pays): still not Sam's account to run on
    expect(resolveEngineAccess(turn(logins, ALEX, { origin: "person", principalId: SAM }, ALEX_ACCOUNT, "claudeAgent", alexOwner)).ok).toBe(false);

    // Alex's own turn runs on Alex's own sign-in folder of that account
    const alexOwn = turn(logins, ALEX, { origin: "person", principalId: ALEX }, ALEX_ACCOUNT, "claudeAgent", alexOwner);
    const ran = await materializeEngineAccess(alexOwn, resolveEngineAccess(alexOwn), deps);
    expect(ran.ok && ran.access.claudeConfigDir).toBe(join(dataDir, "principals", ALEX, "accounts", ALEX_ACCOUNT, "claude"));

    // and the other way round, on the plan account Sam added
    const samOwner = accountOwnerOf(instances, SAM_ACCOUNT);
    expect(resolveEngineAccess(turn(logins, ALEX, { origin: "person", principalId: ALEX }, SAM_ACCOUNT, "codex", samOwner)).ok).toBe(false);
    const samOwn = turn(logins, SAM, { origin: "person", principalId: SAM }, SAM_ACCOUNT, "codex", samOwner);
    const samRan = await materializeEngineAccess(samOwn, resolveEngineAccess(samOwn), deps);
    expect(samRan.ok && samRan.access.codexHome?.startsWith(join(dataDir, "principals", SAM, "accounts", SAM_ACCOUNT))).toBe(true);
  });

  it("an account without an owner stays the organization's, as before", () => {
    expect(accountOwnerOf({ claude: { driver: "claudeAgent" } }, "claude")).toBeUndefined();
    expect(accountOwnerOf({ "claude-work": { driver: "claudeAgent", ownerPrincipalId: "  " } }, "claude-work")).toBeUndefined();
    expect(accountOwnerOf(undefined, "claude")).toBeUndefined();
  });

  it("lists and pickers: an added account shows to its owner only", () => {
    const instances: Record<string, { driver: string; ownerPrincipalId?: string }> = { [ALEX_ACCOUNT]: { driver: "claudeAgent", ownerPrincipalId: ALEX }, claude: { driver: "claudeAgent" } };
    const personal = new PersonalProviderInstances({ load: async () => {}, remove: async () => {}, accountOwner: (id) => accountOwnerOf(instances, id) });
    expect(personal.visible(ALEX_ACCOUNT, ALEX)).toBe(true);
    expect(personal.visible(ALEX_ACCOUNT, ALEX.toUpperCase())).toBe(true);
    expect(personal.visible(ALEX_ACCOUNT, SAM)).toBe(false);
    expect(personal.visible(ALEX_ACCOUNT, "")).toBe(false);
    expect(personal.visible("claude", SAM)).toBe(true);
    expect(personal.ownerOf(ALEX_ACCOUNT)).toBe(ALEX);
  });

  it("accounts added before the owner was recorded: listed with their evidence, never given an owner", () => {
    const instances: Record<string, { driver: string; ownerPrincipalId?: string }> = {
      claude: { driver: "claudeAgent" },
      grok: { driver: "grokAgent" },
      [ALEX_ACCOUNT]: { driver: "claudeAgent", ownerPrincipalId: ALEX },
      [SAM_ACCOUNT]: { driver: "codex" },
      "claude-work": { driver: "claudeAgent" },
    };
    const cases = unownedAddedAccounts(instances, {
      signedInAt: (id) => id === SAM_ACCOUNT ? [{ principalId: ALEX, at: 1 }, { principalId: SAM.toUpperCase(), at: 5 }] : [],
      botOwners: (id) => id === SAM_ACCOUNT ? [SAM, SAM, ALEX] : [],
    }, addedAccount, separateAccountInstance);
    // the organization's first accounts and an owned account are not cases
    expect(cases.map((entry) => entry.instanceId)).toEqual([SAM_ACCOUNT, "claude-work"]);
    expect(cases[0]).toEqual({ instanceId: SAM_ACCOUNT, driver: "codex", ownFolder: true, signedInBy: [SAM, ALEX], usedByBotsOf: [ALEX, SAM].sort() });
    expect(cases[1]).toMatchObject({ instanceId: "claude-work", ownFolder: false, signedInBy: [], usedByBotsOf: [] });
    // nothing is guessed: the entries keep no owner
    expect(accountOwnerOf(instances, SAM_ACCOUNT)).toBeUndefined();
    expect(describeUnownedAccount(cases[0]!)).toContain(`signed in by ${SAM}, ${ALEX}`);
    expect(describeUnownedAccount(cases[1]!)).toContain("nobody signed in");
  });

  it("the engines an administrator gives everyone leave out a person's added account", () => {
    const instances: Record<string, { driver: string; ownerPrincipalId?: string }> = { claude: { driver: "claudeAgent" }, [ALEX_ACCOUNT]: { driver: "claudeAgent", ownerPrincipalId: ALEX } };
    const personal = new PersonalProviderInstances({ load: async () => {}, remove: async () => {}, accountOwner: (id) => accountOwnerOf(instances, id) });
    const entries = Object.entries(instances).map(([instanceId, entry]) => ({ instanceId, shadow: { driverKind: entry.driver } }));
    const engines = createOrgAdminEngines(() => ({
      cfg: {}, providerConfigs: () => instances, personalProviderInstances: personal,
      registry: { entries: () => entries, get: () => undefined, access: () => "subscription" },
      engineDisplayName: () => "", engineInstalled: () => true, driverKeyBacked: () => false, voiceCredential: () => undefined,
    }))();
    expect(engines.map((engine: { id: string }) => engine.id)).toEqual(["claude"]);
  });

  it("removing an added account, from a person's own list or the instance routes, never waits for a turn in flight on it", async () => {
    const cfg = { instances: { claude: { driver: "claudeAgent" }, [ALEX_ACCOUNT]: { driver: "claudeAgent", ownerPrincipalId: ALEX } } } as unknown as AddedAccountRemovalDeps["cfg"];
    const steps: string[] = [];
    let configBusy = false;
    const deps: AddedAccountRemovalDeps = {
      cfg,
      saveConfig: () => {},
      getProviderConfigBusy: () => configBusy,
      setProviderConfigBusy: (value) => { configBusy = value; },
      providerInstancesChanging: { add: () => {}, delete: () => {} },
      persistProviderInstance: async (_id, instances) => { steps.push("persist"); (cfg as { instances: unknown }).instances = instances; },
      bots: () => [{ id: "bot-1", busy: false, modelSelection: { instanceId: "claude", model: "m" } }] as never,
      tasks: () => [{ threadId: "t-1" }] as never,
      // a turn runs on the account right now
      threadBusy: () => true,
      botForThread: () => ({ modelSelection: { instanceId: ALEX_ACCOUNT, model: "m" } }),
      activeGroupTurnForBot: () => false,
    };
    const beforeRemove = async () => { steps.push("move and sign out"); };
    expect(await removeAddedAccount(deps, ALEX_ACCOUNT, { beforeRemove })).toEqual({ ok: true });
    expect(steps).toEqual(["move and sign out", "persist"]);
    expect(Object.keys((cfg as { instances: object }).instances)).not.toContain(ALEX_ACCOUNT);
    expect(configBusy).toBe(false);
  });
});

describe("an added account follows its provider's first one in the allowed list (#4435)", () => {
  const uuid = "0f2b7c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b";
  const instances = {
    claude: { driver: "claudeAgent" },
    [`claude-${uuid}`]: { driver: "claudeAgent", ownerPrincipalId: "alex" },
    [`chatgpt-${uuid}`]: { driver: "codex", ownerPrincipalId: "sam" },
    "claude-work": { driver: "claudeAgent" },
  };
  it("names the provider's first account", () => {
    expect(providerFirstAccount(`claude-${uuid}`, "claudeAgent")).toBe("claude");
    expect(providerFirstAccount(`chatgpt-${uuid}`, "codex")).toBe("chatgpt");
    expect(providerFirstAccount(`antigravity-${uuid}`, "antigravityAgent")).toBe("antigravity");
    expect(providerFirstAccount("claude-work", "claudeAgent")).toBe("claude");
    expect(providerFirstAccount("claude", "claudeAgent")).toBeUndefined();
    expect(providerFirstAccount("grok", "grokAgent")).toBeUndefined();
  });
  it("adds each owned account whose provider is allowed, never an unowned one", () => {
    expect(allowedWithOwnedAccounts(["grok", "claude"], instances)).toEqual(["grok", "claude", `claude-${uuid}`]);
    expect(allowedWithOwnedAccounts(["chatgpt"], instances)).toEqual(["chatgpt", `chatgpt-${uuid}`]);
    expect(allowedWithOwnedAccounts(["grok"], instances)).toEqual(["grok"]);
    expect(allowedWithOwnedAccounts([], instances)).toEqual([]);
    expect(allowedWithOwnedAccounts(null, instances)).toBeNull();
  });
});
