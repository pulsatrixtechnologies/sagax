// #4329 lot 2: the link to the person's bots in the other vendor's bot app is
// a connection of the xAI group, drawn as one line ("Your bots there", one
// button) and a block (state, Connect or Disconnect, two plain switches), the
// technical fields behind Advanced. Every field of the old screen keeps a
// place (design B4).
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import type { GrokBridgeLinkView } from "@/lib/grok-bridge";
import { setLocale } from "@/lib/i18n";
import { BotsLinkAdvanced, BotsLinkBlock, BotsLinkButton, botsLinkAction, botsLinkWords, useBotsLink } from "./LinkedGrokBotSettings";
import { OrgGrokBridgePolicy } from "./OrgGrokBridgePolicy";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => setLocale("en"));

const linked: GrokBridgeLinkView = {
  linked: true,
  enabled: true,
  webhookUrl: "https://bots.example/hook",
  keySet: true,
  linkId: "link_abc",
  bots: ["nimbus"],
  mayCallOwner: false,
  mayTextOwner: true,
  orgAllowed: true,
  stats: { sentToday: 12, receivedToday: 0, deadLetters: 0, circuitOpen: false },
};
const none: GrokBridgeLinkView = {
  linked: false, enabled: false, keySet: false, bots: [], mayCallOwner: false, mayTextOwner: false, orgAllowed: true,
};

/** The block, then its part of the page's one Advanced, as the xAI page draws them. */
function Block({ view }: { view: GrokBridgeLinkView }) {
  const link = useBotsLink(view);
  return createElement(Fragment, null, createElement(BotsLinkBlock, { link }), createElement(BotsLinkAdvanced, { link }));
}
function BlockAlone({ view }: { view: GrokBridgeLinkView }) {
  const link = useBotsLink(view);
  return createElement(BotsLinkBlock, { link });
}
function Button({ view }: { view: GrokBridgeLinkView }) {
  const link = useBotsLink(view);
  return createElement(BotsLinkButton, { link, onOpen: () => {} });
}
const block = (view: GrokBridgeLinkView) => renderToStaticMarkup(createElement(Block, { view }));
const button = (view: GrokBridgeLinkView) => renderToStaticMarkup(createElement(Button, { view }));
const count = (html: string, text: string) => html.split(text).length - 1;

/** The block without its part of Advanced: what the person sees first. */
function firstLevel(html: string): string {
  const at = html.indexOf("data-bots-link-advanced");
  expect(at, "the link has its part of Advanced").toBeGreaterThan(0);
  return html.slice(0, html.lastIndexOf("<", at));
}
function advanced(html: string): string {
  return html.slice(html.indexOf("data-bots-link-advanced"));
}

describe("the bots link on the xAI provider's row (#4376: one line, a button only before it is linked)", () => {
  it("reads 'Your bots there' with its state, in one line", () => {
    expect(botsLinkWords({ state: "connected" })).toBe("Your bots there · Connected");
    expect(botsLinkWords({ state: "off" })).toBe("Your bots there · Paused");
    expect(botsLinkWords({ state: "adminOff" })).toBe("Your bots there · Turned off by your organization");
    expect(botsLinkWords({ state: null })).toBeNull();
  });

  it("carries Connect only while it is not linked: Disconnect and Connect again are on the provider's page", () => {
    expect(button(none)).toMatch(/data-bots-link-action="connect"[^>]*>Connect</);
    expect(button(linked)).toBe("");
    expect(button({ ...linked, enabled: false })).toBe("");
    expect(button({ ...linked, orgAllowed: false })).toBe("");
  });

  it("the page's button follows the state", () => {
    expect(botsLinkAction("connected")).toBe("disconnect");
    expect(botsLinkAction("off")).toBe("connect");
    expect(botsLinkAction("signedOut")).toBe("connect");
    expect(botsLinkAction("adminOff")).toBeNull();
  });
});

describe("the bots link block: first level", () => {
  it("shows the plain sentence, the state with its button and the two switches", () => {
    const top = firstLevel(block(linked));
    expect(top).toContain("Your bots here and your bots there can talk. A message from there is information, never an order.");
    expect(top).toMatch(/data-bots-link-action="disconnect"[^>]*>Disconnect</);
    expect(top).toContain('data-settings-row="grokBridgeMayCall"');
    expect(top).toContain("Those bots may call me");
    expect(top).toContain('data-settings-row="grokBridgeMayText"');
    expect(top).toContain("Those bots may text me");
  });

  it("never shows an address, the key, the header name, dead letters or circuit", () => {
    for (const view of [linked, { ...linked, enabled: false }, { ...linked, stats: { ...linked.stats!, circuitOpen: true, deadLetters: 3 } }]) {
      const top = firstLevel(block(view));
      expect(top).not.toContain("https://bots.example/hook");
      expect(top).not.toContain("/api/bridge/grok/");
      expect(top).not.toMatch(/x-bridge-signature/i);
      expect(top).not.toMatch(/dead letter|circuit|webhook|HMAC|link key/i);
      expect(top).not.toContain('type="password"');
      expect(top).not.toContain('data-settings-row="grokBridgeWebhook"');
      expect(top).not.toContain('data-settings-row="grokBridgeBots"');
    }
  });

  it("not linked: the Connect step asks Address and Key once, one Connect button", () => {
    const html = block(none);
    expect(html).toContain('data-bots-link-connect=""');
    expect(html).toMatch(/data-settings-row="grokBridgeAddress"[^>]*>.*?>Address</);
    expect(html).toMatch(/data-settings-row="grokBridgeConnectKey"[^>]*>.*?>Key</);
    expect(html).toMatch(/ui-button-primary[^"]*"[^>]*>Connect</);
    expect(html).not.toContain("data-bots-link-advanced");
    expect(html).not.toContain('data-settings-row="grokBridgeMayCall"');
  });

  it("organization off with a link: the state once, the link kept, no switch and no button", () => {
    const top = firstLevel(block({ ...linked, orgAllowed: false }));
    expect(count(top, "Turned off by your organization"), "the state is said once").toBe(1);
    expect(top).toContain("Your bots here and your bots there can talk.");
    expect(top).toContain("Your address and key are kept.");
    expect(top).not.toContain("data-bots-link-action");
    expect(top).not.toContain('data-settings-row="grokBridgeMayCall"');
  });
});

describe("the bots link block: Connect needs the address and the key", () => {
  const connectButton = (html: string) => /<button[^>]*data-bots-link-connect-submit[^>]*>/.exec(html)?.[0] ?? "";
  it("an address without a key never connects (nothing could be delivered)", () => {
    expect(connectButton(block({ ...none, webhookUrl: "https://bots.example/hook" }))).toContain(' disabled=""');
    expect(connectButton(block(none))).toContain(' disabled=""');
  });
  it("a key already saved is enough with the address", () => {
    expect(connectButton(block({ ...none, webhookUrl: "https://bots.example/hook", keySet: true }))).not.toContain(' disabled=""');
  });
});

describe("the bots link block: no Advanced of its own (B3, one Advanced per page)", () => {
  it("the block draws no fold named Advanced; its fields are a titled part of the page's Advanced", () => {
    const alone = renderToStaticMarkup(createElement(BlockAlone, { view: linked }));
    expect(alone).not.toContain("data-bots-link-advanced");
    expect(alone).not.toContain(">Advanced<");
    expect(alone).not.toContain("providers.linkedGrokBot.advanced");
    const more = advanced(block(linked));
    expect(more.startsWith('data-bots-link-advanced=""')).toBe(true);
    expect(block(linked)).toContain('data-settings-card="providers.linkedGrokBot.advanced"');
    expect(more).toMatch(/^[^<]*><span[^>]*>Your bots there<\/span>/);
    expect(more).not.toContain(">Advanced<");
  });
});

describe("the bots link: its part of Advanced holds every technical field (B4)", () => {
  it("address, replace the key, which bots, the address to give, save, test, the day's line, remove", () => {
    const more = advanced(block(linked));
    expect(more).toMatch(/data-settings-row="grokBridgeWebhook" data-settings-rowkind="field"/);
    expect(more).toContain("Address of your bots there");
    expect(more).toContain('value="https://bots.example/hook"');
    expect(more).toMatch(/data-settings-row="grokBridgeKey" data-settings-rowkind="field"/);
    expect(more).toContain("Replace the key");
    expect(more).not.toContain("link_abc\"<");
    expect(more).toMatch(/data-settings-row="grokBridgeBots" data-settings-rowkind="field"/);
    expect(more).toContain("Which bots there");
    expect(more).toContain('value="nimbus"');
    // the address to give is copied, never drawn; the header name only in its hint
    expect(more).toContain('data-settings-row="grokBridgeInbound"');
    expect(more).toContain("Address to give to the other app");
    expect(more).toContain('title="/api/bridge/grok/link_abc"');
    expect(more).not.toContain(">/api/bridge/grok/link_abc<");
    expect(more).toContain("X-Bridge-Signature");
    expect(more).toMatch(/ui-button-primary[^"]*"[^>]*>Save</);
    expect(more).toContain(">Send a test<");
    expect(more).toMatch(/text-danger[^"]*"[^>]*>Remove the link</);
    expect(more).toContain("Today: 12 sent, 0 not delivered. Delivery works.");
  });

  it("an open circuit reads in plain words", () => {
    const more = advanced(block({ ...linked, stats: { sentToday: 4, receivedToday: 0, deadLetters: 2, circuitOpen: true } }));
    expect(more).toContain("Today: 4 sent, 2 not delivered. Delivery is paused after repeated failures.");
  });

  it("organization off: Advanced keeps only Remove the link", () => {
    const more = advanced(block({ ...linked, orgAllowed: false }));
    expect(more).toContain("Remove the link");
    expect(more).not.toContain('data-settings-row="grokBridgeWebhook"');
    expect(more).not.toContain(">Send a test<");
  });

  it("French says tu and names no tool", () => {
    setLocale("fr");
    expect(botsLinkWords({ state: "connected" })).toMatch(/^Tes bots là-bas · /);
    const html = block(linked);
    expect(html).toContain("tes bots là-bas peuvent se parler");
    expect(html).toContain("Ces bots peuvent m&#x27;appeler");
    expect(html).toContain("Déconnecter");
    expect(firstLevel(html)).not.toMatch(/Grok\s+Bot|webhook|circuit|lettres mortes/i);
  });
});

describe("Org Grok Bridge policy", () => {
  it("draws the admin kill switch", () => {
    const html = renderToStaticMarkup(createElement(OrgGrokBridgePolicy, { initial: true }));
    expect(html).toContain('data-settings-card="organization.grokBridge"');
    expect(html).toContain('data-org-grok-bridge="on"');
    expect(html).toContain('data-settings-row="grokBridge"');
    expect(html).toContain("Link with Grok Bot");
    expect(html).not.toContain("Grok bridge");
  });
});
