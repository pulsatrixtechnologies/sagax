// Full access, one source of truth (#1065, #1819, #1905; 2026-11-02).
//
// Full access (the bypass level) is a choice the person makes for their own
// bot, in their own sandbox: under it the bot acts, and no surface of Sagax
// shows a card for the work the person already authorized. Three fixes in a
// row (#1088 for #1065, #1821 for #1819, #1808 for the mailbox move) each
// patched one surface, and the next surface brought the card back: the
// safety review held a send before Full was read (auto-approve.ts), the
// model's own may-I ask_choice was never read against the level at all, a
// Grok turn in `default` mode asked about every Sagax tool and each ask was
// judged by a different list. This module is the one list.
//
// What still stands under Full access, and nothing else:
//   - an organization rule set to Refuse or Ask first (custom-rules-org.ts);
//   - the person's own rule set to Refuse or Ask first (their words, or an
//     Ask / Deny rule saved from a card: owner-approval.ts);
//   - isolation between people: a guest's turn, someone else's environment
//     or data, a confidential thread the answerer cannot answer;
//   - a sensitive path or the shared server itself (an organization admin's
//     card on a member's bot: engine-access.ts memberBotAdminApproval);
//   - a real question: the model's own options about a decision the person
//     did not make, or a fact only they can supply (shared/permission-question.ts
//     tells a may-I apart from it).
// A misuse block (credentials, prompt secrecy, a hard misuse category) is a
// refusal, not a card, and is not decided here.
//
// Every surface that can put a card between the bot and the person reads
// this decision and says so with a marker comment, `// full-access: <id>`,
// on the line of the card (full-access-gate.guard.test.ts fails a surface
// without one, and a marker without a registered id).
import type { ApprovalMode } from "../shared/approval-mode.ts";
import { permissionQuestion, recommendedPermissionAnswer, type ChoiceQuestion } from "../shared/permission-question.ts";

export const FULL_ACCESS_HOLDS = ["org-rule", "person-rule", "isolation", "sensitive-path", "question"] as const;
export type FullAccessHold = (typeof FULL_ACCESS_HOLDS)[number];

export interface FullAccessFacts {
  /** An organization rule (Refuser, Demander d'abord) decides this call. */
  orgRule?: "ask" | "deny" | null;
  /** The person's own rule (their words, or one saved from a card) asks or refuses. */
  personRule?: "ask" | "deny" | null;
  /** Someone else's turn, environment or data. */
  isolation?: boolean;
  /** The shared server, or a sensitive hidden name of a bot's own folders. */
  sensitivePath?: boolean;
  /** A real question (the model's own options, a credential form), never a permission. */
  question?: boolean;
}

export type FullAccessVerdict =
  | { acts: true; level: "full"; hold?: undefined }
  | { acts: false; level: ApprovalMode; hold?: FullAccessHold };

/** Whether a turn at `level` acts without a card, and when not, why. */
export function fullAccessDecision(level: ApprovalMode, facts: FullAccessFacts = {}): FullAccessVerdict {
  if (level !== "full") return { acts: false, level };
  if (facts.orgRule) return { acts: false, level, hold: "org-rule" };
  if (facts.personRule) return { acts: false, level, hold: "person-rule" };
  if (facts.isolation) return { acts: false, level, hold: "isolation" };
  if (facts.sensitivePath) return { acts: false, level, hold: "sensitive-path" };
  if (facts.question) return { acts: false, level, hold: "question" };
  return { acts: true, level: "full" };
}

/** The short form every surface reads: Full access with nothing in its way. */
export function fullAccessActs(level: ApprovalMode | undefined, facts: FullAccessFacts = {}): boolean {
  return level !== undefined && fullAccessDecision(level, facts).acts;
}

/** A choice card the bot draws (ask_choice, an engine's own question tool)
 * under Full access: a may-I is answered with the recommended option, the
 * first one; a real decision or a missing fact keeps its card. */
export function fullAccessChoiceAnswer(level: ApprovalMode | undefined, card: ChoiceQuestion, facts: FullAccessFacts = {}): { choice: string } | null {
  if (!fullAccessActs(level, facts)) return null;
  if (!permissionQuestion(card)) return null;
  const choice = recommendedPermissionAnswer(card);
  return choice ? { choice } : null;
}

/** Ask before contacting bots (#1819): the Sagax peer card stands below
 * Full access only; at Full the person's choice already covers the contact. */
export function peerContactCardRequired(approvePeerComms: boolean, level: ApprovalMode | undefined): boolean {
  return approvePeerComms && !fullAccessActs(level);
}

/** The chip and the journal line of a choice Full access answered. */
export function fullAccessChoiceLine(botName: string | undefined, question: string, choice: string): string {
  const who = botName?.trim() || "The bot";
  const asked = question.replace(/\s+/g, " ").trim().slice(0, 160);
  return `Full access answered for you: ${who} asked "${asked}", taken: ${choice.slice(0, 120)}.`;
}

/** Every code path that can put an approval or a choice card between the
 * bot and the person, by the id its marker comment names. The guard test
 * (full-access-gate.guard.test.ts) scans the server for card emitters and
 * requires each one to carry `// full-access: <id>` with an id listed here,
 * and each listed surface's file to read this module (or the index.ts
 * helpers that do). A new surface fails until it is listed and gated. */
export const FULL_ACCESS_SURFACES = {
  /** index.ts request.opened: every engine's permission request (Claude,
   * Codex, Cursor, Grok, Antigravity, Gemini, Qwen, OpenCode, Pi, the chat
   * engines, the MCP gate and saved steps all arrive here). */
  "tool-approval": "server/index.ts request.opened permission card",
  /** index.ts request.opened: an engine's own question tool; a may-I is
   * answered, a real question keeps its card. */
  "question": "server/index.ts request.opened question card",
  /** The safety review's safer path and confirmation (shared/safety-review.ts)
   * on a permission request and before a server-side tool runs. */
  "safety-review": "server/safety-review.ts safetyPermissionEffect and safetyToolHold",
  /** The card a server-side safety hold waits on (index.ts confirmHeldCard). */
  "safety-confirm": "server/index.ts confirmHeldCard",
  /** The Sagax ask_choice tool (server/chat-widgets.ts createChoiceCard). */
  "ask-choice": "server/chat-widgets.ts createChoiceCard",
  /** Ask before contacting bots (index.ts peerReviewRequired, peer-approval.ts). */
  "peer-contact": "server/peer-approval.ts requestPeerApproval behind peerReviewRequired",
  /** A proposal the bot makes about itself or its team: profile, routine,
   * team setup, model, rule, terminal (index.ts fullAccessForSource). */
  "proposal": "server/*-requests.ts cards, applied under Full (fullAccessForSource)",
  /** An outbound send or email draft the bot writes (index.ts). */
  "send": "server/index.ts outbound and email draft cards",
  /** The chat-completions engines answer their own tool gate under Full. */
  "chat-engine": "server/drivers/openai-chat.ts tool gate",
  /** A permission request an engine bridge emits: it is judged in
   * request.opened, never answered or held where it is emitted. */
  "engine-bridge": "server/drivers and runners emitting request.opened",
  /** A card that stands under Full by the isolation hold: it reaches other
   * people's data or presence (the team's memory, a confidential thread's
   * memory write, a meeting with other people). */
  "isolation": "a card kept by the isolation hold: the team's memory, a confidential thread, a meeting with others",
  /** A receipt or a product card that never blocks the bot's turn. */
  "exempt": "a settled receipt, an onboarding card, the Watcher's product card",
} as const;

export type FullAccessSurface = keyof typeof FULL_ACCESS_SURFACES;

/** The marker a card-emitting line carries, on that line or the three above it. */
export const FULL_ACCESS_MARKER = /full-access:\s*([a-z-]+)/;
