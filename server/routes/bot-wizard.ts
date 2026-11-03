// The bot creation wizard's draft (shared/bot-wizard.ts), kept on the server
// so the desktop app and iOS resume the same one, in either mode:
//
//   GET    /api/bot-wizard/kits?language=     { kits, rules, routines }: the
//          role kits (ready answers, rule and routine suggestions, the tool
//          rows a role uses), in one language
//   GET    /api/bot-wizard                    { drafts }: the caller's
//          unfinished drafts, newest first, each with its bot's name
//   GET    /api/bot-wizard/:botId             { draft }
//   PUT    /api/bot-wizard/:botId             { origin, mode, roleId?, restart? }
//          starts the wizard on that bot (a bot the wizard just created, or
//          an existing one for "Redo the wizard"); an open draft is resumed
//          unless `restart`
//   PATCH  /api/bot-wizard/:botId             WizardPatch: mode, step, skip,
//          answers, rule and routine picks, the conversations. The Primary
//          Bot writes it through sagax_settings `bot.wizard`.
//   POST   /api/bot-wizard/:botId/soul        { language? } -> { soul, source }:
//          "Write it for me", by the bot's own model (one-shot), else drawn
//          from the answers
//   POST   /api/bot-wizard/:botId/finish      the draft is done
//   DELETE /api/bot-wizard/:botId             forgets the draft (the bot
//          itself is deleted by DELETE /api/bots/:id when the person asks)
//
// Rights: the bot's owner (deps.mayChange, the same person who may change
// the bot in its settings). A member does it alone; nothing here asks an
// administrator. The bot's fields, rules and routines go through their own
// routes (PATCH /api/bots/:id, /api/custom-rules, /api/routines).
import { z } from "zod";

import {
  WIZARD_MODES,
  WIZARD_STEPS,
  WIZARD_TOOLS_CHOICES,
  applyWizardPatch,
  cleanSoulReply,
  composeSoul,
  kitSuggestions,
  newWizardDraft,
  pick,
  wireKits,
  writeSoulPrompt,
  type WizardDraft,
} from "../../shared/bot-wizard.ts";
import type { BotWizardStore } from "../bot-wizard-store.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Generate = (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;

export interface BotWizardBot {
  id: string;
  name: string;
  title: string;
  description: string;
  soul?: string;
}

export interface BotWizardDeps {
  drafts: BotWizardStore;
  /** The person acting (lowercased principal; "" for nobody). */
  principal(auth: RequestAuth): string;
  /** A bot that exists and is not archived. */
  bot(id: string): BotWizardBot | undefined;
  /** Whether this caller may change that bot (its owner). */
  mayChange(auth: RequestAuth, botId: string): boolean;
  /** The bot's one-shot when its model may be asked now; null otherwise. */
  generate(botId: string): Generate | null;
  /** The role's starting soul (src/lib/bot-roles.ts), for the one-shot. */
  roleTemplate?(roleId: string): string | undefined;
  now?(): number;
  timeoutMs?: number;
}

const ID = /^[\w-]{1,128}$/;
const answers = z.object({
  tone: z.string().max(4000), language: z.string().max(4000), does: z.string().max(4000),
  never: z.string().max(4000), speech: z.string().max(4000),
}).partial().strict();
const idOrNull = z.union([z.string().regex(ID), z.null()]);
const patchSchema = z.object({
  mode: z.enum(WIZARD_MODES).optional(),
  step: z.enum(WIZARD_STEPS).optional(),
  skip: z.enum(WIZARD_STEPS).optional(),
  roleId: z.string().max(64).optional(),
  answers: answers.optional(),
  rules: z.record(z.string().max(64), z.union([z.string().regex(ID), z.null()])).optional(),
  routines: z.array(z.string().max(64)).max(20).optional(),
  guidedBotId: idOrNull.optional(),
  guidedThreadId: idOrNull.optional(),
  testThreadId: idOrNull.optional(),
  tools: z.enum(WIZARD_TOOLS_CHOICES).optional(),
}).strict();
const startSchema = z.object({
  origin: z.enum(["new", "redo"]),
  mode: z.enum(WIZARD_MODES),
  roleId: z.string().max(64).optional(),
  restart: z.boolean().optional(),
}).strict();
const soulSchema = z.object({ language: z.string().max(16).optional() }).strict();

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timed out")); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createBotWizardRoutes(deps: BotWizardDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  /** The draft of a bot this caller may change: its owner's. */
  const reachable = (auth: RequestAuth, botId: string): { bot: BotWizardBot } | { status: number; error: string } => {
    const bot = deps.bot(botId);
    if (!bot || !deps.mayChange(auth, botId)) return { status: 404, error: "no such bot" };
    return { bot };
  };
  const wire = (draft: WizardDraft, bot?: BotWizardBot) => ({ ...draft, ...(bot ? { botName: bot.name } : {}) });

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === "/api/bot-wizard/kits" && method === "GET") {
      return json(res, 200, wireKits(url.searchParams.get("language") ?? "en"));
    }
    if (path === "/api/bot-wizard" && method === "GET") {
      const owner = deps.principal(auth);
      const drafts = deps.drafts.openFor(owner)
        .map((draft) => ({ draft, bot: deps.bot(draft.botId) }))
        .filter((entry): entry is { draft: WizardDraft; bot: BotWizardBot } => Boolean(entry.bot) && deps.mayChange(auth, entry.draft.botId))
        .map(({ draft, bot }) => wire(draft, bot));
      return json(res, 200, { drafts });
    }
    const match = path.match(/^\/api\/bot-wizard\/([\w-]{1,128})(?:\/(soul|finish))?$/);
    if (!match || match[1] === "kits") return PASS;
    const botId = match[1]!;
    const action = match[2];
    const found = reachable(auth, botId);
    if ("error" in found) return json(res, found.status, { error: found.error });
    const { bot } = found;
    const current = deps.drafts.get(botId);

    if (!action && method === "GET") {
      if (!current) return json(res, 404, { error: "no wizard draft for this bot" });
      // The suggestions of the draft's role, so the Primary Bot (bot.wizard)
      // and the apps name the same ids.
      return json(res, 200, { draft: wire(current, bot), suggestions: kitSuggestions(current.roleId, url.searchParams.get("language") ?? "en") });
    }
    if (!action && method === "PUT") {
      const parsed = startSchema.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { origin: new|redo, mode: guided|manual, roleId?, restart? }" });
      if (current && current.status === "draft" && !parsed.data.restart) {
        const resumed = deps.drafts.put(applyWizardPatch(current, { mode: parsed.data.mode }, now()));
        return json(res, 200, { draft: wire(resumed, bot) });
      }
      const draft = newWizardDraft({
        botId, owner: deps.principal(auth), origin: current?.origin === "new" && current.status === "draft" ? "new" : parsed.data.origin,
        mode: parsed.data.mode, ...(parsed.data.roleId !== undefined ? { roleId: parsed.data.roleId } : {}), now: now(),
      });
      // "Redo the wizard" starts prefilled: the bot's own fields are already
      // its own, and the answers, role and rules of the last run come back.
      // Routines were made when it finished: none is picked twice.
      const prefilled: WizardDraft = current && draft.origin === "redo" && parsed.data.roleId === undefined
        ? { ...draft, roleId: current.roleId, answers: { ...current.answers }, rules: { ...current.rules } }
        : draft;
      return json(res, 201, { draft: wire(deps.drafts.put(prefilled), bot) });
    }
    if (!action && method === "PATCH") {
      if (!current) return json(res, 404, { error: "no wizard draft for this bot" });
      const parsed = patchSchema.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send a wizard patch: mode, step, skip, roleId, answers, rules, routines, tools, guidedThreadId, testThreadId" });
      const next = deps.drafts.put(applyWizardPatch(current, parsed.data, now()));
      return json(res, 200, { draft: wire(next, bot) });
    }
    if (!action && method === "DELETE") {
      deps.drafts.remove(botId);
      return json(res, 200, { ok: true });
    }
    if (action === "finish" && method === "POST") {
      if (!current) return json(res, 404, { error: "no wizard draft for this bot" });
      const done = deps.drafts.put({ ...current, status: "done", step: "recap", updatedAt: now() });
      return json(res, 200, { draft: wire(done, bot) });
    }
    if (action === "soul" && method === "POST") {
      const parsed = soulSchema.safeParse(await readBody(req) ?? {});
      if (!parsed.success) return json(res, 400, { error: "send { language? }" });
      const language = parsed.data.language ?? "en";
      const draftAnswers = current?.answers ?? { tone: "", language: "", does: "", never: "", speech: "" };
      const role = bot.description || bot.title;
      const fallback = composeSoul({ name: bot.name, role, answers: draftAnswers, language });
      const generate = deps.generate(botId);
      if (generate) {
        try {
          const template = deps.roleTemplate?.(current?.roleId ?? "");
          const prompt = writeSoulPrompt({ name: bot.name, role, answers: draftAnswers, language, ...(template ? { template } : {}) });
          const soul = cleanSoulReply(await withTimeout((signal) => generate(prompt, { signal }), deps.timeoutMs ?? 45_000));
          if (soul) return json(res, 200, { soul, source: "model" });
        } catch {
          // the answers' own soul below
        }
      }
      // Nothing answered at all: the role's sentence keeps the soul useful.
      const soul = fallback || pick({ en: `You are ${bot.name}.`, fr: `Tu es ${bot.name}.` }, language);
      return json(res, 200, { soul, source: "answers" });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
