import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookTrigger } from "@/lib/webhooks";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { webhookAttempts: [], routineRuns: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => createElement("span") }));
import { TypedTriggerRow, automationText, draftFromConfig, pollerCredentialsInput, sourceEndpointUrl, typedSourceConfig, typedTriggerInput } from "./TypedTriggers";

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as ReactElement<Props>;
    return [node, ...nodes(node.props.children)];
  });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const trigger = (extra: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  id: "w1", endpointId: "wh_abc", name: "PRs", prompt: "", botId: "b1", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 0,
  source: { type: "github", events: ["pr.opened"], filters: { repo: ["acme/*"] } }, signingSecretSet: true, ...extra,
});

function renderRow(webhook: WebhookTrigger, onSetup = vi.fn()) {
  let tree!: ReactElement;
  function Capture() {
    tree = TypedTriggerRow({
      webhook, bot: undefined, setup: undefined, baseUrl: "https://hooks.example/", busy: false,
      onToggle: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onSetup, onOpenChat: vi.fn(),
    });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  const all = nodes(tree);
  const button = (text: string) => all.find((node) => node.type === "button" && renderToStaticMarkup(node as ReactElement).includes(text))!;
  return { html, all, button };
}

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  vi.stubGlobal("window", { confirm: () => true });
});
afterEach(() => vi.unstubAllGlobals());

describe("typed trigger helpers", () => {
  it("parses comma-separated filters, drops unknown events, bounds the rate and keeps the tenant for Graph only", () => {
    const draft = { events: ["ci.failed", "mention"], filters: { repo: " a/b , a/* ,a/b", channel: "C1" }, signingSecret: "", tenantId: " t-1 ", rateLimit: "0" };
    expect(typedSourceConfig("github", draft)).toEqual({ type: "github", events: ["ci.failed"], filters: { repo: ["a/b", "a/*"] } });
    expect(typedSourceConfig("teams", { ...draft, events: [], rateLimit: "120" })).toEqual({ type: "teams", events: [], filters: { channel: ["C1"] }, rateLimitPerMinute: 120, tenantId: "t-1" });
    expect(typedSourceConfig("teams", { ...draft, events: [], rateLimit: "121" }).rateLimitPerMinute).toBeUndefined();
  });
  it("round-trips a stored config into an editable draft without any secret", () => {
    expect(draftFromConfig({ type: "github", events: ["pr.opened"], filters: { repo: ["a/b", "c/*"] }, rateLimitPerMinute: 5 })).toEqual({
      events: ["pr.opened"], filters: { repo: "a/b, c/*" }, signingSecret: "", tenantId: "", rateLimit: "5",
    });
  });
  it("builds a Graph connector or a poller from the draft, never both, and keeps the ICS link out of the source", () => {
    const base = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };
    expect(typedSourceConfig("email", { ...base, connection: "graph", graphConnector: "ms365|default", graphResource: "" })).toEqual({ type: "email", events: [], filters: {}, graph: { connector: "ms365" } });
    expect(typedSourceConfig("teams", { ...base, connection: "graph", graphConnector: "ms365|acct-abcdef12", graphResource: " teams/1/channels/2/messages " }).graph)
      .toEqual({ connector: "ms365", account: "acct-abcdef12", resource: "teams/1/channels/2/messages" });
    expect(typedSourceConfig("email", { ...base, connection: "poller", pollerHost: " imap.example.com ", pollerPort: "993", pollerUsername: "me", pollerSecret: "pw", pollerInterval: "99" }).poller)
      .toEqual({ kind: "imap", host: "imap.example.com", port: 993, username: "me" });
    const ics = { ...base, connection: "poller" as const, pollerKind: "ics" as const, pollerSecret: " https://cal.example.com/private.ics ", pollerLead: "0" };
    expect(typedSourceConfig("calendar", ics).poller).toEqual({ kind: "ics", leadMinutes: 0 });
    expect(pollerCredentialsInput("calendar", ics)).toEqual({ url: "https://cal.example.com/private.ics" });
    expect(typedTriggerInput("calendar", ics, { name: "Cal", prompt: "", botId: "b1" })).toMatchObject({ pollerCredentials: { url: "https://cal.example.com/private.ics" } });
    expect(JSON.stringify(typedSourceConfig("calendar", ics))).not.toContain("private.ics");
    expect(typedSourceConfig("github", { ...base, connection: "poller" }).poller).toBeUndefined();
    expect(pollerCredentialsInput("email", { ...base, connection: "manual", pollerSecret: "pw" })).toBeUndefined();
  });

  it("names the automation state by code, with a generic line for an unknown one", () => {
    expect(automationText({ kind: "poller", state: "error", code: "sign-in-refused", at: 1 })).toEqual({ text: "The server refused the sign-in", tone: "error" });
    expect(automationText({ kind: "graph", state: "error", code: "made-up", at: 1 })).toEqual({ text: "Connection problem", tone: "error" });
    expect(automationText(undefined)).toBeNull();
  });

  it("builds the source URL from the advertised base", () => {
    expect(sourceEndpointUrl("https://hooks.example/", { endpointId: "wh_x" })).toBe("https://hooks.example/sources/wh_x");
  });
});

describe("TypedTriggerRow", () => {
  it("test-fires through the existing test route", async () => {
    fixture.api.mockResolvedValue({ runId: "run-1", deliveryId: "test-1", duplicate: false });
    const { button } = renderRow(trigger());
    (button("Send a test event").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1/test", { method: "POST", body: "{}" });
  });

  it("saves events and filters as a PATCH of the source only", async () => {
    fixture.api.mockResolvedValue({ webhook: trigger() });
    const { button } = renderRow(trigger());
    (button("Save events and filters").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1", { method: "PATCH", body: JSON.stringify({ source: { type: "github", events: ["pr.opened"], filters: { repo: ["acme/*"] } } }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: trigger() });
  });

  it("asks before making a new generated secret and hands the new setup up once", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal("window", { confirm });
    const onSetup = vi.fn();
    fixture.api.mockResolvedValue({ webhook: trigger(), sourceSetup: { endpointUrl: "https://hooks.example/sources/wh_abc", secret: "whsec_new" } });
    const { button } = renderRow(trigger(), onSetup);
    (button("New signing secret").props.onClick as () => void)();
    await flush();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(String(confirm.mock.calls[0])).toContain("stops working immediately");
    (button("New signing secret").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1/rotate", { method: "POST" });
    expect(onSetup).toHaveBeenCalledWith({ endpointUrl: "https://hooks.example/sources/wh_abc", secret: "whsec_new" });
  });

  it("shows a poller's state and an empty write-only password field, never a stored value", () => {
    const webhook = trigger({ source: { type: "email", events: [], filters: {}, poller: { kind: "imap", host: "imap.example.com", username: "me" } }, pollerCredentialsSet: false,
      automation: { kind: "poller", state: "error", code: "no-credentials", at: 1 } });
    const { html } = renderRow(webhook);
    expect(html).toContain("No password or link yet");
    expect(html).toContain("Add the user name and password (or the link)");
    expect(html).not.toContain("No signing secret yet");
    const tag = html.match(/<input[^>]*data-typed-poller-secret[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('type="password"');
    expect(tag).toContain('value=""');
    expect(html).toContain("Sagax reads this source itself");
  });

  it("offers a write-only secret field for a provided secret, never a rotation", () => {
    const { html, all } = renderRow(trigger({ source: { type: "pagerduty", events: [], filters: {} }, signingSecretSet: false }));
    expect(html).toContain("No signing secret yet");
    expect(html).not.toContain("New signing secret");
    const field = all.find((node) => node.type === "input" && node.props.type === "password" && String(node.props["aria-label"]).includes("PagerDuty"));
    expect(field?.props.value).toBe("");
    expect(html).toContain("Generic Webhooks (v3)");
  });
});

describe("typed trigger labels (parity R5 to R7)", () => {
  it("gives every event and filter of every source an English and a French label", async () => {
    const { TRIGGER_SOURCES: sources } = await import("../../shared/trigger-sources");
    const en = (await import("../locales/en.json")).default as Record<string, string>;
    const fr = (await import("../locales/fr.json")).default as Record<string, string>;
    const keys = Object.values(sources).flatMap((source) => [
      ...source.events.map((kind) => `triggers.event.${kind.replace(/\./g, "_")}`),
      ...source.filters.map((key) => `triggers.filter.${key}`),
    ]);
    expect(keys.filter((key) => !en[key])).toEqual([]);
    expect(keys.filter((key) => !fr[key])).toEqual([]);
  });
  it("offers the new GitHub, Linear and Sentry events", async () => {
    const { TRIGGER_SOURCES: sources } = await import("../../shared/trigger-sources");
    expect(sources.github.events).toEqual(expect.arrayContaining([
      "pr.updated", "pr.review_approved", "pr.review_changes_requested", "pr.review_commented", "pr.comment", "pr.review_comment", "pr.thread_resolved", "pr.thread_reopened", "issue.assigned",
    ]));
    expect(sources.linear.events).toEqual(expect.arrayContaining(["issue.status_changed", "cycle.completed"]));
    expect(sources.sentry.events).toEqual(expect.arrayContaining(["issue.archived", "issue.unresolved"]));
  });
});

describe("review fixes in the editor (#942)", () => {
  it("shows a legacy “every event” trigger with the events it really runs for, so saving keeps them", async () => {
    const { TRIGGER_SOURCES: sources } = await import("../../shared/trigger-sources");
    expect(draftFromConfig({ type: "github", events: [], filters: {} }).events).toEqual([...sources.github.legacyEvents!]);
    expect(draftFromConfig({ type: "github", events: [], filters: {}, catalog: 2 }).events).toEqual([]);
    expect(draftFromConfig({ type: "pagerduty", events: [], filters: {} }).events).toEqual([]);
  });
  it("keeps the bot comments choice for GitHub only, off by default", () => {
    const base = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };
    expect(typedSourceConfig("github", base).includeBotComments).toBeUndefined();
    expect(typedSourceConfig("github", { ...base, includeBotComments: true }).includeBotComments).toBe(true);
    expect(typedSourceConfig("sentry", { ...base, includeBotComments: true }).includeBotComments).toBeUndefined();
    expect(draftFromConfig({ type: "github", events: [], filters: {}, catalog: 2, includeBotComments: true }).includeBotComments).toBe(true);
  });
  it("offers the bot comments switch with its help text on GitHub", async () => {
    const { TypedSourceFields } = await import("./TypedTriggers");
    const html = renderToStaticMarkup(createElement(TypedSourceFields, { type: "github", draft: { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" }, onChange: vi.fn(), creating: false }));
    expect(html).toContain('data-typed-bot-comments');
    expect(html).toContain("never start a run");
    const linear = renderToStaticMarkup(createElement(TypedSourceFields, { type: "linear", draft: { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" }, onChange: vi.fn(), creating: false }));
    expect(linear).not.toContain("data-typed-bot-comments");
  });
});

describe("Bot email trigger (B21, 2026-10-21)", () => {
  const empty = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };
  it("has no secret field and no URL when created, says mail comes through Perspicax, and the subject filter is a contains", async () => {
    const { TypedSourceFields } = await import("./TypedTriggers");
    const html = renderToStaticMarkup(createElement(TypedSourceFields, { type: "botmail", draft: empty, onChange: vi.fn(), creating: true }));
    expect(html).not.toContain("data-typed-secret");
    expect(html).not.toContain("signing secret");
    expect(html).toContain("No secret and no URL: mail arrives through Perspicax only.");
    expect(html).toContain("Matches when the subject contains one of the values.");
    expect(html).toContain('data-typed-filter="sender"');
    expect(html).toContain('data-typed-filter="subject"');
  });

  it("never sends a pasted secret for it", async () => {
    const { typedTriggerInput } = await import("./TypedTriggers");
    const input = typedTriggerInput("botmail", { ...empty, signingSecret: "pasted-secret-123" }, { name: "Mail", prompt: "", botId: "b1" });
    expect(input).not.toHaveProperty("signingSecret");
    expect(input.source).toEqual({ type: "botmail", events: [], filters: {} });
  });

  it("its row shows no URL, no secret and no missing-secret warning, only the relay note", () => {
    const { html } = renderRow(trigger({ source: { type: "botmail", events: [], filters: { subject: ["facture"] } }, signingSecretSet: undefined }));
    expect(html).not.toContain("/sources/");
    expect(html).not.toContain("wh_abc");
    expect(html).not.toMatch(/signing secret/i);
    expect(html).toContain("Bot email");
    expect(html).toContain("Nothing to set up: mail sent to this bot&#x27;s address reaches Perspicax");
    expect(html).not.toContain("New signing secret");
  });

  it("names the bot's address with a Copy button, or says it has none yet", async () => {
    const { BotMailAddressLine } = await import("./TypedTriggers");
    const html = renderToStaticMarkup(createElement(BotMailAddressLine, { mail: { available: true, address: "cryptic@bots.example.org", enabled: true } }));
    expect(html).toContain("This bot&#x27;s address");
    expect(html).toContain("cryptic@bots.example.org");
    expect(html).toContain("Copy address");
    const none = renderToStaticMarkup(createElement(BotMailAddressLine, { mail: { available: false, address: null, enabled: false } }));
    expect(none).toContain("This bot has no email address yet.");
    const off = renderToStaticMarkup(createElement(BotMailAddressLine, { mail: { available: true, address: "e@bots.example.org", enabled: false } }));
    expect(off).toContain("Waiting for the administrator to turn it on");
    expect(renderToStaticMarkup(createElement(BotMailAddressLine, { mail: null }))).toBe("");
  });
});

describe("Bot email: the owner's full-tools switch (v2, S2)", () => {
  const empty = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };
  it("is offered for bot email only, off by default, with its warning", async () => {
    const { TypedSourceFields } = await import("./TypedTriggers");
    const html = renderToStaticMarkup(createElement(TypedSourceFields, { type: "botmail", draft: empty, onChange: vi.fn(), creating: true }));
    expect(html).toContain("Give these runs the bot&#x27;s usual tools");
    expect(html).toContain("no shell, and every change or send asks you first");
    expect(html).toMatch(/data-botmail-full-tools=""[^>]*aria-checked="false"|aria-checked="false"[^>]*data-botmail-full-tools=""/);
    const github = renderToStaticMarkup(createElement(TypedSourceFields, { type: "github", draft: empty, onChange: vi.fn(), creating: true }));
    expect(github).not.toContain("data-botmail-full-tools");
  });

  it("is saved with the source and read back, for bot email only", async () => {
    const { typedSourceConfig, draftFromConfig } = await import("./TypedTriggers");
    expect(typedSourceConfig("botmail", { ...empty, allowFullTools: true })).toEqual({ type: "botmail", events: [], filters: {}, allowFullTools: true });
    expect(typedSourceConfig("botmail", empty)).toEqual({ type: "botmail", events: [], filters: {} });
    expect(typedSourceConfig("github", { ...empty, allowFullTools: true })).not.toHaveProperty("allowFullTools");
    expect(draftFromConfig({ type: "botmail", events: [], filters: {}, allowFullTools: true }).allowFullTools).toBe(true);
  });
});
