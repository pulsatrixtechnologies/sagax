// Auto model (docs/plans/2026-10-08-auto-model.md): a bot set to Auto runs
// each of its own turns on the model that fits that turn (2026-10-29: a
// quick question on the fast tier, an image on a model that reads images,
// a long document on the largest context, anything hard on the strongest
// model) and gives every piece of work it hands out the model that fits
// that work. A person's pin always wins: Auto never runs on a pinned bot.
//
// Pure: the engines the payer can use, their model lists and the catalogue
// facts are passed in as data. Nothing here reads the registry, the network
// or the clock, so the same inputs always give the same pick.
import type { EffortLevel, ModelSelection } from "../../shared/wire.ts";
import { effortAcceptedByEngine } from "../../shared/ultracode-effort.ts";
import type { AutoModelRecord, AutoPayerVia, AutoReason, AutoTaskClass, AutoTier } from "../../shared/auto-model.ts";
import { autoOptimizeOf } from "../../shared/model-auto-optimize.ts";

export type { AutoPayerVia, AutoReason } from "../../shared/auto-model.ts";
export type TaskClass = AutoTaskClass;
export type Tier = AutoTier;

/** How each class of work maps to a tier. */
export const CLASS_TIER: Readonly<Record<TaskClass, Tier>> = {
  vision: "vision",
  "large-context": "long",
  "long-reading": "long",
  coding: "coding",
  reasoning: "top",
  automation: "coding",
  quick: "fast",
  general: "coding",
};

/** The person's own turn (2026-10-29): what the words ask for decides the
 * tier. Hard, general, coding and tool-heavy work keeps the strongest model
 * (the conversation is where the person's judgment matters most); only the
 * three classes a cheaper or more fitting model serves better leave it. */
export const ORCHESTRATION_TIER: Readonly<Record<TaskClass, Tier>> = {
  vision: "vision",
  "large-context": "long",
  "long-reading": "long",
  coding: "top",
  reasoning: "top",
  automation: "top",
  quick: "fast",
  general: "top",
};

/** When a tier has no model on any engine, the next tier to try. */
export const TIER_FALLBACK: Readonly<Record<Tier, readonly Tier[]>> = {
  top: ["coding"],
  coding: ["top"],
  fast: ["coding", "top"],
  long: ["top", "coding"],
  vision: ["coding", "top"],
};

export type ModelFamily = "anthropic" | "openai" | "xai" | "google" | "moonshot";

/** The readable mapping: per engine family and tier, id PATTERNS in order of
 * preference. Never a model id: a pattern only matches what the engine lists
 * now and the catalogue knows, newest release first. */
export const TIER_TABLE: Readonly<Record<ModelFamily, Readonly<Record<Tier, readonly RegExp[]>>>> = {
  anthropic: {
    // Fable is above Opus (Anthropic's strongest model).
    top: [/fable/, /opus/],
    coding: [/sonnet/, /opus/],
    fast: [/haiku/, /sonnet/],
    long: [/sonnet/, /opus/],
    vision: [/sonnet/, /opus/],
  },
  openai: {
    top: [/astra/, /sol/, /^gpt-\d+(\.\d+)?$/],
    coding: [/codex(?!.*spark)/, /sol/, /terra/, /^gpt-\d+(\.\d+)?$/],
    fast: [/luna/, /mini/, /spark/, /nano/],
    long: [/sol/, /terra/, /^gpt-\d+(\.\d+)?$/],
    vision: [/sol/, /terra/, /^gpt-\d+(\.\d+)?$/],
  },
  xai: {
    top: [/^grok-\d+(\.\d+)?$/],
    coding: [/grok.*code/, /^grok-\d+(\.\d+)?$/],
    fast: [/fast/, /mini/],
    long: [/^grok-\d+(\.\d+)?$/, /fast/],
    vision: [/^grok-\d+(\.\d+)?$/],
  },
  google: {
    top: [/pro/],
    coding: [/pro/, /flash(?!-lite)/],
    fast: [/flash-lite/, /flash/],
    long: [/pro/, /flash(?!-lite)/],
    vision: [/pro/, /flash(?!-lite)/],
  },
  moonshot: {
    top: [/k3(?!-256k)/, /k\d/],
    coding: [/for-coding(?!-highspeed)/, /code/, /k3/],
    fast: [/highspeed/, /k2/],
    long: [/k3/],
    vision: [/k3/, /k2\.\d/],
  },
};

const DRIVER_FAMILY: Readonly<Record<string, ModelFamily>> = {
  claudeAgent: "anthropic",
  codex: "openai",
  grokAgent: "xai",
  grok: "xai",
  geminiAgent: "google",
  kimiAgent: "moonshot",
};

/** Engines in the order Auto tries them after the bot's own. */
export const ENGINE_ORDER: readonly string[] = ["claudeAgent", "codex", "grokAgent", "geminiAgent", "kimiAgent", "piAgent"];

/** The family a model id belongs to on a multi-provider engine (pi, OpenCode). */
export function familyOfModel(driverKind: string, modelId: string): ModelFamily | null {
  const fixed = DRIVER_FAMILY[driverKind];
  if (fixed) return fixed;
  const full = modelId.toLowerCase();
  const id = bareModelId(modelId);
  if (/anthropic|claude|opus|sonnet|haiku|fable/.test(full)) return "anthropic";
  if (/^(gpt|o\d)|codex/.test(id) || full.startsWith("openai/")) return "openai";
  if (/grok|xai/.test(full)) return "xai";
  if (/gemini|^google\//.test(full)) return "google";
  if (/kimi|moonshot/.test(full)) return "moonshot";
  return null;
}

/** "kimi-code/k3" and "anthropic/claude-opus-5" are matched on their last part. */
export function bareModelId(modelId: string): string {
  const lower = modelId.toLowerCase();
  const sep = lower.lastIndexOf("::");
  const tail = sep >= 0 ? lower.slice(sep + 2) : lower;
  const slash = tail.lastIndexOf("/");
  return slash >= 0 ? tail.slice(slash + 1) : tail;
}

/** What the catalogue (models.dev) says about one model. */
export interface CatalogFacts {
  name?: string;
  reasoning?: boolean;
  vision?: boolean;
  context?: number;
  costInput?: number;
  costOutput?: number;
  releaseDate?: string;
}

/** Catalogue lookup by engine and the id the engine lists. */
export type CatalogLookup = (driverKind: string, modelId: string) => CatalogFacts | undefined;

/** An engine the payer can use for this turn, already filtered by the caller. */
export interface AutoEngine {
  instanceId: string;
  driverKind: string;
  displayName: string;
  models: { default: string; options: ReadonlyArray<{ id: string; label: string; contextWindow?: number; custom?: boolean }> };
  effortLevels?: readonly EffortLevel[];
  via?: AutoPayerVia;
  /** The bot's fast model (ModelSelection.fast) when this engine lists it,
   * custom or local rows included (they are never ranked by tier). */
  fast?: { id: string; label: string };
  /** 2026-10-29: the payer's second sign-in on this engine (a second Grok
   * account), offered to run_with_engine and the connector switch only:
   * Auto never picks a sign-in. `accountKind` is what that sign-in is
   * (a personal grok.com account, or a team one). */
  account?: "second";
  accountKind?: "personal" | "team";
}

export interface AutoChainEntry {
  instanceId: string;
  model: string;
}

export interface AutoPick {
  role: "orchestration" | "worker";
  selection: ModelSelection;
  engineLabel: string;
  modelLabel: string;
  tier: Tier;
  taskClass?: TaskClass;
  /** Why this model, as a stable code the renderer translates. */
  reason: AutoReason;
  via?: AutoPayerVia;
  /** The bot's own engine, when the pick left it. */
  fromEngineLabel?: string;
  /** This pick first, then what a refusal climbs to. */
  chain: AutoChainEntry[];
}

export interface AutoRequest {
  /** The bot's concrete selection under Auto: its engine and fallback model. */
  base: ModelSelection;
  /** Usable engines, any order; the bot's own engine may be absent (unusable). */
  engines: readonly AutoEngine[];
  catalog: CatalogLookup;
  /** Models a recent refusal took out (payer, engine, model). */
  skip?: readonly AutoChainEntry[];
}

export interface TaskInput {
  text: string;
  attachments?: ReadonlyArray<{ kind: "image" | "file"; name?: string; bytes?: number }>;
  /** The target bot's title and standing instructions. */
  role?: string;
}

// ── classification ───────────────────────────────────────────────────────

const LARGE_TEXT_CHARS = 60_000;
const LARGE_ATTACHMENT_BYTES = 400 * 1024;
const MANY_FILES = 5;
const QUICK_CHARS = 280;

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
const DOC_FILE = /\.(pdf|docx?|odt|rtf|txt|md|markdown|pptx?|xlsx?|csv|html?|epub|log)$/i;
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|ps1|sql|ya?ml|toml|json|lua|scala|dart|vue|svelte)$/i;

/** A pattern matching whole words or phrases, Unicode-aware: \b is ASCII
 * only even with the u flag, so "évaluer" or "résumé" would never match it.
 * Letters, digits and _ around a hit mean it is part of another word. */
function words(...alternatives: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/** Keyword patterns per class, English and French. A word that is also
 * everyday language ("rapport", "minutes", "fonction", "code" or "image"
 * alone, "options") is left out or only counted inside a phrase. */
const KEYWORDS: Readonly<Record<Exclude<TaskClass, "general" | "large-context">, readonly RegExp[]>> = {
  vision: [
    words("screenshots?", "captures? d['’]écran", "photos?", "pictures?", "diagrams?", "diagrammes?", "figma", "mockups?", "maquettes?", "ocr",
      "(this|the|attached) (image|picture|photo)", "(cette|l['’]) ?image( jointe)?"),
    words("look at (this|the) (image|picture|screen)", "what do you see", "qu['’]est-ce que tu vois"),
  ],
  "long-reading": [
    words("summari[sz]e", "summary", "résume[rz]?", "résumés?", "synthèse", "synthétise[rz]?", "tl;?dr", "digest"),
    words("read (this|the)", "lis (ce|le|la|les)", "lire (ce|le|la|les)", "relis", "review the (document|report|contract)", "analy[sz]e the (document|report|pdf|transcript)"),
    words("documents?", "reports?", "le rapport", "ce rapport", "un rapport", "pdf", "transcripts?", "transcriptions?", "contracts?", "contrats?",
      "meeting minutes", "procès-verbal", "articles?", "chapters?", "chapitres?", "books?", "livres?"),
  ],
  coding: [
    words("coding", "codebase", "source code", "code source", "(the|this|my|your|our) code", "(le|ce|du|mon|ton|notre) code(?! (postal|promo|secret|qr|d['’]accès|de (la route|réduction|conduite|couleur)))", "code review", "revue de code",
      "refactor\\w*", "bugs?", "bogues?", "debug\\w*", "débogu\\w*", "fix(es|ed)?", "corrige[rz]?", "implement\\w*", "implément\\w*", "compile\\w*",
      "build", "tests?", "unit tests?", "tests unitaires", "typescript", "javascript", "python", "rust", "golang", "kotlin", "sql", "regex",
      "api endpoint", "functions?", "méthodes?", "classes?", "pull request", "PR", "commit", "merge", "branch", "branche", "lint\\w*",
      "stack ?trace", "exception", "segfault", "repo(sitory)?", "dépôt"),
    /```/,
    /\b[\w./-]+\.(ts|tsx|js|py|go|rs|java|swift|kt|rb|cs|cpp|c|h)\b/,
  ],
  reasoning: [
    words("plan", "planifie[rz]?", "planning", "design", "conçois", "concevoir", "architecture", "architect", "strateg\\w*", "stratég\\w*",
      "roadmap", "feuille de route", "root cause", "cause racine", "trade-?offs?", "compromis", "decide", "décide[rz]?", "decision", "décision",
      "evaluate", "évalue[rz]?", "compare", "comparer", "prove", "démontre[rz]?", "reason through", "why does", "pourquoi", "think through", "réfléchis"),
  ],
  automation: [
    words("run", "exécute[rz]?", "lance[rz]?", "sync\\w*", "synchronis\\w*", "import\\w*", "export\\w*", "upload", "télévers\\w*", "download",
      "télécharge[rz]?", "browser", "navigateur", "click", "clique[rz]?", "fill (in|out)", "remplis", "scrape", "crawl", "tickets?", "billets?",
      "api", "webhook", "schedule", "planifie une tâche", "cron", "deploy\\w*", "déplo\\w*", "migrate", "migre[rz]?", "backup",
      "sauvegarde", "install\\w*", "configure[rz]?", "send (an? )?emails?", "envoie[rz]? (un )?courriels?"),
  ],
  quick: [
    words("look ?up", "cherche[rz]?", "find", "trouve[rz]?", "what is", "what's", "c['’]est quoi", "qu['’]est-ce que", "format\\w*", "reformat\\w*",
      "mets? en forme", "translate", "tradui[st]?", "traduction", "convert\\w*", "converti[rs]?", "rename", "renomme[rz]?", "list", "liste[rz]?",
      "count", "compte[rz]?", "spell", "orthographe", "typo", "status", "statut", "quick", "rapide", "short", "court", "one line", "une ligne"),
  ],
};

/** Asking for writing (a letter, an email, a post): never the cheap tier. */
const WRITING = words("write", "draft", "rédige[rz]?", "écris", "écrire", "letters?", "lettres?", "e-?mails?", "courriels?", "posts?", "blog", "cover letter", "reply to");

/** Ties go to the earlier class. */
const CLASS_PRIORITY: readonly TaskClass[] = ["vision", "large-context", "long-reading", "coding", "reasoning", "automation", "quick", "general"];

const ROLE_HINTS: ReadonlyArray<[TaskClass, RegExp]> = [
  ["coding", words("developer", "développeu\\w*", "engineer", "ingénieu\\w*", "coder", "programm\\w*", "devops", "software", "logiciel", "frontend", "backend", "full-?stack", "qa", "tester")],
  ["long-reading", words("writer", "rédact\\w*", "editor", "éditeu\\w*", "research\\w*", "recherch\\w*", "analyst", "analyste", "summar\\w*", "librarian", "bibliothéc\\w*", "reader", "lecteur", "legal", "juridique", "lawyer", "avocat")],
  ["reasoning", words("architect\\w*", "strateg\\w*", "stratèg\\w*", "planner", "planificat\\w*", "chief", "lead", "manager", "gestionnaire", "advisor", "conseill\\w*", "cto", "ceo", "cfo")],
  ["automation", words("ops", "operations?", "opérations?", "dispatch\\w*", "support", "technicien", "technician", "admin\\w*", "automation", "automatisation", "assistant")],
  ["vision", words("designer", "design", "graphi\\w*", "illustrat\\w*", "photograph\\w*", "ui", "ux")],
];

function countHits(patterns: readonly RegExp[], text: string): number {
  let hits = 0;
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    hits += text.match(global)?.length ?? 0;
  }
  return hits;
}

/** Whether a pattern matches anywhere (stateless for global patterns). */
const matches = (pattern: RegExp, text: string) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(text);

// One bounded scan to the closing `>`: the name and path are read from the
// matched tag afterwards, so nothing in the pattern can backtrack.
const ATTACHMENT_TAG = /<attached-(image|file)\b[^>]*>/gi;

/** The attachment tags a message carries (`<attached-image>`, `<attached-file>`),
 * and the text without them. Sizes are the caller's to add. */
export function attachmentsInText(text: string): { text: string; attachments: Array<{ kind: "image" | "file"; name?: string; path?: string }> } {
  const attachments: Array<{ kind: "image" | "file"; name?: string; path?: string }> = [];
  const stripped = text.replace(ATTACHMENT_TAG, (tag: string, kind: string) => {
    const name = /\bname="([^"\r\n]*)"/.exec(tag)?.[1];
    const path = /\bpath="([^"\r\n]*)"/.exec(tag)?.[1];
    attachments.push({ kind: kind.toLowerCase() === "image" ? "image" : "file", ...(name ? { name } : {}), ...(path ? { path } : {}) });
    return " ";
  });
  return { text: stripped, attachments };
}

/** The class of one piece of work, and the signals that decided it. */
export function classifyTask(input: TaskInput): { taskClass: TaskClass; signals: string[] } {
  const parsed = attachmentsInText(input.text ?? "");
  const attachments: Array<{ kind: "image" | "file"; name?: string; bytes?: number }> = [...(input.attachments ?? []), ...parsed.attachments.filter((tag) =>
    !(input.attachments ?? []).some((given) => given.name !== undefined && given.name === tag.name))];
  const text = parsed.text.trim();
  const signals: string[] = [];
  const images = attachments.filter((item) => item.kind === "image" || IMAGE_FILE.test(item.name ?? "")).length;
  const files = attachments.filter((item) => item.kind === "file" && !IMAGE_FILE.test(item.name ?? ""));
  const bytes = attachments.reduce((total, item) => total + (item.bytes ?? 0), 0);

  if (images > 0) {
    signals.push(`image attachment (${images})`);
    return { taskClass: "vision", signals };
  }
  if (text.length > LARGE_TEXT_CHARS || bytes > LARGE_ATTACHMENT_BYTES || files.length >= MANY_FILES) {
    signals.push(text.length > LARGE_TEXT_CHARS ? `long text (${text.length} chars)` : bytes > LARGE_ATTACHMENT_BYTES ? `large attachments (${bytes} bytes)` : `${files.length} files`);
    return { taskClass: "large-context", signals };
  }

  const score = new Map<TaskClass, number>(CLASS_PRIORITY.map((cls) => [cls, 0]));
  const add = (cls: TaskClass, points: number, why: string) => {
    if (points <= 0) return;
    score.set(cls, (score.get(cls) ?? 0) + points);
    signals.push(why);
  };
  for (const [cls, patterns] of Object.entries(KEYWORDS) as Array<[Exclude<TaskClass, "general" | "large-context">, readonly RegExp[]]>) {
    add(cls, countHits(patterns, text), `${cls} words`);
  }
  for (const file of files) {
    const name = file.name ?? "";
    if (CODE_FILE.test(name)) add("coding", 2, `code file ${name}`);
    else if (DOC_FILE.test(name)) add("long-reading", 2, `document ${name}`);
  }
  const role = input.role?.trim();
  if (role) {
    for (const [cls, pattern] of ROLE_HINTS) {
      if (matches(pattern, role)) {
        add(cls, 1, `bot role (${cls})`);
        break;
      }
    }
  }
  // A short message with only lookup or formatting words stays cheap; a
  // short one with a stronger signal keeps that signal.
  const short = text.length <= QUICK_CHARS;
  const writing = matches(WRITING, text);
  if (!short || writing) score.set("quick", 0);

  let best: TaskClass = "general";
  let bestScore = 0;
  for (const cls of CLASS_PRIORITY) {
    const value = score.get(cls) ?? 0;
    if (value > bestScore) {
      best = cls;
      bestScore = value;
    }
  }
  if (bestScore === 0 && writing) {
    signals.push("writing");
    return { taskClass: "general", signals };
  }
  if (bestScore === 0 && short && text.length > 0) {
    signals.push("short message");
    return { taskClass: "quick", signals };
  }
  return { taskClass: best, signals };
}

// ── model ranking ────────────────────────────────────────────────────────

/** Variants Auto passes over while a plain model of the same line exists. */
const VARIANT = /(-thinking|-preview|-pro$|-beta|-alpha|unverified|-latest$|-\d{8}$|-non-reasoning)/;

function versionKey(id: string): number[] {
  return (bareModelId(id).match(/\d+/g) ?? []).map(Number);
}

function compareVersionsDesc(a: string, b: string): number {
  const left = versionKey(a);
  const right = versionKey(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] ?? -1) - (left[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

interface Candidate {
  id: string;
  label: string;
  facts: CatalogFacts;
  variant: boolean;
  context: number;
}

function candidatesOf(engine: AutoEngine, catalog: CatalogLookup, skip: readonly AutoChainEntry[]): Candidate[] {
  const all = engine.models.options
    .filter((option) => !option.custom)
    // A row the engine itself marks as not confirmed for this account is
    // never picked: it is a placeholder, not access.
    .filter((option) => !/unverified/i.test(option.label))
    .filter((option) => !skip.some((entry) => entry.instanceId === engine.instanceId && entry.model === option.id))
    .flatMap((option) => {
      const facts = catalog(engine.driverKind, option.id);
      // Never a model the catalogue does not list.
      if (!facts) return [];
      return [{
        id: option.id,
        label: option.label || facts.name || option.id,
        facts,
        variant: VARIANT.test(bareModelId(option.id)),
        context: facts.context ?? option.contextWindow ?? 0,
      }];
    });
  // Variants (thinking, preview, pro, dated snapshots) only when the engine
  // lists nothing plainer: dropped before ranking, not after.
  const plain = all.filter((candidate) => !candidate.variant);
  return plain.length ? plain : all;
}

/** Newest first: release date, then the version in the id, then plain over a variant. */
function newestFirst(a: Candidate, b: Candidate): number {
  if (a.variant !== b.variant) return a.variant ? 1 : -1;
  const dateA = a.facts.releaseDate ?? "";
  const dateB = b.facts.releaseDate ?? "";
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  return compareVersionsDesc(a.id, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const priceOf = (candidate: Candidate) => (candidate.facts.costInput ?? 0) + (candidate.facts.costOutput ?? 0);

/** The model of one tier on one engine, or null when the engine has none. */
export function modelForTier(engine: AutoEngine, tier: Tier, catalog: CatalogLookup, skip: readonly AutoChainEntry[] = []): Candidate | null {
  let pool = candidatesOf(engine, catalog, skip);
  if (tier === "vision") pool = pool.filter((candidate) => candidate.facts.vision === true);
  if (!pool.length) return null;

  const patternsFor = (candidate: Candidate): readonly RegExp[] | null => {
    const family = familyOfModel(engine.driverKind, candidate.id);
    return family ? TIER_TABLE[family][tier] : null;
  };
  const rank = (candidate: Candidate): number => {
    const patterns = patternsFor(candidate);
    if (!patterns) return -1;
    const id = bareModelId(candidate.id);
    const index = patterns.findIndex((pattern) => pattern.test(id));
    return index;
  };
  const tabled = pool.filter((candidate) => rank(candidate) >= 0);
  if (tabled.length) {
    if (tier === "long") {
      return tabled.toSorted((a, b) => b.context - a.context || rank(a) - rank(b) || newestFirst(a, b))[0]!;
    }
    return tabled.toSorted((a, b) => rank(a) - rank(b) || newestFirst(a, b))[0]!;
  }
  // A family the table does not know (custom, local, other providers): the
  // catalogue alone decides.
  const unknown = pool.filter((candidate) => patternsFor(candidate) === null);
  if (!unknown.length) return null;
  switch (tier) {
    case "fast":
      // cheapest; with no price, a non-reasoning, smaller model is the quick one
      return unknown.toSorted((a, b) => priceOf(a) - priceOf(b) ||
        Number(a.facts.reasoning === true) - Number(b.facts.reasoning === true) ||
        a.context - b.context || newestFirst(a, b))[0]!;
    case "long":
      return unknown.toSorted((a, b) => b.context - a.context || newestFirst(a, b))[0]!;
    case "coding": {
      const coders = unknown.filter((candidate) => /cod(e|er|ex|ing)/.test(bareModelId(candidate.id)));
      if (coders.length) return coders.toSorted((a, b) => newestFirst(a, b))[0]!;
      return strongest(unknown);
    }
    default:
      return strongest(unknown);
  }
}

function strongest(pool: Candidate[]): Candidate {
  const reasoning = pool.filter((candidate) => candidate.facts.reasoning === true);
  const from = reasoning.length ? reasoning : pool;
  return from.toSorted((a, b) => priceOf(b) - priceOf(a) || newestFirst(a, b))[0]!;
}

/** The bot's own engine first, then ENGINE_ORDER, then the rest by id. */
export function orderEngines(engines: readonly AutoEngine[], baseInstanceId: string): AutoEngine[] {
  const orderOf = (engine: AutoEngine) => {
    if (engine.instanceId === baseInstanceId) return -1;
    const index = ENGINE_ORDER.indexOf(engine.driverKind);
    return index >= 0 ? index : ENGINE_ORDER.length;
  };
  return engines.toSorted((a, b) => orderOf(a) - orderOf(b) || (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
}

const MAX_CHAIN = 3;

/** A selection without the Auto flag: what a driver runs. */
export function concrete(selection: ModelSelection): ModelSelection {
  const { auto: _auto, ...rest } = selection;
  return rest;
}

function selectionOn(engine: AutoEngine, model: string, base: ModelSelection): ModelSelection {
  const selection: ModelSelection = { instanceId: engine.instanceId, model };
  // The base effort stays on the same engine when it is still offered; a
  // variant belongs to one model only.
  if (engine.instanceId === base.instanceId) {
    if (base.effort && effortAcceptedByEngine(base.effort, engine.effortLevels ?? [])) selection.effort = base.effort;
    if (base.variant !== undefined && base.model === model) selection.variant = base.variant;
  }
  return selection;
}

function pickTier(request: AutoRequest, tier: Tier, role: AutoPick["role"], taskClass?: TaskClass): AutoPick {
  const skip = request.skip ?? [];
  const engines = orderEngines(request.engines, request.base.instanceId);
  const own = engines.find((engine) => engine.instanceId === request.base.instanceId);
  const chain: Array<{ engine: AutoEngine; model: Candidate; tier: Tier }> = [];
  for (const wanted of [tier, ...TIER_FALLBACK[tier]]) {
    for (const engine of engines) {
      const model = modelForTier(engine, wanted, request.catalog, skip);
      if (model && !chain.some((entry) => entry.engine.instanceId === engine.instanceId && entry.model.id === model.id)) {
        chain.push({ engine, model, tier: wanted });
      }
    }
  }
  const first = chain[0];
  const baseEntry: AutoChainEntry = { instanceId: request.base.instanceId, model: request.base.model };
  const baseUsable = Boolean(own?.models.options.some((option) => option.id === baseEntry.model))
    && !skip.some((entry) => entry.instanceId === baseEntry.instanceId && entry.model === baseEntry.model);
  if (!first) {
    return {
      role,
      selection: concrete(request.base),
      engineLabel: own?.displayName ?? request.base.instanceId,
      modelLabel: own?.models.options.find((option) => option.id === request.base.model)?.label ?? request.base.model,
      tier,
      ...(taskClass ? { taskClass } : {}),
      reason: "base",
      ...(own?.via ? { via: own.via } : {}),
      chain: baseUsable ? [baseEntry] : [],
    };
  }
  const entries: AutoChainEntry[] = chain.slice(0, MAX_CHAIN).map((entry) => ({ instanceId: entry.engine.instanceId, model: entry.model.id }));
  if (!entries.some((entry) => entry.instanceId === baseEntry.instanceId && entry.model === baseEntry.model) && baseUsable) entries.push(baseEntry);
  const reason: AutoReason = first.tier !== tier ? "tier-fallback" : first.engine.instanceId === request.base.instanceId ? "strongest-own" : "strongest-other";
  return {
    role,
    selection: selectionOn(first.engine, first.model.id, request.base),
    engineLabel: first.engine.displayName,
    modelLabel: first.model.label,
    tier: first.tier,
    ...(taskClass ? { taskClass } : {}),
    reason,
    ...(first.engine.via ? { via: first.engine.via } : {}),
    ...(first.engine.instanceId !== request.base.instanceId ? { fromEngineLabel: own?.displayName ?? request.base.instanceId } : {}),
    chain: entries,
  };
}

/** Classes of work the bot's fast model takes (#1209). Reasoning, coding,
 * long reading, large context and vision stay on the model Auto picks. */
export const FAST_CLASSES: readonly TaskClass[] = ["quick", "automation", "general"];

/** The bot's fast model for this work, or null when it has none, the engine
 * does not offer it for this turn or a refusal took it out. The chain goes
 * on to what Auto would have picked, so a refusal climbs to the larger model. */
function pickFast(request: AutoRequest, role: AutoPick["role"], tier: Tier, taskClass?: TaskClass): AutoPick | null {
  const wanted = request.base.fast;
  if (!wanted) return null;
  const engine = request.engines.find((candidate) => candidate.instanceId === wanted.instanceId);
  if (!engine?.fast || engine.fast.id !== wanted.model) return null;
  if ((request.skip ?? []).some((entry) => entry.instanceId === engine.instanceId && entry.model === wanted.model)) return null;
  const normal = pickTier(request, tier, role, taskClass);
  const own = request.engines.find((candidate) => candidate.instanceId === request.base.instanceId);
  const first: AutoChainEntry = { instanceId: engine.instanceId, model: wanted.model };
  return {
    role,
    selection: { instanceId: engine.instanceId, model: wanted.model },
    engineLabel: engine.displayName,
    modelLabel: engine.fast.label,
    tier: "fast",
    ...(taskClass ? { taskClass } : {}),
    reason: "fast",
    ...(engine.via ? { via: engine.via } : {}),
    ...(engine.instanceId !== request.base.instanceId ? { fromEngineLabel: own?.displayName ?? request.base.instanceId } : {}),
    chain: [first, ...normal.chain.filter((entry) => !(entry.instanceId === first.instanceId && entry.model === first.model))].slice(0, MAX_CHAIN),
  };
}

/** #2106: Auto Edit preference nudges the tier (Cost → fast, Intelligence → top). */
function tierForOptimize(tier: Tier, selection: ModelSelection): Tier {
  const optimize = autoOptimizeOf(selection.autoOptimize);
  if (optimize === "cost" && (tier === "top" || tier === "coding")) return "fast";
  if (optimize === "intelligence" && (tier === "fast" || tier === "coding")) return "top";
  return tier;
}

/** The bot's own turns: the tier the words ask for (ORCHESTRATION_TIER), on
 * the bot's own engine when it can. A quick turn (a short message with
 * nothing heavier in it) runs on the fast model set for the bot when it has
 * one, else on the engine's own fast tier; an image on a model that reads
 * images; a long document or a big paste on the largest context; everything
 * else on the strongest general model. Without the words (the preview of
 * the next turn), the strongest general model. A refusal climbs the chain
 * toward the strongest model, never the other way. */
export function pickOrchestrationModel(request: AutoRequest, task?: TaskInput): AutoPick {
  if (!task) return pickTier(request, tierForOptimize("top", request.base), "orchestration");
  const { taskClass } = classifyTask(task);
  if (taskClass === "quick") {
    const fast = pickFast(request, "orchestration", "top", "quick");
    if (fast) return fast;
  }
  return pickTier(request, tierForOptimize(ORCHESTRATION_TIER[taskClass], request.base), "orchestration", taskClass);
}

/** A turn said on a live call (server/voice/voice-turn.ts): a fast model, so the
 * person hears the first words soon. The bot's own fast model when it set
 * one, else the fast tier of its own engine, else the fast tier of another
 * engine the payer can use. Null when no engine has one: the turn keeps the
 * bot's model. Work too big for it is handed to a parallel task on the
 * bot's main model (the call instruction says so). */
export function pickVoiceModel(request: AutoRequest): AutoPick | null {
  const fast = pickFast(request, "orchestration", "fast", "quick");
  if (fast) return fast;
  const own = request.engines.filter((engine) => engine.instanceId === request.base.instanceId);
  // 2026-11-02: the bot's own engine first, even for a fast model the
  // catalogue does not list yet (Grok's "grok-4.7-build-fast"): a call of a
  // bot on that model went to Codex because models.dev had no row for it, and Codex's
  // usage limit came back as the bot's error.
  const ownFast = ownEngineFast(request, own[0]);
  if (ownFast) return ownFast;
  for (const engines of [own, request.engines]) {
    if (!engines.length) continue;
    const pick = pickTier({ ...request, engines }, "fast", "orchestration", "quick");
    if (pick.tier === "fast" && pick.reason !== "base" && pick.reason !== "tier-fallback") return pick;
  }
  return null;
}

/** The fast model a call turn takes on the bot's own engine without the
 * catalogue: the bot's model when it is already a fast one, else the first
 * model the engine lists whose id is its family's fast tier. Null when the
 * engine lists none (the catalogue's pick, then another engine, decide). */
function ownEngineFast(request: AutoRequest, engine: AutoEngine | undefined): AutoPick | null {
  if (!engine) return null;
  const skip = request.skip ?? [];
  const listed = engine.models.options.filter((option) => !option.custom && !/unverified/i.test(option.label)
    && !skip.some((entry) => entry.instanceId === engine.instanceId && entry.model === option.id));
  const isFast = (id: string) => tierOfModel(engine.driverKind, id) === "fast";
  const base = listed.find((option) => option.id === request.base.model && isFast(option.id));
  // a catalogued fast model of the engine wins over an uncatalogued one
  const catalogued = base ? null : modelForTier(engine, "fast", request.catalog, skip);
  if (catalogued && isFast(catalogued.id)) return null;
  const chosen = base ?? listed.find((option) => isFast(option.id));
  if (!chosen) return null;
  return {
    role: "orchestration",
    selection: selectionOn(engine, chosen.id, request.base),
    engineLabel: engine.displayName,
    modelLabel: chosen.label || chosen.id,
    tier: "fast",
    taskClass: "quick",
    reason: "strongest-own",
    ...(engine.via ? { via: engine.via } : {}),
    chain: [{ instanceId: engine.instanceId, model: chosen.id }],
  };
}

/** Work the bot hands out: classify it, then the tier's model; the fast
 * model for the light classes when the bot has one. */
export function pickWorkerModel(request: AutoRequest & { task: TaskInput }): AutoPick {
  const { taskClass } = classifyTask(request.task);
  if (request.base.fast && FAST_CLASSES.includes(taskClass)) {
    const fast = pickFast(request, "worker", CLASS_TIER[taskClass], taskClass);
    if (fast) return fast;
  }
  return pickTier(request, tierForOptimize(CLASS_TIER[taskClass], request.base), "worker", taskClass);
}

/** #1154: the tier a model stands for on its engine (the first pattern of
 * TIER_TABLE it matches; on a tie, top before coding before fast), or null
 * for a family or a model the table does not know. */
export function tierOfModel(driverKind: string, modelId: string): Tier | null {
  const family = familyOfModel(driverKind, modelId);
  if (!family) return null;
  const id = bareModelId(modelId);
  let best: { tier: Tier; index: number } | null = null;
  for (const tier of ["top", "coding", "fast"] as const) {
    const index = TIER_TABLE[family][tier].findIndex((pattern) => pattern.test(id));
    if (index >= 0 && (!best || index < best.index)) best = { tier, index };
  }
  return best?.tier ?? null;
}

/** #1154: the model of the same tier as the bot's on the engines the paying
 * person can use (the bot's own first, then ENGINE_ORDER), for a turn whose
 * own model cannot run for that person. Null when no engine has one. */
export function pickEquivalentModel(request: AutoRequest, tier: Tier): AutoPick | null {
  const pick = pickTier(request, tier, "orchestration");
  return pick.reason === "base" ? null : pick;
}

/** The next entry of a pick's chain after a refusal, or null when the chain
 * is spent. Auto climbs once; the caller marks the retry. */
export function nextInChain(pick: Pick<AutoPick, "chain">, refused: AutoChainEntry): AutoChainEntry | null {
  const at = pick.chain.findIndex((entry) => entry.instanceId === refused.instanceId && entry.model === refused.model);
  return pick.chain[at + 1] ?? null;
}

/** An engine's words for "this model is not yours to use": Auto skips that
 * model for the payer for a while (the turn still shows the engine's error). */
const MODEL_REFUSAL = new RegExp([
  // "unknown model", "model_not_found"
  String.raw`\bunknown model\b|\bmodel_not_found\b`,
  // "model 'x' does not exist / was not found / is not supported / is not available to ..."
  String.raw`\bmodel\b[^\n]{0,60}\b(does not exist|was not found|not found|is not supported|not available (to|for|on|in))\b`,
  // "your account does not have access to model x", "not permitted to use this model"
  String.raw`\b(do(es)? not have access to|no access to|not allowed to use|not permitted to use)\b[^\n]{0,40}\bmodel\b`,
  String.raw`\bmodel\b[^\n]{0,40}\bnot permitted\b`,
].join("|"), "i");
export function isModelRefusal(message: string): boolean {
  return MODEL_REFUSAL.test(message);
}

// ── words ────────────────────────────────────────────────────────────────

const PAYER_PHRASE: Readonly<Record<AutoPayerVia, string>> = {
  subscription: "your subscription can run",
  "owner-key": "your own key can pay for",
  "speaker-key": "your own key can pay for",
  "org-key": "the organization's key can pay for",
  server: "this server can run",
};

export const CLASS_LABEL: Readonly<Record<TaskClass, string>> = {
  vision: "vision",
  "large-context": "large context",
  "long-reading": "long reading",
  coding: "coding",
  reasoning: "reasoning",
  automation: "automation",
  quick: "quick task",
  general: "general",
};

/** The one sentence the person and the bot read (English; the renderer
 * builds its own from the same fields in the person's language). */
export function explainPick(pick: AutoPick): string {
  const payer = PAYER_PHRASE[pick.via ?? "server"];
  if (pick.role === "worker") {
    const cls = pick.taskClass ? CLASS_LABEL[pick.taskClass] : "general";
    return `Auto: worker ${pick.engineLabel} · ${pick.modelLabel} (${cls}), the ${pick.tier} tier ${payer}${pick.reason === "tier-fallback" ? ", no closer tier was available" : ""}.`;
  }
  // The person's own turn, when the words moved it off the strongest tier
  // (2026-10-29): say what in the message decided it.
  if (pick.reason !== "fast" && pick.reason !== "base" && pick.tier === "fast" && pick.taskClass === "quick") {
    return `Auto: ${pick.modelLabel} for this quick question, the fast model ${payer} on ${pick.engineLabel}; a harder question runs on the strongest model.`;
  }
  if (pick.reason !== "base" && pick.tier === "vision" && pick.taskClass === "vision") {
    return `Auto: ${pick.modelLabel} for this image, a model that reads images ${payer} on ${pick.engineLabel}.`;
  }
  if (pick.reason !== "base" && pick.tier === "long" && (pick.taskClass === "long-reading" || pick.taskClass === "large-context")) {
    return `Auto: ${pick.modelLabel} for this long reading, the largest context ${payer} on ${pick.engineLabel}.`;
  }
  switch (pick.reason) {
    case "fast":
      return `Auto: ${pick.modelLabel} for this quick turn, the fast model set for this bot on ${pick.engineLabel}; the larger model stays for reasoning.`;
    case "strongest-own":
      return `Auto: ${pick.modelLabel} for this bot, because it is the strongest general model ${payer} on ${pick.engineLabel}, the engine this bot runs on.`;
    case "strongest-other":
      return `Auto: ${pick.modelLabel} for this bot, because ${pick.fromEngineLabel ?? "this bot's engine"} is not available for this turn and ${pick.engineLabel} is the next engine ${payer}.`;
    case "tier-fallback":
      return `Auto: ${pick.modelLabel} for this bot, because it is the closest general model ${payer} on ${pick.engineLabel}.`;
    default:
      return `Auto: ${pick.modelLabel} for this bot, because no other model is available for this turn.`;
  }
}

/** What a task records of its last pick (WireTask.autoModel). */
export function autoModelRecord(pick: AutoPick, at: number): AutoModelRecord {
  return {
    instanceId: pick.selection.instanceId,
    model: pick.selection.model,
    engineLabel: pick.engineLabel,
    modelLabel: pick.modelLabel,
    role: pick.role,
    tier: pick.tier,
    ...(pick.taskClass ? { taskClass: pick.taskClass } : {}),
    reason: pick.reason,
    ...(pick.via ? { via: pick.via } : {}),
    ...(pick.fromEngineLabel ? { fromEngineLabel: pick.fromEngineLabel } : {}),
    at,
  };
}
