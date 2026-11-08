import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { harnessUnavailableKey, myClaudeEngine } from "./HarnessConnectorsSection";
import type { MyEngine } from "@/lib/perspicax-org";

describe("HarnessConnectorsSection copy", () => {
  it("has an English and a French sentence for every reason the server gives", () => {
    for (const reason of ["disabled", "managed_policy", "no_engine", "not_signed_in", "not_operator", "key", "unknown"] as const) {
      const key = harnessUnavailableKey(reason);
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(Object.hasOwn(fr, key), key).toBe(true);
    }
    expect((fr as Record<string, string>)["harnessConnectors.title"]).toBe("Fournis par Claude (ton compte)");
    expect((fr as Record<string, string>)["harnessConnectors.unavailable.notSignedIn"]).toBe("Connecte ton abonnement Claude pour utiliser tes connecteurs.");
  });
  it("falls back to the unknown sentence", () => {
    expect(harnessUnavailableKey(undefined)).toBe("harnessConnectors.unavailable.unknown");
  });
});

describe("#1533: the connectors box signs in to the person's own Claude", () => {
  const mine = (instanceId: string, driver = "claudeAgent", supported = true): MyEngine => ({
    instanceId, driver, displayName: instanceId, installed: true, subscription: { supported, signedIn: false }, myKey: false, orgKey: false, myTurns: "none",
  });
  it("picks the default Claude engine first, then another Claude, never another engine", () => {
    expect(myClaudeEngine([mine("claude-2"), mine("claude")])?.instanceId).toBe("claude");
    expect(myClaudeEngine([mine("codex", "codex"), mine("claude-2")])?.instanceId).toBe("claude-2");
    expect(myClaudeEngine([mine("codex", "codex")])).toBeUndefined();
    expect(myClaudeEngine(null)).toBeUndefined();
  });
  it("has an English and a French sentence for an expired sign-in", () => {
    expect((en as Record<string, string>)["harnessConnectors.unavailable.expired"]).toContain("Reconnect Claude");
    expect((fr as Record<string, string>)["harnessConnectors.unavailable.expired"]).toContain("Reconnecte Claude");
  });
});
