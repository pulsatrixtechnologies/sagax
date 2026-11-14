import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotCapabilityStore } from "../bots/bot-capability-store.ts";
import { migrateCapabilitiesStores } from "../capabilities/capabilities-store-migration.ts";
import { InstallationCapabilityStore } from "../capabilities/installation-capability-store.ts";
import { resolveVaultKey } from "../mcp/mcp-oauth.ts";
import { GithubCredentials, LOCAL_OWNER, ORG_OWNER, parseCredentialChange, WORKSPACE_SCOPE } from "./github-credentials.ts";
import { MarketplaceTokens } from "../plugins/marketplace-tokens.ts";
import { OrgGithubTokens } from "../org/org-github-tokens.ts";
import { PersonConnections } from "../people/person-connections.ts";

const RELEASE_PERSON = "pr_00000000-0000-4000-8000-000000000001";

const ORG_A = "fake-org-alpha-token-1111";
const ORG_B = "fake-org-bravo-token-2222";
const WS = "fake-workspace-token-3333";
const BOT = "fake-bot-token-4444";
const BOT_SAME = "fake-bot-token-4444";
const MINE = "fake-person-token-5555";
const SECRETS = [ORG_A, ORG_B, WS, BOT, MINE];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const key = { kind: "key" as const, key: Buffer.alloc(32, 7) };

function open() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-gh-cred-"));
  dirs.push(dir);
  return { dir, store: new GithubCredentials(dir, () => key) };
}

function redacted(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text.includes(secret)).toBe(false);
}

/** The three former files, as an organization server had them. */
function legacy(dir: string) {
  const org = new OrgGithubTokens(dir, () => key);
  org.change({ op: "add", label: "Other organization", token: ORG_A });
  org.change({ op: "add", label: "Repository group", token: ORG_B });
  const markets = new MarketplaceTokens(dir, () => key);
  markets.set(WORKSPACE_SCOPE, "example-org/private-market", WS, "p-admin");
  markets.set("bot-a", "example-org/team-market", BOT, "p-alice");
  markets.set("bot-b", "example-org/other-market", BOT_SAME);
  return { org, markets, orgIds: org.list().map((entry) => entry.id) };
}

function migrate(dir: string, store: GithubCredentials) {
  return store.migrate({
    orgTokens: new OrgGithubTokens(dir, () => key),
    marketplaceTokens: new MarketplaceTokens(dir, () => key),
    workspaceOwner: ORG_OWNER,
    ownerOfBot: (botId) => (botId === "bot-b" ? "p-alice" : undefined),
    botName: (botId) => (botId === "bot-a" ? "Rocket" : "Atlas"),
    fallbackOwner: ORG_OWNER,
  });
}

describe("one list of GitHub credentials", () => {
  it("migrates the organization's, the workspace's and each bot's tokens without loss", () => {
    const { dir, store } = open();
    const { orgIds } = legacy(dir);
    const result = migrate(dir, store);
    expect(result.imported).toBe(4); // two org tokens, the workspace's, one shared bot token
    // the organization's keep their ids and labels
    expect(store.list("p-nobody", { org: true }).filter((entry) => entry.owner === "org").map((entry) => [entry.id, entry.label])).toEqual(
      expect.arrayContaining([[orgIds[0], "Other organization"], [orgIds[1], "Repository group"], [expect.any(String), "example-org/private-market"]]),
    );
    // every marketplace reads with the same token as before
    expect(store.get(WORKSPACE_SCOPE, "example-org/private-market")).toBe(WS);
    expect(store.get("bot-a", "example-org/team-market")).toBe(BOT);
    expect(store.get("bot-b", "example-org/other-market")).toBe(BOT_SAME);
    // the same token of the same person is one credential, picked twice
    const mine = store.list("p-alice", { org: false });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ owner: "mine", onlyWhereChosen: true, chosenBy: 2, label: "example-org/team-market (Rocket)" });
    // a former marketplace token is never tried by Automatic elsewhere
    expect(store.automatic("p-alice")).toEqual([]);
    expect(store.automatic(ORG_OWNER).map((entry) => entry.token).sort()).toEqual([ORG_A, ORG_B].sort());
    // the old files are gone, the new one is sealed
    expect(existsSync(join(dir, "org-github-tokens.enc"))).toBe(false);
    expect(existsSync(join(dir, "marketplace-tokens.enc"))).toBe(false);
    const raw = readFileSync(join(dir, "github-credentials.enc"), "utf8");
    for (const secret of SECRETS) expect(raw.includes(secret)).toBe(false);
  });

  it("is idempotent: a second run, or a run on a new process, adds nothing", () => {
    const { dir, store } = open();
    legacy(dir);
    migrate(dir, store);
    const before = JSON.stringify(store.list(ORG_OWNER, { org: false }));
    expect(migrate(dir, store).imported).toBe(0);
    const again = new GithubCredentials(dir, () => key);
    expect(migrate(dir, again).imported).toBe(0);
    expect(JSON.stringify(again.list(ORG_OWNER, { org: false }))).toBe(before);
    // an old file left behind by a crash after the write is taken in once only
    const markets = new MarketplaceTokens(dir, () => key);
    markets.set("bot-a", "example-org/team-market", BOT, "p-alice");
    expect(migrate(dir, again).imported).toBe(0);
    expect(existsSync(join(dir, "marketplace-tokens.enc"))).toBe(false);
  });

  it("keeps an old file when it cannot be read, and never marks it done", () => {
    const { dir, store } = open();
    legacy(dir);
    const broken = { list: () => { throw new Error("unreadable"); }, tokenFor: () => undefined, discard: () => { throw new Error("must not discard"); } };
    expect(() => store.migrate({ orgTokens: broken, workspaceOwner: ORG_OWNER, ownerOfBot: () => undefined, fallbackOwner: ORG_OWNER })).toThrow();
    expect(existsSync(join(dir, "org-github-tokens.enc"))).toBe(true);
    expect(migrate(dir, store).imported).toBe(4);
  });

  it("an account and a credential sealed by the last release read back at this version's start over the same data folder (#4155)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-gh-cred-"));
    dirs.push(dir);
    // server/fixtures/sealed-release-0.8.106: written by the pulsa-v0.8.106
    // tag's own code (PersonConnections.setGithub, GithubCredentials.change)
    // over a headless data folder whose key file held this test key.
    cpSync(join(import.meta.dirname, "../fixtures/sealed-release-0.8.106"), dir, { recursive: true });
    writeFileSync(join(dir, "mcp-oauth.key"), `${key.key.toString("hex")}\n`, { mode: 0o600 });
    // This version's start: the store move runs first, then each store opens
    // with the key it resolves again from the same folder.
    migrateCapabilitiesStores({
      dataDir: dir,
      bots: new BotCapabilityStore(dir),
      installation: new InstallationCapabilityStore(dir, () => resolveVaultKey(dir, {})),
      botIds: () => [],
      personIds: () => [RELEASE_PERSON],
    });
    expect(new PersonConnections(dir, () => resolveVaultKey(dir, {})).github(RELEASE_PERSON)).toMatchObject({ token: "github-fixture-person", login: "alice", via: "device" });
    const released = new GithubCredentials(dir, () => resolveVaultKey(dir, {}));
    expect(released.automatic(RELEASE_PERSON).map((entry) => entry.token)).toEqual(["github-fixture-credential"]);
  });

  it("a credential sealed on a start whose key arrives late reads back once it is there (#4155)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-gh-cred-"));
    dirs.push(dir);
    const before = new GithubCredentials(dir, () => resolveVaultKey(dir, {}));
    before.change("p-alice", { op: "add", label: "Mine", token: MINE });
    const orgBefore = new OrgGithubTokens(dir, () => resolveVaultKey(dir, {}));
    orgBefore.change({ op: "add", label: "Other organization", token: ORG_A });
    // A start whose key arrives late (a desktop key store busy at launch):
    // nothing is lost and the move of the former file retries once it is there.
    let source: ReturnType<typeof resolveVaultKey> = { kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." };
    const late = new GithubCredentials(dir, () => source);
    const orgLate = new OrgGithubTokens(dir, () => source);
    const input = { orgTokens: orgLate, workspaceOwner: ORG_OWNER, ownerOfBot: () => undefined, fallbackOwner: ORG_OWNER };
    expect(() => late.migrate(input)).toThrow();
    expect(() => orgLate.list()).toThrow();
    source = resolveVaultKey(dir, {});
    expect(late.migrate(input).imported).toBe(1);
    expect(late.automatic("p-alice").map((entry) => entry.token)).toEqual([MINE]);
    expect(late.automatic(ORG_OWNER).map((entry) => entry.token)).toEqual([ORG_A]);
  });

  it("a list sealed with a key that is gone is kept beside when a credential is added again (#4155)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-gh-cred-"));
    dirs.push(dir);
    new GithubCredentials(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) })).change("p-alice", { op: "add", label: "Lost", token: ORG_A });
    const store = new GithubCredentials(dir, () => key);
    expect(store.unreadable()).toBe("sealed");
    expect(() => store.list("p-alice", { org: false })).toThrow(expect.objectContaining({ code: "store_sealed" }));
    store.change("p-alice", { op: "add", label: "Mine", token: MINE });
    expect(store.unreadable()).toBeNull();
    expect(store.automatic("p-alice").map((entry) => entry.token)).toEqual([MINE]);
    const kept = readdirSync(dir).filter((name) => name.startsWith("github-credentials.enc.unreadable-"));
    expect(kept).toHaveLength(1);
    // The file kept beside still opens with its own key.
    renameSync(join(dir, kept[0]!), join(dir, "github-credentials.enc"));
    expect(new GithubCredentials(dir, () => ({ kind: "key", key: Buffer.alloc(32, 3) })).automatic("p-alice").map((entry) => entry.token)).toEqual([ORG_A]);
  });

  it("a list this start could not read is asked again, never taken for sealed (#4155)", () => {
    const { dir, store } = open();
    store.change("p-alice", { op: "add", label: "Mine", token: MINE });
    const file = join(dir, "github-credentials.enc");
    chmodSync(file, 0o000);
    const later = new GithubCredentials(dir, () => key);
    expect(() => later.automatic("p-alice")).toThrow(expect.objectContaining({ code: "store_unavailable" }));
    expect(() => later.change("p-alice", { op: "add", label: "Other", token: ORG_B })).toThrow(expect.objectContaining({ code: "store_unavailable" }));
    chmodSync(file, 0o600);
    expect(later.automatic("p-alice").map((entry) => entry.token)).toEqual([MINE]);
    expect(readdirSync(dir).filter((name) => name.includes("unreadable"))).toEqual([]);
  });

  it("a marketplace picks a credential, or goes back to Automatic", () => {
    const { store } = open();
    store.change("p-alice", { op: "add", label: "My company", token: MINE });
    const [entry] = store.list("p-alice", { org: true });
    store.choose("bot-a", "example-org/team-market", entry!.id);
    expect(store.get("bot-a", "example-org/team-market")).toBe(MINE);
    expect(store.describe("bot-a", "example-org/team-market", "p-alice").chosen).toEqual({ id: entry!.id, label: "My company", owner: "mine" });
    expect(store.describe("bot-a", "example-org/team-market", "p-bob").chosen?.owner).toBe("other");
    store.choose("bot-a", "example-org/team-market", null);
    expect(store.get("bot-a", "example-org/team-market")).toBeUndefined();
    expect(store.describe("bot-a", "example-org/team-market", "p-alice")).toEqual({});
    // removing a picked credential sends its marketplaces back to Automatic
    store.choose("bot-a", "example-org/team-market", entry!.id);
    store.change("p-alice", { op: "remove", id: entry!.id });
    expect(store.chosen("bot-a", "example-org/team-market")).toBeUndefined();
  });

  it("remembers which credential read a marketplace, by label, never the token", () => {
    const { store } = open();
    store.change(ORG_OWNER, { op: "add", label: "Other organization", token: ORG_A });
    const [org] = store.list("p-nobody", { org: true });
    store.noteUsed("bot-a", "example-org/team-market", { via: "credential", credential: org!.id });
    const view = store.describe("bot-a", "example-org/team-market", "p-alice");
    expect(view.used).toMatchObject({ via: "credential", label: "Other organization" });
    store.noteUsed("bot-a", "example-org/team-market", { via: "person", login: "alice" });
    expect(store.describe("bot-a", "example-org/team-market", "p-alice").used).toMatchObject({ via: "person", login: "alice" });
    redacted(store.describe("bot-a", "example-org/team-market", "p-alice"));
  });

  it("each person sees their own and the organization's, never another person's, and no token", () => {
    const { store } = open();
    store.change("p-alice", { op: "add", label: "Alice's", token: MINE });
    store.change(ORG_OWNER, { op: "add", label: "Shared", token: ORG_A });
    store.change(LOCAL_OWNER, { op: "add", label: "Solo", token: ORG_B });
    const alice = store.list("p-alice", { org: true });
    expect(alice.map((entry) => [entry.label, entry.owner])).toEqual([["Alice's", "mine"], ["Shared", "org"]]);
    expect(store.list("p-bob", { org: true }).map((entry) => entry.label)).toEqual(["Shared"]);
    expect(alice.map((entry) => entry.hint).sort()).toEqual(["1111", "5555"]);
    redacted(alice);
    // another owner's credential is not found
    expect(() => store.change("p-bob", { op: "remove", id: alice[0]!.id })).toThrow(/No credential/);
  });

  it("a migrated marketplace token stays picked by its marketplaces, and goes with the last of them", () => {
    const { dir, store } = open();
    legacy(dir);
    migrate(dir, store);
    const [kept] = store.list("p-alice", { org: false });
    expect(kept).toMatchObject({ onlyWhereChosen: true, chosenBy: 2 });
    // the marketplace left one bot: the other still reads with it
    store.unpick("bot-a", "example-org/team-market");
    expect(store.get("bot-b", "example-org/other-market")).toBe(BOT_SAME);
    expect(store.list("p-alice", { org: false })).toEqual([expect.objectContaining({ id: kept!.id, chosenBy: 1 })]);
    // and the last one: nothing keeps it any more
    store.unpick("bot-b", "example-org/other-market");
    expect(store.list("p-alice", { org: false })).toEqual([]);
  });

  it("parses one explicit change and refuses a rename that carries a token", () => {
    expect(parseCredentialChange({ op: "add", label: " Mine ", token: ` ${MINE} ` })).toEqual({ scope: "mine", change: { op: "add", label: "Mine", token: MINE } });
    expect(parseCredentialChange({ op: "add", label: "Shared", token: MINE, scope: "org" }).scope).toBe("org");
    expect(() => parseCredentialChange({ op: "rename", id: "gt_0000000000000001", label: "x", token: MINE })).toThrow(/separate step/);
    expect(() => parseCredentialChange({ op: "add", label: "x", token: "short" })).toThrow(/single line/);
  });
});
