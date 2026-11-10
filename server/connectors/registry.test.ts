// #3344 (part of #3286): one registry of a person's connectors over all of
// their own sign-ins, kept on disk by name and state.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isPrincipalId } from "../auth/principals.ts";
import type { ProviderAuthenticationStatus } from "../contracts.ts";
import { grokAccountReach, type GrokAccountReach } from "../drivers/acp/grok-tool-catalog.ts";
import { LOGIN_MARKER, PrincipalEngineLogins, secondLoginSupported, type LoginController } from "../engines/principal-engine-logins.ts";
import { separateAccountInstance } from "../engines/separate-account.ts";
import { ClaudeAiConnectorInventory, connectorPrincipalFor, engineConnectorsPrompt } from "../harness-connectors.ts";
import { createConnectorPlanForTurn, grokCloudConnectorsForTurn, relayAddsAccountConnectors, turnLoadsAccountConnectors } from "./turn-plan.ts";
import { createConnectorsElsewhereFor } from "../index-leaves/connectorsElsewhereFor.ts";
import { createConnectorSetupStore } from "../index-leaves/connectorSetupStore.ts";
import { createEngineReachFor } from "../index-leaves/engineReachFor.ts";
import { chooseRelayEngine, relayAccountLabel, type RelayEngine } from "../run-with-engine.ts";
import personalGateway from "../testing/grok-gateway-mcp-list.json" with { type: "json" };
import teamGateway from "../testing/grok-gateway-team-mcp-list.json" with { type: "json" };
import { chatgptAppsProvider } from "./providers/chatgpt-apps.ts";
import { claudeAiProvider } from "./providers/claude-ai.ts";
import { grokComProvider } from "./providers/grok-com.ts";
import { ConnectorRegistry, CONNECTORS_DIR } from "./registry.ts";
import type { ConnectorAccountSlot } from "./types.ts";

const A = "pr_00000000-0000-4000-8000-00000000000a";
const B = "pr_00000000-0000-4000-8000-00000000000b";
const ADDED = "grok-33333333-3333-4333-8333-333333333333";
const DEFAULT = "default";

/** An empty gateway answer: a sign-in with no grok.com connector. */
const NO_GATEWAY = { sessionMcpResolved: true, servers: [] };

type Answers = Record<string, unknown>;

/** A server's sign-ins and registry as index.ts wires them, on fakes: the
 * sign-in flows end at once, the Grok probe answers per folder, the Claude
 * CLI answers per config folder. `memory` false: nothing in this process's
 * memory (a restart), every probe and CLI call counted. */
function server(dataDir: string, options: { grok?: Answers; claude?: Record<string, string>; memory?: boolean } = {}) {
  const probes: string[] = [];
  const claudeCalls: string[] = [];
  const made: Array<{ finish: () => Promise<void> }> = [];
  let registry: ConnectorRegistry;
  const logins = new PrincipalEngineLogins({
    dataDir,
    now: () => 5_000,
    instance: (id) => (id === "claude" ? { driver: "claudeAgent", cli: "claude" }
      : id === "codex" ? { driver: "codex", cli: "codex" }
        : id === "grok" || id.startsWith("grok-") ? { driver: "grokAgent", cli: "grok" } : null),
    controller: ({ onAuthenticated }) => {
      let phase: ProviderAuthenticationStatus["phase"] = "waiting";
      made.push({ finish: async () => { phase = "succeeded"; await onAuthenticated(); } });
      const controller: LoginController = {
        start: async () => ({ flowId: `flow-${made.length}`, phase: "waiting", kind: "device", url: "https://example.test/device", code: "TEST-1" }) as never,
        get: async (flowId) => ({ flowId, phase }) as never,
        cancel: async () => {},
        signOut: async () => {},
      };
      return controller;
    },
    probeReach: async (_cli, env) => { probes.push(env.HOME ?? ""); return options.grok?.[env.HOME ?? ""] ?? null; },
    onConnectorAccountChanged: (person, change) => { void registry.followSignIn(person, change); },
  });
  const inventory = new ClaudeAiConnectorInventory({
    run: async ({ args, env }) => {
      claudeCalls.push(args.join(" "));
      const listing = options.claude?.[env.CLAUDE_CONFIG_DIR ?? ""];
      if (args[0] === "auth") return JSON.stringify(listing === undefined ? { loggedIn: false } : { loggedIn: true, authMethod: "claude.ai" });
      return listing ?? "";
    },
  });
  const folder = (driver: string, accountId: string) => (accountId === DEFAULT ? (driver === "claudeAgent" ? "claude" : "grok") : accountId);
  const own = (id: string) => (id === DEFAULT ? undefined : id);
  const signedIn = (principalId: string, driver: "claudeAgent" | "grokAgent", slot: ConnectorAccountSlot) =>
    logins.signedInAccounts(principalId, driver, slot).map((id) => id ?? DEFAULT);
  registry = new ConnectorRegistry({
    dataDir,
    accountInstance: (_provider, instanceId) => (separateAccountInstance(instanceId) ? instanceId : DEFAULT),
    providers: [
      claudeAiProvider({
        instances: (principalId) => (isPrincipalId(principalId) ? signedIn(principalId, "claudeAgent", "primary") : []),
        account: (principalId, accountId) => {
          if (!logins.signedIn(principalId, "claudeAgent", "primary", own(accountId))) return { unavailable: "not_signed_in" };
          const dir = logins.loginDir(principalId, "claudeAgent", "primary", own(accountId));
          return { cli: "claude", env: { CLAUDE_CONFIG_DIR: dir }, key: `person:${principalId}:${accountId}` };
        },
        inventory,
        label: () => "Claude",
      }),
      grokComProvider({
        signIns: (principalId) => (["primary", "second"] as const).flatMap((slot) => signedIn(principalId, "grokAgent", slot).map((instanceId) => ({ instanceId, slot }))),
        home: (principalId, accountId, slot) => logins.loginDir(principalId, "grokAgent", slot, own(accountId)),
        kind: (principalId, accountId, slot) => {
          const kind = logins.grokAccountIdentity(principalId, slot, own(accountId))?.kind;
          return kind === "personal" || kind === "team" ? kind : undefined;
        },
        label: (_accountId, slot, kind) => (slot === "second" ? relayAccountLabel("Grok", kind) : "Grok"),
        probe: async (principalId, accountId, slot, force) => { await logins.readReach(principalId, folder("grokAgent", accountId), slot, force); },
        ...(options.memory === false ? { reach: (): GrokAccountReach | undefined => undefined } : {}),
      }),
      chatgptAppsProvider(),
    ],
  });
  const signIn = async (principalId: string, instanceId: string, slot: ConnectorAccountSlot = "primary", principalType?: "User" | "Team") => {
    const session = `session-${made.length}`;
    await logins.start(principalId, instanceId, session, slot);
    if (principalType) {
      const home = logins.loginDir(principalId, "grokAgent", slot, separateAccountInstance(instanceId) ? instanceId : undefined);
      mkdirSync(join(home, ".grok"), { recursive: true });
      // the CLI's login record holds the address: never copied to the registry
      writeFileSync(join(home, ".grok", "auth.json"), JSON.stringify({ "https://auth.example.test::p-1": { principal_type: principalType, email: "someone@example.test" } }));
    }
    await made.at(-1)!.finish();
    await settle();
    return session;
  };
  return { logins, registry, inventory, probes, claudeCalls, signIn };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const home = (dataDir: string, principalId: string, folder: string) => join(dataDir, "principals", principalId, folder);
const names = (registry: ConnectorRegistry, principalId: string) =>
  registry.accounts(principalId).map((account) => [account.label, account.instanceId, account.slot, account.connectors.map((entry) => entry.name)]);

describe("connector registry (#3344)", () => {
  it("lists only the person's own sign-ins and never keeps another person's", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
    const { registry, signIn } = server(dataDir, {
      grok: { [home(dataDir, A, "grok")]: personalGateway, [home(dataDir, B, "grok")]: teamGateway },
      claude: { [home(dataDir, B, "claude")]: "claude.ai Docs Hub: https://docs.example.test/mcp - ✓ Connected\n" },
    });
    await signIn(A, "grok", "primary", "User");
    await signIn(B, "grok", "primary", "Team");
    await signIn(B, "claude");
    expect(names(registry, A)).toEqual([["Grok", DEFAULT, "primary", ["Microsoft Teams", "Outlook (Exchange)", "Automations", "Docs Hub"]]]);
    expect(names(registry, B).map(([label]) => label)).toEqual(["Claude", "Grok"]);
    // a read of someone else's sign-in is never kept for this person
    const theirs = registry.account(B, { provider: "claude-ai", instanceId: "claude", slot: "primary" })!;
    registry.record(A, theirs);
    expect(registry.account(A, { provider: "claude-ai", instanceId: "claude", slot: "primary" })).toBeUndefined();
    // each person's own file; nobody's holds the address of the login record, nor any other field
    const files = readdirSync(join(dataDir, CONNECTORS_DIR)).sort();
    expect(files).toEqual([`${A}.json`, `${B}.json`]);
    const a = readFileSync(join(dataDir, CONNECTORS_DIR, `${A}.json`), "utf8");
    expect(a).not.toMatch(/@|example\.test|https?:/);
    expect(Object.keys(JSON.parse(a).accounts[0]).sort()).toEqual(["at", "auth", "connectors", "driver", "gateway", "instanceId", "key", "kind", "label", "provider", "slot"]);
  });

  it("lists two Grok sign-ins and an added account, each with its own connectors, and forgets one at sign-out", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
    const { registry, logins, signIn } = server(dataDir, {
      grok: {
        [home(dataDir, A, "grok")]: teamGateway,
        [home(dataDir, A, "grok-2")]: personalGateway,
        [join(dataDir, "principals", A, "accounts", ADDED, "grok")]: NO_GATEWAY,
      },
    });
    await signIn(A, "grok", "primary", "Team");
    const secondSession = await signIn(A, "grok", "second", "User");
    await signIn(A, ADDED, "primary", "User");
    expect(names(registry, A)).toEqual([
      ["Grok", DEFAULT, "primary", ["Microsoft Teams", "Outlook (Exchange)", "Automations"]],
      ["Grok", ADDED, "primary", []],
      ["Grok (personal account)", DEFAULT, "second", ["Microsoft Teams", "Outlook (Exchange)", "Automations", "Docs Hub"]],
    ]);
    const second = registry.account(A, { provider: "grok-com", instanceId: "grok", slot: "second" })!;
    expect(second.kind).toBe("personal");
    // the tool names use_tool takes, by connector
    expect(second.connectors.find((entry) => entry.id === "microsoft-teams")!.tools.map((tool) => tool.id)).toContain("cursor__user-Teams-list_5fchats___10");
    // signing out of the second sign-in forgets it, and only it
    await logins.signOut(A, "grok", secondSession, "second");
    await settle();
    expect(names(registry, A).map(([label, instanceId, slot]) => [label, instanceId, slot])).toEqual([["Grok", DEFAULT, "primary"], ["Grok", ADDED, "primary"]]);
    expect(grokAccountReach(home(dataDir, A, "grok-2"))).toBeUndefined();
    // the console's Reset access forgets them all
    logins.clearAll(A);
    await settle();
    expect(registry.accounts(A)).toEqual([]);
    expect(readdirSync(join(dataDir, CONNECTORS_DIR))).toEqual([]);
  });

  it("knows the same connectors right after a restart, before any CLI call", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
    const first = server(dataDir, {
      grok: { [home(dataDir, A, "grok")]: personalGateway },
      claude: { [home(dataDir, A, "claude")]: "claude.ai Docs Hub: https://docs.example.test/mcp - ✓ Connected\nclaude.ai Mail: https://mail.example.test/mcp - ! Needs authentication\n" },
    });
    await first.signIn(A, "grok", "primary", "User");
    await first.signIn(A, "claude");
    const before = first.registry.accounts(A);
    expect(before.map((account) => account.label)).toEqual(["Claude", "Grok"]);
    expect(before[0]!.connectors.map((entry) => [entry.name, entry.state])).toEqual([["Docs Hub", "connected"], ["Mail", "needs-sign-in"]]);

    // a new process: nothing in memory, every CLI call counted
    const after = server(dataDir, { memory: false });
    expect(after.registry.accounts(A)).toEqual(before);
    expect(after.probes).toEqual([]);
    expect(after.claudeCalls).toEqual([]);
  });

  it("tells a bot with default settings of the person's Grok sign-ins", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
    const { registry, signIn } = server(dataDir, {
      grok: { [home(dataDir, A, "grok")]: teamGateway, [home(dataDir, A, "grok-2")]: personalGateway },
    });
    await signIn(A, "grok", "primary", "Team");
    await signIn(A, "grok", "second", "User");
    const engine = (instanceId: string, driverKind: string) => ({ instanceId, driverKind, enabled: true, adapter: { capabilities: { withholdsHostTools: true } } });
    const instances = [engine("claude", "claudeAgent"), engine("grok", "grokAgent")];
    const host: Record<string, unknown> = {
      IDENTITY: { kind: "perspicax" },
      connectorRegistry: registry,
      registry: { instances: () => instances },
      turnSlotFor: () => "primary",
      connectorPrincipalFor,
      isPrincipalId,
      secondLoginSupported,
      relayAccountLabel,
      // a bot with default settings: no grokAccountConnectors opt-in
      accountConnectorInput: (_bot: unknown, instance: { instanceId: string; driverKind: string }, speaker: unknown) => ({
        identity: "perspicax", restrictedByPolicy: false, driver: instance.driverKind, instanceId: instance.instanceId,
        via: "subscription", payerPrincipalId: A, speaker, ownerPrincipalId: A, localPrincipalId: "",
      }),
      turnPayerPrincipal: () => A,
      withholdHostToolsFor: () => true,
      grokAccountKindFor: () => undefined,
      engineDisplayName: (instance: { driverKind: string }) => (instance.driverKind === "claudeAgent" ? "Claude" : "Grok"),
      claudeAccountForPrincipal: () => ({ unavailable: "not_signed_in" }),
    };
    // the one connector plan per turn (lot L2), read by every reader
    const planned = (h: Record<string, unknown>) => Object.assign(h, {
      connectorPlanForTurn: createConnectorPlanForTurn({
        accountConnectorInput: (...args: unknown[]) => (h.accountConnectorInput as (...a: unknown[]) => Parameters<typeof turnLoadsAccountConnectors>[0])(...args),
        withholdHostToolsFor: () => true,
      }),
    });
    planned(host);
    const elsewhere = createConnectorsElsewhereFor(() => host);
    const bot = { modelSelection: { instanceId: "claude" } };
    const speaker = { origin: "person", principalId: A };

    // a Claude bot is told of both Grok sign-ins and what they bring
    const fromClaude = elsewhere(bot, instances[0], speaker);
    expect(fromClaude).toEqual([
      { engine: "Grok", connectors: ["Microsoft Teams", "Outlook (Exchange)", "Automations"], accountKind: "team" },
      { engine: "Grok (personal account)", connectors: ["Microsoft Teams", "Outlook (Exchange)", "Automations", "Docs Hub"], accountKind: "personal" },
    ]);
    const prompt = engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: false, grokCloud: false, relay: true, elsewhere: fromClaude });
    expect(prompt).toContain("Grok: Microsoft Teams, Outlook (Exchange)");
    expect(prompt).toContain("Grok (personal account): Microsoft Teams");

    // a bot on Grok with default settings does not load its own account's
    // connectors in its turn: it is told that sign-in is reachable too
    const onGrok = { modelSelection: { instanceId: "grok" } };
    const fromGrok = elsewhere(onGrok, instances[1], speaker);
    expect(fromGrok.map((entry: { engine: string }) => entry.engine)).toEqual(["Grok", "Grok (personal account)"]);
    // and the relay really runs there: from the list to run_with_engine, each
    // engine named is accepted, its own sign-in included (the part loads the
    // connectors the turn does not, engineRelay)
    const relayEngines: RelayEngine[] = [
      { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", models: { default: "grok-4", options: [{ id: "grok-4" }] } },
      { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok (personal account)", models: { default: "grok-4", options: [{ id: "grok-4" }] }, account: "second", accountKind: "personal" },
    ];
    const ownTurn = (host.accountConnectorInput as (...a: unknown[]) => Parameters<typeof turnLoadsAccountConnectors>[0])(onGrok, instances[1], speaker);
    expect(turnLoadsAccountConnectors(ownTurn)).toBe(false);
    const current = { instanceId: "grok", model: "grok-4", relayAddsAccountConnectors: relayAddsAccountConnectors(ownTurn) };
    expect(current.relayAddsAccountConnectors).toBe(true);
    for (const listed of fromGrok) {
      expect(chooseRelayEngine({ engine: listed.engine, engines: relayEngines, current }), listed.engine).toMatchObject({ ok: true, instanceId: "grok", model: "grok-4" });
    }
    const part = chooseRelayEngine({ engine: "Grok", engines: relayEngines, current });
    expect(part.ok && part.account).toBeUndefined();
    // the part's turn (engineRelay) loads that sign-in's connectors
    expect(grokCloudConnectorsForTurn({ ...ownTurn, engineRelay: true })).toBe(true);
    // an opted-in bot's turn already has them: only the other sign-in
    const optedIn = planned({ ...host, accountConnectorInput: (...args: unknown[]) => ({ ...(host.accountConnectorInput as (...a: unknown[]) => object)(...args), grokAccountConnectors: true }) });
    expect(createConnectorsElsewhereFor(() => optedIn)(onGrok, instances[1], speaker).map((entry: { engine: string }) => entry.engine)).toEqual(["Grok (personal account)"]);
    // its own sign-in, not listed, is still "do it yourself" for the relay
    const optedInTurn = (optedIn.accountConnectorInput as (...a: unknown[]) => Parameters<typeof turnLoadsAccountConnectors>[0])(onGrok, instances[1], speaker);
    expect(chooseRelayEngine({ engine: "Grok", engines: relayEngines, current: { instanceId: "grok", model: "grok-4", relayAddsAccountConnectors: relayAddsAccountConnectors(optedInTurn) } })).toMatchObject({ ok: false });
    // any other engine loads nothing more in a part on its own engine and
    // model: a bot on Codex, a Claude bot on a key, still do it themselves
    const codexEngines: RelayEngine[] = [{ instanceId: "codex", driverKind: "codex", displayName: "Codex", models: { default: "gpt-5", options: [{ id: "gpt-5" }] } }];
    const codexTurn = { ...ownTurn, driver: "codex", instanceId: "codex" };
    expect(chooseRelayEngine({ engine: "Codex", engines: codexEngines, current: { instanceId: "codex", model: "gpt-5", relayAddsAccountConnectors: relayAddsAccountConnectors(codexTurn) } })).toMatchObject({ ok: false });
    const claudeEngines: RelayEngine[] = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", models: { default: "opus", options: [{ id: "opus" }] } }];
    const claudeKeyTurn = { ...ownTurn, driver: "claudeAgent", instanceId: "claude", via: "owner-key" as const };
    expect(chooseRelayEngine({ engine: "Claude", engines: claudeEngines, current: { instanceId: "claude", model: "opus", relayAddsAccountConnectors: relayAddsAccountConnectors(claudeKeyTurn) } })).toMatchObject({ ok: false });

    // the connector switch and the setup card read the same registry
    expect(createEngineReachFor(() => optedIn)(onGrok, instances[1], speaker, "subscription", "second")).toEqual(
      ["Microsoft Teams", "Outlook (Exchange)", "Automations", "Docs Hub"].map((connector) => ({ connector })));
    const setup = createConnectorSetupStore(() => ({
      ...host,
      engineLogins: { preferredAccount: () => undefined },
      driverDisplayName: () => "Grok",
    }))();
    expect(setup.grokReach(A)).toMatchObject({ connectors: ["microsoft-teams", "outlook"], account: "team", elsewhere: { engine: "Grok (personal account)", connectors: ["microsoft-teams", "outlook"] } });
  });

  it("reads a sign-in it never saw once, in the background", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
    // signed in before this process (a marker on disk), nothing read yet
    const dir = home(dataDir, A, "grok");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LOGIN_MARKER), JSON.stringify({ at: 1 }));
    const { registry, probes } = server(dataDir, { grok: { [dir]: personalGateway } });
    expect(registry.accounts(A)).toMatchObject([{ label: "Grok", auth: "unknown", connectors: [], at: 0 }]);
    await settle();
    expect(probes).toEqual([dir]);
    expect(registry.accounts(A)[0]!.connectors.map((entry) => entry.name)).toContain("Microsoft Teams");
    registry.accounts(A);
    expect(probes).toHaveLength(1);
  });
});
