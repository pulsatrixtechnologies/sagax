// #4475: a bot asked two things in one turn (two cards). The person answers
// one; the other stays open on their screen. The turn that the answer starts
// is told which of its questions still wait, so the bot goes on with what
// is answered and neither asks the open one again nor answers it for the
// person. Read from the conversation itself: the one place that says which
// card is still open.
import type { Message } from "../store.ts";

type CardRow = Pick<Message, "id" | "kind" | "card">;

const NOTE_QUESTION_MAX = 300;
const NOTE_QUESTIONS_MAX = 6;

/** Whether `message` is a bot's question card still waiting on the person:
 * an ask_choice card (drawn in the chat or raised as a request) or an
 * engine's own question, never a permission, an offer or the first-run quiz. */
export function openAskCard(message: CardRow): boolean {
  const card = message.kind === "options" ? message.card : undefined;
  if (!card || card.answered || card.dismissed || card.expired) return false;
  if (card.tool && card.requestType !== "question") return false;
  if (card.proactiveProposal) return false;
  return card.requestType === "question" || Boolean(card.questionRequest);
}

/** The words of the question an open card asks. */
function askWords(card: NonNullable<Message["card"]>): string {
  const asked = (card.questionRequest?.questions ?? []).map((question) => question.question).filter((text): text is string => typeof text === "string" && Boolean(text.trim()));
  const words = asked.length ? asked.join(" / ") : card.subtitle || card.title || "";
  const flat = words.replace(/\s+/g, " ").trim();
  return flat.length > NOTE_QUESTION_MAX ? `${flat.slice(0, NOTE_QUESTION_MAX - 1).trimEnd()}…` : flat;
}

/** The questions of `messages` still open, oldest first, leaving out the
 * card this turn answers (`answering`, its reply target). */
export function stillOpenAsks(messages: readonly CardRow[], answering?: string): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (message.id === answering || !openAskCard(message)) continue;
    const words = askWords(message.card!);
    if (words) out.push(words);
  }
  return out;
}

/** The line added to the turn's input when some of the bot's questions
 * still wait: empty when none does. */
export function openAsksNote(questions: readonly string[]): string {
  if (!questions.length) return "";
  const shown = questions.slice(0, NOTE_QUESTIONS_MAX).map((question) => `- ${JSON.stringify(question)}`);
  const more = questions.length > NOTE_QUESTIONS_MAX ? [`- and ${questions.length - NOTE_QUESTIONS_MAX} more`] : [];
  return [
    questions.length === 1
      ? "[Still open: the person has not answered this question you asked them in a card yet. Its card stays on their screen.]"
      : "[Still open: the person has not answered these questions you asked them in cards yet. Their cards stay on their screen.]",
    ...shown,
    ...more,
    "[Go on with what is answered. Do not ask these again and do not answer them for the person: each answer comes as its own message.]",
  ].join("\n");
}

/** `text` (the turn's input) with the note of the questions still open in
 * `messages`, other than the one it answers. */
export function withOpenAsksNote(text: string, messages: readonly CardRow[], answering?: string): string {
  const note = openAsksNote(stillOpenAsks(messages, answering));
  return note ? `${text}\n\n${note}` : text;
}
