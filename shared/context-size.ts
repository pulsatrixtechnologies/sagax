// #4417: a model's context size, chosen where its engine offers more than
// one (Claude Code: a 1M window or the 200K one, CLAUDE_CODE_DISABLE_1M_CONTEXT).
// One value per place, never two: the bot's own choice (`contextWindow` on
// the bot, PATCH /api/bots/:id) and the person's default per provider
// (`contextByProvider`, GET/PUT /api/me/models). The turn runs on the bot's
// choice when its model offers it, else the person's default for the
// model's provider when offered, else the model's own size. A model server
// added by address keeps the size the person typed (its catalog row offers
// that one size, so nothing here applies). Pure: the server's turn and the
// screens read the same functions.
import { providerOfModel, type ProviderInstanceFacts, type ProviderModelFacts } from "./model-provider.ts";

/** A catalog row as far as its context sizes go. */
export interface ContextSizeFacts {
  /** The size the engine runs the model at when none is chosen. */
  contextWindow?: number;
  /** Every size the engine can run this model at (the default among them). */
  contextWindows?: readonly number[];
}

const MAX_SIZE = 100_000_000;

/** A size a person may store: whole tokens, at least 1,000. */
export function isContextSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1_000 && value <= MAX_SIZE;
}

/** The sizes offered for a model, smallest first; empty with one size or none
 * (the control is then hidden, never greyed). */
export function offeredContextSizes(option: ContextSizeFacts | undefined): number[] {
  const sizes = [...new Set((option?.contextWindows ?? []).filter(isContextSize))].sort((a, b) => a - b);
  return sizes.length > 1 ? sizes : [];
}

/** The size the turn asks for, or undefined for the model's own. */
export function contextSizeInForce({ offered, chosen, fallback }: {
  offered: readonly number[];
  /** The bot's own choice. */
  chosen?: number | null;
  /** The person's default for the model's provider. */
  fallback?: number | null;
}): number | undefined {
  if (chosen && offered.includes(chosen)) return chosen;
  if (fallback && offered.includes(fallback)) return fallback;
  return undefined;
}

/** The provider a context default is kept under for this model. */
export function contextProviderOf(instance: ProviderInstanceFacts, option: ProviderModelFacts): string {
  return providerOfModel(instance, option).id;
}

/** The size the bot's next turn runs at: the chosen one, else the model's own. */
export function contextSizeForTurn({ instance, option, chosen, defaults }: {
  instance: ProviderInstanceFacts;
  option: (ProviderModelFacts & ContextSizeFacts) | undefined;
  chosen?: number | null;
  defaults: Readonly<Record<string, number>>;
}): number | undefined {
  if (!option) return undefined;
  const offered = offeredContextSizes(option);
  if (!offered.length) return undefined;
  return contextSizeInForce({ offered, chosen, fallback: defaults[contextProviderOf(instance, option)] });
}

/** `{ <provider id>: <size> }` kept as stored: unknown entries dropped. */
export function cleanContextDefaults(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [provider, size] of Object.entries(raw as Record<string, unknown>)) {
    if (provider && provider.length <= 120 && isContextSize(size)) out[provider] = size;
  }
  return out;
}

/** "1M", "200K": the size as the vendors write it. */
export function contextSizeWords(size: number): string {
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000}M`;
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(size / 1_000)}K`;
}
