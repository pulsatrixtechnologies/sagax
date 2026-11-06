// Organization server: what Grok Build, Kimi Code, Gemini CLI and pi run on
// for one turn (SendTurnInput.access, server/engines/engine-credentials.ts): the
// payer's own home and key, never the server's own login or key.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { piAccessEnvironment, piCatalogEnvironment, PI_ACCESS_KEY_ENV } from "../pi.ts";
import { geminiApplyAccess } from "./gemini.ts";
import { grokApplyAccess, grokPickAuthMethod } from "./grok.ts";
import { KIMI_MOONSHOT_MODEL, kimiApplyAccess } from "./kimi.ts";

const home = () => join(mkdtempSync(join(tmpdir(), "org-access-")), "home");

describe("Grok Build", () => {
  it("a subscription turn runs in the person's own HOME with no key", () => {
    const dir = home();
    const env: Record<string, string | undefined> = { HOME: "/data", GROK_HOME: "/data/.grok", XAI_API_KEY: "xai-server" };
    grokApplyAccess(env, { via: "subscription", identity: "subscription:p", engineHome: dir }, { XAI_API_KEY: "xai-org" });
    expect(env).toEqual({ HOME: dir, GROK_HOME: join(dir, ".grok") });
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o777).toBe(0o700);
    if (process.platform !== "win32") expect(statSync(join(dir, ".grok")).mode & 0o777).toBe(0o700);
  });

  it("a key turn runs on the payer's key in an empty home; an org-key turn on the instance's key", () => {
    const dir = home();
    const env: Record<string, string | undefined> = { HOME: "/data" };
    grokApplyAccess(env, { via: "speaker-key", identity: "speaker-key:p:f", environment: { XAI_API_KEY: "xai-bob" }, engineHome: dir }, { XAI_API_KEY: "xai-org" });
    expect(env).toEqual({ HOME: dir, GROK_HOME: join(dir, ".grok"), XAI_API_KEY: "xai-bob" });
    const org: Record<string, string | undefined> = { HOME: "/data", GROK_HOME: "/data/.grok" };
    grokApplyAccess(org, { via: "org-key", identity: "org-key", engineHome: dir }, { XAI_API_KEY: "xai-org" });
    expect(org).toEqual({ HOME: dir, GROK_HOME: join(dir, ".grok"), XAI_API_KEY: "xai-org" });
  });

  it("never reuses another person's GROK_HOME", () => {
    const a = home();
    const b = home();
    const envA: Record<string, string | undefined> = { HOME: "/data", GROK_HOME: "/server/.grok", XAI_API_KEY: "xai-server" };
    const envB: Record<string, string | undefined> = { ...envA };
    grokApplyAccess(envA, { via: "subscription", identity: "subscription:a", engineHome: a }, {});
    grokApplyAccess(envB, { via: "subscription", identity: "subscription:b", engineHome: b }, {});
    expect(envA.GROK_HOME).toBe(join(a, ".grok"));
    expect(envB.HOME).toBe(b);
    expect(envB.GROK_HOME).toBe(join(b, ".grok"));
    expect(envA.GROK_HOME).not.toBe(envB.GROK_HOME);
    expect(envA.XAI_API_KEY).toBeUndefined();
    expect(envB.XAI_API_KEY).toBeUndefined();
  });

  it("authenticates with the cached token or grok.com subscription method, else the unadvertised xai.api_key method for a key", () => {
    const methods = [{ id: "cached_token" }, { id: "grok.com" }];
    expect(grokPickAuthMethod(methods, { XAI_API_KEY: "xai-bob" })).toBe("cached_token");
    // Current CLI versions advertise grok.com for an already-signed-in session.
    expect(grokPickAuthMethod([{ id: "grok.com" }], {})).toBe("grok.com");
    expect(grokPickAuthMethod([{ id: "grok.com" }], { XAI_API_KEY: "xai-bob" })).toBe("grok.com");
    expect(grokPickAuthMethod([], { XAI_API_KEY: "xai-bob" })).toBe("xai.api_key");
    expect(grokPickAuthMethod([], {})).toBeNull();
  });
});

describe("Kimi Code", () => {
  it("a subscription turn points KIMI_CODE_HOME at the person's own login", () => {
    const dir = home();
    const env: Record<string, string | undefined> = { MOONSHOT_API_KEY: "server", KIMI_API_KEY: "server" };
    kimiApplyAccess(env, { via: "subscription", identity: "subscription:p", engineHome: dir });
    expect(env).toEqual({ KIMI_CODE_HOME: dir });
  });

  it("a Moonshot key turn writes the provider with the key's variable name, never the key", () => {
    const dir = home();
    const env: Record<string, string | undefined> = {};
    kimiApplyAccess(env, { via: "owner-key", identity: "owner-key:p:f", environment: { MOONSHOT_API_KEY: "sk-moonshot-secret" }, engineHome: dir });
    expect(env).toMatchObject({ KIMI_CODE_HOME: dir, MOONSHOT_API_KEY: "sk-moonshot-secret" });
    const config = readFileSync(join(dir, "config.toml"), "utf8");
    expect(config).toContain(`default_model = "${KIMI_MOONSHOT_MODEL}"`);
    expect(config).toContain('api_key_env = "MOONSHOT_API_KEY"');
    expect(config).not.toContain("sk-moonshot-secret");
  });
});

describe("Gemini CLI", () => {
  it("runs on the payer's Google key in an empty GEMINI_CLI_HOME, never a server key", () => {
    const dir = home();
    const env: Record<string, string | undefined> = { GEMINI_API_KEY: "server", GOOGLE_API_KEY: "server" };
    geminiApplyAccess(env, { via: "speaker-key", identity: "speaker-key:p:f", environment: { GEMINI_API_KEY: "AIza-bob" }, engineHome: dir });
    expect(env).toEqual({ GEMINI_CLI_HOME: dir, GEMINI_API_KEY: "AIza-bob" });
  });
});

describe("pi", () => {
  it("runs in the payer's own agent dir with only their keys", () => {
    const dir = home();
    const env = piAccessEnvironment({ HOME: "/data" }, { via: "speaker-key", identity: "speaker-key:p:f", environment: { OPENAI_API_KEY: "sk-bob", XAI_API_KEY: "xai-bob", BOX_TOKEN: "nope" }, engineHome: dir });
    expect(env).toEqual({ HOME: "/data", PI_CODING_AGENT_DIR: dir, OPENAI_API_KEY: "sk-bob", XAI_API_KEY: "xai-bob" });
    expect(piAccessEnvironment({ HOME: "/data" }, undefined)).toEqual({ HOME: "/data" });
  });

  it("#2024: pi's native providers, the organization's keys and the model servers", () => {
    const dir = home();
    const env = piAccessEnvironment(
      { HOME: "/data" },
      { via: "speaker-key", identity: "speaker-key:p:f", environment: { MISTRAL_API_KEY: "m-bob", GROQ_API_KEY: "g-bob", SAGAX_PI_KEY_ORG_ACME: "srv" }, engineHome: dir },
    );
    expect(env).toEqual({ HOME: "/data", PI_CODING_AGENT_DIR: dir, MISTRAL_API_KEY: "m-bob", GROQ_API_KEY: "g-bob", SAGAX_PI_KEY_ORG_ACME: "srv" });
    expect(PI_ACCESS_KEY_ENV).toEqual(expect.arrayContaining(["MISTRAL_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "ZAI_API_KEY", "MINIMAX_API_KEY"]));

    const orgDir = home();
    const org = piAccessEnvironment({ HOME: "/data" }, { via: "org-key", identity: "org-key", engineHome: orgDir }, { OPENAI_API_KEY: "sk-org", BOX_TOKEN: "nope" });
    expect(org).toEqual({ HOME: "/data", PI_CODING_AGENT_DIR: orgDir, OPENAI_API_KEY: "sk-org" });
    // a speaker's turn never takes the organization's keys
    expect(piAccessEnvironment({ HOME: "/data" }, { via: "speaker-key", identity: "s", engineHome: home() }, { OPENAI_API_KEY: "sk-org" }).OPENAI_API_KEY).toBeUndefined();

    const served = home();
    piAccessEnvironment({ HOME: "/data" }, {
      via: "server",
      identity: "server",
      engineHome: served,
      environment: { SAGAX_PI_KEY_ORG_ACME: "srv" },
      piModelServers: [{ instanceId: "acme", name: "Acme", url: "https://models.example.com/v1", protocol: "openai", scope: "org", provider: "px-org-acme", keyEnv: "SAGAX_PI_KEY_ORG_ACME", models: [{ id: "m", label: "M", contextWindow: 1000, maxTokens: 100, reasoning: true, input: ["text"] }] }],
    });
    const text = readFileSync(join(served, "models.json"), "utf8");
    expect(JSON.parse(text).providers["px-org-acme"].apiKey).toBe("$SAGAX_PI_KEY_ORG_ACME");
    expect(text).not.toContain("srv\"");
  });

  it("an organization server lists every key provider's models from a home of its own", () => {
    expect(piCatalogEnvironment({ HOME: "/data" }, false)).toEqual({ HOME: "/data" });
    const env = piCatalogEnvironment({ HOME: "/data" }, true);
    expect(env.PI_CODING_AGENT_DIR).toContain("sagax-pi-catalog");
    for (const name of PI_ACCESS_KEY_ENV) expect(env[name]).toBe("sagax-catalog-only");
  });
});
