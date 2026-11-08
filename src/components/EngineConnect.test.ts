// The minimal engine card of a person on an organization server (Settings >
// Model providers and the model picker): one "Pays with" line, one Connect
// button or Connected with Disconnect, a small link to their keys while no
// subscription is signed in; never the payer chain.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { MyEngine } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ api: null as null | ((...args: unknown[]) => Promise<unknown>) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (...args: unknown[]) => fixture.api!(...args),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));

import { EngineConnect, connectName, engineConnectHasAction, paysWithText } from "./EngineConnect";
import { engineSignInError } from "./settings/MyEngines";
import { deviceCodeHintShown } from "./DeviceSignIn";

const issuer = "https://px.example.test";
const engine = (patch: Partial<MyEngine> = {}): MyEngine => ({
  instanceId: "codex", driver: "codex", displayName: "Codex", installed: true,
  subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});
const render = (value: MyEngine) => renderToStaticMarkup(createElement(EngineConnect, { engine: value, issuer, onChanged: () => {} }));

beforeEach(() => {
  setLocale("en");
  fixture.api = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("window", {});
});

describe("EngineConnect", () => {
  it("an engine the server image does not carry reads Not available on this server, with the reason as a tooltip", () => {
    const html = render(engine({ installed: false, notAvailable: "Google's runtime is about 2 GB" }));
    expect(html).toContain('data-pays-with="not-available"');
    expect(html).toContain("Not available on this server");
    expect(html).toContain("Google&#x27;s runtime is about 2 GB");
    expect(html).not.toContain("<button");
    expect(paysWithText({ installed: false, myTurns: "none", notAvailable: "x" })).toBe("Not available on this server");
    setLocale("fr");
    expect(paysWithText({ installed: false, myTurns: "none", notAvailable: "x" })).toBe("Non disponible sur ce serveur");
  });

  it("not connected: Not connected and one Connect button, no payer chain or device-code hint", () => {
    const html = render(engine());
    expect(html).toContain('data-pays-with="none"');
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect ChatGPT");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("Disconnect");
    for (const gone of ["Who pays for your turns", "Checked in this order", "data-payer=", "Nothing pays for this provider yet", "Can&#x27;t answer you yet", "Sign in with your OpenAI account", "kept on the organization server for you only", "Device-code login"]) {
      expect(html).not.toContain(gone);
    }
    expect(render(engine({ instanceId: "claude", driver: "claudeAgent", displayName: "Claude" }))).toContain("Connect Claude");
    expect(render(engine({ instanceId: "grok", driver: "grokAgent", displayName: "Grok" }))).toContain("Connect Grok");
    expect(render(engine({ instanceId: "kimi", driver: "kimiAgent", displayName: "Kimi" }))).toContain("Connect Kimi");
  });

  it("connected: Pays with your subscription, Connected and Disconnect, no Connect button or keys link", () => {
    const signedIn = engine({ subscription: { supported: true, signedIn: true }, myKey: true, orgKey: true, myTurns: "subscription" });
    const html = render(signedIn);
    expect(html).toContain("Pays with: your subscription");
    expect(html).toContain("data-engine-connected");
    expect(html).toContain(">Connected<");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect ChatGPT");
    expect(html).not.toContain("data-engine-keys-link");
  });

  it("#1533: a sign-in the provider refused reads Reconnection required with Reconnect Claude, never Connected", () => {
    const expired = engine({ instanceId: "claude", driver: "claudeAgent", displayName: "Claude", subscription: { supported: true, signedIn: true, expired: true }, myTurns: "subscription" });
    const html = render(expired);
    expect(html).toContain('data-pays-with="expired"');
    expect(html).toContain("Reconnection required");
    expect(html).toContain("data-engine-expired");
    expect(html).toContain("Reconnect Claude");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("data-engine-connected");
    expect(html).not.toContain(">Connected<");
    expect(engineConnectHasAction(expired)).toBe(true);
    setLocale("fr");
    expect(render(expired)).toContain("Reconnexion requise");
    expect(render(expired)).toContain("Reconnecter Claude");
  });

  it("in the model window: no status line and no Connected/Disconnect, which the window shows elsewhere (2026-10-15)", () => {
    const signedIn = engine({ subscription: { supported: true, signedIn: true }, myTurns: "subscription" });
    const bare = (value: MyEngine) => renderToStaticMarkup(createElement(EngineConnect, { engine: value, issuer, onChanged: () => {}, statusLine: false, disconnect: false }));
    const html = bare(signedIn);
    expect(html).not.toContain("data-pays-with");
    expect(html).not.toContain("data-engine-connected");
    expect(html).not.toContain("Disconnect");
    expect(engineConnectHasAction(signedIn)).toBe(false);
    // still the way to connect
    expect(bare(engine())).toContain("Connect ChatGPT");
    expect(engineConnectHasAction(engine())).toBe(true);
    expect(engineConnectHasAction(engine({ instanceId: "pi", driver: "piAgent", subscription: { supported: false, signedIn: false }, myTurns: "key" }))).toBe(true);
    expect(engineConnectHasAction(engine({ instanceId: "xaiApi", driver: "grok", subscription: { supported: false, signedIn: false }, myTurns: "org-key" }))).toBe(false);
  });

  it("key only: the status line names the key and the Manage link shows, with no button when no subscription exists", () => {
    const keyOnly = engine({ instanceId: "pi", driver: "piAgent", displayName: "pi", subscription: { supported: false, signedIn: false }, myKey: true, myTurns: "key" });
    const html = render(keyOnly);
    expect(html).toContain('data-pays-with="key"');
    expect(html).toContain("Pays with: your key in Perspicax");
    expect(html).toContain("data-engine-keys-link");
    expect(html).toContain(`${issuer}/console/credentials?kind=model`);
    expect(html).toContain("Manage my keys in Perspicax");
    expect(html).not.toContain("<button");
    // A provider with a subscription still offers Connect beside the key.
    const both = render(engine({ myKey: true, myTurns: "key" }));
    expect(both).toContain("Pays with: your key in Perspicax");
    expect(both).toContain("Connect ChatGPT");
    expect(both).toContain("data-engine-keys-link");
  });

  it("organization key and engines a key cannot serve", () => {
    expect(render(engine({ orgKey: true, myTurns: "org-key" }))).toContain("Pays with: the organization<");
    const custom = render(engine({ instanceId: "ollama", driver: "openaiCompatible", displayName: "Ollama", subscription: { supported: false, signedIn: false } }));
    expect(custom).toContain("Not connected");
    expect(custom).not.toContain("data-engine-keys-link");
    expect(custom).not.toContain("<button");
    // A non-connectable engine (no subscription, no personal key) whose binary
    // is genuinely absent reads as not installed, with no button.
    const absent = render(engine({ instanceId: "ollama", driver: "openaiCompatible", displayName: "Ollama", subscription: { supported: false, signedIn: false }, installed: false }));
    expect(absent).toContain("Not installed on this server");
    expect(absent).not.toContain("<button");
  });

  // Regression: a logout must never leave an engine looking "not installed"
  // with the Connect button gone. Grok on ACME signed out but the CLI still
  // present (fix/engine-connect-not-blocked-by-installed).
  describe("signed-out is never a lockout", () => {
    const grok = (patch: Partial<MyEngine> = {}): MyEngine =>
      engine({ instanceId: "grok", driver: "grokAgent", displayName: "Grok", subscription: { supported: true, signedIn: false }, myTurns: "none", ...patch });

    it("signed out with the CLI installed: Connect Grok is offered, Not connected, never Not installed", () => {
      const html = render(grok());
      expect(html).toContain("Connect Grok");
      expect(html).toContain("Not connected");
      expect(html).not.toContain("Not installed on this server");
      expect(html).toContain('data-pays-with="none"');
    });

    it("signed out while the probe reads installed:false (no reason): still Connect Grok, never Not installed", () => {
      // The core lockout: a logout (or a stale probe) reading installed:false
      // must not read as missing software or drop the way back in.
      const html = render(grok({ installed: false }));
      expect(html).toContain("Connect Grok");
      expect(html).toContain("<button");
      expect(html).not.toContain("Not installed on this server");
      expect(html).not.toContain("Not available on this server");
      expect(paysWithText(grok({ installed: false }))).toBe("Not connected");
      expect(engineConnectHasAction(grok({ installed: false }))).toBe(true);
    });

    it("the Connect button is enabled (not disabled) when signed out", () => {
      // renderToStaticMarkup omits `disabled` for disabled={false}; the only
      // button in a signed-out card is Connect, so no disabled attribute means
      // it is clickable.
      const html = render(grok({ installed: false }));
      expect(html).toContain("<button");
      expect(html).not.toContain("disabled");
    });

    it("the image genuinely not carrying Grok still reads Not available, with no Connect", () => {
      const html = render(grok({ installed: false, notAvailable: "no Grok CLI in this image" }));
      expect(html).toContain("Not available on this server");
      expect(html).not.toContain("Connect Grok");
      expect(html).not.toContain("<button");
      expect(engineConnectHasAction(grok({ installed: false, notAvailable: "x" }))).toBe(false);
    });
  });

  it("names the account people sign in with and speaks French", () => {
    expect(connectName({ driver: "codex", displayName: "Codex" })).toBe("ChatGPT");
    expect(connectName({ driver: "geminiAgent", displayName: "Gemini CLI" })).toBe("Gemini");
    expect(connectName({ driver: "piAgent", displayName: "pi" })).toBe("pi");
    setLocale("fr");
    expect(paysWithText({ installed: true, myTurns: "subscription" })).toBe("Payé par : ton abonnement");
    expect(render(engine())).toContain("Non connecté");
  });
});

describe("a sign-in refused on an engine the server lists as installed", () => {
  const grok = engine({ instanceId: "grok", driver: "grokAgent", displayName: "Grok" });
  it("says the engine is not connected, never that it is not installed", () => {
    const raw = "Grok is not installed on this server. Install it with xAI's installer (https://x.ai/cli), then try again.";
    expect(engineSignInError(grok, new Error(raw))).toBe("Grok is not connected. Connect it to use it.");
    setLocale("fr");
    expect(engineSignInError(grok, new Error(raw))).toBe("Grok n'est pas connecté. Connecte-le pour l'utiliser.");
  });
  it("keeps other failures, and keeps not-installed for an engine the host really lacks", () => {
    expect(engineSignInError(grok, new Error("Grok could not reach its sign-in service."))).toBe("Grok could not reach its sign-in service.");
    expect(engineSignInError(grok, new Error(""))).toBe("The sign-in did not finish.");
    expect(engineSignInError({ ...grok, installed: false }, new Error("Grok is not installed on this server."))).toBe("Grok is not installed on this server.");
  });
  it("the card keeps Connect and the keys link, and the status line shows once", () => {
    const html = render({ ...grok, myKey: true, myTurns: "key" });
    expect(html.match(/>Pays with: your key in Perspicax</g)).toHaveLength(1);
    expect(html).toContain("Connect Grok");
    expect(html).toContain("Manage my keys in Perspicax");
    expect(html).not.toContain("not installed");
  });
});

describe("the device-code hint", () => {
  it("shows only once a sign-in failed, and not when the failure already says it", () => {
    expect(deviceCodeHintShown(null, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "waiting" }, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "succeeded" }, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "failed", message: "The server stopped." }, null)).toBe(true);
    expect(deviceCodeHintShown(null, "Network down")).toBe(true);
    expect(deviceCodeHintShown({ phase: "failed", message: "Enable device-code login in your ChatGPT security settings" }, null)).toBe(false);
  });
});

describe("2026-10-29: a person's two Grok accounts on the Providers card", () => {
  const grok = (accounts: MyEngine["accounts"]): MyEngine => engine({
    instanceId: "grok", driver: "grokAgent", displayName: "Grok", subscription: { supported: true, signedIn: true }, myTurns: "subscription", accounts,
  });

  it("draws one row per account: what it is, its address, Connected, and the grok.com connectors it brings", () => {
    const html = render(grok([
      { slot: "primary", signedIn: true, kind: "team", email: "ops@example.test", connectors: [{ label: "SharePoint", tools: 12 }] },
      { slot: "second", signedIn: true, kind: "personal", email: "me@example.test", connectors: [{ label: "Microsoft Teams", tools: 36 }, { label: "Outlook (Exchange)", tools: 29 }] },
    ]));
    expect(html).toContain('data-grok-account="primary"');
    expect(html).toContain('data-account-kind="team"');
    expect(html).toContain("Team account");
    expect(html).toContain("ops@example.test");
    expect(html).toContain('data-account-kind="personal"');
    expect(html).toContain("Personal account");
    expect(html).toContain("Through grok.com: Microsoft Teams (36), Outlook (Exchange) (29)");
    expect(html).toContain("Through grok.com: SharePoint (12)");
    expect(html.match(/Connected/g)?.length).toBe(2);
    expect(html.match(/Disconnect/g)?.length).toBe(2);
    expect(html).toContain("the personal account comes first");
    expect(html).not.toContain('data-engine-connected');
  });

  it("a second account not connected yet offers Connect a second Grok account; one with no connector says so", () => {
    const html = render(grok([
      { slot: "primary", signedIn: true, kind: "personal", connectors: [] },
      { slot: "second", signedIn: false },
    ]));
    expect(html).toContain("Connect a second Grok account");
    expect(html).toContain("Second Grok account");
    expect(html).toContain("No grok.com connector on this account yet.");
    expect(html).toContain('data-my-engine="grok#second"');
    expect(html.match(/Connected/g)?.length).toBe(1);
    setLocale("fr");
    expect(render(grok([{ slot: "primary", signedIn: false }, { slot: "second", signedIn: false }]))).toContain("Connecter un deuxième compte Grok");
  });

  it("a sign-in the provider refused since says Reconnect on its own row only", () => {
    const html = render(grok([
      { slot: "primary", signedIn: true, kind: "team", expired: true },
      { slot: "second", signedIn: true, kind: "personal", connectors: [] },
    ]));
    expect(html).toContain("Reconnect Grok");
    expect(html.match(/Connected/g)?.length).toBe(1);
  });
});
