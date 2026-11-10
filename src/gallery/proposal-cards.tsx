// Dev gallery for the proposal cards in the chat (learned skill, routine):
// open and settled, and the composer's box for an open skill. Synthetic data
// only (an unreviewed skill shows the disabled Enable). Served by Vite in dev at /src/gallery/proposal-cards.html;
// not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApprovalBox, pendingApprovals } from "@/components/PendingApproval";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const BOT = { id: "preview-bot", name: "Marc", color: "green", soul: "" } as unknown as Bot;

const SKILL_MD = `---
name: task-abort
description: Stop a running task cleanly when the person asks to abort it.
---

# Task Abort

## When to Use
- The person says stop, cancel or abort while a task runs.

## Steps
1. Stop the running tool calls.
2. Say what was done and what was left.
3. Never retry the aborted task on your own.
`;

function skillCard(id: string, answered?: "allow", unreviewed = false): Message {
  const gist = "Added a task-abort skill so the bot stops a running task cleanly when you ask it to.";
  return {
    id,
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: 'Enable skill "task-abort"?',
      subtitle: `${gist}\n\nAdds one line to the prompt index; the body is read only when used.`,
      options: ["Enable", "Deny"],
      requestId: `skill-${id}`,
      tool: "stage_skill",
      ownerRule: { tool: "sagax:skill", scope: { action: "create", source: "review" }, description: "Keep the skills this bot learns from its conversations" },
      ...(answered ? { answered } : {}),
      skillRequest: {
        version: 1,
        requestId: `skill-${id}`,
        botId: BOT.id,
        threadId: "t",
        stagedId: `staged-${id}`,
        action: "create",
        name: "task-abort",
        gist,
        source: "learn:automatic review of this conversation",
        // an unreviewed request has no preview to read: its Enable stays disabled
        ...(unreviewed ? {} : { preview: SKILL_MD, sha256: "6d3bee9d".repeat(8) }),
        warnings: [],
        createdAt: 1,
      },
    } as Message["card"],
  } as Message;
}

function routineCard(id: string, answered?: "allow"): Message {
  return {
    id,
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Schedule routine",
      subtitle: "Every weekday at 9:00, review the open backlog and post a short summary.\n\nInstructions:\nReview every item in the backlog. Flag the ones older than 7 days.\nPost the summary in this chat.\n\nRuns on: this computer · 30 min max",
      options: ["Schedule", "Cancel"],
      requestId: `routine-${id}`,
      tool: "schedule_routine",
      ownerRule: { tool: "sagax:routine", scope: { action: "create" }, description: "Create routines" },
      ...(answered ? { answered } : {}),
      routineRequest: {
        version: 1,
        requestId: `routine-${id}`,
        botId: BOT.id,
        threadId: "t",
        createdAt: 1,
        operation: {
          action: "create",
          routine: {
            name: "Backlog review",
            instructions: "Review every item in the backlog.",
            schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
            runOn: "maus",
            durationMinutes: 30,
          },
        },
      },
    } as unknown as Message["card"],
  } as Message;
}

const OPEN = [skillCard("s1"), routineCard("r1")];
const UNREVIEWED = skillCard("s3", undefined, true);
const SETTLED = [skillCard("s2", "allow"), routineCard("r2", "allow")];

function Preview() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-[840px] flex-col gap-4">
        {OPEN.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
        <div className="mt-2 text-[12px] text-ink-secondary">Settled:</div>
        {SETTLED.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
        <div className="mt-4 rounded-2xl border border-hairline/40 bg-card">
          <PendingApprovalBox approvals={pendingApprovals([OPEN[0]!])} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
        </div>
        <div className="mt-4 rounded-2xl border border-hairline/40 bg-card">
          <PendingApprovalBox approvals={pendingApprovals([OPEN[1]!])} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
        </div>
        <div data-gallery-unreviewed className="mt-4 rounded-2xl border border-hairline/40 bg-card">
          <PendingApprovalBox approvals={pendingApprovals([UNREVIEWED])} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <Preview />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  </StrictMode>,
);
