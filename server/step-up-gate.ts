// The step-up decision for one Allow (shared/step-up.ts, server/security-keys.ts):
// which classes the card falls in, which of them the answering person chose,
// and whether the presented step-up was signed for exactly this card, its
// content and this answer. server/index.ts calls it on every answer path.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, resolve as resolvePath } from "node:path";

import type { RiskClass } from "../shared/custom-rules.ts";
import {
  STEP_UP_CLASSES,
  actionToolClasses,
  canonicalJson,
  cardContentText,
  normalizeAnswer,
  stepUpClassesForCard,
  riskClassesFromFacts,
  type ActionClassContext,
  type StepUpAnswer,
  type StepUpClass,
  type StepUpRefusal,
  type StepUpTarget,
} from "../shared/step-up.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { ORG_ALWAYS_ALLOW_OFF, answerWidens, standingGrantsAllowed } from "./custom-rules-org.ts";
import { factsForCall } from "./custom-rules-review.ts";
import { grantDigest, type SecurityKeys } from "./security-keys.ts";

/** The grant an Allow on this card, with this answer, is authorized by:
 * the card, a digest of its content and the answer's widening parts (a
 * standing grant is its own grant, `alwaysAllowStepUpGrant`). */
export function approvalStepUpGrant(threadId: string, requestId: string, card: OptionCardData, answer: StepUpAnswer, extra?: unknown): string {
  const normalized = normalizeAnswer(answer);
  // `extra`: what the card stands for when it holds none of it itself (a
  // bot act's route and body), so the key signs that too.
  const content = createHash("sha256").update(cardContentText(card)).update(extra === undefined ? "" : `\u0000${canonicalJson(extra)}`).digest("base64url");
  return grantDigest(["approval", threadId, requestId, content, canonicalJson({ always: normalized.always, rememberCommand: normalized.rememberCommand, rule: normalized.rule })]);
}

export function alwaysAllowStepUpGrant(botId: string, key: string): string {
  return grantDigest(["always-allow", botId, key]);
}

const UNREADABLE = "Saved security keys could not be read, so this approval cannot be confirmed. Repair security-keys.json on the server.";

export type StepUpDecision = { status: number; body: StepUpRefusal | OrgAlwaysAllowRefusal } | null;

/** 2026-10-21 (server/custom-rules-org.ts): the organization turned
 * "Toujours permettre" off, so an answer that would save a standing grant is
 * refused on every answer path (this gate is asked by each of them). */
export type OrgAlwaysAllowRefusal = typeof ORG_ALWAYS_ALLOW_OFF & { classes: []; reason?: undefined; target?: undefined };

function orgRefusal(): { status: number; body: OrgAlwaysAllowRefusal } {
  return { status: 403, body: { ...ORG_ALWAYS_ALLOW_OFF, classes: [] } };
}

/** Null lets the Allow through; else the refusal (403) with the target a
 * client starts a step-up for. A path that cannot carry a step-up passes
 * none and is refused for a card that needs one: never let through. */
export function approvalStepUp(input: {
  keys: SecurityKeys;
  person: string | null;
  /** Whose classes apply when `person` is null (the bot's owner). */
  policyPerson?: string | null;
  /** Classes the card falls in beyond its own fields (a bot act's route). */
  extraClasses?: readonly StepUpClass[];
  /** Content the card stands for beyond its own fields. */
  extraContent?: unknown;
  threadId: string;
  requestId: string;
  card: OptionCardData | undefined;
  behavior: string;
  answer: StepUpAnswer;
  risks: readonly RiskClass[];
  stepUp: unknown;
}): StepUpDecision {
  const { keys, person, threadId, requestId, card, behavior } = input;
  if (behavior !== "allow") return null;
  if (answerWidens(input.answer) && !standingGrantsAllowed()) return orgRefusal();
  if (!card || card.answered || card.dismissed || card.expired) {
    // No live card to read: nothing tells what this Allow would do. For a
    // person who chose any class, it is refused, never let through.
    const any = keys.required(person, STEP_UP_CLASSES, input.policyPerson);
    if (!any.length) return null;
    return { status: 409, body: { error: "This approval is no longer waiting.", code: "step_up_failed", classes: any, reason: "wrong-target" } };
  }
  const normalized = normalizeAnswer(input.answer);
  const answer = { always: normalized.always, rememberCommand: normalized.rememberCommand, rule: normalized.rule };
  const classes = [...new Set([...stepUpClassesForCard(card, input.risks, answer), ...(input.extraClasses ?? [])])];
  const required = keys.required(person, classes, input.policyPerson);
  if (!required.length) return null;
  if (keys.store.unreadable) return { status: 403, body: { error: UNREADABLE, code: "step_up_unavailable", classes: required, reason: "unreadable" } };
  if (!person) return { status: 403, body: { error: "This approval needs a security key: only the person can give it, in Sagax.", code: "step_up_required", classes: required } };
  const target: StepUpTarget = { kind: "approval", threadId, requestId, answer };
  if (input.stepUp === undefined || input.stepUp === null || input.stepUp === "") {
    return { status: 403, body: { error: "This approval needs your security key.", code: "step_up_required", classes: required, target } };
  }
  const used = keys.consume(input.stepUp, person, approvalStepUpGrant(threadId, requestId, card, answer, input.extraContent));
  if (!used.ok) return { status: 403, body: { error: "Your security key did not confirm this approval. Try again.", code: "step_up_failed", classes: required, reason: used.reason, target } };
  return null;
}

/** A standing grant (Always allow) saved from a card: the same step-up's
 * own grant, bound to the bot and the key it remembers. */
export function alwaysAllowStepUp(input: {
  keys: SecurityKeys;
  person: string | null;
  policyPerson?: string | null;
  botId: string;
  threadId: string;
  requestId: string;
  card: OptionCardData | undefined;
  key: string;
  risks: readonly RiskClass[];
  stepUp: unknown;
}): StepUpDecision {
  const { keys, person, card } = input;
  if (!standingGrantsAllowed()) return orgRefusal();
  if (!card) return null;
  const required = keys.required(person, stepUpClassesForCard(card, input.risks, { alwaysAllowKey: input.key }), input.policyPerson);
  if (!required.length) return null;
  if (keys.store.unreadable) return { status: 403, body: { error: UNREADABLE, code: "step_up_unavailable", classes: required, reason: "unreadable" } };
  if (!person) return { status: 403, body: { error: "Always allow needs a security key: only the person can give it, in Sagax.", code: "step_up_required", classes: required } };
  const target: StepUpTarget = { kind: "approval", threadId: input.threadId, requestId: input.requestId, answer: { alwaysAllowKey: input.key } };
  if (input.stepUp === undefined || input.stepUp === null || input.stepUp === "") {
    return { status: 403, body: { error: "Always allow needs your security key.", code: "step_up_required", classes: required, target } };
  }
  const used = keys.consume(input.stepUp, person, alwaysAllowStepUpGrant(input.botId, input.key));
  if (!used.ok) return { status: 403, body: { error: "Your security key did not confirm this approval. Try again.", code: "step_up_failed", classes: required, reason: used.reason, target } };
  return null;
}

/** The grants a step-up for a waiting card authorizes: the Allow with this
 * answer, and the standing grant when the answer saves one. */
export function approvalGrantsFor(input: { threadId: string; requestId: string; card: OptionCardData; botId: string | undefined; answer: StepUpAnswer | undefined; extraContent?: unknown }): { grants: string[] } | { status: number; error: string } {
  const answer = normalizeAnswer(input.answer);
  const grants = [approvalStepUpGrant(input.threadId, input.requestId, input.card, { always: answer.always, rememberCommand: answer.rememberCommand, rule: answer.rule }, input.extraContent)];
  if (answer.alwaysAllowKey) {
    if (input.card.allowKey !== answer.alwaysAllowKey) return { status: 409, error: "That grant is not on this approval." };
    if (!input.botId) return { status: 404, error: "This approval has no bot." };
    grants.push(alwaysAllowStepUpGrant(input.botId, answer.alwaysAllowKey));
  }
  return { grants };
}

/** The server's view of its own disk for an action tool's classes
 * (shared/step-up.ts actionToolClasses): the thread's own folders, real
 * paths (the deepest existing ancestor for a file not yet there, so a link
 * in the way is followed) and whether a file is already there. */
export function actionClassContext(threadFolders: readonly string[]): ActionClassContext {
  const real = (absolute: string): string => {
    let probe = resolvePath(absolute);
    const rest: string[] = [];
    while (!existsSync(probe) && dirname(probe) !== probe) {
      rest.unshift(basename(probe));
      probe = dirname(probe);
    }
    try {
      return resolvePath(realpathSync(probe), ...rest);
    } catch {
      return resolvePath(absolute);
    }
  };
  // Nothing at the path itself (lstat: not even a broken link), and the
  // deepest thing on its way that lstat sees is a live folder (a broken
  // link there would send the write wherever it points).
  const fresh = (absolute: string): boolean => {
    let probe = resolvePath(absolute);
    let first = true;
    for (;;) {
      let found = false;
      try {
        lstatSync(probe);
        found = true;
      } catch {
        // nothing here: look one level up
      }
      if (found) {
        if (first) return false;
        try {
          // realpathSync throws on a broken link
          return lstatSync(realpathSync(probe)).isDirectory();
        } catch {
          return false;
        }
      }
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
      first = false;
    }
  };
  return {
    threadFolders: threadFolders.map((folder) => real(folder)),
    resolve: real,
    exists: (absolute) => existsSync(absolute),
    freshPath: fresh,
  };
}

/** The call's risk classes as custom rules read them, with every shell
 * command that is not a plain read in destructive and irreversible
 * (riskClassesFromFacts), and the classes of an action tool (a file write,
 * a screen action, a page opened to send: actionToolClasses). A card that
 * cannot be read is in every class. */
export function cardRiskClasses(card: OptionCardData, context: ActionClassContext = {}): RiskClass[] {
  if (!card.tool) return [];
  try {
    const binding = card.customRuleCandidate?.binding;
    const risks = riskClassesFromFacts(factsForCall({
      tool: card.tool,
      ...(card.mcpTool ? { mcpTool: card.mcpTool } : {}),
      ...(card.toolInput ? { input: card.toolInput } : {}),
      ...(card.toolHints ? { hints: card.toolHints } : {}),
      ...(binding?.command ? { command: binding.command } : {}),
      summary: card.subtitle,
    }));
    const action = actionToolClasses({ tool: card.tool, ...(card.mcpTool ? { mcpTool: card.mcpTool } : {}), ...(card.toolInput ? { input: card.toolInput } : {}) }, context);
    return [...new Set([...risks, ...action])];
  } catch {
    return ["destructive", "irreversible", "money", "external-send"];
  }
}

/** The classes an Allow on a call would fall in, before its card exists:
 * the same reading as the card's (stepUpClassesForCard over cardRiskClasses),
 * so a call Sagax would answer by itself is held for a card exactly when
 * that card would need the person's key (2026-10-16, own environment and
 * Sagax's own tools). A call that cannot be read is in every class. */
export function callStepUpClasses(call: {
  tool: string;
  mcpTool?: string;
  input?: string;
  summary?: string;
  command?: string;
  hints?: OptionCardData["toolHints"];
}, context: ActionClassContext = {}): StepUpClass[] {
  const card: OptionCardData = {
    title: "", subtitle: call.summary ?? "", options: [], requestType: "permission", tool: call.tool,
    ...(call.mcpTool ? { mcpTool: call.mcpTool } : {}),
    ...(call.input ? { toolInput: call.input } : {}),
    ...(call.hints ? { toolHints: call.hints } : {}),
  };
  let risks: RiskClass[];
  try {
    risks = riskClassesFromFacts(factsForCall({
      tool: call.tool,
      ...(call.mcpTool ? { mcpTool: call.mcpTool } : {}),
      ...(call.input ? { input: call.input } : {}),
      ...(call.hints ? { hints: call.hints } : {}),
      ...(call.command ? { command: call.command } : {}),
      summary: call.summary ?? "",
    }));
    risks = [...new Set([...risks, ...actionToolClasses({ tool: call.tool, ...(call.mcpTool ? { mcpTool: call.mcpTool } : {}), ...(call.input ? { input: call.input } : {}) }, context)])];
  } catch {
    return [...STEP_UP_CLASSES];
  }
  return stepUpClassesForCard(card, risks);
}
