// #1137, #1154: which model a person's turn runs on, so every turn of a bot
// (a group's included) runs on an engine the person who pays can pay for.
// Pure: the server passes what it knows about access, sessions and picks.
import type { ModelSelection } from "../../shared/wire.ts";
import { equivalentOfferedModel } from "../../shared/payable-model.ts";

/** A turn that left the bot's model for one the person who pays can run. */
export interface TurnModelSwitch {
  selection: ModelSelection;
  /** The bot's model the turn did not run on. */
  requested: ModelSelection;
  /** not-offered: their session lacks the pick, same engine; own-pick: their
   * own model for this bot; starred: their default model; equivalent: the
   * same tier on another engine they can pay for. */
  reason: "not-offered" | "own-pick" | "starred" | "equivalent";
}

export interface TurnModelRoutingInput {
  /** The bot's model for this turn (a viewer's own pin already applied). */
  requested: ModelSelection;
  /** The person who wrote is the bot's owner. */
  ownerSpeaks: boolean;
  /** Each person pays for their own turns (#1137), not the owner. */
  speakerPays: boolean;
  /** The payer can run this engine and model at all (credentials, policy). */
  access(selection: ModelSelection): boolean;
  /** The model ids the payer's own session offers on that engine; null when
   * unknown, so nothing is replaced on a guess. */
  offered(selection: ModelSelection): readonly string[] | null;
  /** A custom or local row: never in a session's list, never replaced. */
  exempt(selection: ModelSelection): boolean;
  /** The effort kept on `model` of that engine, when it takes it. */
  effortOn(selection: ModelSelection, model: string): ModelSelection["effort"];
  /** The person's own model for this bot, when they set one. */
  ownPick?: ModelSelection;
  /** The person's starred models, first one first. */
  starred: readonly ModelSelection[];
  /** The model of the bot's tier on another engine the payer can pay for. */
  equivalent(): ModelSelection | null;
}

const same = (a: ModelSelection, b: ModelSelection) => a.instanceId === b.instanceId && a.model === b.model;

/**
 * In order: the bot's model; the nearest model the payer's own session
 * offers on that engine; when they cannot pay for that engine and each
 * person pays (or it is the owner's own turn), the person's own model for
 * this bot, their first starred model they can run, then the same tier on
 * another engine they can pay for. Null when the bot's model runs as it is,
 * or nothing does (the access card then says what to do).
 */
export function routeTurnModel(input: TurnModelRoutingInput): TurnModelSwitch | null {
  const { requested } = input;
  const fit = (selection: ModelSelection): ModelSelection | null => {
    if (!input.access(selection)) return null;
    if (input.exempt(selection)) return selection;
    const offered = input.offered(selection);
    if (!offered || offered.includes(selection.model)) return selection;
    const model = equivalentOfferedModel(selection.model, offered);
    if (!model) return null;
    const effort = input.effortOn(selection, model);
    return { instanceId: selection.instanceId, model, ...(effort ? { effort } : {}) };
  };
  const own = fit(requested);
  if (own) return own === requested ? null : { selection: own, requested, reason: "not-offered" };
  // The owner pays for the people who write: the owner's model or the card.
  if (!input.ownerSpeaks && !input.speakerPays) return null;
  const tried: Array<{ selection: ModelSelection; reason: TurnModelSwitch["reason"] }> = [];
  if (input.ownPick && !same(input.ownPick, requested)) tried.push({ selection: input.ownPick, reason: "own-pick" });
  for (const selection of input.starred) tried.push({ selection, reason: "starred" });
  for (const candidate of tried) {
    if (same(candidate.selection, requested)) continue;
    const runs = fit(candidate.selection);
    if (runs) return { selection: runs, requested, reason: candidate.reason };
  }
  const other = input.equivalent();
  const runs = other && !same(other, requested) ? fit(other) : null;
  return runs ? { selection: runs, requested, reason: "equivalent" } : null;
}
