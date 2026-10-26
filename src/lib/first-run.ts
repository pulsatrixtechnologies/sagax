// The guided first run's step machine, kept pure so the decisions (which step
// to open on, which steps are already done, how far along we are) are unit
// tested without React. The three steps are the only ones that stand between a
// brand-new person and a working first message: connect an engine, create the
// first bot, send the first message. Each reuses an existing surface rather
// than adding a second place to configure things; this module only decides the
// order and the progress, never how a step is carried out.

/** The three real steps, in order. Nothing here is marketing or optional
 * chrome: every step is a thing that must be true before the next can run. */
export type FirstRunStep = "engine" | "bot" | "message";

export const FIRST_RUN_STEPS: readonly FirstRunStep[] = ["engine", "bot", "message"];

export interface FirstRunFacts {
  /** At least one engine can run a turn now (a personal one or a company one). */
  engineReady: boolean;
  /** The person already has a usable (non-hidden) bot, such as the starter
   * bot a fresh install seeds, or one kept from a previous session. */
  botExists: boolean;
}

/** The first step that still needs doing. An engine already connected, or a
 * bot that already exists, is shown done and skipped, never redone: so the
 * person who opens the app with a ready engine starts on "bot", and one who
 * already has both lands straight on "send your first message". */
export function firstRunInitialStep(facts: FirstRunFacts): FirstRunStep {
  if (!facts.engineReady) return "engine";
  if (!facts.botExists) return "bot";
  return "message";
}

export function firstRunStepIndex(step: FirstRunStep): number {
  return FIRST_RUN_STEPS.indexOf(step);
}

/** Whether a step is already satisfied, for the done check mark on a step the
 * person did not have to do. The message step is the finish line, never
 * "done" on its own. */
export function firstRunStepDone(step: FirstRunStep, facts: FirstRunFacts): boolean {
  if (step === "engine") return facts.engineReady;
  if (step === "bot") return facts.botExists;
  return false;
}

export function nextFirstRunStep(step: FirstRunStep): FirstRunStep | null {
  const index = firstRunStepIndex(step);
  if (index < 0 || index + 1 >= FIRST_RUN_STEPS.length) return null;
  return FIRST_RUN_STEPS[index + 1]!;
}
