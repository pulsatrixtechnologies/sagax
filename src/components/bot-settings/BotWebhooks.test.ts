// Persona > Access > Webhooks (2026-10-29): this bot's webhooks, listed
// only; a routine's webhook opens its routine, a webhook of its own opens
// Automations > Webhooks. No second place to manage them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus } from "@/state/store";
import type { WebhookTrigger } from "@/lib/webhooks";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ webhooks: [] as unknown[], routines: [] as unknown[], config: null as unknown }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({
    state: { bots: [], webhooks: fixture.webhooks, routines: fixture.routines, webhookAttempts: [], routineRuns: [], webhookIngress: { available: true }, instances: [], config: fixture.config },
    dispatch: vi.fn(),
  }),
}));
import { BotWebhooks, canManageBotWebhooks } from "./BotWebhooks";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";

const bot = { id: "scout", name: "Scout", ownerUserId: "owner@example.test", modelSelection: { instanceId: "claude", model: "m" } } as unknown as Bot;
const webhook = (id: string, extra: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  id, endpointId: `ep-${id}`, name: "GitHub", prompt: "", botId: "scout", runOn: "maus", enabled: true,
  createdAt: 1, updatedAt: 1, deliveryCount: 4, tokenLast4: "k3Yz", ...extra,
});
const member = (principalId: string) => ({ viewer: { role: "member", principalId } }) as unknown as ConfigStatus;
const render = () => renderToStaticMarkup(createElement(BotWebhooks, { bot }));

beforeEach(() => {
  setLocale("en");
  fixture.config = null;
  fixture.routines = [{ id: "r1", name: "New order", botId: "scout" }];
  fixture.webhooks = [webhook("w1", { routineId: "r1" }), webhook("w2", { name: "Monitor" }), webhook("other", { botId: "someone-else", name: "Not mine" })];
});

describe("BotWebhooks", () => {
  it("lists only this bot's webhooks, each opening where it is managed", () => {
    const html = render();
    expect(html).toContain('data-bot-webhook="w1"');
    expect(html).toContain("New order");
    expect(html).toContain('data-open-webhook-home="routine"');
    expect(html).toContain("Open the routine");
    expect(html).toContain('data-bot-webhook="w2"');
    expect(html).toContain('data-open-webhook-home="automations"');
    expect(html).toContain("Open in Automations");
    expect(html).not.toContain("Not mine");
    expect(html).toContain("4 deliveries");
  });

  it("keeps no second copy of the management: no create, rotate, delete or token here", () => {
    const html = render();
    expect(html).not.toContain("data-new-webhook");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("Regenerate");
    expect(html).not.toContain("whsec_");
  });

  it("says who manages a bot's webhooks", () => {
    expect(canManageBotWebhooks(member("owner@example.test"), bot)).toBe(true);
    expect(canManageBotWebhooks(member("someone@example.test"), bot)).toBe(false);
    expect(canManageBotWebhooks(null, bot)).toBe(true);
  });

  it("says its empty state in one line", () => {
    fixture.webhooks = [];
    expect(render()).toContain("No webhooks for this bot.");
  });
});

// The bot's profile page (#2313): the webhooks card carries its own grey
// label, each webhook is a reference row and opens with a plain pill.
describe("BotWebhooks on the profile page (plain surface)", () => {
  const plain = () => renderToStaticMarkup(createElement(SettingsSurfaceProvider, { surface: "plain", children: createElement(BotWebhooks, { bot }) }));
  // HelpTip popovers keep their own outline (a floating surface, not a card).
  const withoutPopovers = (markup: string) => markup.replace(/<div[^>]*popover-surface[\s\S]*?<\/div>/g, "");

  it("labels its card and keeps every row and action, with no border, underline or primary pill", () => {
    const html = plain();
    expect(html).toContain(">Webhooks<");
    expect(html).toContain('data-bot-webhook="w1"');
    expect(html).toContain('data-bot-webhook="w2"');
    expect(html).toContain("Open the routine");
    expect(html).toContain("Open in Automations");
    expect(html).toContain("4 deliveries");
    expect(html).toMatch(/data-open-webhook-home="routine"[^>]*class="[^"]*ui-button/);
    const bare = withoutPopovers(html);
    expect(bare).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
    expect(bare).not.toContain("underline");
    expect(bare).not.toContain("ui-button-primary");
  });

  it("says its empty state in the same card", () => {
    fixture.webhooks = [];
    const html = plain();
    expect(html).toContain(">Webhooks<");
    expect(html).toContain("No webhooks for this bot.");
    expect(withoutPopovers(html)).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
  });
});
