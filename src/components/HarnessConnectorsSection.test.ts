import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { accountSections, myClaudeEngine, myEngineFor, type HarnessConnectorsAnswer } from "./HarnessConnectorsSection";
import type { MyEngine } from "@/lib/perspicax-org";

const EN = en as Record<string, string>;
const FR = fr as Record<string, string>;

const mine = (instanceId: string, driver = "claudeAgent", over: Partial<MyEngine["subscription"]> = {}): MyEngine => ({
  instanceId, driver, displayName: instanceId, installed: true, subscription: { supported: true, signedIn: false, ...over }, myKey: false, orgKey: false, myTurns: "none",
});

describe("HarnessConnectorsSection copy (#4408)", () => {
  it("has English and French words for each section, naming the provider, never a single one", () => {
    for (const key of ["harnessConnectors.providedBy", "harnessConnectors.help", "harnessConnectors.accountsTitle", "harnessConnectors.loadingAccounts", "providers.advanced.help"]) {
      expect(Object.hasOwn(EN, key), key).toBe(true);
      expect(Object.hasOwn(FR, key), key).toBe(true);
    }
    expect(EN["harnessConnectors.providedBy"]).toBe("Provided by {provider} (your account)");
    expect(FR["harnessConnectors.providedBy"]).toBe("Fournis par {provider} (ton compte)");
    // the Advanced sentence names no single provider any more
    for (const words of [EN["providers.advanced.help"], FR["providers.advanced.help"]]) expect(words).not.toMatch(/claude|chatgpt|grok|openai|xai/i);
  });
});

describe("#1533: the connectors sections sign in to the person's own engine", () => {
  it("picks the default engine of the driver first, then another, never another engine", () => {
    expect(myClaudeEngine([mine("claude-2"), mine("claude")])?.instanceId).toBe("claude");
    expect(myClaudeEngine([mine("codex", "codex"), mine("claude-2")])?.instanceId).toBe("claude-2");
    expect(myClaudeEngine([mine("codex", "codex")])).toBeUndefined();
    expect(myClaudeEngine(null)).toBeUndefined();
    expect(myEngineFor([mine("grok-2", "grokAgent"), mine("grok", "grokAgent")], "grokAgent")?.instanceId).toBe("grok");
  });
});

describe("#4408: one section per provider whose account carries connectors", () => {
  const answer = (providers: HarnessConnectorsAnswer["providers"]): HarnessConnectorsAnswer => ({
    manageUrl: "https://claude.ai/customize/connectors", canManage: false, enabled: true,
    claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] }, codex: { available: false }, providers,
  });
  const claude = { provider: "claude-ai" as const, vendor: "anthropic" as const, manageUrl: "https://claude.ai/customize/connectors" };
  const openai = { provider: "chatgpt-apps" as const, vendor: "openai" as const, manageUrl: "https://chatgpt.com/#settings/Connectors" };
  const xai = { provider: "grok-com" as const, vendor: "xai" as const, manageUrl: "https://grok.com/connectors" };

  it("draws every provider that has connectors, in order, under the Providers page's names", () => {
    const sections = accountSections(answer([
      { ...claude, available: true, connectors: [{ name: "Gmail", status: "connected" }] },
      { ...openai, available: true, connectors: [{ name: "Notes", status: "connected" }] },
      { ...xai, available: true, connectors: [{ id: "outlook", name: "Outlook", status: "needs_auth" }] },
    ]), null);
    expect(sections.map((section) => [section.name, section.kind, section.entry.connectors.length])).toEqual([
      ["Claude", "list", 1], ["OpenAI", "list", 1], ["SpaceXSI", "list", 1],
    ]);
  });

  it("a provider whose sign-in expired draws nothing here: its row on the same page owns that first step", () => {
    const engines = [mine("claude", "claudeAgent", { signedIn: true, expired: true }), mine("codex", "codex"), mine("grok", "grokAgent", { signedIn: true, expired: true })];
    const sections = accountSections(answer([
      { ...claude, available: false, reason: "not_signed_in", connectors: [] },
      { ...openai, available: true, connectors: [] },
      { ...xai, available: false, reason: "unknown", connectors: [] },
    ]), engines);
    expect(sections).toEqual([]);
    // a read that did not answer on a live sign-in: Check again
    expect(accountSections(answer([{ ...xai, available: false, reason: "unknown", connectors: [] }]), [mine("grok", "grokAgent", { signedIn: true })])
      .map((section) => [section.entry.provider, section.kind])).toEqual([["grok-com", "unknown"]]);
    // a key, someone else's sign-in, no engine: nothing
    expect(accountSections(answer([
      { ...claude, available: false, reason: "key", connectors: [] },
      { ...openai, available: false, reason: "not_operator", connectors: [] },
      { ...xai, available: false, reason: "no_engine", connectors: [] },
    ]), engines)).toEqual([]);
  });

  it("a provider the person never signed in to shows its one first step, for each provider the same way", () => {
    // never signed in: its row waits under Add a provider, not on the page,
    // so the section holds the one Connect (main showed it for Claude only)
    const engines = [mine("claude"), mine("codex", "codex"), mine("grok", "grokAgent")];
    const sections = accountSections(answer([
      { ...claude, available: false, reason: "not_signed_in", connectors: [] },
      { ...openai, available: false, reason: "not_signed_in", connectors: [] },
      { ...xai, available: false, reason: "not_signed_in", connectors: [] },
    ]), engines);
    expect(sections.map((section) => [section.name, section.kind, section.engine?.instanceId])).toEqual([
      ["Claude", "signIn", "claude"], ["OpenAI", "signIn", "codex"], ["SpaceXSI", "signIn", "grok"],
    ]);
    // no engine of the person's own to sign in to (a solo server): nothing
    expect(accountSections(answer([{ ...claude, available: false, reason: "not_signed_in", connectors: [] }]), null)).toEqual([]);
    // signed in meanwhile (the answer lags): its row is on the page, nothing here
    expect(accountSections(answer([{ ...claude, available: false, reason: "not_signed_in", connectors: [] }]), [mine("claude", "claudeAgent", { signedIn: true })])).toEqual([]);
  });

  it("an older server's answer (no providers list) reads the same way", () => {
    const older: HarnessConnectorsAnswer = {
      manageUrl: "https://claude.ai/customize/connectors", canManage: false, enabled: true,
      claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] },
      codex: { available: true, connectors: [{ name: "Notes", status: "connected" }] },
      grok: { accounts: [{ auth: "subscription", connectors: [{ id: "outlook", name: "Outlook", status: "connected" }] }] },
    };
    expect(accountSections(older, null).map((section) => section.name)).toEqual(["Claude", "OpenAI", "SpaceXSI"]);
  });
});
