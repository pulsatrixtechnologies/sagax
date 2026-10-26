// sagax_help: what Sagax and Perspicax can do, where and how, served on
// demand from the generated knowledge base (server/self-knowledge/
// knowledge.generated.json, scripts/self-knowledge/generate.ts). Nothing of
// it rides in the system prompt: one line there sends the bot here.
//
// The base is read from disk on the first question only (about 1 MB, never
// inlined in the bundle), indexed once, and kept. A question gets a few
// short sections: the best sentences of each, where it is in the app, who
// may use it. BM25 over title, keywords and text, with French words mapped
// to the English of the catalog.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeBase, KnowledgeKind, KnowledgeSection } from "./self-knowledge-types.ts";

export const KNOWLEDGE_FILE_NAME = "knowledge.generated.json";
export const HELP_DEFAULT_RESULTS = 4;
export const HELP_MAX_RESULTS = 6;
/** Characters of one section's excerpt, title and lines aside. */
const EXCERPT_CHARS = 520;

/** The base sits in self-knowledge/ beside this module in a checkout and
 * beside the bundled server (scripts/bundle-server.mjs copies it). Read
 * without blocking the event loop. */
export async function readBundledKnowledge(): Promise<KnowledgeBase | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return JSON.parse(await readFile(join(here, "self-knowledge", KNOWLEDGE_FILE_NAME), "utf8")) as KnowledgeBase;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- words

const STOP = new Set((
  "a an the and or of to in on for with without by at from as is are be been can could do does did how what where when which who whom why "
  + "it its this that these those i you your my me we our us they their them he she his her if then than not no yes there here into about "
  + "any all some more most other such only own same so too very just also will would should may might must have has had having get got "
  + "le la les un une des du de d l et ou au aux en dans sur pour par avec sans ce cet cette ces se sa son ses mon ma mes ton ta tes "
  + "notre nos votre vos leur leurs je tu il elle on nous vous ils elles qui que quoi dont ou quand comment pourquoi est sont etre "
  + "suis es sommes etes ete avoir ai as avons avez ont fait faire peux peut peuvent pouvez puis pourrais pourrait est-ce ne pas plus "
  + "moi toi lui y a-t-il qu c s n m t j quel quelle quels quelles ca cela ceci tout tous toute toutes"
).split(" "));

/** French words of a question to the English of the catalog and the docs.
 * Search plumbing only: a word maps to the words the base uses. */
const FR_EN: Record<string, string> = {
  installer: "install", installe: "install", installation: "install", ajouter: "add", ajoute: "add", creer: "create", cree: "create",
  supprimer: "delete remove", effacer: "delete", retirer: "remove", modifier: "change edit", changer: "change", lancer: "launch start run",
  demarrer: "start launch", executer: "run", rouler: "run", envoyer: "send", lire: "read", ecrire: "write", ouvrir: "open", voir: "see view show",
  donner: "give grant assign", attribuer: "assign grant", accorder: "grant", partager: "share", publier: "publish", exporter: "export",
  importer: "import", sauvegarder: "backup save", sauvegarde: "backup", restaurer: "restore", connecter: "connect", brancher: "connect",
  rejoindre: "join", planifier: "schedule", programmer: "schedule", approuver: "approve approval", generer: "generate", chercher: "search",
  rechercher: "search", utiliser: "use", controler: "control", prendre: "take", noter: "notes", appeler: "call",
  greffon: "plugin", extension: "plugin extension", plugins: "plugin", outil: "tool", outils: "tools", competence: "skill", competences: "skills",
  voix: "voice", vocal: "voice", vocale: "voice", vocales: "voice", parole: "voice speech", equipe: "team", equipes: "teams",
  membre: "member", membres: "members", organisation: "organization", entreprise: "organization company", admin: "admin administrator",
  administrateur: "admin administrator", proprietaire: "owner", personne: "person people", personnes: "people", utilisateur: "user person",
  agent: "agent", agents: "agents", nuage: "cloud", infonuagique: "cloud", routines: "routine routines automations", routine: "routine automations",
  automatisation: "automations routine", automatisations: "automations routines", tache: "task", taches: "tasks", recurrente: "recurring schedule",
  chaque: "every", matin: "morning schedule", jour: "day daily", semaine: "week weekly", horaire: "schedule",
  fichier: "file", fichiers: "files", archive: "archive zip", archives: "archive zip", piece: "attachment", jointe: "attachment",
  image: "image", images: "image", photo: "image photo", capture: "screenshot", ecran: "screen screenshot", ordinateur: "computer",
  ordi: "computer", poste: "computer", mac: "mac computer desktop", bureau: "desktop", navigateur: "browser", fureteur: "browser",
  courriel: "email mail", courriels: "email", mail: "email mail", reunion: "meeting", reunions: "meetings", appel: "call", appels: "calls",
  modele: "model", modeles: "models", moteur: "engine", moteurs: "engines", fournisseur: "provider", cle: "key", cles: "keys",
  reglage: "settings", reglages: "settings", parametre: "settings", parametres: "settings", menu: "menu", page: "page", pages: "pages",
  memoire: "memory", souvenir: "memory", conversation: "conversation thread", conversations: "conversations threads", fil: "thread",
  fils: "threads", salle: "room", salles: "rooms", groupe: "group room", confidentielle: "confidential", confidentiel: "confidential",
  prive: "private confidential", privee: "private confidential", approbation: "approval", approbations: "approvals", permission: "permission",
  permissions: "permissions", droit: "permission right", droits: "permissions", acces: "access", complet: "full",
  consommation: "usage cost", jetons: "tokens usage", couts: "cost usage", cout: "cost", facture: "billing", forfait: "plan",
  telephone: "phone ios iphone", cellulaire: "phone ios", iphone: "ios iphone", ipad: "ios ipad", mobile: "mobile ios phone",
  declencheur: "trigger webhook", declencheurs: "triggers webhooks", crochet: "webhook", identifiants: "credentials", motdepasse: "password",
  passe: "password", coffre: "vault", lien: "link", liens: "links", widget: "widget", tableau: "table chart", graphique: "chart",
  mise: "update", jour_: "update", version: "version", nouveautes: "release notes new", nouveau: "new", nouvelle: "new",
  terminal: "terminal shell", commande: "command", commandes: "commands", serveur: "server", serveurs: "servers", hebergement: "hosting",
  sagax: "sagax", perspicax: "perspicax", console: "console", bot: "bot", bots: "bots", primaire: "primary chief",
  langue: "language", anglais: "language english", francais: "language french", theme: "theme skin", sombre: "dark theme", clair: "light theme",
  remplir: "fill autofill", remplisse: "fill autofill", remplisses: "fill autofill", formulaire: "form fill", mettre: "set",
  inviter: "invite", invitation: "invite", emoji: "emoji reaction", reagir: "react reaction", ancienne: "past", anciennes: "past", apparence: "appearance", notification: "notifications", alerte: "alert notifications",
};

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(/[^a-z0-9_.]+/)) {
    for (const part of raw.split(/[_.]/).concat(raw.includes("_") || raw.includes(".") ? [raw] : [])) {
      if (part.length < 2 || STOP.has(part)) continue;
      out.push(stem(part));
    }
  }
  return out;
}

/** A question's words, with the French ones mapped to the base's English. */
export function queryTerms(question: string): string[] {
  const terms: string[] = [];
  for (const raw of fold(question).split(/[^a-z0-9_.-]+/)) {
    if (!raw) continue;
    if (raw.startsWith(".") && raw.length > 1) terms.push(raw.slice(1)); // ".zip" is the zip format
    const english = FR_EN[raw] ?? FR_EN[raw.replace(/s$/, "")];
    terms.push(...tokenize(raw));
    if (english) terms.push(...tokenize(english));
  }
  return [...new Set(terms)];
}

// ---------------------------------------------------------------- index

/** How much a kind of section weighs: a checked how-to and the catalog
 * first, route lists last. */
const KIND_WEIGHT: Record<KnowledgeKind, number> = {
  guide: 1.5, tool: 1.15, setting: 1.15, menu: 1.1, perspicax: 1.05, doc: 1, engine: 0.9, release: 0.85, notes: 0.6, route: 0.4,
};

interface Indexed {
  section: KnowledgeSection;
  terms: Map<string, number>;
  length: number;
}

export interface KnowledgeIndex {
  base: KnowledgeBase;
  docs: Indexed[];
  df: Map<string, number>;
  avgLength: number;
}

export function indexKnowledge(base: KnowledgeBase): KnowledgeIndex {
  const df = new Map<string, number>();
  const docs = base.sections.map((section) => {
    const terms = new Map<string, number>();
    let length = 0;
    // Keywords and the place in the app weigh on a match but not on the
    // length: a Settings page's long list of search words must not bury it.
    const add = (text: string | undefined, weight: number, counts: boolean) => {
      for (const term of tokenize(text ?? "")) {
        terms.set(term, (terms.get(term) ?? 0) + weight);
        if (counts) length += weight;
      }
    };
    add(section.title, 3, true);
    add(section.keywords, 2, false);
    add(section.where, 2, false);
    add(section.text, 1, true);
    for (const term of terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return { section, terms, length };
  });
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
  return { base, docs, df, avgLength };
}

export interface HelpMatch { section: KnowledgeSection; score: number }

export function searchKnowledge(index: KnowledgeIndex, question: string, limit = HELP_DEFAULT_RESULTS, context?: Pick<HelpContext, "organization">): HelpMatch[] {
  const terms = queryTerms(question);
  if (!terms.length) return [];
  const total = index.docs.length;
  const k1 = 1.2;
  const b = 0.6;
  const scored: HelpMatch[] = [];
  for (const doc of index.docs) {
    let score = 0;
    let hits = 0;
    for (const term of terms) {
      const tf = doc.terms.get(term);
      if (!tf) continue;
      hits++;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / index.avgLength));
    }
    if (!score) continue;
    // A section that answers more of the question's words beats one that
    // repeats a single word.
    score *= KIND_WEIGHT[doc.section.kind] * (0.5 + hits / terms.length);
    // A solo Sagax has no Perspicax console: its pages come last there.
    if (context && !context.organization && doc.section.kind === "perspicax") score *= 0.3;
    scored.push({ section: doc.section, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.section.id < b.section.id ? -1 : 1));
  if (!scored.length) return [];
  const floor = scored[0].score * 0.35;
  return scored.filter((match) => match.score >= floor).slice(0, Math.max(1, Math.min(HELP_MAX_RESULTS, limit)));
}

/** The sentences of a section that answer the question best, in their own
 * order, within EXCERPT_CHARS. The first sentence leads a tool or a guide. */
export function excerpt(section: KnowledgeSection, question: string, max = EXCERPT_CHARS): string {
  const text = section.text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [text];
  const wanted = new Set(queryTerms(question));
  const ranked = sentences.map((sentence, at) => {
    const words = tokenize(sentence);
    const hits = words.filter((word) => wanted.has(word)).length;
    return { at, sentence, score: hits / Math.sqrt(words.length + 4) + (at === 0 && (section.kind === "tool" || section.kind === "guide") ? 10 : 0) };
  }).sort((a, b) => b.score - a.score || a.at - b.at);
  const kept: typeof ranked = [];
  let size = 0;
  for (const entry of ranked) {
    if (size + entry.sentence.length > max && kept.length) continue;
    kept.push(entry);
    size += entry.sentence.length + 1;
    if (size >= max) break;
  }
  kept.sort((a, b) => a.at - b.at);
  const out = kept.map((entry) => entry.sentence).join(" ");
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

// ---------------------------------------------------------------- answer

export interface HelpContext {
  /** An organization server (Perspicax), or a person's own Sagax. */
  organization: boolean;
  /** The person speaking in this turn, on an organization server. */
  role?: "admin" | "member" | null;
  /** Perspicax tools (api_list, ...) may be in this turn's catalog. */
  perspicaxTools?: boolean;
}

export function helpAnswer(index: KnowledgeIndex, question: string, context: HelpContext, limit = HELP_DEFAULT_RESULTS): { text: string; ids: string[] } {
  const { base } = index;
  const where = context.organization
    ? `organization server (Perspicax)${context.role ? `, the person speaking is ${context.role === "admin" ? "an admin" : "a member"}` : ""}`
    : "a person's own Sagax (solo, no organization)";
  const head = [
    `Sagax ${base.version} knowledge, ${base.generated}${base.perspicax && context.organization ? `; Perspicax console ${base.perspicax.version} (this organization's may be older)` : ""}. This server: ${where}.`,
  ];
  const matches = searchKnowledge(index, question, limit, context);
  if (!matches.length) {
    head.push("Nothing in the knowledge base matches. Do not claim the capability exists or does not: say you did not find it, and check your own tool list" + (context.perspicaxTools ? " (and api_list, if you have it)" : "") + " before answering.");
    return { text: head.join("\n"), ids: [] };
  }
  head.push("From Sagax's own code and docs: trust it over memory, and your own tool list over it. Say where it is and who may do it.");
  const blocks = matches.map(({ section }) => [
    `## ${section.title} [${section.kind}]`,
    section.where ? `Where: ${section.where}` : null,
    section.access ? `Access: ${section.access}` : null,
    excerpt(section, question),
    `(${section.source})`,
  ].filter(Boolean).join("\n"));
  const tail = context.perspicaxTools ? ["For this organization's live Perspicax catalog (products, profiles, what the person may reach), if you have api_list: api_list, then api_search."] : [];
  return { text: [...head, ...blocks, ...tail].join("\n\n"), ids: matches.map((match) => match.section.id) };
}

let cached: Promise<KnowledgeIndex | null> | undefined;

/** The index of the bundled base, built on first use and kept (about 6 MB).
 * Null when the file is missing (a checkout that never ran the generator). */
export function bundledKnowledgeIndex(): Promise<KnowledgeIndex | null> {
  cached ??= readBundledKnowledge().then((base) => (base ? indexKnowledge(base) : null));
  return cached;
}

/** sagax_help calls per turn: a looping bot gets a refusal, not CPU. */
export const HELP_CALLS_PER_TURN = 20;

export class HelpCallCounter {
  private readonly counts = new Map<string, number>();
  /** True while `turn` (thread and generation) is under the cap. */
  take(turn: string): boolean {
    const used = this.counts.get(turn) ?? 0;
    if (used >= HELP_CALLS_PER_TURN) return false;
    if (this.counts.size > 2000) this.counts.clear();
    this.counts.set(turn, used + 1);
    return true;
  }
}
