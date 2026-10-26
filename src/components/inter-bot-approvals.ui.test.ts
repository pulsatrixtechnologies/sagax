// A member's own bot looked locked on Auto (2026-10-19): a bot-to-bot
// conversation waited on a card the person could not see, and the bot
// editor locked the model for any busy conversation of the bot. Here:
// those cards join the open conversation's box, named by the bot that
// asked; the model waits only for the selected thread, and says why; with
// nothing to run on, the model menu says what to do.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({ value: { organization: false, state: "ready", adminNames: [] as string[] } as Record<string, unknown> }));
vi.mock("@/lib/org-engine-readiness", () => ({
  usePersonEngineReadiness: () => readiness.value,
  openOrgEngineSetup: vi.fn(),
}));

import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { approvalSources, interBotPendings } from "./parallel-approvals";
import { PendingApprovalPanel } from "./PendingApproval";
import { modelTurnLock } from "./bot-settings/ModelSection";
import { ModelNoEngineNotice } from "./ModelNoEngineNotice";

afterEach(() => {
  setLocale("en");
  readiness.value = { organization: false, state: "ready", adminNames: [] };
});

const card = (id: string, extra: Record<string, unknown> = {}): Message => ({
  id, role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "ls -la", options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "Bash", ...extra },
}) as never;

describe("bot-to-bot approvals", () => {
  it("join the open conversation's box after its parallel tasks, never the open one twice", () => {
    const bot = {
      threadId: "main",
      tasks: [{ threadId: "par", title: "Draft", activity: "waiting-on-you", parallelOf: { threadId: "main", messageId: "m", at: 1 } }],
      waitingApprovals: [
        { threadId: "work", openedByName: "Mira", kind: "work", updatedAt: 5 },
        { threadId: "main", openedByName: "Mira" },
        { threadId: "par", openedByName: "Mira" },
      ],
    } as never as Bot;
    expect(approvalSources(bot)).toEqual([
      { threadId: "par", title: "Draft", stamp: 0 },
      { threadId: "work", askedBy: "Mira", stamp: 5 },
    ]);
    expect(approvalSources({ threadId: "main", tasks: [] } as never)).toEqual([]);
  });

  it("name the bot that asked on the card, and answer in their own thread", () => {
    const [pending] = interBotPendings([card("a")], { threadId: "work", openedByName: "Mira" });
    expect(pending).toMatchObject({ threadId: "work", askedBy: "Mira", requestId: "req-a" });
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, bot: { id: "b", name: "Teo" } as never }));
    expect(html).toContain('data-approval-asked-by="work"');
    expect(html).toContain("Demandée par Mira");
    const [unnamed] = interBotPendings([card("b")], { threadId: "work" });
    expect(renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: unnamed!, count: 1, index: 0 }))).toContain("Demandée par un autre bot");
  });
});

describe("the bot editor's model lock", () => {
  const bot = (tasks: unknown[], messages: Message[] = []) => ({ id: "b", threadId: "main", busy: true, activity: "waiting-on-you", tasks, messages }) as never as Bot;

  it("ignores another conversation of the bot: only the selected thread holds a model change", () => {
    expect(modelTurnLock(bot([
      { threadId: "main", busy: false, activity: "idle" },
      { threadId: "work", busy: true, activity: "waiting-on-you", openedBy: { botId: "other", name: "Mira", at: 1 } },
    ]))).toEqual({ busy: false });
  });

  it("says whose answer the selected thread waits for", () => {
    expect(modelTurnLock(bot([{ threadId: "main", busy: true, activity: "working" }]))).toEqual({ busy: true, reason: "working" });
    expect(modelTurnLock(bot([{ threadId: "main", busy: true, activity: "waiting-on-you" }], [card("a")]))).toEqual({ busy: true, reason: "approval" });
    expect(modelTurnLock(bot([{ threadId: "main", busy: true, activity: "waiting-on-you" }], [card("a", { adminApproval: { kind: "server" } })])))
      .toEqual({ busy: true, reason: "admin" });
  });
});

describe("no engine for this person", () => {
  it("draws nothing on a solo server or once something answers", () => {
    expect(renderToStaticMarkup(createElement(ModelNoEngineNotice))).toBe("");
    readiness.value = { organization: true, state: "ready", adminNames: [] };
    expect(renderToStaticMarkup(createElement(ModelNoEngineNotice))).toBe("");
  });

  it("says to add their key or subscription, or to ask an admin in Perspicax", () => {
    setLocale("fr");
    readiness.value = { organization: true, state: "connect", adminNames: [] };
    let html = renderToStaticMarkup(createElement(ModelNoEngineNotice));
    expect(html).toContain('data-model-no-engine="connect"');
    expect(html).toContain("Ajoutez votre clé ou votre abonnement");
    expect(html).toContain("Qui a quoi");
    expect(html).toContain("data-model-no-engine-connect");
    readiness.value = { organization: true, state: "blocked", adminNames: ["Alice"] };
    html = renderToStaticMarkup(createElement(ModelNoEngineNotice));
    expect(html).toContain('data-model-no-engine="blocked"');
    expect(html).toContain("Contactez votre admin : Alice.");
    expect(html).not.toContain("data-model-no-engine-connect");
  });
});
