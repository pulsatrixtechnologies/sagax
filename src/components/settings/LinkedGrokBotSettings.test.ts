import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";

import type { GrokBridgeLinkView } from "@/lib/grok-bridge";
import { LinkedGrokBotSettings } from "./LinkedGrokBotSettings";
import { OrgGrokBridgePolicy } from "./OrgGrokBridgePolicy";

afterEach(() => vi.restoreAllMocks());

const linked: GrokBridgeLinkView = {
  linked: true,
  enabled: true,
  webhookUrl: "https://grok.example/hook",
  keySet: true,
  linkId: "link_abc",
  bots: ["nimbus"],
  mayCallOwner: false,
  mayTextOwner: true,
  orgAllowed: true,
  stats: { sentToday: 2, receivedToday: 0, deadLetters: 0, circuitOpen: false },
};

describe("Linked the reference app settings", () => {
  it("draws the linked card with webhook, opt-ins and inbound path", () => {
    const html = renderToStaticMarkup(createElement(LinkedGrokBotSettings, { initial: linked }));
    expect(html).toContain('data-settings-card="providers.linkedGrokBot"');
    expect(html).toContain('data-grok-bridge="on"');
    expect(html).toContain("https://grok.example/hook");
    expect(html).toContain('data-settings-row="grokBridgeMayCall"');
    expect(html).toContain('data-settings-row="grokBridgeMayText"');
    // #2682: the opaque link id is never drawn, only copied (tooltip)
    expect(html).toContain('data-settings-row="grokBridgeInbound"');
    expect(html).not.toContain(">/api/bridge/grok/link_abc<");
    expect(html).toContain('title="/api/bridge/grok/link_abc"');
  });

  it("is drawn like Web search: FieldRow fields, Save as the primary pill, no bridge wording (#2682)", () => {
    const html = renderToStaticMarkup(createElement(LinkedGrokBotSettings, { initial: linked }));
    for (const row of ["grokBridgeWebhook", "grokBridgeKey", "grokBridgeBots"]) {
      expect(html).toMatch(new RegExp(`data-settings-row="${row}" data-settings-rowkind="field"`));
    }
    expect(html).toMatch(/ui-button-primary[^"]*"[^>]*>Save link</);
    expect(html).toContain("Link with Grok Bot");
    expect(html).not.toMatch(/Grok bridge|Bridge on/i);
  });

  it("shows the org kill message when the bridge is disabled for the org", () => {
    const html = renderToStaticMarkup(createElement(LinkedGrokBotSettings, {
      initial: { ...linked, orgAllowed: false },
    }));
    expect(html).toContain("An admin turned off Link with Grok Bot");
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
