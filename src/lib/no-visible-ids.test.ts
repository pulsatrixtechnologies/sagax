// Guard for the owner's rule (2026-10-19): "N'affiche JAMAIS des GUID, on ne
// comprend rien." Key screens and labels are rendered with fixtures whose
// ids are UUIDs (bots, conversations, people, engines, accounts, folders);
// the test fails when a UUID, whole or cut short, reaches visible text. An
// id may stay in a tooltip (title) or a Copy action: attributes are not
// visible text and are left out.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { containsUuid, isOpaqueId, quotedIdOr, readableOr, sagaxFolder } from "../../shared/human-id";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";

vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
}));

const { botLabel, engineLabel, personLabel } = await import("./human-label");
const { humanPath, shortPath } = await import("./short-path");
const { VerifyCard } = await import("@/components/VerifyCard");
await import("@/components/dev-pods/all-pods");
const { devPodDefinitions } = await import("@/components/dev-pods/registry");
const { environmentData } = await import("@/components/dev-pods/pods/environment");
const { folderLabel } = await import("@/components/dev-pods/sources");

const { runAsOptionLabel } = await import("@/components/routines/RunAsField");
const { ownerLabel } = await import("@/components/settings/OrgSharing");
const { recipientLabel } = await import("@/components/bot-settings/AllowedRecipientsRow");
const { ResourceUsageBody } = await import("@/components/resource-usage/ResourceUsageCard");
const { ConnectorSetupBody } = await import("@/components/connector-setup/ConnectorSetupCard");
const { resolveConnectorSetupTarget } = await import("../../shared/connector-setup");
const { OutboundCard } = await import("@/components/OutboundCard");
const { WidgetBody } = await import("@/components/widget/WidgetBody");
const { netCheckWidget } = await import("../../shared/net-tools/widget");
const { NET_FIXTURES } = await import("../../shared/net-tools/fixtures");
const { RoutineChangeLine } = await import("@/components/RoutineToggleLine");
const { BotEmailAddressCard } = await import("@/components/bot-settings/BotEmailAddress");
const { BotMailAddressLine } = await import("@/components/TypedTriggers");
const { BotReachMeCard } = await import("@/components/bot-settings/BotReachMe");
const { reachMeFrom } = await import("@/lib/reach-me");
const { ModeChoice } = await import("@/components/bot-wizard/BotWizard");
const { newWizardDraft } = await import("../../shared/bot-wizard");
const { ApprovalsJournal } = await import("@/components/approvals/ApprovalsJournal");
const { RuleTestResults } = await import("@/components/approvals/RuleTest");

const BOT_ID = "5752d21c-e77c-4a83-84f0-66048216a5df";
const THREAD_ID = "d4eb1f10-ceef-428a-afdd-d53d1194c2e7";
const PERSON_ID = "pr_0b6f3c1e-2d4a-4c55-9a3b-7e1f00c2d9aa";
const ENGINE_ID = "claude-3f2a9d10-6b7c-4e21-8a0f-5c4d3e2b1a09";
const ACCOUNT_ID = "ca_9Xk2LmQ7pR4tV8wZ1yB3nC6d";
const TASK_FOLDER = `/Users/ann/Library/Application Support/Sagax/task-workspaces/${BOT_ID}/${THREAD_ID}`;

/** The text a person sees: markup without tags or attributes. */
function visibleText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function expectNoUuid(text: string): void {
  expect(containsUuid(text), `a UUID is visible: ${text}`).toBe(false);
}

describe("shared/human-id", () => {
  it("recognises UUIDs, whole or cut short, and other opaque ids", () => {
    expect(isOpaqueId(THREAD_ID)).toBe(true);
    expect(isOpaqueId(PERSON_ID)).toBe(true);
    expect(isOpaqueId(ENGINE_ID)).toBe(true);
    expect(isOpaqueId(ACCOUNT_ID)).toBe(true);
    expect(isOpaqueId("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b")).toBe(true);
    expect(containsUuid("d4eb1f10-ceef-428a-afdd-d53d119…")).toBe(true);
    expect(containsUuid("Environment d4eb1f10-ceef-428a")).toBe(true);
    expect(isOpaqueId("21m00Tcm4TlvDq8ikWAM")).toBe(true);
    for (const name of ["claude", "Pepper", "sagax", "feat/login-redirect", "ann@example.com", "build-01", "work-2024-10-19", "team_engineeringplatform", "release-candidatebuildnotes", "codex-2", "ara"]) {
      expect(isOpaqueId(name), name).toBe(false);
      expect(containsUuid(name), name).toBe(false);
    }
  });

  it("names the folders Sagax makes after ids", () => {
    expect(sagaxFolder(TASK_FOLDER)).toEqual({ kind: "conversation", rest: [] });
    expect(sagaxFolder(`${TASK_FOLDER}/src/app`)).toEqual({ kind: "conversation", rest: ["src", "app"] });
    expect(sagaxFolder(`/data/parallel-worktrees/${BOT_ID}/${THREAD_ID}`)).toEqual({ kind: "parallel", rest: [] });
    expect(sagaxFolder(`/data/workspaces/${BOT_ID}`)).toEqual({ kind: "bot", rest: [] });
    expect(sagaxFolder("/Users/ann/work/sagax")).toBeNull();
  });

  it("keeps a readable name and replaces an opaque one", () => {
    expect(readableOr("Work", "Account 1")).toBe("Work");
    expect(readableOr(ACCOUNT_ID, "Account 1")).toBe("Account 1");
    expect(quotedIdOr("ghost", "the selected engine")).toBe("\"ghost\"");
    expect(quotedIdOr(ENGINE_ID, "the selected engine")).toBe("the selected engine");
  });
});

describe("no UUID on screen", () => {
  setLocale("en");

  it("paths read as folders, never as ids", () => {
    expect(shortPath(TASK_FOLDER, "/Users/ann")).toBe(t("folder.conversation"));
    expect(shortPath(`${TASK_FOLDER}/src`, "/Users/ann")).toBe(`${t("folder.conversation")}/src`);
    expect(shortPath("/Users/ann/work", "/Users/ann")).toBe("~/work");
    expectNoUuid(humanPath(`/srv/cache/${THREAD_ID}/out`));
    expect(folderLabel(TASK_FOLDER)).toBe(t("folder.conversation"));
    expect(folderLabel(`${TASK_FOLDER}/web`)).toBe("web");
    expect(folderLabel("/Users/ann/sagax")).toBe("sagax");
  });

  it("the Environment card names the folder and the branch, the id only in tooltips", () => {
    const definition = devPodDefinitions().find((entry) => entry.id === "environment")!;
    const branchRow: Message = {
      id: "m1", role: "bot", kind: "activity", at: 1,
      tool: { name: "Bash", ok: true, summary: `git switch sagax/parallel-${THREAD_ID.slice(0, 12)}`, output: `Switched to branch 'sagax/parallel-${THREAD_ID.slice(0, 12)}'` },
    };
    const bot = { id: BOT_ID, threadId: THREAD_ID, name: "Pepper", cwd: TASK_FOLDER, computer: "local", messages: [branchRow], tasks: [] } as unknown as Bot;
    const data = environmentData({ bot, task: undefined, messages: [branchRow], computerStart: undefined });
    expect(data).not.toBeNull();
    const markup = renderToStaticMarkup(createElement(definition.Body, { data, ctx: { bot, task: undefined, messages: [branchRow], threadKey: `${BOT_ID}:${THREAD_ID}`, computerStart: undefined, dispatch: () => undefined } }));
    const text = visibleText(createElement(definition.Body, { data, ctx: { bot, task: undefined, messages: [branchRow], threadKey: `${BOT_ID}:${THREAD_ID}`, computerStart: undefined, dispatch: () => undefined } }));
    expectNoUuid(text);
    expect(text).toContain(t("folder.conversation"));
    expect(text).toContain(t("folder.parallelBranch"));
    // the full path stays reachable for support, in the tooltip
    expect(markup).toContain(`title="${TASK_FOLDER}"`);
  });

  it("the This run card shows commands and labels, not step ids", () => {
    const text = visibleText(createElement(VerifyCard, {
      steps: [
        { id: THREAD_ID, label: "ssh", command: "ssh build-01 \"df -h\"", status: "passed", dryRun: false, verified: false },
        { id: BOT_ID, label: "git commit", command: "git commit -m \"Fix\"", status: "running", dryRun: false, verified: false },
      ],
      canSave: true, skill: null, onDismiss: () => undefined, onSave: () => undefined,
    }));
    expectNoUuid(text);
    expect(text).toContain("ssh build-01");
  });

  it("the usage card names the computer, never a sampler id or a UUID in its host name", () => {
    const text = visibleText(createElement(ResourceUsageBody, {
      view: { samplerId: "ru_0123456789abcdef01", target: "host", label: "Serveur web", hostLabel: BOT_ID },
      snapshot: { id: "ru_0123456789abcdef01", state: "live", host: { hostname: `srv ${THREAD_ID}`, os: "Linux" }, frames: [{ t: 1, cpu: { total: 5 }, mem: null, disk: null, net: null, volumes: [{ name: `/mnt/${PERSON_ID}`, used: 1, total: 2 }] }] },
      scheme: "light",
    }));
    expectNoUuid(text);
    expect(text).not.toContain("ru_0123456789abcdef01");
  });

  it("the Connect card names the connector, never its card id, its owner digest or a UUID", () => {
    const view = { id: "cs_0123456789abcdef01", connector: "microsoft-teams", label: "Microsoft Teams", provider: "grok" as const, url: "https://grok.com/connectors", status: "pending" as const, owner: "0123456789abcdef", createdAt: 1 };
    const text = visibleText(createElement(ConnectorSetupBody, { view, checking: false, opened: true, onConnect: () => undefined, onDone: () => undefined }));
    expectNoUuid(text);
    expect(text).toContain("Microsoft Teams");
    expect(text).not.toContain("cs_0123456789abcdef01");
    expect(text).not.toContain("0123456789abcdef");
    // a bot that passes an id as the connector's name gets no card at all
    expect(resolveConnectorSetupTarget(BOT_ID)).toBeNull();
  });

  it("a phone call and a purchase card name the bot and the shop, never the record id (parité R13)", () => {
    setLocale("fr");
    const base = { id: THREAD_ID, role: "bot" as const, kind: "text" as const, text: "", at: 0 };
    const call = { ...base, outbound: { kind: "call" as const, id: "call_0123456789abcdef", status: "pending" as const, botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer", script: "Bonjour", callback: "+1 438 555 0199" } } as unknown as Message;
    const pay = { ...base, outbound: { kind: "purchase" as const, id: "pay_0123456789abcdef", status: "done" as const, botName: "Rocket", merchant: "Boutique", amount: "45.20", currency: "CAD", items: [{ name: "Câble", quantity: 3 }], orderRef: "A-1" } } as unknown as Message;
    for (const message of [call, pay]) {
      const text = visibleText(createElement(OutboundCard, { message }));
      expectNoUuid(text);
      expect(text).not.toMatch(/(call|pay)_[0-9a-f]{16}/);
    }
    expect(visibleText(createElement(OutboundCard, { message: call }))).toContain("Appel vers +1 514 555 0142");
    expect(visibleText(createElement(OutboundCard, { message: call }))).toContain("Ne pas appeler");
    expect(visibleText(createElement(OutboundCard, { message: pay }))).toMatch(/3 articles achetés · 45,20\s\$/);
    setLocale("en");
  });

  it("the wizard's drafts to resume name the bot, or a plain word, never its id", () => {
    const draft = (botName: string) => ({ ...newWizardDraft({ botId: BOT_ID, owner: PERSON_ID, origin: "new", mode: "manual", now: 1 }), botName, guidedThreadId: THREAD_ID });
    const text = visibleText(createElement(ModeChoice, { busy: null, guideName: "Chef", drafts: [draft("Nova"), draft("")], onChoose: () => {}, onResume: () => {}, onDiscard: () => {} }));
    expect(text).toContain("Nova");
    expect(text).toContain(t("botWizard.unnamed"));
    expect(containsUuid(text)).toBe(false);
  });

  it("a routine change line names the routine, never its id", () => {
    const event = { action: "updated" as const, turnKey: "u1", routines: [{ id: THREAD_ID, name: "Revue des billets ACME", botId: BOT_ID }] };
    for (const action of ["created", "updated", "deleted"] as const) {
      expectNoUuid(visibleText(createElement(RoutineChangeLine, { event: { ...event, action }, canOpen: () => true, onOpen: () => {} })));
    }
  });

  it("allowed recipients name a bot, never its id (parité 1C)", () => {
    const bots = [{ id: BOT_ID, name: "Quasar" }];
    expect(recipientLabel(`bot:${BOT_ID}`, bots)).toEqual({ text: "Quasar", title: BOT_ID });
    expectNoUuid(recipientLabel(`bot:${THREAD_ID}`, bots).text);
    expect(recipientLabel("email:ana@example.com", bots).text).toBe("ana@example.com");
  });

  it("an IT tools card names the check and the target, never an id", () => {
    for (const result of Object.values(NET_FIXTURES)) {
      const root = netCheckWidget(result, "en");
      const text = visibleText(createElement(WidgetBody, { root, headed: false }));
      expectNoUuid(text);
      expect(text).toContain("Explain");
      expectNoUuid(String(root.title));
      expectNoUuid(String(root.caption));
    }
  });

  it("the bot email address row and the trigger's address line show the address, never the bot's id (B21)", () => {
    const mail = { available: true, address: "cryptic@bots.example.org", enabled: false };
    for (const element of [createElement(BotEmailAddressCard, { mail }), createElement(BotMailAddressLine, { mail })]) {
      const text = visibleText(element);
      expectNoUuid(text);
      expect(text).toContain("cryptic@bots.example.org");
      expect(text).not.toContain(BOT_ID);
    }
  });

  it("Reach me names channels and the Telegram bot by its @username, never an id (2026-10-26)", () => {
    const view = reachMeFrom({ saved: true, settings: { channels: ["telegram", "sms"], smsNumber: "+15145550123", hours: { always: true } }, channels: { telegram: { ready: true, connected: true, username: "my_sagax_bot" }, sms: { ready: false, reason: `bot ${BOT_ID}` } } });
    const actions = { onSave: async () => ({ ok: true as const }), onTelegramConnect: async () => ({ ok: true as const }), onTelegramDisconnect: async () => {} };
    const text = visibleText(createElement(BotReachMeCard, { view, actions }));
    expectNoUuid(text);
    expect(text).toContain("@my_sagax_bot");
  });

  it("people, bots, engines and accounts read by name or a plain word", () => {
    const labels = [
      personLabel(undefined, PERSON_ID),
      personLabel("", "ann@example.com", PERSON_ID),
      botLabel(undefined, BOT_ID),
      engineLabel(undefined, ENGINE_ID),
      personLabel(undefined, PERSON_ID),
      runAsOptionLabel({ principalId: PERSON_ID, name: "", selectable: false }),
      ownerLabel({ ownerName: "", ownerPrincipalId: PERSON_ID } as Parameters<typeof ownerLabel>[0]),
    ];
    for (const label of labels) {
      expectNoUuid(label);
      expect(isOpaqueId(label), label).toBe(false);
    }
    expect(personLabel(undefined, PERSON_ID)).toBe(t("ids.unknownPerson"));
    expect(personLabel("", "ann@example.com", PERSON_ID)).toBe("ann@example.com");
    expect(botLabel(undefined, BOT_ID)).toBe(t("ids.deletedBot"));
    expect(engineLabel(undefined, ENGINE_ID)).toBe(t("ids.removedEngine"));
    expect(engineLabel(undefined, "claude")).toBe("claude");
  });
  it("the Journal names the bot, the action and the rule, never an id (2026-10-26)", () => {
    const entries = [
      { key: `${THREAD_ID}:${BOT_ID}`, at: "2026-10-26T12:00:00.000Z", botId: BOT_ID, botName: "Quasar", threadId: THREAD_ID, requestId: THREAD_ID,
        tool: "Bash", summary: `rm -rf /srv/${BOT_ID}`, outcome: "denied" as const, decider: "custom-rule" as const, source: "custom-rule-deny",
        ruleText: `supprimer dans /srv/${THREAD_ID}`, ruleId: THREAD_ID, askedBy: "level" as const, askedSource: "no-grant" },
      { key: `run:${THREAD_ID}`, at: "2026-10-26T12:01:00.000Z", botId: BOT_ID, botName: BOT_ID, threadId: THREAD_ID, tool: `mcp__${BOT_ID}__read`,
        outcome: "allowed" as const, decider: "grant" as const, guard: { allow: false, reason: "speaker_not_granted", mode: "shadow", scope: "agents:admin" }, answeredBy: PERSON_ID },
    ];
    expectNoUuid(visibleText(createElement(ApprovalsJournal, { data: { entries, days: 7 }, loading: false, days: 7, onDays: () => {}, query: "", onQuery: () => {} })));
    expectNoUuid(visibleText(createElement(RuleTestResults, { result: {
      days: 7, scanned: 2, matched: 1, counts: { allowed: 0, asked: 0, denied: 1, cardStays: 0, changed: 1 },
      hits: [{ key: THREAD_ID, at: "2026-10-26T12:00:00.000Z", botName: "Quasar", tool: "Bash", summary: `cat /srv/${BOT_ID}`, actual: "allowed", would: "denied", changed: true }],
    } })));
  });
});
