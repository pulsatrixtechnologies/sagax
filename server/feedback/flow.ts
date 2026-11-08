// The Feedback bot's short conversation (#2618), as a pure function of the
// thread: which question is open, what the person answered, and what to ask
// next. Every question the bot asks carries a server-side marker
// (`feedback`), so the next message from the person answers it. The kind
// comes first; a bug then asks for steps, expected and actual, an idea for a
// description, a question for the question itself; then the impact; then one
// to three follow-ups only where an answer is vague; then the preview card.
import type { FeedbackKind, FeedbackStep } from "../../shared/feedback.ts";

export type FeedbackLanguage = "fr" | "en";
export type AnswerField = "steps" | "expected" | "actual" | "describe";

export interface FeedbackMarker {
  step: FeedbackStep;
  reportId: string;
  /** step "followup": the answer it makes precise. */
  field?: AnswerField;
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

export interface FeedbackFollowup {
  field: string;
  question: string;
  answer: string;
}

export interface FeedbackAnswers {
  kind?: FeedbackKind;
  steps?: string;
  expected?: string;
  actual?: string;
  describe?: string;
  impact?: string;
  followups: FeedbackFollowup[];
  /** Details the person added on the preview card. */
  extra?: string[];
}

export type FlowStep =
  | { kind: "ask"; marker: FeedbackMarker; message: { kind: "text"; text: string } | { kind: "options"; card: FlowCard } }
  | { kind: "preview" };

const KIND_CARD: Record<FeedbackLanguage, FlowCard> = {
  fr: { title: "Qu'est-ce qu'on signale?", subtitle: "Choisissez, ou décrivez-le dans vos mots.", options: ["Un bogue", "Une idée", "Une question"] },
  en: { title: "What would you like to report?", subtitle: "Pick one, or describe it in your own words.", options: ["A bug", "An idea", "A question"] },
};
const IMPACT_CARD: Record<FeedbackLanguage, FlowCard> = {
  fr: { title: "Quel est l'impact pour vous?", subtitle: "Ça aide l'équipe à trier.", options: ["Bloquant", "Gênant", "Mineur"] },
  en: { title: "How much does it affect you?", subtitle: "It helps the team sort reports.", options: ["Blocking", "Annoying", "Minor"] },
};
export const SEND_OPTIONS: Record<FeedbackLanguage, [string, string]> = {
  fr: ["Envoyer", "Annuler"],
  en: ["Send", "Cancel"],
};
export const OFFER_OPTIONS: Record<FeedbackLanguage, [string, string]> = {
  fr: ["Envoyer le signalement", "Non merci"],
  en: ["Send the report", "No thanks"],
};

const QUESTIONS: Record<FeedbackLanguage, Record<AnswerField, string>> = {
  fr: {
    steps: "Quelles étapes mènent au problème? Une par ligne, si possible.",
    expected: "Qu'est-ce que vous attendiez?",
    actual: "Et qu'est-ce qui s'est passé à la place?",
    describe: "Décrivez-le en quelques phrases.",
  },
  en: {
    steps: "What steps lead to the problem? One per line, if you can.",
    expected: "What did you expect to happen?",
    actual: "And what happened instead?",
    describe: "Describe it in a few sentences.",
  },
};
const DESCRIBE: Record<FeedbackLanguage, Record<"idea" | "question", string>> = {
  fr: { idea: "Décrivez l'idée: qu'est-ce que ça vous permettrait de faire?", question: "Quelle est votre question?" },
  en: { idea: "Describe the idea: what would it let you do?", question: "What is your question?" },
};
const FOLLOWUPS: Record<FeedbackLanguage, Record<AnswerField, string>> = {
  fr: {
    steps: "Pouvez-vous préciser les étapes: sur quelle page, quel bouton, dans quel ordre?",
    expected: "Pouvez-vous préciser ce que vous attendiez exactement?",
    actual: "Qu'avez-vous vu exactement: un message d'erreur, un écran vide, rien du tout?",
    describe: "Pouvez-vous donner un exemple concret?",
  },
  en: {
    steps: "Could you be more precise about the steps: which page, which button, in what order?",
    expected: "Could you say exactly what you expected?",
    actual: "What exactly did you see: an error message, a blank screen, nothing at all?",
    describe: "Could you give a concrete example?",
  },
};

const FIELDS: Record<FeedbackKind, AnswerField[]> = {
  bug: ["steps", "expected", "actual"],
  idea: ["describe"],
  question: ["describe"],
};
const ANSWER_STEPS = new Set<FeedbackStep>(["kind", "steps", "expected", "actual", "describe", "impact", "followup", "preview", "offer"]);
export const MAX_FOLLOWUPS = 3;

export function parseKind(text: string): FeedbackKind | undefined {
  const plain = text.trim().toLowerCase();
  for (const language of ["fr", "en"] as const) {
    const index = KIND_CARD[language].options.findIndex((option) => option.toLowerCase() === plain);
    if (index >= 0) return (["bug", "idea", "question"] as const)[index];
  }
  if (/\b(?:bogue|bug|erreur|error|crash|plant[eé]|cass[eé]|broken|marche pas|fonctionne pas)\b/i.test(plain)) return "bug";
  if (/\b(?:id[ée]e|idea|suggest|suggestion|souhait|wish|feature|ajouter|add)\b/i.test(plain)) return "idea";
  if (/\?\s*$|\b(?:comment|how|pourquoi|why|question)\b/i.test(plain)) return "question";
  return undefined;
}

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

/** The newest question the bot asked in a feedback conversation, or null. */
export function openFeedbackStep(messages: readonly FlowMessage[]): FeedbackMarker | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const marker = messages[index]!.feedback;
    if (messages[index]!.role === "bot" && marker) return ANSWER_STEPS.has(marker.step) ? marker : null;
  }
  return null;
}

/** What the person answered so far in one report, read from the thread. */
export function feedbackAnswers(messages: readonly FlowMessage[], reportId: string, preset: Partial<FeedbackAnswers> = {}): FeedbackAnswers {
  const answers: FeedbackAnswers = { followups: [], ...preset };
  let asked: FlowMessage | null = null;
  for (const message of messages) {
    if (message.role === "bot") {
      asked = message.feedback?.reportId === reportId ? message : null;
      continue;
    }
    const marker = asked?.feedback;
    const text = (message.text ?? "").trim();
    if (!marker || !text) continue;
    if (marker.step === "kind") {
      const kind = parseKind(text);
      answers.kind = kind ?? "bug";
      if (!kind || !KIND_CARD.fr.options.concat(KIND_CARD.en.options).some((option) => option.toLowerCase() === text.toLowerCase())) {
        answers.describe ??= text;
      }
    } else if (marker.step === "impact") answers.impact = text;
    else if (marker.step === "followup") answers.followups.push({ field: marker.field ?? "describe", question: asked?.text ?? "", answer: text });
    else if (marker.step === "preview" || marker.step === "offer") {
      if (!isSendOption(text, true) && !isCancelOption(text, true)) answers.extra = [...(answers.extra ?? []), text];
    } else if (marker.step === "steps" || marker.step === "expected" || marker.step === "actual" || marker.step === "describe") {
      answers[marker.step] = text;
    }
    asked = null;
  }
  return answers;
}

/** The next question, or the preview once everything is known. */
export function nextFeedbackStep(language: FeedbackLanguage, answers: FeedbackAnswers, reportId: string): FlowStep {
  // the Feedback bot's own questionnaire, never a permission; full-access: exempt
  if (!answers.kind) return { kind: "ask", marker: { step: "kind", reportId }, message: { kind: "options", card: { ...KIND_CARD[language] } } };
  const fields = FIELDS[answers.kind];
  for (const field of fields) {
    if (answers[field]) continue;
    const text = field === "describe" && answers.kind !== "bug" ? DESCRIBE[language][answers.kind] : QUESTIONS[language][field];
    return { kind: "ask", marker: { step: field, reportId }, message: { kind: "text", text } };
  }
  if (answers.kind !== "question" && !answers.impact) {
    // a question of the Feedback form, not a permission; full-access: exempt
    return { kind: "ask", marker: { step: "impact", reportId }, message: { kind: "options", card: { ...IMPACT_CARD[language] } } };
  }
  if (answers.followups.length < MAX_FOLLOWUPS) {
    const followed = new Set(answers.followups.map((followup) => followup.field));
    const vague = fields.find((field) => !followed.has(field) && isVague(answers[field]));
    if (vague) return { kind: "ask", marker: { step: "followup", reportId, field: vague }, message: { kind: "text", text: FOLLOWUPS[language][vague] } };
  }
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
