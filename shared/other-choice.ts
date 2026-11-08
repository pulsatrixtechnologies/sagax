/**
 * A bot's own "Other" choice (#2804). Question cards already end with an
 * "Other" row that opens a field, so a last option the model wrote as
 * "Other", "Autre fuseau" or "Something else" would show a second one.
 * The card turns that option into its own "Other" row instead.
 */
const OTHER_START = /^(other|others|another|something else|none of (these|the above)|autres?|aucune? de ces|quelque chose d'autre|autre chose)(\b|\s|$|[.:,(…-])/iu;

/** Whether a choice label is an "other / something else" escape hatch. */
export function isOtherChoice(label: string): boolean {
  return OTHER_START.test(label.trim());
}

/**
 * The index of the option that stands for "Other": only the last one, so a
 * real answer that happens to start with "Other" mid-list stays an answer.
 * -1 when the list has no such option.
 */
export function otherChoiceIndex(labels: readonly string[]): number {
  const last = labels.length - 1;
  return last >= 1 && isOtherChoice(labels[last]!) ? last : -1;
}
