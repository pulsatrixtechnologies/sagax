// The model reviewer of custom rules (examen automatique, 2026-10-21, Grok
// Bot parity A1; JC: "OUI, comme Grok"). A card the deterministic matcher
// left to the person (server/custom-rules-review.ts) is judged by a light,
// isolated, tool-free model (the bot's own engine's reviewPermission: Haiku
// on Claude) against the person's rules and the organization's. It answers
// in the person's place:
//
//   - allow or deny only when it names one of the rules of that behavior,
//     held by shared/custom-rules.ts modelCustomDecision (an organization
//     rule never allows; an allow keeps the risk scope; a shell line only
//     when it is one plain line, lot A1b);
//   - ask: the card stays, with the rule and the reason on it;
//   - unsure, failed, timed out or no reviewer: the card stays, untouched.
//
// The reason is on the card (its rule notice) and in the decision row
// (`source: auto-review`, the rule id, the reason). Cost: only cards reach
// here (never a call a grant or a rule already answered), one prompt per
// card, the same card text reviewed once per 10 minutes (cache, and one
// call in flight per prompt), call text cut at 4,000 characters.
//
// Nothing here knows the server: index.ts gives the reviewer, how to answer
// the engine and how to settle the card.

import { createHash } from "node:crypto";

import {
  customRulesJudgePrompt,
  modelCustomDecision,
  modelReviewRules,
  modelReviewWanted,
  modelRuleNotice,
  type CallFacts,
  type CustomRule,
  type CustomRuleDecision,
  type CustomRuleNotice,
  type ModelRuleVerdict,
} from "../shared/custom-rules.ts";

export const MODEL_REVIEW_TIMEOUT_MS = 30_000;
export const MODEL_REVIEW_CACHE_MS = 10 * 60_000;
export const MODEL_REVIEW_CACHE_MAX = 256;

export type ModelReviewer = (prompt: string, signal?: AbortSignal) => Promise<string>;

export interface ModelReviewCard {
  threadId: string;
  requestId: string;
  botId: string;
  /** The engine instance that asked (the answer goes back to it). */
  instanceId: string;
  /** The rules of the person who answers the card (rulesOf: their own,
   * their allow rules only while the organization keeps Always allow on,
   * and the organization's). */
  rules: readonly CustomRule[];
  /** What the matcher decided at request.opened. */
  local: CustomRuleDecision;
  facts: CallFacts;
  call: { tool: string; input?: string; summary?: string };
  language?: string;
}

export interface ModelReviewDeps {
  /** The bot's isolated reviewer, or undefined when its engine has none. */
  reviewer(botId: string): ModelReviewer | undefined;
  /** The card is still open (nobody answered it meanwhile). */
  stillOpen(threadId: string, requestId: string): boolean;
  /** Answer the engine that asked; true once it took the answer (an allow
   * only when the engine ran it). */
  deliver(card: ModelReviewCard, behavior: "allow" | "deny", message?: string): Promise<boolean>;
  /** Show the verdict: the card's rule notice, and for an answer, who
   * answered (the examen automatique) and the decision row. */
  settle(card: ModelReviewCard, verdict: ModelRuleVerdict, notice: CustomRuleNotice): void;
  timeoutMs?: number;
  now?: () => number;
}

export interface CustomRulesModelReviewer {
  /** The verdict for one card (cached), without acting on it. */
  judge(card: ModelReviewCard): Promise<ModelRuleVerdict>;
  /** Judge one card and act on it. Never throws. */
  reviewCard(card: ModelReviewCard): Promise<ModelRuleVerdict>;
}

export function createCustomRulesModelReviewer(deps: ModelReviewDeps): CustomRulesModelReviewer {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? MODEL_REVIEW_TIMEOUT_MS;
  // key: sha256 of the bot and the prompt (rules and call). A rule changed,
  // added or removed makes a new prompt, so a stale answer is never reused.
  const cache = new Map<string, { at: number; reply: string }>();
  const inflight = new Map<string, Promise<string | null>>();

  const ask = async (review: ModelReviewer, key: string, prompt: string): Promise<string | null> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < MODEL_REVIEW_CACHE_MS) return hit.reply;
    if (hit) cache.delete(key);
    const running = inflight.get(key);
    if (running) return running;
    const call = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // a reviewer that ignores its signal still stops counting here
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("model review timed out"));
        }, timeoutMs);
      });
      try {
        const reply = await Promise.race([review(prompt, controller.signal), late]);
        if (typeof reply !== "string") return null;
        cache.set(key, { at: now(), reply });
        while (cache.size > MODEL_REVIEW_CACHE_MAX) cache.delete(cache.keys().next().value!);
        return reply;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        inflight.delete(key);
      }
    })();
    inflight.set(key, call);
    return call;
  };

  const judge = async (card: ModelReviewCard): Promise<ModelRuleVerdict> => {
    const rules = modelReviewRules(card.rules, card.botId);
    if (!modelReviewWanted(card.local, rules)) return { kind: "none" };
    const review = deps.reviewer(card.botId);
    if (!review) return { kind: "none" };
    const prompt = customRulesJudgePrompt(rules, card.call, card.facts, card.language);
    const key = createHash("sha256").update(card.botId).update("\0").update(prompt).digest("hex");
    const reply = await ask(review, key, prompt);
    return modelCustomDecision(card.local, rules, card.facts, reply);
  };

  const reviewCard = async (card: ModelReviewCard): Promise<ModelRuleVerdict> => {
    try {
      const verdict = await judge(card);
      const notice = modelRuleNotice(verdict);
      if (verdict.kind === "none" || !notice) return { kind: "none" };
      // the person (or their Primary Bot) answered while the model thought
      if (!deps.stillOpen(card.threadId, card.requestId)) return { kind: "none" };
      if (verdict.kind === "ask") {
        deps.settle(card, verdict, notice);
        return verdict;
      }
      const taken = await deps.deliver(card, verdict.kind, verdict.kind === "deny" ? "Refused by the person's rule (automatic review)." : undefined);
      if (!taken) return { kind: "none" };
      deps.settle(card, verdict, notice);
      return verdict;
    } catch {
      return { kind: "none" };
    }
  };

  return { judge, reviewCard };
}
