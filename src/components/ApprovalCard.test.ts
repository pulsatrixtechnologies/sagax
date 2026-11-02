import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { adminWillAnswerLine, ApprovalCard } from "./ApprovalCard";
import { approvalWho } from "./PerspicaxOrgSettings";
import { pendingApprovals, PendingApprovalPanel, spokenApprovalPrompt, type Pending } from "./PendingApproval";
import type { Bot, Message } from "@/state/store";
import { skillRequestBehavior } from "../../shared/skill-request";

const routineRequest = {
  version: 1 as const,
  requestId: "routine-request",
  botId: "bot-1",
  threadId: "thread-1",
  createdAt: 1,
};

const createRoutineOperation = {
  action: "create" as const,
  routine: {
    name: "Backlog review",
    instructions: "Review every item in the backlog.",
    schedule: { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] },
    runOn: "maus" as const,
    durationMinutes: 30,
  },
};

/** An open tool request reads in full in the composer's box, its one card
 * (owner, 2026-10-15); the thread keeps a quiet waiting line. */
function openRequestHtml(message: Message, bot?: Bot): string {
  const pending: Pending = pendingApprovals([message])[0]
    ?? { message, requestId: message.card!.requestId!, tool: message.card!.tool ?? "", detail: message.card!.subtitle };
  return renderToStaticMarkup(createElement(PendingApprovalPanel, { pending, count: 1, index: 0, bot }));
}

describe("ApprovalCard decided by voice", () => {
  const bash = (answered: string, via?: "call"): Message => ({
    id: "bash-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "rm -rf build",
      options: ["Allow", "Deny"],
      requestId: "r1",
      tool: "Bash",
      answered,
      answeredBy: { kind: "loopback", ...(via ? { via } : {}) },
    },
  });

  it("says a card was decided by voice on a Live call", () => {
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow", "call") }))).toMatch(/Allowed.*by voice/);
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("deny", "call") }))).toMatch(/Declined.*by voice/);
  });

  it("says nothing extra for a tap", () => {
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow") }))).not.toContain("by voice");
  });

  it("says automatic review is in progress while the reviewer has the card (lot A1b)", () => {
    const message: Message = {
      id: "reviewing",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Approval needed",
        subtitle: "pnpm test",
        options: ["Allow", "Deny"],
        requestId: "r-review",
        tool: "Bash",
        reviewing: true,
      },
    };
    const html = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(html).toContain("Automatic review in progress");
    expect(html).toContain('data-auto-review="pending"');
    expect(openRequestHtml(message)).toContain("Automatic review in progress");
  });
});

describe("ApprovalCard routine proposals", () => {
  it("describes a chat-created routine as scheduling rather than a raw tool call", () => {
    const message: Message = {
      id: "routine-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Confirm routine",
        subtitle: "Weekdays at 09:00",
        options: ["Confirm", "Cancel"],
        requestId: "routine-request",
        tool: "schedule_routine",
        routineRequest: { ...routineRequest, operation: createRoutineOperation },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("Wants to schedule a routine");
    expect(markup).toContain("Weekdays at 09:00");
  });

  it("records the exact routine action after confirmation", () => {
    const message: Message = {
      id: "routine-delete-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Delete “Daily inbox”?",
        subtitle: "Delete “Daily inbox”?\nWhen: Weekdays at 09:00",
        options: ["Confirm", "Cancel"],
        answered: "allow",
        requestId: "routine-request",
        tool: "manage_routine",
        routineRequest: {
          ...routineRequest,
          operation: { action: "delete", routineId: "routine-1", expectedUpdatedAt: 1 },
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("Delete “Daily inbox”?");
    expect(markup).toContain("Routine deleted");
  });

  it("does not imply a run-now request has already started", () => {
    const message: Message = {
      id: "routine-run-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Run now “Daily inbox”?",
        subtitle: "Action: Run routine now\nName: Daily inbox",
        options: ["Confirm", "Cancel"],
        answered: "allow",
        requestId: "routine-request",
        tool: "manage_routine",
        routineRequest: {
          ...routineRequest,
          operation: { action: "run_now", routineId: "routine-1", expectedUpdatedAt: 1 },
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("Routine run queued");
    expect(markup).not.toContain("Routine started");
  });

  it("speaks a routine's concise title instead of narrating all instructions", () => {
    const instructions = "Review every item in the backlog. ".repeat(500);
    const message: Message = {
      id: "routine-voice-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Schedule routine “Backlog review”?",
        subtitle: `Action: Create routine\n\nInstructions:\n${instructions}`,
        options: ["Confirm", "Cancel"],
        requestId: "routine-request",
        tool: "schedule_routine",
        routineRequest: { ...routineRequest, operation: createRoutineOperation },
      },
    };
    const pending: Pending = {
      message,
      requestId: "routine-request",
      tool: "schedule_routine",
      detail: message.card!.subtitle,
    };

    const spoken = spokenApprovalPrompt(pending, "Mochi");
    expect(spoken).toContain("Schedule routine “Backlog review”?");
    expect(spoken).toContain("Review the schedule and instructions on screen");
    expect(spoken).not.toContain("Review every item in the backlog");
    expect(spoken.length).toBeLessThan(200);
  });
});

describe("ApprovalCard profile proposals", () => {
  const card = (answered?: string) => ({
    title: "Set up Scout?",
    subtitle: 'Why: you asked\nName: "Scout" → "Kiwi"\nSOUL.md (0 → 9 bytes):\n+Be brief.\nChanges what Scout is told on every turn. Nothing runs.',
    options: ["Confirm", "Cancel"],
    requestId: "req-p1",
    tool: "update_profile",
    answered,
    profileRequest: {
      version: 1 as const, requestId: "req-p1", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
      createdAt: 1, reason: "you asked", changes: { name: "Kiwi", soul: "Be brief." }, before: { name: "Scout", soul: "" }, expectedRevision: "r",
    },
  });

  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("describes a profile proposal as a profile update and shows the diff", () => {
    const message: Message = {
      id: "profile-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: card(),
    };

    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(html).toContain("wants to update its profile");
    // the internal tool id is not shown on a proposal
    expect(html).not.toContain("update_profile");
    expect(html).toContain("+Be brief.");
    expect(html).toContain("Nothing runs.");
  });

  it("records Profile updated after confirmation", () => {
    const message: Message = {
      id: "profile-card-answered",
      role: "bot",
      kind: "options",
      at: 1,
      card: card("allow"),
    };

    expect(renderToStaticMarkup(createElement(ApprovalCard, { bot, message }))).toContain("Profile updated");
  });

  it("names the actual target in the header when a Chief proposes for a peer", () => {
    const crossCard = card();
    crossCard.profileRequest = {
      ...crossCard.profileRequest,
      targetBotId: "bot-2",
      targetName: "Peer",
    };
    const message: Message = {
      id: "profile-card-cross",
      role: "bot",
      kind: "options",
      at: 1,
      card: crossCard,
    };

    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(html).toContain("Scout wants to update @Peer");
    expect(html).toContain("profile</span>");
    expect(html).not.toContain("wants to update its profile");
  });

  it("speaks the card's concise title, not the full diff, and shows an imperative strip label", () => {
    const message: Message = {
      id: "profile-voice-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: card(),
    };
    const pending: Pending = {
      message,
      requestId: "req-p1",
      tool: "update_profile",
      detail: message.card!.subtitle,
    };

    const spoken = spokenApprovalPrompt(pending, "Mochi");
    expect(spoken).toBe('Mochi wants to update its profile: Set up Scout?. Review the change on screen. Should I confirm it?');
    expect(spoken).not.toContain("SOUL.md");
    expect(spoken).not.toContain("+Be brief.");

    const strip = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending, count: 1, index: 0 }));
    expect(strip).toContain("Confirm this profile change");
  });
});

describe("ApprovalCard learned skills", () => {
  it("maps create and update choices to approval while keeping refusals denied", () => {
    expect(skillRequestBehavior("Enable")).toBe("allow");
    expect(skillRequestBehavior("Update")).toBe("allow");
    expect(skillRequestBehavior("Apply")).toBe("allow");
    expect(skillRequestBehavior("Deny")).toBe("deny");
    expect(skillRequestBehavior("Dismiss")).toBe("deny");
    expect(skillRequestBehavior("unexpected")).toBe("deny");
  });

  it("describes a staged skill as enablement rather than a raw tool call", () => {
    const message: Message = {
      id: "skill-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Enable skill "file-expense"?',
        subtitle: "Files an expense in the company portal.",
        options: ["Enable", "Deny"],
        requestId: "skill-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "skill-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-1",
          action: "create",
          name: "file-expense",
          gist: "Files an expense in the company portal.",
          source: "learn:conversation",
          preview: "---\nname: file-expense\ndescription: Files an expense.\n---\n\n# File expense\n",
          sha256: "abcdef0123456789".repeat(4),
          warnings: [],
          createdAt: 1,
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("enable a learned skill");
    expect(markup).toContain("Files an expense in the company portal.");
    expect(markup).toContain("Review the complete SKILL.md before enabling");
    expect(markup).toContain("Source: learn:conversation");
    expect(markup).toContain("name: file-expense");
    expect(markup).toContain("sha256 abcdef01");

    const spoken = spokenApprovalPrompt(
      { message, requestId: "skill-request", tool: "stage_skill", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain('Enable skill "file-expense"?');
    expect(spoken).toContain("Should I enable it?");
  });

  it("labels a reviewed skill replacement as an update", () => {
    const message: Message = {
      id: "skill-update",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Update skill "verify-app"?',
        subtitle: "Refreshes the verified workflows.",
        options: ["Update", "Deny"],
        requestId: "skill-update-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "skill-update-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-update",
          action: "update",
          name: "verify-app",
          gist: "Refreshes the verified workflows.",
          source: "learn:maintenance",
          preview: "---\nname: verify-app\ndescription: Verifies the app.\n---\n",
          sha256: "abcdef0123456789".repeat(4),
          warnings: [],
          createdAt: 1,
        },
      },
    };

    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain("update a learned skill");
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain("replacing the current version");
    const spoken = spokenApprovalPrompt(
      { message, requestId: "skill-update-request", tool: "stage_skill", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain("Should I update it?");

    message.card!.answered = "allow";
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain("Skill updated");
  });

  it("keeps an old persisted skill card readable but deny-only", () => {
    const message: Message = {
      id: "legacy-skill-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Enable old skill?",
        subtitle: "This card predates reviewed hashes.",
        options: ["Enable", "Dismiss"],
        requestId: "legacy-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "legacy-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-1",
          action: "create",
          name: "old-skill",
          gist: "Old skill",
          warnings: [],
          createdAt: 1,
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("created by an older build");
    expect(markup).toContain("cannot be safely applied");
    expect(markup).toContain("create the skill again");

    message.card!.skillRequest!.action = "update";
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message })))
      .toContain("propose the update again");
  });
});

describe("ApprovalCard tool-call kinds", () => {
  const kindMessage = (tool?: string): Message => ({
    id: "kind-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "rg \"wants to\" src/components",
      options: ["Allow", "Deny"],
      requestId: "req-kind",
      tool,
    },
  });

  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("speaks a verb phrase when the driver only knows the ACP kind", () => {
    const html = openRequestHtml(kindMessage("other"), bot);
    expect(html).toContain("Scout wants to take an action");
    expect(html).not.toContain("wants to other");
  });

  it("maps every kind an ACP driver can send, and still humanizes tool names", () => {
    const cases: Array<[string, string]> = [
      ["shell", "run a command"],
      ["edit", "edit a file"],
      ["read", "read a file"],
      ["fetch", "fetch a web page"],
      ["delete", "delete a file"],
      ["think", "think"],
      ["other", "take an action"],
      ["tool", "use a tool"],
      ["mcp__ogb__computer_batch", "use computer batch"],
    ];
    for (const [tool, phrase] of cases) {
      const html = openRequestHtml(kindMessage(tool), bot);
      expect(html).toContain(`Scout wants to ${phrase}`);
    }
  });

  it("reads grammatically when no tool is known", () => {
    const html = openRequestHtml(kindMessage(undefined));
    expect(html).toContain("Wants to take an action");
    expect(html).not.toContain("Allow this bot to an action");
  });

  it("speaks a verb phrase in the voice prompt too", () => {
    const message = kindMessage("other");
    const spoken = spokenApprovalPrompt(
      { message, requestId: "req-kind", tool: "other", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain("Mochi wants to take an action");
    expect(spoken).not.toContain("wants to other");
  });
});

describe("ApprovalCard expired proposals", () => {
  const expiredMessage = (): Message => ({
    id: "profile-expired-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Set up Scout?",
      subtitle: 'Name: "Scout" → "Kiwi"',
      options: ["Confirm", "Cancel"],
      requestId: "req-expired",
      tool: "update_profile",
      expired: true,
      profileRequest: {
        version: 1, requestId: "req-expired", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "you asked", changes: { name: "Kiwi" }, before: { name: "Scout" }, expectedRevision: "r",
      },
    },
  });
  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("marks a dead proposal as expired instead of waiting for an answer", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: expiredMessage() }));
    expect(html).toContain("Expired. Ask for a fresh proposal");
    expect(html).not.toContain("Waiting for your confirmation below");
    expect(html).not.toContain("data-tour=\"approval\"");
  });

  it("keeps an expired proposal out of the composer's decision queue", () => {
    const live = expiredMessage();
    live.card!.expired = undefined;
    expect(pendingApprovals([live, expiredMessage()]).map((pending) => pending.requestId)).toEqual(["req-expired"]);
  });
});

describe("ApprovalCard outbound holds", () => {
  const subtitle = [
    "Linear · Create linear comment",
    '{"issueId":"2f04bc73","body":"In flight"}',
    "",
    "Linear · Create linear comment",
    '{"issueId":"1c2755f","body":"From Discord"}',
  ].join("\n");
  const outboundMessage = (answered?: string): Message => ({
    id: "outbound-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Send on your behalf?",
      subtitle,
      options: ["Allow", "Deny"],
      requestId: "req-outbound",
      tool: "LINEAR_CREATE_LINEAR_COMMENT",
      heldCode: "approval.held.outbound",
      held: "This sends something on your behalf, so it always asks first.",
      answered,
      outboundRequest: {
        tool: "LINEAR_CREATE_LINEAR_COMMENT",
        app: "Linear",
        calls: [
          { app: "Linear", label: "Create linear comment" },
          { app: "Linear", label: "Create linear comment" },
        ],
      },
    },
  });
  const bot = { id: "bot-1", name: "Kiwi" } as never as Bot;

  it("names the app and the actions instead of the tool slug", () => {
    const html = openRequestHtml(outboundMessage(), bot);
    expect(html).toContain("Send to Linear?");
    expect(html).toContain("Create linear comment ×2");
    expect(html).not.toContain("LINEAR CREATE LINEAR COMMENT");
    expect(html).not.toContain("LINEAR_CREATE_LINEAR_COMMENT");
    expect(html).toContain("issueId");
    // the thread only says it waits: the request is not shown twice
    const line = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: outboundMessage() }));
    expect(line).toContain("Waiting for your approval");
    expect(line).not.toContain("Send to Linear?");
  });

  it("keeps the settled status line", () => {
    // a one-line receipt once answered (#455), the request one click away
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: outboundMessage("allow") }));
    expect(html).toContain("Allowed once");
    expect(html).toContain("Send to Linear");
    expect(html).toContain('data-testid="approval-receipt"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("heads the composer strip the same way", () => {
    const [pending] = pendingApprovals([outboundMessage()]);
    const strip = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 }));
    expect(strip).toContain("Send to Linear?");
    expect(strip).toContain("Create linear comment ×2");
    expect(strip).not.toContain("Approval requested");
    expect(strip).not.toContain("LINEAR_CREATE_LINEAR_COMMENT");
  });

  it("reads the subtitle back for a card from an older computer", () => {
    const message = outboundMessage();
    message.card!.outboundRequest = { tool: "LINEAR_CREATE_LINEAR_COMMENT", app: "Linear" };
    const html = openRequestHtml(message, bot);
    expect(html).toContain("Send to Linear?");
    expect(html).toContain("Create linear comment ×2");
  });

});

describe("ApprovalCard for a change that applied on its own", () => {
  const applied = (card: Partial<NonNullable<Message["card"]>>): Message => ({
    id: "applied-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Schedule “Check before dentist”?",
      subtitle: "Action: Create routine\nSchedule: Cron 30 14 * * 3",
      options: [],
      answered: "allow",
      dismissed: true,
      autoApplied: true,
      requestId: "routine-request",
      tool: "schedule_routine",
      ...card,
    },
  });
  const routineCard = (operation: NonNullable<NonNullable<Message["card"]>["routineRequest"]>["operation"], undo?: object) => applied({
    routineRequest: { ...routineRequest, operation, resultId: "routine-1", ...(undo ? { undo } : {}) } as NonNullable<Message["card"]>["routineRequest"],
  });
  const render = (message: Message) => renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" }));

  it("reads as one plain line with Undo instead of the approval box", () => {
    const at = new Date();
    at.setHours(14, 30, 0, 0);
    const markup = render(routineCard(createRoutineOperation, { name: "Check before dentist", schedule: { type: "once", at: at.getTime() } }));
    expect(markup).toMatch(/Scout scheduled a routine: Check before dentist, today 2:30/);
    expect(markup).toContain(">Undo<");
    expect(markup).toContain(">Details<");
    // The cron expression and the approval box stay out of the line.
    expect(markup).not.toContain("30 14 * * 3");
    expect(markup).not.toContain("Waiting for your confirmation");
    expect(markup).not.toContain("schedule_routine");
  });

  it("says a routine created paused was created paused", () => {
    const markup = render(routineCard(
      { ...createRoutineOperation, paused: true },
      { name: "Backlog review" },
    ));
    expect(markup).toContain("Scout created a paused routine: Backlog review");
    expect(markup).not.toContain("scheduled a routine");
  });

  it("never shows a cron expression that has no plain name", () => {
    const markup = render(routineCard(
      { ...createRoutineOperation, routine: { ...createRoutineOperation.routine, schedule: { type: "cron", expression: "*/7 3-5 * * 1", timeZone: "UTC" } } },
      { name: "Odd hours", schedule: { type: "cron", expression: "*/7 3-5 * * 1", timeZone: "UTC" } },
    ));
    expect(markup).toContain("Scout scheduled a routine: Odd hours");
    expect(markup).not.toContain("*/7");
  });

  it("says Undone after Undo, and offers no Undo for a run", () => {
    const undone = { ...routineCard(createRoutineOperation, { name: "Backlog review" }) };
    undone.card = { ...undone.card!, undone: true };
    const markup = render(undone);
    expect(markup).toContain("Scout scheduled a routine: Backlog review");
    expect(markup).toContain(" · Undone");
    expect(markup).not.toContain(">Undo<");
    const run = render(routineCard({ action: "run_now", routineId: "routine-1", expectedUpdatedAt: 1 }, { name: "Backlog review" }));
    expect(run).toContain("Scout started a routine: Backlog review");
    expect(run).not.toContain(">Undo<");
  });

  it("names profile fields, the model, and the skill in plain words", () => {
    const profile = render(applied({
      tool: "update_profile",
      profileRequest: {
        version: 1, requestId: "p", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "asked", changes: { title: "Researcher", soul: "Be brief." }, before: { title: "", soul: "" },
        expectedRevision: "r", undo: { appliedRevision: "r2" },
      },
    }));
    expect(profile).toContain("Scout updated its profile: title, standing instructions");
    expect(profile).toContain(">Undo<");
    const model = render(applied({
      tool: "update_model",
      modelRequest: {
        version: 1, requestId: "m", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "asked", selection: { instanceId: "codex", model: "gpt-fixture" }, before: { instanceId: "claude", model: "sonnet" },
      },
    }));
    expect(model).toContain("Scout changed its default model: gpt-fixture");
    const skill = render(applied({
      tool: "stage_skill",
      skillRequest: {
        version: 1, requestId: "s", botId: "bot-1", threadId: "thread-1", stagedId: "staged", action: "create",
        name: "file-expense", gist: "Files an expense.", warnings: [], createdAt: 1,
      },
    }));
    expect(skill).toContain("Scout added a skill: file-expense");
  });

  it("keeps the approval box for a card a person confirmed", () => {
    const confirmed = routineCard(createRoutineOperation, { name: "Backlog review" });
    confirmed.card = { ...confirmed.card!, autoApplied: undefined, options: ["Confirm", "Cancel"] };
    expect(render(confirmed)).toContain("Routine scheduled");
  });
});

describe("ApprovalCard rule proposals (propose_rule)", () => {
  const ruleCard = (answered?: string) => ({
    title: "Add this approval rule?",
    subtitle: "Why: You confirmed reading files in Documents\nWhen Ottoline wants to: read files in Documents\nIt should: Allow automatically\nConfirm saves this rule for you. Org Ask first and Refuse rules still win over it.",
    options: ["Confirm", "Cancel"],
    requestId: "req-rule-1",
    tool: "propose_rule",
    answered,
    ruleRequest: {
      version: 1 as const,
      requestId: "req-rule-1",
      botId: "bot-1",
      threadId: "thread-1",
      ownerId: "person-a",
      scopeBotId: "bot-1",
      scopeBotName: "Ottoline",
      createdAt: 1,
      reason: "You confirmed reading files in Documents",
      sentence: "read files in Documents",
      operation: {
        action: "add" as const,
        when: "read files in Documents",
        behavior: "allow" as const,
        botId: "bot-1",
      },
    },
  });

  const bot = { id: "bot-1", name: "Ottoline" } as never as Bot;

  it("keeps the proposal card in the thread with Confirm details", () => {
    const message: Message = {
      id: "rule-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: ruleCard(),
    };
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(html).toContain("Add this approval rule?");
    expect(html).toContain("read files in Documents");
    expect(html).toContain("Allow automatically");
    expect(html).toContain("Waiting for your confirmation below");
    expect(html).not.toContain("data-approval-waiting");
  });

  it("records Approval rule saved after confirmation", () => {
    const message: Message = {
      id: "rule-card-answered",
      role: "bot",
      kind: "options",
      at: 1,
      card: ruleCard("allow"),
    };
    expect(renderToStaticMarkup(createElement(ApprovalCard, { bot, message }))).toContain("Approval rule saved");
  });

  it("records Approval rule removed for a remove proposal", () => {
    const card = {
      ...ruleCard("allow"),
      title: "Remove this approval rule?",
      ruleRequest: {
        ...ruleCard("allow").ruleRequest,
        operation: {
          action: "remove" as const,
          ruleId: "rule-1",
          before: { when: "read files in Documents", behavior: "allow" as const, botId: "bot-1" },
        },
      },
    };
    const message: Message = { id: "rule-remove", role: "bot", kind: "options", at: 1, card };
    expect(renderToStaticMarkup(createElement(ApprovalCard, { bot, message }))).toContain("Approval rule removed");
  });

  it("speaks the card title for a rule proposal and labels the dock as Confirm", () => {
    const message: Message = {
      id: "rule-dock",
      role: "bot",
      kind: "options",
      at: 1,
      card: ruleCard(),
    };
    const pending: Pending = pendingApprovals([message])[0]!;
    expect(spokenApprovalPrompt(pending, "Ottoline")).toContain("change an approval rule");
    const html = openRequestHtml(message, bot);
    expect(html).toContain("Confirm this approval rule");
    expect(html).toContain('aria-label="Pending approval-rule confirmation"');
  });
});

describe("a card waiting for an organization admin (2026-10-08)", () => {
  it("says what happens next and names the admins when known", () => {
    expect(adminWillAnswerLine(["Alice", "Owner"])).toBe(
      "An admin (Alice, Owner) sees it in Settings > Organization. Your bot continues as soon as it is approved, or skips this step if it is denied.",
    );
    expect(adminWillAnswerLine([" "])).toContain("The organization's admins see it in Settings > Organization.");
    expect(adminWillAnswerLine(undefined)).toContain("The organization's admins");
  });
  it("shows the member's waiting card with that line, and what happens next", () => {
    const message = {
      id: "m-admin", role: "bot", kind: "options", at: 1,
      card: { title: "Approval needed", subtitle: "agents__vm_exec", options: ["Allow", "Deny"], requestId: "r-admin", requestType: "permission", tool: "other", adminApproval: true, adminNames: ["Alice"] },
    } as unknown as Message;
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Sprout" }, message }));
    expect(html).toContain("This command runs on the organization&#x27;s server: waiting for an admin to approve it.");
    expect(html).toContain("On the bot&#x27;s own computer (its server environment, Local VM or cloud computer) it needs no admin.");
    expect(html).toContain("An admin (Alice) sees it in Settings &gt; Organization.");
  });
  it("tells the admin whose request it is", () => {
    expect(approvalWho({ botName: "Sprout", requestedBy: "Erin", ownerName: "Erin" })).toBe("Sprout, asked by Erin");
    expect(approvalWho({ botName: "Sprout", ownerName: "Erin" })).toBe("Sprout, owned by Erin");
    expect(approvalWho({ botName: "Sprout" })).toBe("Sprout");
  });
});
