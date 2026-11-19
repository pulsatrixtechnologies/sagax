// #4416: on an organization server, each person sees the models their own
// key's account offers, through the per-viewer list (instancesForViewer).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { GrokDriver } from "../drivers/grok.ts";
import { createInstancesForViewer } from "./instancesForViewer.ts";
import { createPiKeyProviders } from "./piKeyProviders.ts";
import { createViewerAccountModels } from "./viewerAccountModels.ts";

const WRITTEN = ["grok-4.7", "grok-4", "grok-4-fast", "grok-3-mini"];

describe("each person's own key lists their account's models (#4416)", () => {
  let previousFetch: typeof globalThis.fetch;
  /** What each key's account lists; a missing key answers 500. */
  let accounts: Record<string, string[]> = {};
  const runtimes: ProviderInstance[] = [];

  beforeEach(() => {
    previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const key = String(new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      const models = accounts[key];
      if (!models) return new Response("denied", { status: 500 });
      if (String(url).endsWith("/language-models")) return Response.json({ models: models.map((id) => ({ id, output_modalities: ["text"] })) });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  /** An organization server with one xAI instance; `keys` is what each
   * person keeps in Perspicax (by sub), `serverKey` the organization's. */
  async function server(keys: Record<string, string>, serverKey?: string) {
    const runtime = await GrokDriver.create({
      instanceId: "grok", displayName: "Grok", enabled: true,
      environment: serverKey ? { XAI_API_KEY: serverKey } : {},
      config: { url: "https://fake.xai.invalid/v1", apiKeyEnv: serverKey ? "XAI_API_KEY" : "SAGAX_TEST_NO_XAI_KEY" },
    });
    runtimes.push(runtime);
    await runtime.refreshModels?.();
    const subOf = (id: string) => `sub-${id}`;
    const host: Record<string, unknown> = {
      IDENTITY: { kind: "perspicax", issuer: "https://issuer.invalid" },
      DATA_DIR: "/nonexistent-4416",
      registry: { get: (id: string) => (id === "grok" ? runtime : undefined) },
      describeInstances: async () => [{ instanceId: "grok", driverKind: "grok", displayName: "Grok", models: runtime.models }],
      isPrincipalId: (id: string) => id.startsWith("pr_"),
      principals: {
        byId: (id: string) => ({ id, subject: { sub: subOf(id), iss: "https://issuer.invalid" } }),
        list: () => Object.keys(keys).map((id) => ({ id, subject: { sub: subOf(id), iss: "https://issuer.invalid" } })),
      },
      orgPersonFacts: (person: { subject: { sub: string } }) => ({ sub: person.subject.sub }),
      engineInstalled: () => true,
      keyOnlyInstance: () => true,
      perspicaxDirectory: {
        providerKeys: (sub: string) => (Object.keys(keys).some((id) => subOf(id) === sub) ? ["xai"] : []),
        invalidate: () => {},
      },
      providerAccountOwner: (id: string | undefined) => (id ? { principalId: id } : null),
      providerAccounts: {
        resolve: async (owner: { principalId: string }) => ({ ok: true, key: keys[owner.principalId], fingerprint: `fp-${owner.principalId}` }),
      },
      principalLoginDir: () => "/nonexistent-4416/login",
      driverKeyBacked: () => Boolean(serverKey),
      fileKeyConfigured: () => false,
      serverEngineAllowedFor: () => true,
      consoleEngineAllowed: () => true,
      cfg: {},
      syncPersonalProvidersInBackground: async () => {},
      refusedModelsFor: () => [],
      personalProviderInstances: { visible: () => true, get: () => undefined },
      compatServerVisible: () => true,
      orgOfferedEngines: (instances: unknown[]) => instances,
      overlayModelServers: (instances: unknown[]) => instances,
      piModelServersForViewer: async () => [],
      desktopLocalModels: { overlay: (instances: unknown[]) => instances },
    };
    host.piKeyProviders = createPiKeyProviders(() => host);
    host.viewerAccountModels = createViewerAccountModels(() => host);
    const list = createInstancesForViewer(() => host);
    return async (person: string) => ((await list(person)) as { models: { options: { id: string }[] } }[])[0].models.options.map((option) => option.id);
  }

  it("gives two people with different keys on one xAI instance different lists", async () => {
    accounts = { "org-key": ["grok-3-mini"], "key-alice": ["grok-4.7", "grok-4.6", "grok-4.5"], "key-bob": ["grok-4.7-fast"] };
    const modelsFor = await server({ pr_alice: "key-alice", pr_bob: "key-bob" }, "org-key");
    expect(await modelsFor("pr_alice")).toEqual(["grok-4.7", "grok-4.6", "grok-4.5"]);
    expect(await modelsFor("pr_bob")).toEqual(["grok-4.7-fast"]);
    // someone with no key of their own runs on the organization's: its list
    expect(await modelsFor("pr_carol")).toEqual(["grok-3-mini"]);
  });

  it("lists a person's own models when the server has no key at all", async () => {
    accounts = { "key-alice": ["grok-4.6", "grok-4.5"] };
    const modelsFor = await server({ pr_alice: "key-alice" });
    expect(await modelsFor("pr_alice")).toEqual(["grok-4.6", "grok-4.5"]);
  });

  it("keeps the written list when a person's key cannot be read", async () => {
    accounts = {};
    const modelsFor = await server({ pr_alice: "key-alice" });
    expect(await modelsFor("pr_alice")).toEqual(WRITTEN);
  });
});

// #4973: on Claude Code, a person's own Claude sign-in lists what their
// account offers, read through the engine's modelsForAccess.
describe("each person's own Claude sign-in lists their account's models (#4973)", () => {
  it("passes the viewer's own sign-in, and nobody else's", async () => {
    const asked: Array<{ via: string; claudeConfigDir?: string }> = [];
    const written = { default: "claude-sonnet-5", options: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }] };
    const runtime = {
      models: written,
      modelsForAccess: async (access: { via: string; claudeConfigDir?: string }) => {
        asked.push(access);
        return { default: "claude-mythos-5-2", options: [{ id: "claude-mythos-5-2", label: "Claude Mythos 5.2" }] };
      },
    };
    const signedIn = new Set(["pr_alice"]);
    const host: Record<string, unknown> = {
      IDENTITY: { kind: "perspicax", issuer: "https://issuer.invalid" },
      DATA_DIR: "/nonexistent-4973",
      registry: { get: (id: string) => (id === "claude" ? runtime : undefined) },
      describeInstances: async () => [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", models: written }],
      isPrincipalId: (id: string) => id.startsWith("pr_"),
      principals: { byId: (id: string) => ({ id, subject: { sub: `sub-${id}`, iss: "https://issuer.invalid" } }), list: () => [] },
      orgPersonFacts: (person: { subject: { sub: string } }) => ({ sub: person.subject.sub }),
      engineInstalled: () => true,
      keyOnlyInstance: () => false,
      engineLogins: { signedIn: (pid: string) => signedIn.has(pid), expired: () => false },
      perspicaxDirectory: { providerKeys: () => [], invalidate: () => {} },
      providerAccountOwner: (id: string | undefined) => (id ? { principalId: id } : null),
      providerAccounts: { resolve: async () => ({ ok: false, error: "link" }) },
      principalLoginDir: (pid: string) => `/nonexistent-4973/principals/${pid}/claude`,
      driverKeyBacked: () => false,
      fileKeyConfigured: () => false,
      serverEngineAllowedFor: () => true,
      consoleEngineAllowed: () => true,
    };
    host.piKeyProviders = createPiKeyProviders(() => host);
    const viewer = createViewerAccountModels(() => host);
    const ids = async (person: string) => ((await viewer(person, await (host.describeInstances as () => Promise<unknown[]>)())) as { models: { options: { id: string }[] } }[])[0]!.models.options.map((option) => option.id);
    expect(await ids("pr_alice")).toEqual(["claude-mythos-5-2"]);
    expect(asked).toEqual([expect.objectContaining({ via: "subscription", claudeConfigDir: "/nonexistent-4973/principals/pr_alice/claude" })]);
    // Not signed in, no key: the instance's list, and no read on their behalf.
    expect(await ids("pr_bob")).toEqual(["claude-sonnet-5"]);
    expect(asked).toHaveLength(1);
  });
});
