import type { Answers, AskOptions, ChoiceAnswer, DeciderQuestion, DeciderResult, DeciderSeam, ScoreAnswer, YesNoAnswer } from "./types.ts";
export interface Decider {
  ask<Qs extends Record<string, DeciderQuestion>>(
    seam: DeciderSeam,
    state: unknown,
    questions: Qs,
    options?: AskOptions,
  ): Promise<DeciderResult<Answers<Qs>>>;
  choose<K extends string>(
    seam: DeciderSeam,
    state: unknown,
    question: { instructions: string; options: Record<K, string> },
    options?: AskOptions,
  ): Promise<DeciderResult<ChoiceAnswer<K>>>;
  score(
    seam: DeciderSeam,
    state: unknown,
    question: { instructions: string; levels: string[] },
    options?: AskOptions,
  ): Promise<DeciderResult<ScoreAnswer>>;
  yesNo(seam: DeciderSeam, state: unknown, instructions: string, options?: AskOptions): Promise<DeciderResult<YesNoAnswer>>;
  /** One tiny yes/no call with a draft key or the saved one (with neither,
   * Cloud Pro's included decisions through the relay), whatever the switches
   * say: the Settings Test button, and the check on save. */
  testKey(input?: { key?: string }, options?: AskOptions): Promise<DeciderResult<YesNoAnswer>>;
}
