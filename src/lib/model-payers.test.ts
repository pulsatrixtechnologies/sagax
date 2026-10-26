import { describe, expect, it } from "vitest";

import { engineCanConnect, engineUnavailable, orgEngineState, payerOrder } from "./model-payers";

const claude = (patch: Partial<Parameters<typeof payerOrder>[0]> = {}): Parameters<typeof payerOrder>[0] => ({
  driver: "claudeAgent", installed: true, subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});

describe("payerOrder (server/engine-credentials.ts, the speaker pays)", () => {
  it("lists the subscription, the person's key, then the organization key; never the server's own sign-in", () => {
    expect(payerOrder(claude()).rows.map((row) => row.id)).toEqual(["subscription", "key", "org-key"]);
  });

  it("takes the payer used now from the server's answer", () => {
    expect(payerOrder(claude({ subscription: { supported: true, signedIn: true }, myKey: true, myTurns: "subscription" })).current).toBe("subscription");
    expect(payerOrder(claude({ myKey: true, orgKey: true, myTurns: "key" })).current).toBe("key");
    expect(payerOrder(claude({ orgKey: true, myTurns: "org-key" })).current).toBe("org-key");
    expect(payerOrder(claude()).current).toBeNull();
  });

  it("offers no subscription or own key for an engine without them", () => {
    const other = { driver: "openaiCompatible", installed: true, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: false, myTurns: "none" as const };
    expect(payerOrder(other).rows.map((row) => row.id)).toEqual(["org-key"]);
    expect(orgEngineState(other)).toBe("noAccess");
  });

  it("Grok Build and Kimi Code take a subscription and a key; Gemini CLI and pi a key only", () => {
    const engine = (driver: string, supported: boolean) => ({ driver, installed: true, subscription: { supported, signedIn: false }, myKey: false, orgKey: false, myTurns: "none" as const });
    expect(payerOrder(engine("grokAgent", true)).rows.map((row) => row.id)).toEqual(["subscription", "key", "org-key"]);
    expect(payerOrder(engine("kimiAgent", true)).rows.map((row) => row.id)).toEqual(["subscription", "key", "org-key"]);
    expect(payerOrder(engine("geminiAgent", false)).rows.map((row) => row.id)).toEqual(["key", "org-key"]);
    expect(payerOrder(engine("piAgent", false)).rows.map((row) => row.id)).toEqual(["key", "org-key"]);
  });

  it("names the provider column state", () => {
    // A subscription engine that is signed out needs a sign-in, even when the
    // CLI probe briefly reads installed:false: a logout must never read as
    // missing software (the Grok lockout, fix/engine-connect-not-blocked-by-installed).
    expect(orgEngineState(claude({ installed: false }))).toBe("signInRequired");
    // the server image deliberately does not carry it (engines.lock.json)
    expect(orgEngineState(claude({ installed: false, notAvailable: "too big" }))).toBe("notAvailable");
    expect(orgEngineState(claude({ notAvailable: "too big" }))).toBe("signInRequired");
    expect(orgEngineState(claude())).toBe("signInRequired");
    expect(orgEngineState(claude({ orgKey: true, myTurns: "org-key" }))).toBe("connected");
    // A non-connectable engine (no subscription, no personal key) whose binary
    // is genuinely absent still reads as not installed.
    const custom = { driver: "openaiCompatible", installed: false, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: false, myTurns: "none" as const };
    expect(orgEngineState(custom)).toBe("notInstalled");
  });

  it("engineUnavailable is only the image-not-carried case; engineCanConnect ignores a bare installed:false", () => {
    // Only installed:false WITH a reason (engines.lock.json notPreinstalled).
    expect(engineUnavailable({ installed: false, notAvailable: "too big" })).toBe(true);
    expect(engineUnavailable({ installed: false })).toBe(false);
    expect(engineUnavailable({ installed: true })).toBe(false);
    // Signed out + connectable → connecting is the right action, regardless of
    // a transient installed:false (the Grok logout lockout).
    const sub = (patch: Partial<MyEngineSub> = {}): MyEngineSub => ({ installed: true, subscription: { supported: true, signedIn: false }, ...patch });
    expect(engineCanConnect(sub())).toBe(true);
    expect(engineCanConnect(sub({ installed: false }))).toBe(true);
    expect(engineCanConnect(sub({ installed: false, notAvailable: "too big" }))).toBe(false);
    expect(engineCanConnect(sub({ subscription: { supported: true, signedIn: true } }))).toBe(false);
    expect(engineCanConnect(sub({ subscription: { supported: false, signedIn: false } }))).toBe(false);
  });
});

type MyEngineSub = { installed: boolean; notAvailable?: string; subscription: { supported: boolean; signedIn: boolean } };
