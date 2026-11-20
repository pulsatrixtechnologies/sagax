// A thread runs on its bot's model unless a person picked another model in
// that thread. The server stores no model for a thread that follows its bot;
// the wire carries the model the thread runs on plus followsBotModel, so the
// app and the phones read one effective model either way.
import type { ModelSelection } from "./wire.ts";

/** The same engine, model, effort and variant, and the same Auto and mode: a
 * thread pinned to the model an Auto bot falls back on is not the bot's own
 * selection (it would run Auto again, and a Heavy team's agents would too). */
export function sameModelSelection(a: ModelSelection | undefined, b: ModelSelection | undefined): boolean {
  if (!a || !b) return a === b;
  return a.instanceId === b.instanceId && a.model === b.model && a.effort === b.effort && a.variant === b.variant
    && (a.auto === true) === (b.auto === true) && (a.accountPinned === true) === (b.accountPinned === true) && a.mode === b.mode;
}
