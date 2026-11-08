// #2909: what a question or an approval notification says, from the card
// the person will open: the question itself as the title, the asker named
// when another bot routes the banner, each answer with what it does.
import { CHOICE_LABEL_MAX, choiceQuestionMismatch, notificationContextText, notificationLine } from "../../shared/notification-context.ts";
import { attentionChoices, type PersonAttention } from "../../shared/person-attention.ts";

export interface QuestionWordsInput {
  permission: boolean;
  /** The bot that asked. */
  asker?: string;
  /** The bot whose banner carries it (a routine's owner, else the asker). */
  routed?: string;
  /** The card's summary: the question, or what the tool would do. */
  summary?: string;
  /** An approval in plain words (approvalPlain). */
  plain?: { title?: string; line: string };
  /** The harness question, when there is one (ask_choice, AskUserQuestion). */
  questions?: readonly { question?: string; options?: readonly { label?: string; description?: string }[] }[];
  /** The card's answers, in order. */
  options?: readonly string[];
}

export interface QuestionWords {
  title?: string;
  line: string;
  context: string;
  choiceLabels?: (string | undefined)[];
  choiceDetails?: (string | undefined)[];
}

export function questionNotificationWords(input: QuestionWordsInput): QuestionWords {
  const summary = String(input.summary ?? "");
  const otherAsker = input.asker && input.routed && input.asker !== input.routed ? input.asker : undefined;
  const lead = otherAsker ? `${otherAsker}: ` : "";
  if (input.permission) {
    const line = input.plain ? input.plain.line : summary;
    // the detail keeps the bot's words whole; the plain line is the headline
    const context = [otherAsker ? `${otherAsker}` : "", input.plain?.line ?? "", summary !== input.plain?.line ? summary : ""]
      .filter(Boolean).join("\n\n");
    return { ...(input.plain?.title ? { title: input.plain.title } : {}), line, context };
  }
  const first = input.questions?.[0];
  const question = first?.question?.trim() || summary;
  const options = first?.options ?? [];
  const choices = input.options ?? [];
  const choiceLabels = choices.length
    ? choices.map((choice) => {
      const own = options.find((option) => option.label === choice)?.label;
      return own && own.length <= CHOICE_LABEL_MAX ? own : undefined;
    })
    : undefined;
  const choiceDetails = choices.length
    ? choices.map((choice) => options.find((option) => option.label === choice)?.description?.trim() || undefined)
    : undefined;
  const title = `${lead}${notificationLine(question, 120)}`;
  // the detail is the summary when it says more than the question alone
  const context = [otherAsker ? `${otherAsker}` : "", summary].filter(Boolean).join("\n\n");
  return {
    title,
    line: notificationLine(question, 240),
    context,
    ...(choiceLabels?.some(Boolean) ? { choiceLabels } : {}),
    ...(choiceDetails?.some(Boolean) ? { choiceDetails } : {}),
  };
}

/** The last sentence that asks something, in plain words, or "". */
function lastQuestion(text: string): string {
  const lines = notificationContextText(text, 8000).split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const at = line.lastIndexOf("?");
    if (at < 0) continue;
    const head = line.slice(0, at + 1);
    const sentence = head.split(/(?<=[.!])\s+/).filter(Boolean).pop() ?? head;
    const tail = line.slice(at + 1).trim();
    return notificationLine(tail.startsWith("(") ? `${sentence} ${tail}` : sentence, 300);
  }
  return "";
}

/** A trailing "(oui / non)" the answers would contradict. */
const TRAILING_CHOICES = /\s*\(([^()]{2,80})\)\s*[.!]?\s*$/;

/** A needs-you card (shared/person-attention.ts) as notification words.
 * The title is the notification kind's own (`deliverableNotification`), the
 * line and the context lead with the question the bot asks (its last
 * question, not the first words of a long summary), then what each answer
 * does, then every item (tables as text). The choices are the card's own
 * one-tap answers; a Yes / No that cannot answer an "A or B?" question
 * gives no buttons (Open), and its "(oui / non)" leaves the words. */
export function needsYouNotificationWords(
  card: Pick<PersonAttention, "kind" | "items" | "choices">,
): { question: string; line: string; context: string; choices: string[] } {
  const items = card.items.map((entry) => entry.text.trim()).filter(Boolean);
  let choices = attentionChoices(card);
  let question = card.kind === "question" || choices.length ? lastQuestion(items.join("\n\n")) : "";
  let context = items.length > 1 ? items.map((item) => `- ${item}`).join("\n") : items[0] ?? "";
  if (choices.length && choiceQuestionMismatch(question, choices)) {
    choices = [];
    question = question.replace(TRAILING_CHOICES, "");
    context = context.replace(/(\?)\s*\(([^()]{2,80})\)\s*$/, "$1");
  }
  const first = items[0] ? notificationLine(items[0], 240) : "";
  return { question, line: question || first, context, choices };
}
