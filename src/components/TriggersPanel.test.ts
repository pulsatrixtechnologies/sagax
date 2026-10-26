import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { WebhookTrigger } from "@/lib/webhooks";
import { setLocale, t } from "@/lib/i18n";

// The pop-up's own state, seeded by call order (effects never run under
// server rendering): useWebhookActions owns 0–4, the builder 5–10.
const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  webhooks: [] as unknown[],
  bots: [] as unknown[],
  overrides: new Map<number, unknown>(),
  index: 0,
  counting: false,
  showThreads: true,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!fixture.counting) return react.useState(initial);
      const index = fixture.index++;
      const seeded = fixture.overrides.has(index) ? fixture.overrides.get(index) : typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [seeded, () => {}];
    },
  };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("@/state/store", async (importOriginal) => ({
  openBotThread: (await importOriginal<typeof import("@/state/store")>()).openBotThread,
  api: fixture.api,
  useStore: () => ({
    state: {
      bots: fixture.bots,
      webhooks: fixture.webhooks,
      webhookAttempts: [],
      routineRuns: [],
      webhookIngress: { available: true },
      instances: [],
      config: null,
    },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("@/components/Avatar", () => ({ BotAvatar: ({ bot }: { bot: Bot }) => createElement("span", { "data-avatar": bot.id }) }));
import { TRIGGER_SOURCES, TriggersPanel, triggerInput } from "./TriggersPanel";

const CREDENTIALS = 0;
const SOURCE = 5;
const BOT = 7;
const PROMPT = 8;
const TYPED_DRAFT = 11;
const SETUPS = 12;

const bot = (id: string, name: string) => ({ id, name, hidden: false, modelSelection: { instanceId: "claude", model: "m" } }) as unknown as Bot;
const webhook = (id: string, extra: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  id, endpointId: `ep-${id}`, name: "GitHub", prompt: "", botId: "scout", runOn: "maus", enabled: true,
  createdAt: 1, updatedAt: 1, deliveryCount: 4, lastReceivedAt: Date.now() - 5 * 60_000, tokenLast4: "k3Yz", ...extra,
});

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as ReactElement<Props>;
    return [node, ...nodes(node.props.children)];
  });
}
function render() {
  let tree!: ReturnType<typeof TriggersPanel>;
  function Capture() {
    fixture.index = 0;
    fixture.counting = true;
    try { tree = TriggersPanel(); } finally { fixture.counting = false; }
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.bots = [bot("scout", "Scout"), bot("atlas", "Atlas")];
  fixture.webhooks = [];
  fixture.overrides = new Map();
  fixture.showThreads = true;
  vi.stubGlobal("window", { confirm: () => true });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  setLocale("en");
  vi.unstubAllGlobals();
});

describe("Triggers pop-up", () => {
  it("reads as a sentence in a Settings window: When [source] → [bot] should", () => {
    const { html, nodes: tree } = render();
    expect(html).toContain(">Triggers</h2>");
    expect(html).toContain("Start a task the moment something happens, without asking.");
    expect(html).not.toContain("glass-surface");
    expect(html).toContain("data-dialog-close");
    expect(html).toContain(">When</span>");
    expect(html).toContain(">should</span>");
    // The source and the bot are pill menus (PillSelect): their choices.
    const menu = (label: string) => tree.find((node) => node.props.ariaLabel === label)!.props.options as Array<{ value: string; label: string }>;
    expect(menu(t("triggers.sourceAria")).map((option) => option.label)).toEqual(["Another app sends a link request", "Typeform", "Zapier", "Stripe", "Something else…",
      "GitHub", "GitLab", "Slack", "Microsoft Teams", "Outlook", "Outlook Calendar", "Sentry", "PagerDuty", "Linear", "Bot email"]);
    expect(menu(t("triggers.botAria"))).toContainEqual({ value: "atlas", label: "Atlas" });
    expect(html).toContain("Create trigger");
    expect(html).toContain("No triggers yet");
  });

  it("creates through the existing webhook API with the name, bot and instructions", async () => {
    fixture.overrides.set(SOURCE, "stripe");
    fixture.overrides.set(BOT, "atlas");
    fixture.overrides.set(PROMPT, "  Summarize the failed build.  ");
    const created = webhook("w1", { name: "Stripe", botId: "atlas" });
    fixture.api.mockResolvedValue({ webhook: created, credential: { endpointUrl: "https://hooks.example/w1", token: "whsec_w1", command: `curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"` } });
    const { nodes: tree } = render();
    const form = tree.find((node) => node.props["data-trigger-builder"] !== undefined)!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    await flush();
    expect(fixture.api).toHaveBeenCalledOnce();
    const [url, init] = fixture.api.mock.calls[0]!;
    expect(url).toBe("/api/webhooks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Stripe", prompt: "Summarize the failed build.", botId: "atlas", runOn: "maus",
      enabled: true, verificationPending: false, eventTypes: [], maxPendingRuns: null,
    });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: created });
  });

  it("names a custom source after what you typed, and falls back to the instructions", () => {
    const bots = fixture.bots as Bot[];
    expect(triggerInput({ source: "custom", customName: " New ticket ", botId: "scout", prompt: "" }, bots).name).toBe("New ticket");
    expect(triggerInput({ source: "custom", customName: "", botId: "scout", prompt: "Reply kindly. Then file it." }, bots).name).toBe("Reply kindly");
    expect(triggerInput({ source: "link", customName: "", botId: "scout", prompt: "" }, bots).name).toBe("Another app sends a link request");
    expect(TRIGGER_SOURCES.map((source) => source.id)).toEqual(["link", "typeform", "zapier", "stripe", "custom"]);
  });

  it("lists triggers as name → bot with deliveries, Copy command and an on/off switch", async () => {
    fixture.webhooks = [webhook("w1"), webhook("w2", { name: "Stripe", enabled: false, botId: "atlas", lastReceivedAt: undefined, deliveryCount: 0 })];
    fixture.overrides.set(CREDENTIALS, { w1: { endpointUrl: "https://hooks.example/w1", token: "whsec_w1", command: `curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"` } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { html, nodes: tree } = render();
    expect(html).toContain("Your triggers");
    expect(html).toContain('data-trigger-row="w1"');
    expect(html).toMatch(/GitHub<\/span>.*Scout<\/span>/);
    expect(html).toContain("4 received · last 5m ago");
    expect(html).toContain("Nothing received yet");
    // w1 holds a freshly shown token: Copy command twice (row and details).
    // w2 shows only the last 4 characters and a Regenerate button, no token.
    expect(html.match(/Copy command/g)).toHaveLength(2);
    expect(html).toContain("Bearer token ending in");
    expect(html).toContain("Copy it now. The full token is shown only this once.");
    expect(html).not.toContain("whsec_w2");
    expect(html).toMatch(/aria-label="GitHub on or off" type="button" role="switch" aria-checked="true"/);
    expect(html).toMatch(/aria-label="Stripe on or off" type="button" role="switch" aria-checked="false"/);
    expect(html).toContain("Advanced options");
    expect(html).toContain("Regenerate token");
    expect(html).toContain("Recent deliveries");

    const rows = tree.filter((node) => (node.props.webhook as WebhookTrigger | undefined)?.id);
    const first = rows.find((node) => (node.props.webhook as WebhookTrigger).id === "w1")!;
    (first.props.onCopy as (copy: "token" | "command", replace: boolean) => void)("command", false);
    await flush();
    expect(writeText).toHaveBeenCalledWith('curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"');
    expect(fixture.api).not.toHaveBeenCalled();

    fixture.api.mockResolvedValue({ webhook: { ...(fixture.webhooks[1] as WebhookTrigger), enabled: true } });
    const second = rows.find((node) => (node.props.webhook as WebhookTrigger).id === "w2")!;
    (second.props.onToggle as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w2", { method: "PATCH", body: JSON.stringify({ enabled: true, verificationPending: false }) });
  });

  it("opens a delivery's chat as before with threads shown, and by the switch alone with them hidden", () => {
    fixture.webhooks = [webhook("w1")];
    fixture.bots = [{ ...bot("scout", "Scout"), threadId: "scout-chat" }, bot("atlas", "Atlas")];
    const openChat = () => {
      fixture.dispatch.mockClear();
      const row = render().nodes.find((node) => (node.props.webhook as WebhookTrigger | undefined)?.id === "w1")!;
      (row.props.onOpenChat as (threadId: string) => void)("delivery-run");
      return fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type !== "toggleTriggers");
    };
    // a thread opened by name is shown, never a fresh topic over it (#763)
    const cleared = { type: "freshTopic", botId: "scout", threadId: null };
    expect(openChat()).toEqual([{ type: "select", id: "scout" }, { type: "switchTask", botId: "scout", threadId: "delivery-run" }, cleared]);
    // The thread Scout was on keeps its unread mark: only its activity row reaches it.
    fixture.showThreads = false;
    expect(openChat()).toEqual([{ type: "switchTask", botId: "scout", threadId: "delivery-run" }, cleared]);
  });

  it("closes through the store", () => {
    const { nodes: tree } = render();
    const close = tree.find((node) => node.props.label === "Close triggers")!; // the round DialogCloseButton
    (close.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleTriggers", open: false });
  });

  it("disables every row while another trigger action is pending", () => {
    fixture.webhooks = [webhook("w1"), webhook("w2", { name: "Stripe" })];
    fixture.overrides.set(1, "w1:command");
    const { html } = render();
    // Primary button, switch, regenerate, edit and delete on both rows (no
    // token is on screen, so there is no copy-command button).
    expect(html.match(/ disabled=""/g)).toHaveLength(10);
  });

  it("serializes copy, rotation and other mutations before a pending response returns", async () => {
    fixture.webhooks = [webhook("w1"), webhook("w2", { name: "Stripe" })];
    let resolveRotation!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise((resolve) => { resolveRotation = resolve; }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { nodes: tree } = render();
    const rows = tree.filter((node) => (node.props.webhook as WebhookTrigger | undefined)?.id);
    const copy = (index: number) => (rows[index]!.props.onCopy as (kind: "command", replace: boolean) => void)("command", true);
    copy(0);
    copy(1);
    copy(0);
    (rows[1]!.props.onToggle as () => void)();
    (rows[1]!.props.onDelete as () => void)();
    expect(fixture.api).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    resolveRotation({ webhook: fixture.webhooks[0], credential: { endpointUrl: "https://hooks.example/w1", token: "whsec_w1", command: `curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"` } });
    await flush();
    expect(writeText).toHaveBeenCalledWith('curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"');

    fixture.api.mockResolvedValueOnce({ webhook: fixture.webhooks[1], credential: { endpointUrl: "https://hooks.example/w2", token: "whsec_w2", command: `curl -X POST https://hooks.example/w2 -H "Authorization: Bearer whsec_w2"` } });
    copy(1);
    await flush();
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith('curl -X POST https://hooks.example/w2 -H "Authorization: Bearer whsec_w2"');
  });

  it("releases the mutation guard after failure or cancelling a rotation", async () => {
    fixture.webhooks = [webhook("w1")];
    fixture.api.mockRejectedValueOnce(new Error("Offline"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { confirm });
    const row = render().nodes.find((node) => (node.props.webhook as WebhookTrigger | undefined)?.id === "w1")!;
    const copy = row.props.onCopy as (kind: "command", replace: boolean) => void;
    copy("command", true);
    await flush();
    copy("command", true);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fixture.api).toHaveBeenCalledOnce();

    fixture.api.mockResolvedValueOnce({ webhook: fixture.webhooks[0], credential: { endpointUrl: "https://hooks.example/w1", token: "whsec_w1", command: `curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"` } });
    copy("command", true);
    await flush();
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledWith('curl -X POST https://hooks.example/w1 -H "Authorization: Bearer whsec_w1"');
  });

  it("shows only the last 4 characters of a copied token and asks before regenerating", async () => {
    fixture.webhooks = [webhook("w1")];
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() } });
    const { html, nodes: tree } = render();
    expect(html).toContain("Bearer token ending in k3Yz");
    expect(html).not.toContain("whsec_");
    const row = tree.find((node) => (node.props.webhook as WebhookTrigger | undefined)?.id === "w1")!;
    (row.props.onCopy as (kind: "command", replace: boolean) => void)("command", true);
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(String(confirm.mock.calls[0]).toLowerCase()).toContain("stops working immediately");
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("hands a start-up migrated token over once through reveal, without confirming or rotating", async () => {
    fixture.webhooks = [webhook("w1", { tokenPending: true })];
    const confirm = vi.fn(() => true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { confirm });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { html, nodes: tree } = render();
    expect(html).toContain("This webhook now needs a bearer token; copy it here.");
    expect(html).toContain("Show token");
    fixture.api.mockResolvedValueOnce({ webhook: fixture.webhooks[0], credential: { endpointUrl: "https://hooks.example/w1", token: "whsec_w1", command: "curl-command" } });
    const row = tree.find((node) => (node.props.webhook as WebhookTrigger | undefined)?.id === "w1")!;
    (row.props.onCopy as (kind: "command", replace: boolean) => void)("command", false);
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1/reveal", { method: "POST" });
    expect(writeText).toHaveBeenCalledWith("curl-command");
  });

  it("uses existing translated actions and English fallback keys for the new details", () => {
    fixture.webhooks = [webhook("w1")];
    setLocale("de");
    const { html } = render();
    expect(html).toContain(t("common.delete"));
    expect(html).toContain(t("triggers.regenerateToken"));
    expect(html).toContain("k3Yz");
    expect(html).not.toContain(">Delete</button>");
    expect(html).not.toContain(">Copy command</button>");
  });

  it("offers typed sources in their own group, next to the link-request presets", () => {
    const { html, nodes: tree } = render();
    const options = tree.find((node) => node.props.ariaLabel === t("triggers.sourceAria"))!.props.options as Array<{ value: string; group: string }>;
    expect(options.filter((option) => option.group === "Any app, with a bearer token").map((option) => option.value)).toEqual(["link", "typeform", "zapier", "stripe", "custom"]);
    expect(options.filter((option) => option.group === "Apps that sign their events").map((option) => option.value)).toEqual(["github", "gitlab", "slack", "teams", "email", "calendar", "sentry", "pagerduty", "linear"]);
    // bot email (2026-10-21) signs nothing: it comes through Perspicax, in a group of its own
    expect(options.filter((option) => option.group === "Mail to the bot's own address").map((option) => option.value)).toEqual(["botmail"]);
    expect(html).not.toContain("data-typed-fields");
  });

  it("shows events, filters and the generated-secret note for GitHub", () => {
    fixture.overrides.set(SOURCE, "github");
    const { html } = render();
    expect(html).toContain('data-typed-fields="github"');
    for (const label of ["Pull request opened", "Review requested", "CI failed", "Repository", "Branch", "Keywords"]) expect(html).toContain(label);
    expect(html).toContain("Sagax makes the signing secret; it is shown once after you create the trigger.");
    expect(html).not.toContain("data-typed-secret");
    expect(html).toContain("fenced as untrusted data, never as instructions");
  });

  it("asks Slack for its signing secret as a password field and notes deferred Graph filters", () => {
    fixture.overrides.set(SOURCE, "slack");
    const slack = render().html;
    expect(slack).toContain("Signing secret from Slack");
    expect(slack).toMatch(/type="password"[^>]*data-typed-secret/);
    fixture.overrides.set(SOURCE, "email");
    const mail = render().html;
    expect(mail).toContain("Checked by the bot, not a security boundary: Outlook sends no details with the notification.");
    expect(mail).toContain("Microsoft tenant ID (optional)");
  });

  it("creates a typed trigger with its source, filters and pasted secret, then keeps the setup in memory", async () => {
    fixture.overrides.set(SOURCE, "slack");
    fixture.overrides.set(TYPED_DRAFT, { events: ["mention", "nope"], filters: { channel: " C1, C2 ,C1", sender: "" }, signingSecret: " slack-secret-123 ", tenantId: "t", rateLimit: "30" });
    const created = webhook("w9", { name: "Slack", source: { type: "slack", events: ["mention"], filters: { channel: ["C1", "C2"] } }, signingSecretSet: true });
    fixture.api.mockResolvedValue({ webhook: created, sourceSetup: { endpointUrl: "https://hooks.example/sources/ep-w9" } });
    const { nodes: tree } = render();
    const form = tree.find((node) => node.props["data-trigger-builder"] !== undefined)!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
    await flush();
    const body = JSON.parse(fixture.api.mock.calls[0]![1].body);
    expect(body).toMatchObject({ name: "Slack", botId: "scout" });
    expect(body.source).toEqual({ type: "slack", events: ["mention"], filters: { channel: ["C1", "C2"] }, rateLimitPerMinute: 30 });
    expect(body.signingSecret).toBe("slack-secret-123");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: created });
  });

  it("never sends a pasted secret for a source whose secret Sagax makes", () => {
    const input = triggerInput({ source: "github", customName: "", botId: "scout", prompt: "" }, fixture.bots as Bot[],
      { events: [], filters: {}, signingSecret: "should-not-go", tenantId: "tenant", rateLimit: "999" });
    expect(input.signingSecret).toBeUndefined();
    expect(input.source).toEqual({ type: "github", events: [], filters: {} });
    expect(input.name).toBe("GitHub");
  });

  it("lists a typed trigger with its setup URL, test-fire and no bearer command", () => {
    fixture.webhooks = [webhook("w1", { source: { type: "github", events: ["ci.failed"], filters: { repo: ["acme/*"] } }, signingSecretSet: true })];
    fixture.overrides.set(SETUPS, { w1: { endpointUrl: "https://hooks.example/sources/ep-w1", secret: "whsec_once" } });
    const { html } = render();
    expect(html).toContain('data-trigger-source="github"');
    expect(html).toContain("Send a test event");
    expect(html).toContain("https://hooks.example/sources/ep-w1");
    expect(html).toContain("whsec_once");
    expect(html).toContain("Signing secret, shown only this once:");
    expect(html).toContain("CI failed");
    expect(html).toContain("Repository: acme/*");
    expect(html).not.toContain("Copy command");
    expect(html).not.toContain("Bearer token ending in");
  });

  it("builds the source URL from the receiver without any secret once the setup is gone", () => {
    fixture.webhooks = [webhook("w1", { source: { type: "linear", events: [], filters: {} }, signingSecretSet: false })];
    const { html } = render();
    expect(html).toContain("/sources/ep-w1");
    expect(html).not.toContain("whsec_");
    expect(html).toContain("No signing secret yet: every event is refused until you paste it.");
    expect(html).toContain("Signing secret from Linear");
  });

  it("is translated in French", () => {
    setLocale("fr");
    fixture.overrides.set(SOURCE, "github");
    fixture.webhooks = [webhook("w1", { source: { type: "github", events: [], filters: {} }, signingSecretSet: true })];
    const { html, nodes: tree } = render();
    const options = tree.find((node) => node.props.ariaLabel === t("triggers.sourceAria"))!.props.options as Array<{ group: string }>;
    expect(options.at(-2)!.group).toBe("Applications qui signent leurs événements");
    expect(options.at(-1)!.group).toBe("Courriel à l'adresse du bot");
    expect(html).toContain("Pull request ouverte");
    expect(html).toContain("Envoyer un événement test");
    expect(html).toContain("Secret de signature enregistré.");
  });
});
