// Search in the Edit bot rail. It shares Settings' mechanism
// (lib/settings-search.ts): the same folding (accents and case), the same
// row marks, the same highlight. The one thing Settings does not need is
// here: the editor mounts one page at a time, so the rows of the other pages
// are not in the DOM. This index tells which page holds a word (labels and
// keywords in French and English, plain synonyms included); the page that
// opens is then filtered and scrolled by applySettingsSearch like Settings.
import { BOT_SECTIONS } from "@/components/bot-settings/sections";
import { settingsQuery, settingsTextMatches } from "./settings-search";
import { botProfileSubPageOf, type BotProfileSubPage, type PersonaCategory } from "./persona-sections";

/** Search words of what each page holds, beyond the labels BOT_SECTIONS has.
 * An index, not copy: English and French side by side, accents optional. */
export const PERSONA_SEARCH_WORDS: Record<PersonaCategory, readonly string[]> = {
  overview: ["identité", "nom", "name", "description", "propriétaire", "owner", "étiquette", "statut", "status"],
  appearance: ["apparence", "mascotte", "mascottes", "mascot", "avatar", "personnage", "couleur", "photo", "image", "téléverser", "televerser", "upload", "animation", "look", "skin"],
  sharing: ["partage", "partagé", "partager", "équipe", "equipe", "team", "personnes", "people", "droits", "niveau", "level", "share"],
  visibility: ["visibilité", "visibilite", "visible", "qui peut voir", "privé", "prive", "private", "administrateurs", "admins", "salons", "rooms"],
  summary: ["résumé", "resume", "ce qu'il fait", "what it does", "aperçu", "apercu", "prompt", "invite", "ce que le modèle voit", "portée", "limites", "won't"],
  soul: ["personnalité", "personnalite", "âme", "ame", "soul", "instructions", "ton", "style", "persona", "caractère", "caractere"],
  rules: ["règles", "regles", "rules", "consignes", "contraintes", "jamais", "toujours", "never", "always", "politique", "garde-fous", "guardrails"],
  skills: ["compétences", "competences", "habiletés", "habiletes", "skills", "procédures", "procedures", "apprendre", "teach", "learned"],
  files: ["dossier", "dossier du bot", "fichiers", "files", "mémoire", "memoire", "memory", "documents", "notes", "souvenirs", "modèles de documents", "templates", "markdown"],
  model: ["modèle", "modele", "moteur", "moteurs", "engine", "fournisseur", "provider", "effort", "raisonnement", "reasoning", "contexte", "context", "vitesse", "fast", "claude", "codex", "grok", "auto", "clé api", "api key"],
  worksOn: ["zone de travail", "espace de travail", "workspace", "ordinateur", "computer", "machine virtuelle", "vm", "navigateur", "browser", "nuage", "cloud", "où il travaille", "where it works"],
  access: ["accès", "acces", "access", "mcp", "outils", "tools", "webhooks", "crochets", "autoriser", "toujours permettre", "toujours autoriser", "allow", "exclure", "exclude", "navigateur", "browser", "dossier de travail", "horaire", "planifié", "schedule"],
  slack: ["slack", "messages directs", "direct messages", "mentions", "canal", "channel"],
  permissions: ["permissions", "approbation", "approbations", "approuver", "approval", "approve", "mode auto", "auto mode", "révision", "revision", "review", "pairs", "peers", "contacter", "contact", "coordination", "demander d'abord", "refuser", "ask first", "deny", "horaire", "routines", "schedule"],
  voice: ["voix", "voice", "parler", "speak", "alertes", "alerts", "notifications", "son", "sound", "horaire", "heures calmes", "ne pas déranger", "quiet hours", "do not disturb", "schedule"],
  usage: ["utilisation", "usage", "jetons", "tokens", "coût", "cout", "cost", "facturation", "billing"],
  history: ["changements", "changes", "historique", "history", "annuler", "undo", "restaurer", "rollback", "journal", "log"],
};

/** Permissions and Access are split across sub-pages (V6): the words of the
 * options each part holds, so a search lands where the option is (#2623).
 * A section's other words open its own sub-page. */
export const PERSONA_PART_SEARCH_WORDS: Partial<Record<PersonaCategory, Partial<Record<BotProfileSubPage, readonly string[]>>>> = {
  permissions: {
    actsAlone: ["proactif", "proactive", "de lui-même", "on its own", "agit seul", "acts alone", "cible de publication", "publish target", "destinataires", "recipients", "brouillons", "drafts", "email drafts", "brouillons de courriel", "mèmes", "memes", "meme", "gif"],
    rules: ["règles personnalisées", "regles personnalisees", "custom rules"],
    advanced: ["bot principal", "primary bot", "primary", "coordination", "contacter", "contact", "pairs", "peers", "garde-fou de boucle", "loop guard", "boucle", "loop", "crochets", "hooks", "accès aux outils", "tool access", "parallèle", "parallele", "parallel", "envois en ton nom", "sending on your behalf", "limite quotidienne", "daily limit"],
  },
  access: {
    actsAlone: ["résumé de fond", "resume de fond", "background brief", "brief", "en arrière-plan", "background"],
    advanced: ["ordinateur", "computer", "nuage", "cloud", "navigateur", "browser"],
  },
};

/** The sub-page a search for `query` opens for `category`: the one that
 * holds the matched option, else the section's own (null: the header). */
export function personaSubPageForQuery(category: PersonaCategory, query: string): BotProfileSubPage | null {
  const parts = PERSONA_PART_SEARCH_WORDS[category];
  if (parts && settingsQuery(query)) {
    for (const [page, words] of Object.entries(parts) as Array<[BotProfileSubPage, readonly string[]]>) {
      if (words.some((word) => settingsTextMatches(word, query))) return page;
    }
  }
  return botProfileSubPageOf(category);
}

const partWords = (page: PersonaCategory): readonly string[] => Object.values(PERSONA_PART_SEARCH_WORDS[page] ?? {}).flat();

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** How well `query` names `page`: 0 its label, 1 a keyword of the rail, 2 a
 * word of the index, null no match. */
export function personaPageRank(page: PersonaCategory, label: string, query: string): number | null {
  if (!settingsQuery(query)) return 0;
  if (settingsTextMatches(label, query)) return 0;
  const keywords = ENTRY.get(page)?.keywords ?? [];
  if (keywords.some((word) => settingsTextMatches(word, query))) return 1;
  if (PERSONA_SEARCH_WORDS[page].some((word) => settingsTextMatches(word, query))) return 2;
  if (partWords(page).some((word) => settingsTextMatches(word, query))) return 2;
  return null;
}

/** The pages `query` leads to, best match first, ties in rail order. An empty
 * query keeps every page in rail order. */
export function personaPagesMatching(
  pages: readonly PersonaCategory[],
  query: string,
  labelOf: (page: PersonaCategory) => string,
): PersonaCategory[] {
  if (!settingsQuery(query)) return [...pages];
  return pages
    .map((page, index) => ({ page, index, rank: personaPageRank(page, labelOf(page), query) }))
    .filter((hit): hit is { page: PersonaCategory; index: number; rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((hit) => hit.page);
}

/** The result that follows `key` (ArrowDown, ArrowUp) in a list, wrapping at
 * both ends; null for any other key. */
export function stepPersonaResult<T>(results: readonly T[], current: T | undefined, key: string): T | null {
  if (results.length === 0 || (key !== "ArrowDown" && key !== "ArrowUp")) return null;
  const index = current === undefined ? -1 : results.indexOf(current);
  const step = key === "ArrowDown" ? 1 : -1;
  const next = index < 0 ? (step > 0 ? 0 : results.length - 1) : (index + step + results.length) % results.length;
  return results[next]!;
}
