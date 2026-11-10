// The /feedback exchange (#2618, #3299), as a pure function of the thread:
// which question is open, what the person said, and what comes next. The
// report is built from the chat /feedback is typed in (chat-facts.ts) and the
// person's own words; the server asks at most one question, only when
// nothing says what went wrong, then shows the preview card. Every message it
// posts carries a server-side marker (`feedback`), so the next message from
// the person answers it.
import type { FeedbackKind, FeedbackStep } from "../../shared/feedback.ts";
export type FeedbackLanguage = "fr" | "en";

export interface FeedbackMarker {
  step: FeedbackStep;
  reportId: string;
}

export interface FlowCard {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  requestId?: string;
  /** A question card: Sagax's approval queue and the MCP list it. */
  requestType?: "question";
  answeredText?: string;
}

export interface FlowMessage {
  id?: string;
  role: "bot" | "user";
  kind: string;
  text?: string;
  card?: FlowCard;
  feedback?: FeedbackMarker;
}

export interface FeedbackAnswers {
  /** The words typed after /feedback, or the frustrated message an offer quotes. */
  said: string;
  /** The answer to the one question, when it was asked. */
  detail?: string;
  /** The one question was asked already. */
  asked?: boolean;
  /** Details the person added on the preview card. */
  extra?: string[];
}

export type FlowStep =
  | { kind: "ask"; marker: FeedbackMarker; message: { kind: "text"; text: string } }
  | { kind: "preview" };

export const SEND_OPTIONS: Record<FeedbackLanguage, [string, string]> = {
  fr: ["Envoyer", "Annuler"],
  en: ["Send", "Cancel"],
};
export const OFFER_OPTIONS: Record<FeedbackLanguage, [string, string]> = {
  fr: ["Envoyer le signalement", "Non merci"],
  en: ["Send the report", "No thanks"],
};

const OFFER_WORDS: Record<FeedbackLanguage, { title: string; subtitle: (summary: string) => string }> = {
  fr: {
    title: "On dirait que quelque chose ne marche pas.",
    subtitle: (summary) => `Je peux envoyer un signalement à l'équipe avec ce message, la version et les journaux récents, anonymisés :\n\n« ${summary} »`,
  },
  en: {
    title: "Looks like something isn't working.",
    subtitle: (summary) => `I can send a report to the team with this message, the version and recent logs, anonymized:\n\n"${summary}"`,
  },
};

/** The ready-made report offered after a frustrated message, in the
 * person's language (the app gallery shows it too). */
export function offerCard(lang: FeedbackLanguage, summary: string): FlowCard {
  const words = OFFER_WORDS[lang];
  return { title: words.title, subtitle: words.subtitle(summary), options: [...OFFER_OPTIONS[lang]] };
}

const DETAIL_QUESTION: Record<FeedbackLanguage, string> = {
  fr: "Qu'est-ce qui s'est passé, et qu'est-ce que tu attendais à la place? Une phrase suffit.",
  en: "What happened, and what did you expect instead? One sentence is enough.",
};
const ANSWER_STEPS = new Set<FeedbackStep>(["detail", "preview", "offer"]);

/** The kind the person's words point to: a bug unless they read as an
 * idea or a question. */
export function parseKind(text: string): FeedbackKind | undefined {
  const plain = text.trim().toLowerCase();
  if (!plain) return undefined;
  if (/\b(?:bogue|bug|erreur|error|crash|plant[eé]|cass[eé]|broken|marche pas|fonctionne pas|fails?|échoue)\b/i.test(plain)) return "bug";
  if (/\b(?:id[ée]e|idea|suggest|suggestion|souhait|wish|feature|ajouter|add|would be nice|serait bien)\b/i.test(plain)) return "idea";
  if (/\?\s*$|\b(?:comment|how|pourquoi|why|question)\b/i.test(plain)) return "question";
  return undefined;
}

/** Too short or empty to say what went wrong. */
export function isVague(text: string | undefined): boolean {
  const plain = (text ?? "").trim();
  if (plain.length < 15) return true;
  return /^(?:je (?:ne )?sais pas|sais pas|aucune id[ée]e|idk|i don'?t know|no idea|n\/?a|rien|nothing|pareil|same|la m[eê]me chose|the same thing)[\s.!?]*$/i.test(plain);
}

export function feedbackLanguage(text: string): FeedbackLanguage {
  const plain = ` ${text.toLowerCase()} `;
  if (/[àâçéèêëîïôûùüÿœ]/.test(plain)) return "fr";
  const french = [" je ", " le ", " la ", " les ", " pas ", " une ", " est ", " que ", " qui ", " quand ", " avec ", " pour ", " dans "];
  return french.some((word) => plain.includes(word)) ? "fr" : "en";
}

/** The newest marker the server left in the thread, when the person's next
 * message answers it; null otherwise. */
export function openFeedbackStep(messages: readonly FlowMessage[]): FeedbackMarker | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const marker = messages[index]!.feedback;
    if (messages[index]!.role === "bot" && marker) return ANSWER_STEPS.has(marker.step) ? marker : null;
  }
  return null;
}

/** What the person said so far in one report, read from the thread. */
export function feedbackAnswers(messages: readonly FlowMessage[], reportId: string, said: string): FeedbackAnswers {
  const answers: FeedbackAnswers = { said };
  let asked: FlowMessage | null = null;
  for (const message of messages) {
    if (message.role === "bot") {
      asked = message.feedback?.reportId === reportId ? message : null;
      if (asked?.feedback?.step === "detail") answers.asked = true;
      continue;
    }
    const marker = asked?.feedback;
    const text = (message.text ?? "").trim();
    if (!marker || !text) continue;
    if (marker.step === "detail") answers.detail = answers.detail ? `${answers.detail}\n${text}` : text;
    else if (marker.step === "preview" || marker.step === "offer") {
      if (!isSendOption(text, true) && !isCancelOption(text, true)) answers.extra = [...(answers.extra ?? []), text];
    }
    asked = null;
  }
  return answers;
}

/** The one question when nothing says what went wrong (no words of the
 * person's and no error in the chat), or the preview. */
export function nextFeedbackStep(language: FeedbackLanguage, answers: FeedbackAnswers, reportId: string, chatError?: string): FlowStep {
  const words = [answers.said, answers.detail ?? ""].join(" ").trim();
  const known = Boolean(chatError?.trim()) || !isVague(words);
  if (!known && !answers.asked) return { kind: "ask", marker: { step: "detail", reportId }, message: { kind: "text", text: DETAIL_QUESTION[language] } };
  return { kind: "preview" };
}

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}
const SEND_WORDS = new Set(["envoie", "envoies", "envoyer", "envoyez", "envoi", "send", "go", "oui", "yes", "yep", "yeah", "ok", "okay", "confirme", "confirmer", "confirm", "ouais", "parfait", "vas", "allez", "accord"]);
const CANCEL_WORDS = new Set(["annule", "annuler", "annulez", "cancel", "non", "no", "nope", "stop", "abandonne", "abandon", "laisse", "tomber"]);
const NEGATIONS = new Set(["pas", "ne", "n", "not", "dont", "don", "jamais", "never", "attends", "attend", "wait", ...CANCEL_WORDS]);

/** The person's words mean "send": the exact button label, or (when `loose`,
 * only at the preview question) a short free confirmation such as "Oui,
 * envoie-le", "go" or "send it". Anything longer is a detail to add. */
export function isSendOption(text: string, loose = false): boolean {
  if ([SEND_OPTIONS.fr[0], SEND_OPTIONS.en[0], OFFER_OPTIONS.fr[0], OFFER_OPTIONS.en[0]].includes(text.trim())) return true;
  if (!loose) return false;
  const tokens = words(text);
  return tokens.length > 0 && tokens.length <= 5 && tokens.some((token) => SEND_WORDS.has(token)) && !tokens.some((token) => NEGATIONS.has(token));
}

export function isCancelOption(text: string, loose = false): boolean {
  if ([SEND_OPTIONS.fr[1], SEND_OPTIONS.en[1], OFFER_OPTIONS.fr[1], OFFER_OPTIONS.en[1]].includes(text.trim())) return true;
  if (!loose) return false;
  const tokens = words(text);
  if (tokens.length === 0 || tokens.length > 5) return false;
  return tokens.some((token) => CANCEL_WORDS.has(token)) || (tokens.some((token) => SEND_WORDS.has(token)) && tokens.some((token) => NEGATIONS.has(token)));
}
