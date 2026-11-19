// A stand-in for the bot's fast model in the soul sort tests (#5019): it
// reads the items out of the classification prompt and answers each with
// the verdict the test names.
import type { SoulClassifier, SoulVerdict } from "../bots/soul-sort.ts";

export function soulSortModel(decide: (text: string) => SoulVerdict): { classifier: SoulClassifier; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    classifier: () => async (prompt) => {
      prompts.push(prompt);
      const texts = prompt.split("\nItems:\n")[1]!.split(/^\[\d+\][^\n]*\n/m).slice(1).map((text) => text.trim());
      return JSON.stringify({ items: texts.map((text, i) => ({ i, ...decide(text) })) });
    },
  };
}

/** The usual verdict: a line that says never or always is a rule. */
export const rulesAreNeverLines = (text: string): SoulVerdict => /\b(?:never|always)\b/i.test(text) && !/open the way you opened/i.test(text) ? { kind: "rule" } : { kind: "persona" };
