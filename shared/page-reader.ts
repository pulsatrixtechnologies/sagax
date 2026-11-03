// The reader's view of a published page (2026-10-28): what the wrapper at
// /pages/view/<token> tells its own script (server/pages/published-pages-render.ts
// writes it, src/page-reader/ reads it) and the words of its bar, in French
// and English like the wrapper's other words.
//
// The bar and its tools live in the wrapper, outside the page's frame: the
// page stays in its sandbox (opaque origin, no network), and the wrapper's
// script only reaches this server's own routes with the reader's own rights.
// A reader who is not signed in gets the title, the notice and Download PDF
// (the browser prints the page's whole height; Save as PDF writes it);
// anyone signed in who may read the page also gets Annotate; the page's own
// person also gets Share.
import { MASCOT_COLOR_NAMES } from "./mascot-colors.ts";
import type { PageKind } from "./published-pages.ts";

export type ReaderLang = "fr" | "en";

/** What the wrapper hands its script, as a JSON block (never run). */
export interface ReaderBoot {
  v: 1;
  lang: ReaderLang;
  title: string;
  kind: PageKind;
  /** The version readers get. */
  version: number;
  /** The page's id, only for a signed-in reader with a right on it (its own
   * person: Share; anyone signed in who may read it: Annotate). A reader
   * who is not signed in never gets it. */
  pageId?: string;
  /** The signed-in reader, as the bar names them. */
  me?: { id: string; name: string };
  /** The page's person, as the Share popover names them (Owner). */
  owner?: { name: string };
  can: { share: boolean; annotate: boolean };
  /** The bot that published it, as its mascot is drawn in the bar
   * (2026-10-29): its name, its color (a mascot color name or #rrggbb) and
   * its character (shared/mascot-look.ts, checked again when drawn). */
  bot?: { name: string; color: string; look?: Record<string, unknown> };
}

/** The id of the JSON block and of the bar's actions. */
export const READER_BOOT_ID = "sagax-reader-boot";
export const READER_ACTIONS_ID = "sagax-reader-actions";
/** The box of the bot's mascot in the bar's byline. */
export const READER_MASCOT_ID = "sagax-reader-mascot";

const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;
const BOT_COLOR_NAMES: ReadonlySet<string> = new Set(MASCOT_COLOR_NAMES);

/** A bot color the bar may draw: a known mascot color name or #rrggbb. Pure. */
export function readerBotColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (BOT_COLOR_NAMES.has(value)) return value;
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function readerBot(value: unknown): ReaderBoot["bot"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const color = readerBotColor(record.color);
  if (typeof record.name !== "string" || !color) return undefined;
  const look = record.look && typeof record.look === "object" && !Array.isArray(record.look) ? record.look as Record<string, unknown> : undefined;
  return { name: record.name.slice(0, 80), color, ...(look ? { look } : {}) };
}

/** The boot block as the script reads it: checked, or null. Pure. */
export function parseReaderBoot(value: unknown): ReaderBoot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || (record.lang !== "fr" && record.lang !== "en")) return null;
  if (typeof record.title !== "string" || (record.kind !== "html" && record.kind !== "markdown" && record.kind !== "presentation")) return null;
  if (typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1) return null;
  const can = record.can && typeof record.can === "object" ? record.can as Record<string, unknown> : {};
  const pageId = typeof record.pageId === "string" && PAGE_ID.test(record.pageId) ? record.pageId : undefined;
  const me = record.me && typeof record.me === "object" ? record.me as Record<string, unknown> : null;
  const owner = record.owner && typeof record.owner === "object" ? record.owner as Record<string, unknown> : null;
  return {
    v: 1,
    lang: record.lang,
    title: record.title,
    kind: record.kind,
    version: record.version,
    ...(pageId ? { pageId } : {}),
    ...(me && typeof me.id === "string" && typeof me.name === "string" ? { me: { id: me.id, name: me.name } } : {}),
    ...(owner && typeof owner.name === "string" ? { owner: { name: owner.name } } : {}),
    // a right without the page's id is no right
    can: { share: can.share === true && Boolean(pageId), annotate: can.annotate === true && Boolean(pageId) },
    ...(readerBot(record.bot) ? { bot: readerBot(record.bot)! } : {}),
  };
}

/** The notice the yellow banner used to carry, word for word: who published
 * the page for whom, and that it is not a Sagax screen. Always visible in
 * the bar. Pure. */
export function readerNotice(input: { bot: string; person: string; lang: ReaderLang }): { who: string; warning: string } {
  return input.lang === "fr"
    ? { who: `Page publiée par ${input.bot} pour ${input.person}`, warning: "Ceci n'est pas un écran Sagax, n'y entrez jamais de mot de passe." }
    : { who: `Page published by ${input.bot} for ${input.person}`, warning: "This is not a Sagax screen, never enter a password here." };
}

/** The bar's two lines under the title (2026-10-29): who published it
 * (with the bot's name apart, drawn in semibold beside its mascot) and the
 * warning, word for word the notice's. Pure. */
export function readerByline(input: { bot: string; person: string; lang: ReaderLang }): { before: string; bot: string; after: string; warning: string } {
  const notice = readerNotice(input);
  const at = notice.who.indexOf(input.bot);
  return at < 0
    ? { before: notice.who, bot: "", after: "", warning: notice.warning }
    : { before: notice.who.slice(0, at), bot: input.bot, after: notice.who.slice(at + input.bot.length), warning: notice.warning };
}

const STRINGS = {
  en: {
    share: "Share",
    pdf: "Download PDF",
    pdfHint: "Opens the print dialog: choose Save as PDF.",
    shareTitle: "Share “{title}”",
    add: "Add people or groups",
    people: "Who has access",
    owner: "Owner",
    you: "You",
    someone: "A person of your organization",
    someGroup: "A group of your organization",
    remove: "Remove {name}",
    group: "Group · {count} people",
    noMatch: "No one matches.",
    general: "General access",
    invited: "People you invite",
    invitedHint: "Only you and the people or groups you add.",
    onlyYou: "Only me",
    onlyYouHint: "Only you, signed in to this server.",
    org: "Anyone in your organization",
    orgHint: "People signed in to this server.",
    link: "Anyone with the link",
    linkHint: "Anyone who has the link, without signing in.",
    linkOff: "Turned off by your organization.",
    linkConfirm: "Anyone with the link will see this page, without signing in. Confirm to switch it to a public link.",
    confirm: "Share with anyone with the link",
    cancel: "Cancel",
    copy: "Copy link",
    copied: "Copied",
    close: "Close",
    failed: "That did not work. Try again.",
    linkOffError: "Your organization turned off public links. Choose Anyone in your organization instead.",
    info: "About this page",
    annotate: "Annotate",
    hereNow: "Also reading now: {names}",
    suggest: "Suggest an edit",
    suggestWith: "Replace with",
    suggestNote: "Why (optional)",
    suggestion: "Suggested edit",
    accept: "Accept",
    decline: "Decline",
    accepted: "Accepted · version {n}",
    declined: "Declined",
    annotateHint: "Select text or click a part of the page, then write your comment.",
    comments: "Comments",
    noComments: "No comments yet.",
    newComment: "Comment on",
    onPart: "Part of the page",
    write: "Add a comment…",
    send: "Comment",
    reply: "Reply",
    replyTo: "Reply…",
    resolve: "Resolve",
    reopen: "Reopen",
    resolved: "Resolved",
    showResolved: "Show resolved ({count})",
    hideResolved: "Hide resolved",
    delete: "Delete",
    notFound: "Not found in this version",
    someoneElse: "Someone",
    justNow: "just now",
    minutes: "{n} min",
    hours: "{n} h",
    state: "Page state",
    stateHint: "What readers set in this page: votes, checks, claims.",
    stateEmpty: "Nothing set yet.",
    stateClear: "Clear the state",
    stateClearConfirm: "Clear every value readers set in this page? This cannot be undone.",
    stateLock: "Make {key} read-only",
    stateUnlock: "Let readers change {key} again",
    stateLocked: "Read-only",
    stateBy: "{name} · {when}",
    levelAnyone: "Anyone with the link",
    levelSigned: "Signed-in readers",
    levelEditors: "Editors",
    levelOwner: "You only",
  },
  fr: {
    share: "Partager",
    pdf: "Télécharger le PDF",
    pdfHint: "Ouvre la fenêtre d'impression : choisissez Enregistrer au format PDF.",
    shareTitle: "Partager « {title} »",
    add: "Ajouter des personnes ou des groupes",
    people: "Qui a accès",
    owner: "Propriétaire",
    you: "Vous",
    someone: "Une personne de votre organisation",
    someGroup: "Un groupe de votre organisation",
    remove: "Retirer {name}",
    group: "Groupe · {count} personnes",
    noMatch: "Personne ne correspond.",
    general: "Accès général",
    invited: "Personnes invitées",
    invitedHint: "Vous seul et les personnes ou groupes ajoutés.",
    onlyYou: "Moi seulement",
    onlyYouHint: "Vous seulement, connecté à ce serveur.",
    org: "Toute votre organisation",
    orgHint: "Les personnes connectées à ce serveur.",
    link: "Toute personne ayant le lien",
    linkHint: "Quiconque a le lien, sans se connecter.",
    linkOff: "Désactivé par votre organisation.",
    linkConfirm: "Toute personne ayant le lien verra cette page, sans se connecter. Confirmez pour la passer en lien public.",
    confirm: "Partager avec toute personne ayant le lien",
    cancel: "Annuler",
    copy: "Copier le lien",
    copied: "Copié",
    close: "Fermer",
    failed: "Ça n'a pas fonctionné. Réessayez.",
    linkOffError: "Votre organisation a désactivé les liens publics. Choisissez plutôt Toute votre organisation.",
    info: "À propos de cette page",
    annotate: "Annoter",
    hereNow: "Lisent aussi en ce moment : {names}",
    suggest: "Suggérer une modification",
    suggestWith: "Remplacer par",
    suggestNote: "Pourquoi (facultatif)",
    suggestion: "Modification suggérée",
    accept: "Accepter",
    decline: "Refuser",
    accepted: "Acceptée · version {n}",
    declined: "Refusée",
    annotateHint: "Sélectionnez du texte ou cliquez sur une partie de la page, puis écrivez votre commentaire.",
    comments: "Commentaires",
    noComments: "Aucun commentaire pour l'instant.",
    newComment: "Commenter",
    onPart: "Partie de la page",
    write: "Ajouter un commentaire…",
    send: "Commenter",
    reply: "Répondre",
    replyTo: "Répondre…",
    resolve: "Résoudre",
    reopen: "Rouvrir",
    resolved: "Résolu",
    showResolved: "Afficher les résolus ({count})",
    hideResolved: "Masquer les résolus",
    delete: "Supprimer",
    notFound: "Introuvable dans cette version",
    someoneElse: "Quelqu'un",
    justNow: "à l'instant",
    minutes: "{n} min",
    hours: "{n} h",
    state: "État de la page",
    stateHint: "Ce que les lecteurs ont posé dans cette page : votes, cases, réservations.",
    stateEmpty: "Rien n'est posé pour l'instant.",
    stateClear: "Vider l'état",
    stateClearConfirm: "Vider toutes les valeurs posées par les lecteurs dans cette page ? C'est définitif.",
    stateLock: "Passer {key} en lecture seule",
    stateUnlock: "Permettre de nouveau aux lecteurs de modifier {key}",
    stateLocked: "Lecture seule",
    stateBy: "{name} · {when}",
    levelAnyone: "Toute personne ayant le lien",
    levelSigned: "Lecteurs connectés",
    levelEditors: "Éditeurs",
    levelOwner: "Vous seulement",
  },
} as const;

export type ReaderStringKey = keyof typeof STRINGS.en;

/** One word of the bar, with its {placeholders} filled. Pure. */
export function readerText(lang: ReaderLang, key: ReaderStringKey, values: Record<string, string> = {}): string {
  const text: string = (STRINGS[lang] as Record<ReaderStringKey, string>)[key] ?? STRINGS.en[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Every key has both languages (the tests read this). */
export const READER_STRING_KEYS = Object.keys(STRINGS.en) as ReaderStringKey[];
export const READER_STRINGS_FR_KEYS = Object.keys(STRINGS.fr) as ReaderStringKey[];
