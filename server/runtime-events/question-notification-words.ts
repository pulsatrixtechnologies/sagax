// #2909: what a question or an approval notification says, from the card
// the person will open: the question itself as the title, the asker named
// when another bot routes the banner, each answer with what it does.
import { notificationLine } from "../../shared/notification-context.ts";
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
  const lead = otherAsker ? `${otherAsker} : ` : "";
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
      return own && own.length <= 24 ? own : undefined;
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

/** A needs-you card (shared/person-attention.ts) as notification words:
 * the title says what kind of wait it is, the context holds every item whole
 * (tables as text), the choices are the card's own one-tap answers. */
export function needsYouNotificationWords(
  card: Pick<PersonAttention, "kind" | "items" | "choices">,
  routineName?: string,
  botName = "",
): { title: string; line: string; context: string; choices: string[] } {
  const where = routineName ? ` (${routineName})` : "";
  const who = botName || "Your bot";
  const title = card.kind === "question"
    ? `${who} has a question${where}`
    : card.kind === "failure" ? `${who} needs a decision${where}` : `${who} needs you${where}`;
  const items = card.items.map((entry) => entry.text.trim()).filter(Boolean);
  const context = items.length > 1 ? items.map((item) => `- ${item}`).join("\n") : items[0] ?? "";
  const first = items[0] ? notificationLine(items[0], 240) : "";
  return {
    title: card.kind === "question" && items.length === 1 ? notificationLine(items[0]!, 120) : title,
    line: first,
    context,
    choices: attentionChoices(card),
  };
}
