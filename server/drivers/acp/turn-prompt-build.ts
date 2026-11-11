/** Compose ACP prompt halves and the session-split prompt input (#1383). */
import { promptHalves, readPromptSplitReceipt, splitSessionPrompt } from "../prompt-split.ts";
import { ACP_PROMPT_RE_ANCHOR_TURNS } from "./constants.ts";
import { fitOpeningSystem, promptFitTarget } from "./prompt-fit.ts";
import type { AcpTurnCtx } from "./turn-context.ts";

type Section = { id: string; text: string };

/** The opening system block: the stable half first, then the volatile half
 * (its per-conversation sections last, compact-prompt.ts), so two
 * conversations of one bot open with the same bytes up to what differs
 * (#3510). Built from the sections when they are given, so whole sections
 * can be left out; from the halves as they are otherwise. */
export function openingSystem(input: {
  stable: string;
  volatile: string;
  hint: string;
  stableSections?: readonly Section[];
  volatileSections?: readonly Section[];
  extra: Section | null;
}): { compose: (leftOut: ReadonlySet<string>) => string; present: ReadonlySet<string> } {
  const join = (sections: readonly Section[], leftOut: ReadonlySet<string>) =>
    sections.filter((section) => !leftOut.has(section.id)).map((section) => section.text).join("");
  // Sections are used only when they rebuild the halves byte for byte; a
  // caller that reordered a half (a local model's bot-last order) keeps it whole.
  const stableParts = input.stableSections && join(input.stableSections, new Set()) + input.hint === input.stable ? input.stableSections : undefined;
  const baseVolatile = input.volatileSections?.filter((section) => section !== input.extra);
  const volatileOf = (leftOut: ReadonlySet<string>) => {
    const base = join(baseVolatile ?? [], leftOut);
    const extra = input.extra && !leftOut.has(input.extra.id) ? input.extra.text : "";
    return base && extra ? `${base}\n\n${extra}` : base || extra;
  };
  const volatileParts = baseVolatile && volatileOf(new Set()) === input.volatile ? baseVolatile : undefined;
  const present = new Set([...(stableParts ?? []), ...(volatileParts ?? [])].map((section) => section.id));
  return {
    present,
    compose: (leftOut) =>
      (stableParts ? join(stableParts, leftOut) + input.hint : input.stable)
      + (volatileParts ? volatileOf(leftOut) : input.volatile),
  };
}

export function composeAcpPromptInput(ctx: AcpTurnCtx): {
  halves: { stable: string | null; volatile: string };
  volatileSections: AcpTurnCtx["turn"]["systemVolatileSections"];
  promptInput: AcpTurnCtx["promptTurn"];
  promptTurn: AcpTurnCtx["promptTurn"];
  pendingSplitReceipt: AcpTurnCtx["pendingSplitReceipt"];
  state: AcpTurnCtx["state"];
} {
  const { support, DRIVER_KIND, turn, threadId, mcpServers } = ctx;
  let promptTurn = ctx.promptTurn;
  let pendingSplitReceipt = ctx.pendingSplitReceipt;
  const state = ctx.state;
  const sessionId = ctx.sessionId;

  // A support's own standing line (support.stableSystemHint) joins
  // the stable half, so it rides once per session like the rest.
  const hint = support.stableSystemHint ?? "";
  const split = promptHalves(turn);
  let halves = hint && split.stable !== null ? { ...split, stable: split.stable + hint } : split;
  if (hint && promptTurn.system) promptTurn = { ...promptTurn, system: promptTurn.system + hint };
  // A support's own context section (Grok: the tools this bot
  // already used) rides the volatile half as one more section, so
  // a change re-sends that section alone.
  let volatileSections = turn.systemVolatileSections;
  const extraSection = halves.stable !== null
  ? support.volatileSection?.({ botId: turn.botId, serverNames: mcpServers.map((server) => server.name), sessionId, threadId, accountConnectors: turn.grokCloudConnectors === true }) ?? null
  : null;
  const extra = extraSection && extraSection.text.trim() ? extraSection : null;
  if (extra) {
  halves = { ...halves, volatile: halves.volatile ? `${halves.volatile}\n\n${extra.text}` : extra.text };
  volatileSections = [...(volatileSections ?? []), extra];
  if (promptTurn.system) promptTurn = { ...promptTurn, system: `${promptTurn.system}\n\n${extra.text}` };
  }
  let promptInput = promptTurn;
  if (halves.stable !== null) {
  const receiptKey = JSON.stringify([threadId, sessionId]);
  const previousReceipt = readPromptSplitReceipt(DRIVER_KIND, receiptKey);
  // Carry the high-water mark, not just the final report: several
  // ordinary dips across turns can add up to a compaction.
  state.usagePeak = previousReceipt?.peakUsed ?? previousReceipt?.lastUsed ?? null;
  // #3510: the full block a new session gets puts the stable half first and
  // fits the engine's size by whole sections (prompt-fit.ts).
  const opening = openingSystem({
    stable: halves.stable, volatile: halves.volatile, hint,
    ...(turn.systemStableSections ? { stableSections: turn.systemStableSections } : {}),
    ...(volatileSections ? { volatileSections } : {}),
    extra,
  });
  const fitted = fitOpeningSystem({
    compose: opening.compose,
    present: opening.present,
    text: promptTurn.text,
    target: support.promptByteLimit ? promptFitTarget(support.promptByteLimit) : undefined,
  });
  const stable = halves.stable;
  const compose = (text: string) => splitSessionPrompt(
  stable,
  halves.volatile,
  previousReceipt,
  promptTurn.system ? fitted.system : promptTurn.system,
  text,
  Boolean(turn.mentionTurn),
  ACP_PROMPT_RE_ANCHOR_TURNS,
  volatileSections,
  );
  let composed = compose(promptTurn.text);
  // The earlier-context line goes only with an opening block that needed it.
  if (composed.receipt.turnsSinceFull === 0 && promptTurn.system && fitted.text !== promptTurn.text) composed = compose(fitted.text);
  if (composed.receipt.turnsSinceFull === 0 && promptTurn.system) {
    noteOpeningPrompt(DRIVER_KIND, threadId, fitted, [...(turn.systemStableSections ?? []), ...(volatileSections ?? [])], support.promptByteLimit);
  }
  promptInput = { ...promptTurn, system: "", text: composed.text };
  pendingSplitReceipt = { key: receiptKey, receipt: composed.receipt, previous: previousReceipt };
  // Visible to finishAcpTurnError if sendPrompt throws before this phase returns.
  ctx.pendingSplitReceipt = pendingSplitReceipt;
  }

  return { halves, volatileSections, promptInput, promptTurn, pendingSplitReceipt, state };
}

/** One log line for an opening prompt that is large or left sections out:
 * its size, its biggest sections and what it left out. Ids and sizes only. */
export function noteOpeningPrompt(driver: string, threadId: string, fitted: { system: string; text: string; leftOut: string[]; historyLeftOut: boolean; over: number }, sections: readonly Section[], limit: number | undefined): void {
  if (!limit) return;
  const size = Buffer.byteLength(fitted.system, "utf8");
  if (!fitted.leftOut.length && !fitted.historyLeftOut && !fitted.over && size < limit / 2) return;
  const target = promptFitTarget(limit);
  const total = size + 2 + Buffer.byteLength(fitted.text, "utf8");
  const changes = [
    ...(fitted.leftOut.length ? [`left out sections ${fitted.leftOut.join(", ")}`] : []),
    ...(fitted.historyLeftOut ? ["left out the earlier-context line"] : []),
  ];
  const outcome = total > limit
    ? `over the engine's limit ${limit} by ${total - limit} bytes`
    : fitted.over ? `under the engine's limit ${limit}, over the target ${target} by ${fitted.over} bytes` : `fits ${target}`;
  const biggest = [...sections]
    .map((section) => ({ id: section.id, bytes: Buffer.byteLength(section.text, "utf8") }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8)
    .map((section) => `${section.id}=${section.bytes}`)
    .join(" ");
  console.info(`[acp] ${driver} opening prompt ${size} bytes, ${total} with the turn (thread ${threadId.slice(0, 8)}): biggest ${biggest}`
    + (changes.length ? `; ${changes.join("; ")}` : "") + `; ${outcome}`);
}
