// The bot creation wizard's client side (shared/bot-wizard.ts has the
// draft, server/routes/bot-wizard.ts keeps it): the calls the screen makes,
// each on an existing route. The bot is a real bot from the first step,
// created with the same Auto defaults as New bot (POST /api/bots); its
// fields change through the bot's own PATCH, its rules through
// /api/custom-rules and its routines through /api/routines when the person
// finishes. Pure helpers are exported for tests.
import { api as defaultApi, type Bot } from "@/state/store";
import { autoSelectionReady, readBotDefaults } from "@/lib/first-bot";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import {
  kitSuggestions,
  ruleSuggestion,
  routineSuggestion,
  pick,
  type WizardDraft,
  type WizardMode,
  type WizardPatch,
  type WizardAnswers,
  type WizardTool,
} from "../../shared/bot-wizard";

type Request = typeof defaultApi;

/** A draft as the server sends it: with its bot's name. */
export type WireWizardDraft = WizardDraft & { botName?: string };

export interface WizardSuggestions {
  answers?: WizardAnswers;
  rules: Array<{ id: string; behavior: "allow" | "ask" | "deny"; when: string }>;
  routines: Array<{ id: string; name: string; prompt: string; time: string; weekdays: number[] }>;
  tools: WizardTool[];
  apps: string[];
}

export const PENDING_RULE = "pending";

export async function listWizardDrafts(request: Request = defaultApi): Promise<WireWizardDraft[]> {
  return (await request<{ drafts: WireWizardDraft[] }>("/api/bot-wizard")).drafts ?? [];
}

export async function readWizardDraft(botId: string, language: string, request: Request = defaultApi): Promise<{ draft: WireWizardDraft; suggestions: WizardSuggestions }> {
  return request(`/api/bot-wizard/${encodeURIComponent(botId)}?language=${encodeURIComponent(language)}`);
}

export async function startWizardDraft(botId: string, body: { origin: "new" | "redo"; mode: WizardMode; roleId?: string; restart?: boolean }, request: Request = defaultApi): Promise<WireWizardDraft> {
  return (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "PUT", body: JSON.stringify(body) })).draft;
}

export async function patchWizardDraft(botId: string, patch: WizardPatch, request: Request = defaultApi): Promise<WireWizardDraft> {
  return (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "PATCH", body: JSON.stringify(patch) })).draft;
}

export async function writeSoulForMe(botId: string, language: string, request: Request = defaultApi): Promise<{ soul: string; source: "model" | "answers" }> {
  return request(`/api/bot-wizard/${encodeURIComponent(botId)}/soul`, { method: "POST", body: JSON.stringify({ language: language.startsWith("fr") ? "fr" : "en" }) });
}

export async function deleteWizardDraft(botId: string, request: Request = defaultApi): Promise<void> {
  await request(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "DELETE" });
}

/** The wizard's bot: created at once on the server's Auto defaults, as New
 * bot and the first run do, under the suggested name the person changes in
 * step 1. It stays a draft (its wizard draft says so) until they finish.
 * `noMcp` (2026-10-27): the wizard's own default is no MCP server (the
 * Tools step is optional now; its Workspace stays on Auto, the server's
 * default, and apps connect later), sent only when this person may set the
 * field on a new bot. */
export async function createWizardBot(request: Request = defaultApi, options: { noMcp?: boolean } = {}): Promise<Bot> {
  const defaults = await readBotDefaults(request);
  const selection = defaults.modelSelection;
  const body = {
    ...(defaults.suggestedName?.trim() ? { name: defaults.suggestedName.trim() } : {}),
    ...(autoSelectionReady(selection) ? { modelSelection: selection } : {}),
    // the template's own fields go in `settings` (server/bots/new-bot-defaults.ts)
    ...(options.noMcp ? { settings: { mcpServers: [] } } : {}),
  };
  return (await request<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(body) })).bot;
}

// ── the Bot designer (2026-10-27) ───────────────────────────────────────
// Guided mode never waits on a bot the person does not have: when no bot can
// guide (none yet, or only the one being made), choosing Guided creates the
// Bot designer, an ordinary bot of the person's own (their rights, no admin
// step), which then leads the wizard. One that exists already (a Built-in
// "Bot Designer", one the wizard made earlier) is found by its name in
// either language and leads first.

const DESIGNER_NAMES = new Set(["bot designer", "concepteur de bots", "concepteur de bot"]);

const normalizedName = (value: string | undefined) => (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/** A bot named Bot designer (or Concepteur de bots). Pure. */
export function isDesignerBot(bot: { name?: string }): boolean {
  return DESIGNER_NAMES.has(normalizedName(bot.name));
}

/** The Bot designer's profile, in the person's language. Pure. */
export function designerProfile(language: string): { name: string; title: string; description: string; soul: string } {
  return {
    name: pick({ en: "Bot designer", fr: "Concepteur de bots" }, language),
    title: pick({ en: "Designs your bots", fr: "Conçoit vos bots" }, language),
    description: pick({
      en: "Sets up a new bot with you in the creation wizard: one question at a time, each step filled in live.",
      fr: "Configure un nouveau bot avec vous dans l'assistant de création : une question à la fois, chaque étape remplie en direct.",
    }, language),
    soul: pick({
      en: [
        "You are the Bot designer. You help the person you speak with create and set up their own bots in Sagax's bot creation wizard.",
        "",
        "- Ask one short question at a time, in the person's language, in the wizard's order: identity (name, role, description), soul (tone, language, what it does, what it never does, how it talks), rules, routines. Tools and apps are optional: offer them once, and only open them if the person wants.",
        "- Fill each answer in at once: the new bot's own fields with sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), and the wizard's answers, rules and routines with bot.wizard. Read the suggestions with get first and use their ids.",
        "- Everything you set is the person's own bot, in their own environment: never ask an administrator, never add a limit they did not ask for.",
        "- Say in one line what you filled in, then ask the next question. When everything is set, tell them to try it from the recap and press Finish.",
      ].join("\n"),
      fr: [
        "Tu es le Concepteur de bots. Tu aides la personne avec qui tu parles à créer et régler ses propres bots dans l'assistant de création de Sagax.",
        "",
        "- Pose une question courte à la fois, dans la langue de la personne, dans l'ordre de l'assistant : identité (nom, rôle, description), soul (ton, langue, ce qu'il fait, ce qu'il ne fait jamais, sa façon de parler), règles, routines. Les outils et apps sont optionnels : propose-les une fois, et ouvre-les seulement si la personne le veut.",
        "- Remplis chaque réponse tout de suite : les champs du nouveau bot avec sagax_settings (bot.name, bot.description, bot.persona, bot.approvalMode...), et les réponses, règles et routines de l'assistant avec bot.wizard. Lis d'abord les suggestions avec get et utilise leurs ids.",
        "- Tout ce que tu règles est le bot de la personne, dans son propre environnement : ne demande jamais à un administrateur, n'ajoute aucune limite qu'elle n'a pas demandée.",
        "- Dis en une ligne ce que tu as rempli, puis pose la question suivante. Quand tout est réglé, dis-lui de l'essayer depuis le récap et d'appuyer sur Terminer.",
      ].join("\n"),
    }, language),
  };
}

/** Create the Bot designer on the server's Auto defaults (POST /api/bots,
 * the person's own right to create a bot: nothing an admin must do). Its
 * fields are the ones a member may set on a new bot. */
export async function createDesignerBot(language: string, request: Request = defaultApi): Promise<Bot> {
  const defaults = await readBotDefaults(request);
  const selection = defaults.modelSelection;
  const { soul, ...profile } = designerProfile(language);
  // name, title and description ride beside the request; the soul is a
  // template field, so it goes in `settings` (server/bots/new-bot-defaults.ts)
  const body = { ...profile, settings: { soul }, ...(autoSelectionReady(selection) ? { modelSelection: selection } : {}) };
  return (await request<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(body) })).bot;
}

export type RuleEffect = "allow" | "ask" | "deny";

/** The custom rule a suggestion becomes (POST /api/custom-rules), on its
 * suggested effect or the one the person picked. Pure. */
export function ruleBody(suggestionId: string, botId: string, language: string, behavior?: RuleEffect): { when: string; behavior: RuleEffect; botId: string; riskScope: string[] } | null {
  const suggestion = ruleSuggestion(suggestionId);
  if (!suggestion) return null;
  return { when: pick(suggestion.when, language), behavior: behavior ?? suggestion.behavior, botId, riskScope: [] };
}

/** The effect of each applied suggestion now: its custom rule's own (the
 * person may have changed it here or in the bot's rules). */
export async function appliedRuleEffects(draft: Pick<WizardDraft, "botId" | "rules">, request: Request = defaultApi): Promise<Record<string, RuleEffect>> {
  const applied = Object.entries(draft.rules).filter(([, ruleId]) => ruleId && ruleId !== PENDING_RULE);
  if (!applied.length) return {};
  const { rules } = await request<{ rules?: Array<{ id: string; behavior?: string }> }>(`/api/custom-rules?botId=${encodeURIComponent(draft.botId)}`);
  const byId = new Map((rules ?? []).map((rule) => [rule.id, rule.behavior]));
  const effects: Record<string, RuleEffect> = {};
  for (const [id, ruleId] of applied) {
    const behavior = byId.get(ruleId);
    if (behavior === "allow" || behavior === "ask" || behavior === "deny") effects[id] = behavior;
  }
  return effects;
}

/** Set one suggestion's effect (2026-10-27: one selector per rule instead
 * of a box and a badge). null removes the rule; another effect changes the
 * applied rule in place (PATCH) or makes it. Returns the draft's patch. */
export async function setSuggestedRuleEffect(draft: WizardDraft, suggestionId: string, effect: RuleEffect | null, language: string, request: Request = defaultApi): Promise<Record<string, string | null>> {
  if (!effect) return setSuggestedRule(draft, suggestionId, false, language, request);
  const existing = draft.rules[suggestionId];
  if (existing && existing !== PENDING_RULE) {
    await request(`/api/custom-rules/${encodeURIComponent(existing)}`, { method: "PATCH", body: JSON.stringify({ behavior: effect }) });
    return {};
  }
  const body = ruleBody(suggestionId, draft.botId, language, effect);
  if (!body) return {};
  const created = await request<{ rule?: { id: string } }>("/api/custom-rules", { method: "POST", body: JSON.stringify(body) });
  return created.rule?.id ? { [suggestionId]: created.rule.id } : {};
}

/** Apply or remove one suggested rule; returns the draft's rules patch. */
export async function setSuggestedRule(draft: WizardDraft, suggestionId: string, on: boolean, language: string, request: Request = defaultApi): Promise<Record<string, string | null>> {
  const existing = draft.rules[suggestionId];
  if (!on) {
    if (existing && existing !== PENDING_RULE) {
      try { await request(`/api/custom-rules/${encodeURIComponent(existing)}`, { method: "DELETE" }); }
      catch { /* already removed by hand: the draft forgets it all the same */ }
    }
    return { [suggestionId]: null };
  }
  if (existing && existing !== PENDING_RULE) return {};
  const body = ruleBody(suggestionId, draft.botId, language);
  if (!body) return {};
  const created = await request<{ rule?: { id: string } }>("/api/custom-rules", { method: "POST", body: JSON.stringify(body) });
  return created.rule?.id ? { [suggestionId]: created.rule.id } : {};
}

/** Suggestions the Primary Bot marked "pending" (bot.wizard) in guided
 * mode: the app makes each rule with the person's own session. Pure. */
export function pendingRules(draft: Pick<WizardDraft, "rules">): string[] {
  return Object.entries(draft.rules).filter(([, value]) => value === PENDING_RULE).map(([id]) => id);
}

/** The routine a picked suggestion becomes (POST /api/routines). Pure. */
export function routineBody(suggestionId: string, botId: string, language: string): Record<string, unknown> | null {
  const suggestion = routineSuggestion(suggestionId);
  if (!suggestion) return null;
  return {
    name: pick(suggestion.name, language),
    prompt: pick(suggestion.prompt, language),
    botId,
    target: "bot",
    enabled: true,
    schedule: { type: "daily", time: suggestion.time, weekdays: suggestion.weekdays },
  };
}

/** Finish: create the picked routines, then mark the draft done. A routine
 * that fails is reported, never a reason to undo the bot. */
export async function finishWizard(draft: WizardDraft, language: string, request: Request = defaultApi): Promise<{ draft: WireWizardDraft; failed: string[] }> {
  const failed: string[] = [];
  for (const id of draft.routines) {
    const body = routineBody(id, draft.botId, language);
    if (!body) continue;
    try { await request("/api/routines", { method: "POST", body: JSON.stringify(body) }); }
    catch { failed.push(String(body.name)); }
  }
  const done = (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(draft.botId)}/finish`, { method: "POST", body: "{}" })).draft;
  return { draft: done, failed };
}

/** A conversation on a bot, created for the wizard (guided chat, Try it). */
export async function openWizardThread(botId: string, title: string, request: Request = defaultApi): Promise<string> {
  const created = await request<{ bot?: { threadId?: string }; task?: { threadId?: string } }>(`/api/bots/${encodeURIComponent(botId)}/tasks`, { method: "POST", body: JSON.stringify({ title }) });
  const threadId = created.task?.threadId ?? created.bot?.threadId;
  if (!threadId) throw new Error("Could not open a conversation");
  return threadId;
}

export async function sendWizardMessage(botId: string, threadId: string, text: string, request: Request = defaultApi): Promise<void> {
  await request(`/api/bots/${encodeURIComponent(botId)}/messages`, { method: "POST", body: JSON.stringify({ text, threadId, sendId: crypto.randomUUID() }) });
}

/** The bot that guides: the person's Bot designer when they have one, else
 * their Primary Bot, else their first other bot (never the one being made).
 * Null: the wizard creates the Bot designer when Guided is chosen. Pure.
 * #2045: in org mode pass viewerId so another person's Primary Bot is never
 * chosen as the guide. */
export function guideBot<T extends Pick<Bot, "id" | "hidden" | "chiefOfStaff" | "ownerUserId"> & { name?: string }>(
  bots: readonly T[],
  draftBotId: string | null,
  viewerId?: string,
): T | null {
  const others = bots.filter((bot) => !bot.hidden && bot.id !== draftBotId);
  const mine = viewerId === undefined ? others : others.filter((bot) => viewerOwnsBot(bot, viewerId));
  const pool = mine.length ? mine : others;
  const primary = viewerId === undefined
    ? pool.find((bot) => bot.chiefOfStaff)
    : pool.find((bot) => isViewersPrimaryBot(bot, viewerId));
  return pool.find((bot) => isDesignerBot(bot)) ?? primary ?? pool[0] ?? null;
}

/** "Do it for me" chips: the role's answer, only when the field is empty
 * or different. Pure. */
export function answerSuggestion(suggestions: WizardSuggestions | null, key: keyof WizardAnswers, current: string): string | null {
  const value = suggestions?.answers?.[key]?.trim();
  return value && value !== current.trim() ? value : null;
}

/** A routine's schedule in words: "08:00, Mon to Fri". Pure. */
export function scheduleLabel(time: string, weekdays: readonly number[], dayNames: readonly string[], weekdaysLabel: string, everyDayLabel: string): string {
  const days = [...weekdays].sort();
  if (days.length === 7) return `${time}, ${everyDayLabel}`;
  if (days.join() === "1,2,3,4,5") return `${time}, ${weekdaysLabel}`;
  return `${time}, ${days.map((day) => dayNames[day] ?? "").filter(Boolean).join(", ")}`;
}

/** The suggestions of a role, in one language (shared kits). Pure. */
export function wizardSuggestions(roleId: string, language: string): WizardSuggestions {
  return kitSuggestions(roleId, language);
}
