// The first conversation of a new bot: two questions, then a closing line.
// Typing anything else dismisses the card and the turn runs as usual.

interface IntroMessage {
  role?: string;
  kind?: string;
  text?: string;
  card?: { title: string; subtitle: string; options: string[]; requestId?: string; dismissed?: boolean };
}

export type IntroLanguage = "fr" | "en";

interface Card {
  title: string;
  subtitle: string;
  options: string[];
}

const TASK: Record<IntroLanguage, Card> = {
  en: {
    title: "What should we start with?",
    subtitle: "Pick one. Or just write what you want.",
    options: ["Day to day work", "A project", "Just talk"],
  },
  fr: {
    title: "Par quoi on commence?",
    subtitle: "Choisis. Ou écris ce que tu veux.",
    options: ["Le quotidien", "Un projet", "Juste discuter"],
  },
};

const APPROVAL: Record<IntroLanguage, Card> = {
  en: {
    title: "How should I act?",
    subtitle: "You can change this later in the bot's settings.",
    options: ["Ask me first", "Decide and show me"],
  },
  fr: {
    title: "Comment je dois agir?",
    subtitle: "Tu pourras changer ça dans les réglages du bot.",
    options: ["Demander d'abord", "Décider et me montrer"],
  },
};

export function introTaskCard(language: IntroLanguage): { role: "bot"; kind: "options"; card: Card } {
  // an onboarding card, no permission; full-access: exempt
  return { role: "bot", kind: "options", card: TASK[language] };
}

function languageOf(title: string): IntroLanguage | null {
  if (title === TASK.fr.title || title === APPROVAL.fr.title) return "fr";
  if (title === TASK.en.title || title === APPROVAL.en.title) return "en";
  return null;
}

function closing(language: IntroLanguage, task: string, approval: string): string {
  if (language === "fr") {
    return `C'est noté. On commence par « ${task} », et je vais ${approval === APPROVAL.fr.options[0] ? "te demander avant d'agir" : "décider et te montrer le résultat"}. Écris-moi quand tu veux commencer.`;
  }
  return `Noted. We'll start with "${task}", and I will ${approval === APPROVAL.en.options[0] ? "ask before I act" : "decide and show you the result"}. Write whenever you want to begin.`;
}

export type IntroAdvance =
  | { kind: "card"; card: Card }
  | { kind: "done"; text: string };

/** The next scripted step when the person picked an option on the open card. */
export function introAdvance(messages: readonly IntroMessage[], text: string): IntroAdvance | null {
  const open = [...messages].reverse().find((message) =>
    message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed);
  if (!open?.card) return null;
  const language = languageOf(open.card.title);
  if (!language) return null;
  if (!open.card.options.includes(text)) return null;
  if (open.card.title === TASK[language].title) return { kind: "card", card: APPROVAL[language] };
  if (open.card.title === APPROVAL[language].title) {
    const task = [...messages].reverse().find((message) => message.role === "user" && message.kind === "text" && message.text && TASK[language].options.includes(message.text));
    return { kind: "done", text: closing(language, task?.text ?? TASK[language].options[0]!, text) };
  }
  return null;
}
