// #3515: cards the server stamped with English words before their words
// came from the locale catalogs, read back into their keys so they show in
// the reader's language when shown again (nothing is re-posted). One reader
// for the app (src/lib/question-card-title.ts, its `t`) and the server (the
// organization's connector and the agent API, the person's catalog words):
// - a question card from before 0.8.78 ("Your bot has a question", with
//   "Yes" / "No"; #2633, #3080);
// - the brief offer card from before #3512 ("Keep today's brief?", with
//   "Yes" / "Not now").
// A card keeps its stored labels: what it answers with never changes.

import { APPROVAL_EN } from "./approval-describe.ts";
import type { LineWords } from "./workspace-line.ts";

/** The title servers stamped on a question card before 0.8.78: the
 * question card's English title (shared/approval-describe.ts). */
export const OLD_QUESTION_TITLE = APPROVAL_EN["question.card.title"]!;

interface OldCard {
  title: string;
  titleKey: string;
  options: Readonly<Record<string, string>>;
  /** Its stored body and the parameter the key takes from it. */
  body?: { words: RegExp; key: string; param: string };
}

const OLD_CARDS: readonly OldCard[] = [
  { title: OLD_QUESTION_TITLE, titleKey: "question.card.title", options: { Yes: "approvals.yes", No: "approvals.no" } },
  {
    title: "Keep today's brief?",
    titleKey: "proactive.briefOffer.title",
    options: { Yes: "proactive.briefOffer.yes", "Not now": "proactive.briefOffer.notNow" },
    body: {
      words: /^Today's brief was on by default, without you choosing it: I stopped it\. If you say yes, I send it to you every day at (\S+), as one of my routines, which you can pause, edit or delete\.$/,
      key: "proactive.briefOffer.body",
      param: "time",
    },
  },
];

function oldCard(title: unknown): OldCard | undefined {
  const words = typeof title === "string" ? title.trim() : "";
  return words ? OLD_CARDS.find((card) => card.title === words) : undefined;
}

/** A key's words, or undefined when the catalog lacks it (`say` gave the key back). */
function said(say: LineWords, key: string, vars?: Record<string, string>): string | undefined {
  const words = say(key, vars);
  return words && words !== key ? words : undefined;
}

/** An old card's title in the reader's words; undefined for any other card. */
export function oldCardTitle(title: unknown, say: LineWords): string | undefined {
  const card = oldCard(title);
  return card ? said(say, card.titleKey) : undefined;
}

/** An old card's body in the reader's words; undefined for any other. */
export function oldCardBody(title: unknown, body: unknown, say: LineWords): string | undefined {
  const known = oldCard(title)?.body;
  const match = known && typeof body === "string" ? known.words.exec(body.trim()) : null;
  return known && match ? said(say, known.key, { [known.param]: match[1]! }) : undefined;
}

/** One of an old card's stored labels in the reader's words; the label
 * itself for any other card or label. */
export function oldCardOption(title: unknown, label: string, say: LineWords): string {
  const key = oldCard(title)?.options[label];
  return (key && said(say, key)) || label;
}
