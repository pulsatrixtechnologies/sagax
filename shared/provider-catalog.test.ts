import { describe, expect, it } from "vitest";
import { providerCatalog, type CatalogInstance } from "./provider-catalog.ts";

const instance = (fields: Partial<CatalogInstance> & Pick<CatalogInstance, "instanceId" | "driverKind">, models: string[] = []): CatalogInstance => ({
  displayName: fields.instanceId,
  snapshot: { state: "available" },
  models: { options: models.map((id) => ({ id, label: id })) },
  ...fields,
});

describe("the provider catalog (#4329)", () => {
  const instances: CatalogInstance[] = [
    instance({ instanceId: "pi", driverKind: "piAgent", access: "custom" }, ["anthropic/claude-opus-5", "anthropic/claude-new-6", "openai/gpt-6"]),
    instance({ instanceId: "claude", driverKind: "claudeAgent", access: "subscription", displayName: "Claude", snapshot: { state: "available", account: { email: "ada@example.com" } } }, ["claude-opus-5"]),
    instance({ instanceId: "codex", driverKind: "codex", access: "subscription", displayName: "Codex", snapshot: { state: "available", account: { email: "ada@example.com" } } }, ["gpt-6"]),
    instance({ instanceId: "chatgpt", driverKind: "codex", access: "subscription", displayName: "ChatGPT plan", snapshot: { state: "available", authenticated: false } }, ["gpt-6"]),
    instance({ instanceId: "grok", driverKind: "grokAgent", access: "subscription", displayName: "Grok" }, ["grok-5"]),
    instance({ instanceId: "mistral", driverKind: "mistral", displayName: "Mistral", snapshot: { state: "unavailable" } }, []),
    instance({ instanceId: "personal-1", driverKind: "openai-compat", access: "api", displayName: "Home server", providerAccount: { provider: "compat:lab", serverId: "lab" } }, ["qwen3"]),
    instance({ instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode" }, ["opencode/big-pickle", "openai/gpt-6"]),
  ];
  const withLocal = instances.map((entry) => entry.instanceId === "codex"
    ? { ...entry, models: { options: [...entry.models.options, { id: "deskabc::qwen3", label: "qwen3", local: true }] } }
    : entry);

  it("lists one row per provider in the agreed order, OpenAI once with its two accounts", () => {
    const { providers } = providerCatalog({ instances: withLocal, place: "solo" });
    expect(providers.map((provider) => provider.label)).toEqual(["Claude", "OpenAI", "SpaceXSI", "Mistral", "OpenCode", "Home server", "This computer"]);
    const openai = providers.find((provider) => provider.id === "openai")!;
    expect(openai.kind).toBe("account");
    expect(openai.connections.map((connection) => [connection.instanceId, connection.label, connection.state])).toEqual([
      ["codex", "ada@example.com", "connected"],
      // no email: the provider's name, never the instance's
      ["chatgpt", "OpenAI", "signedOut"],
    ]);
    expect(openai.state).toBe("connected");
    // no provider is named after a tool
    expect(providers.some((provider) => ["Codex", "pi", "Claude Code"].includes(provider.label))).toBe(false);
  });

  it("lists a model once under its vendor with every engine that lists the same canonical id", () => {
    const { providers } = providerCatalog({ instances, place: "solo" });
    const claude = providers.find((provider) => provider.id === "anthropic")!;
    expect(claude.models.map((model) => [model.id, model.engines.map((engine) => `${engine.harness}:${engine.model}`)])).toEqual([
      ["claude-opus-5", ["claudeAgent:claude-opus-5", "piAgent:anthropic/claude-opus-5"]],
      // pi alone lists it: only pi is offered for it
      ["claude-new-6", ["piAgent:anthropic/claude-new-6"]],
    ]);
    const openai = providers.find((provider) => provider.id === "openai")!;
    expect(openai.models).toHaveLength(1);
    expect(openai.models[0]!.engines.map((engine) => engine.instanceId)).toEqual(["codex", "chatgpt", "pi", "opencodeGo"]);
    const opencode = providers.find((provider) => provider.id === "opencode")!;
    expect(opencode.models.map((model) => model.id)).toEqual(["big-pickle"]);
  });

  it("gives each connection the matrix's harnesses and recommendation", () => {
    const { providers } = providerCatalog({ instances: withLocal, place: "organization", servers: [{ instanceId: "lab", protocol: "openai" }] });
    const claude = providers.find((provider) => provider.id === "anthropic")!.connections[0]!;
    expect(claude.kind).toBe("account");
    expect(claude.recommended).toBe("claudeAgent");
    // #4410 lot 1 + #5523: pi and OpenCode also run on the person's own Claude sign-in; Claude Code stays the recommendation
    expect(claude.harnesses.filter((pair) => pair.mark === "works").map((pair) => pair.harness)).toEqual(["claudeAgent", "piAgent", "opencodeGo"]);
    // #5524: same for an OpenAI/Codex account; Codex stays the recommendation
    const openaiAccount = providers.find((provider) => provider.id === "openai")!.connections[0]!;
    expect(openaiAccount.kind).toBe("account");
    expect(openaiAccount.recommended).toBe("codex");
    expect(openaiAccount.harnesses.filter((pair) => pair.mark === "works").map((pair) => pair.harness)).toEqual(["codex", "piAgent", "opencodeGo"]);
    const server = providers.find((provider) => provider.id === "server:lab")!;
    expect(server.connections[0]).toMatchObject({ kind: "address", recommended: "openai-compat" });
    const computer = providers.find((provider) => provider.id === "computer")!;
    expect(computer.connections[0]).toMatchObject({ kind: "computer", recommended: "codex" });
    expect(providers.find((provider) => provider.id === "mistral")).toMatchObject({ kind: "key", state: "unavailable" });
  });

  it("puts the bots link under the xAI group, never as a model source, and hides it when the organization turned it off with no link", () => {
    const linked = providerCatalog({ instances, place: "organization", botsLink: { linked: true, enabled: true, orgAllowed: true } });
    const xai = linked.providers.find((provider) => provider.id === "xai")!;
    expect(xai.connections.map((connection) => [connection.kind, connection.state])).toEqual([["account", "connected"], ["botsLink", "connected"]]);
    expect(xai.connections[1]!.harnesses).toEqual([]);
    expect(providerCatalog({ instances, place: "organization", botsLink: { linked: true, enabled: true, orgAllowed: false } })
      .providers.find((provider) => provider.id === "xai")!.connections[1]!.state).toBe("adminOff");
    expect(providerCatalog({ instances, place: "organization", botsLink: { linked: false, enabled: false, orgAllowed: false } })
      .providers.find((provider) => provider.id === "xai")!.connections.some((connection) => connection.kind === "botsLink")).toBe(false);
    // a link with no xAI engine still shows the group
    expect(providerCatalog({ instances: [], place: "solo", botsLink: { linked: true, enabled: false, orgAllowed: true } }).providers)
      .toEqual([expect.objectContaining({ id: "xai", label: "SpaceXSI", connections: [expect.objectContaining({ kind: "botsLink", state: "off" })] })]);
    // no xAI account, not linked, the organization allows it: its Connect step is still offered
    expect(providerCatalog({ instances: [], place: "solo", botsLink: { linked: false, enabled: false, orgAllowed: true } }).providers)
      .toEqual([expect.objectContaining({ id: "xai", label: "SpaceXSI", connections: [expect.objectContaining({ kind: "botsLink", state: "signedOut" })] })]);
  });

  it("offers only the built in runtime for an Azure resource, behind the default address row or a person's server", () => {
    const azureInstances: CatalogInstance[] = [
      instance({ instanceId: "openaiCompat", driverKind: "openai-compat", access: "api", displayName: "Other" }, ["gpt-6-deployment"]),
      instance({ instanceId: "personal-2", driverKind: "openai-compat", access: "api", displayName: "Team resource", providerAccount: { provider: "compat:res", serverId: "res" } }, ["gpt-6-deployment"]),
      instance({ instanceId: "personal-1", driverKind: "openai-compat", access: "api", displayName: "Home server", providerAccount: { provider: "compat:lab", serverId: "lab" } }, ["qwen3"]),
    ];
    const { providers } = providerCatalog({
      instances: azureInstances, place: "organization", azureInstances: ["openaiCompat"],
      servers: [{ instanceId: "res", protocol: "openai", azure: true }, { instanceId: "lab", protocol: "openai" }],
    });
    for (const id of ["server:openaiCompat", "server:res"]) {
      const connection = providers.find((provider) => provider.id === id)!.connections[0]!;
      expect(connection.harnesses.map((pair) => [pair.harness, pair.mark])).toEqual([["openai-compat", "works"], ["piAgent", "no"], ["opencodeGo", "no"]]);
      expect(connection.recommended).toBe("openai-compat");
    }
    // an address that is no Azure resource keeps the address pairs
    const lab = providers.find((provider) => provider.id === "server:lab")!.connections[0]!;
    expect(lab.harnesses.find((pair) => pair.harness === "piAgent")?.mark).toBe("works");
  });

  it("never names a tool on a connection's line: an account with no email reads as its provider, the tool's name stays for Advanced", () => {
    const tools: CatalogInstance[] = [
      instance({ instanceId: "codex", driverKind: "codex", access: "subscription", displayName: "Codex", snapshot: { state: "available", authenticated: false } }, ["gpt-6"]),
      instance({ instanceId: "antigravity", driverKind: "antigravityAgent", access: "subscription", displayName: "Antigravity", snapshot: { state: "available" } }, ["gemini-4"]),
      instance({ instanceId: "claudeApi", driverKind: "claudeAgent", access: "api", displayName: "Claude (API key)" }, ["claude-opus-5"]),
    ];
    const { providers } = providerCatalog({ instances: tools, place: "solo" });
    const connections = providers.flatMap((provider) => provider.connections.map((connection) => ({ provider: provider.label, ...connection })));
    expect(connections.find((connection) => connection.instanceId === "codex")).toMatchObject({ kind: "account", label: "OpenAI", name: "Codex", state: "signedOut" });
    for (const connection of connections) {
      expect(connection.label).toBe(connection.provider);
      expect(["Codex", "Antigravity", "Claude (API key)"]).not.toContain(connection.label);
    }
  });

  it("is empty with nothing connected", () => {
    expect(providerCatalog({ instances: [], place: "solo" })).toEqual({ providers: [] });
  });
});

// M-20261119-015: a person with two Claude accounts, each with its own list
describe("the accounts that offer each model", () => {
  const personal = instance({ instanceId: "claude-personal", driverKind: "claudeAgent", access: "subscription", displayName: "Personal",
    snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }, ["claude-opus-5-5", "claude-fable-5-2"]);
  const team = instance({ instanceId: "claude-team", driverKind: "claudeAgent", access: "subscription", displayName: "Team",
    snapshot: { state: "available", authenticated: true, account: { email: "ada@acme.test" } } }, ["claude-mythos-5-2", "claude-opus-5-5", "claude-fable-5-2"]);
  const claudeOf = (input: Parameters<typeof providerCatalog>[0]) => providerCatalog(input).providers.find((provider) => provider.id === "anthropic")!;

  it("keeps every account that offers a model, and the one account a model comes from alone", () => {
    const claude = claudeOf({ instances: [personal, team], place: "solo" });
    const byId = new Map(claude.models.map((model) => [model.id, model]));
    expect(byId.get("claude-opus-5-5")).toMatchObject({ accounts: ["claude-personal", "claude-team"] });
    expect(byId.get("claude-opus-5-5")?.onlyAccount).toBeUndefined();
    expect(byId.get("claude-mythos-5-2")).toMatchObject({ accounts: ["claude-team"], onlyAccount: "claude-team" });
  });

  it("one account: nothing to tell apart", () => {
    const claude = claudeOf({ instances: [team], place: "solo" });
    expect(claude.models.find((model) => model.id === "claude-mythos-5-2")).toMatchObject({ accounts: ["claude-team"] });
    expect(claude.models.some((model) => model.onlyAccount)).toBe(false);
  });

  it("reads the person's own sign-in on an organization server, not the instance's", () => {
    // the server's own state says signed out; the person's own sign-ins are on
    const signedOut = [personal, team].map((entry) => ({ ...entry, snapshot: { ...entry.snapshot, authenticated: false } }));
    const off = claudeOf({ instances: signedOut, place: "organization" });
    expect(off.models.some((model) => model.onlyAccount)).toBe(false);
    const mine = claudeOf({ instances: signedOut, place: "organization", accountConnected: () => true });
    expect(mine.models.find((model) => model.id === "claude-mythos-5-2")?.onlyAccount).toBe("claude-team");
  });

  it("two tools of one sign-in (Codex and the ChatGPT plan) are never two accounts", () => {
    const codex = instance({ instanceId: "codex", driverKind: "codex", access: "subscription", displayName: "Codex", snapshot: { state: "available", authenticated: true } }, ["gpt-6"]);
    const plan = instance({ instanceId: "chatgpt", driverKind: "codex", access: "subscription", displayName: "ChatGPT plan", snapshot: { state: "available", authenticated: true, chatgptPlan: true } }, ["gpt-6", "gpt-6-pro"]);
    const openai = providerCatalog({ instances: [codex, plan], place: "solo" }).providers.find((provider) => provider.id === "openai")!;
    expect(openai.models.find((model) => model.id === "gpt-6-pro")).toMatchObject({ accounts: ["chatgpt"] });
    expect(openai.models.some((model) => model.onlyAccount)).toBe(false);
  });
});
