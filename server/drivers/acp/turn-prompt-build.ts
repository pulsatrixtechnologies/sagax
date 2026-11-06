/** Compose ACP prompt halves and the session-split prompt input (#1383). */
import { promptHalves, readPromptSplitReceipt, splitSessionPrompt } from "../prompt-split.ts";
import { ACP_PROMPT_RE_ANCHOR_TURNS } from "./constants.ts";
import type { AcpTurnCtx } from "./turn-context.ts";

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
  if (extraSection && extraSection.text.trim()) {
  halves = { ...halves, volatile: halves.volatile ? `${halves.volatile}\n\n${extraSection.text}` : extraSection.text };
  volatileSections = [...(volatileSections ?? []), extraSection];
  if (promptTurn.system) promptTurn = { ...promptTurn, system: `${promptTurn.system}\n\n${extraSection.text}` };
  }
  let promptInput = promptTurn;
  if (halves.stable !== null) {
  const receiptKey = JSON.stringify([threadId, sessionId]);
  const previousReceipt = readPromptSplitReceipt(DRIVER_KIND, receiptKey);
  // Carry the high-water mark, not just the final report: several
  // ordinary dips across turns can add up to a compaction.
  state.usagePeak = previousReceipt?.peakUsed ?? previousReceipt?.lastUsed ?? null;
  const composed = splitSessionPrompt(
  halves.stable,
  halves.volatile,
  previousReceipt,
  promptTurn.system,
  promptTurn.text,
  Boolean(turn.mentionTurn),
  ACP_PROMPT_RE_ANCHOR_TURNS,
  volatileSections,
  );
  promptInput = { ...promptTurn, system: "", text: composed.text };
  pendingSplitReceipt = { key: receiptKey, receipt: composed.receipt, previous: previousReceipt };
  // Visible to finishAcpTurnError if sendPrompt throws before this phase returns.
  ctx.pendingSplitReceipt = pendingSplitReceipt;
  }

  return { halves, volatileSections, promptInput, promptTurn, pendingSplitReceipt, state };
}
