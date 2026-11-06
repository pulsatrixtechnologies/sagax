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
  bots: ["cryptic"],
  mayCallOwner: false,
  mayTextOwner: true,
  orgAllowed: true,
  stats: { sentToday: 2, receivedToday: 0, deadLetters: 0, circuitOpen: false },
};

describe("Linked Grok Bot settings", () => {
  it("draws the linked card with webhook, opt-ins and inbound path", () => {
    const html = renderToStaticMarkup(createElement(LinkedGrokBotSettings, { initial: linked }));
    expect(html).toContain('data-settings-card="providers.linkedGrokBot"');
    expect(html).toContain('data-grok-bridge="on"');
    expect(html).toContain("https://grok.example/hook");
    expect(html).toContain('data-settings-row="grokBridgeMayCall"');
    expect(html).toContain('data-settings-row="grokBridgeMayText"');
    expect(html).toContain("/api/bridge/grok/link_abc");
  });

  it("shows the org kill message when the bridge is disabled for the org", () => {
    const html = renderToStaticMarkup(createElement(LinkedGrokBotSettings, {
      initial: { ...linked, orgAllowed: false },
    }));
    expect(html).toContain("An admin turned off the Grok bridge");
  });
});

describe("Org Grok Bridge policy", () => {
  it("draws the admin kill switch", () => {
    const html = renderToStaticMarkup(createElement(OrgGrokBridgePolicy, { initial: true }));
    expect(html).toContain('data-settings-card="organization.grokBridge"');
    expect(html).toContain('data-org-grok-bridge="on"');
    expect(html).toContain('data-settings-row="grokBridge"');
  });
});
