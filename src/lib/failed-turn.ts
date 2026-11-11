// A failed turn is stored as an activity row named "error: <the engine's
// words>" (shared/failed-turn.ts, written the same for a 1:1 chat and a
// room). This is the one place that decides what a person reads for it: the
// chat row's headline (ChatView's FailedTurnRow, which rooms render too) and
// the sidebar preview both ask signedOutEngine, so they never disagree.
import { offersSignIn } from "@/components/EngineSetup";
import { t } from "@/lib/i18n";
import { limitFailoverRowText } from "@/lib/limit-failover";
import { localizedEngineCause } from "@/lib/engine-error-text";
import { plainErrorLine } from "@/lib/plain-error";
import { stepLabel } from "@/lib/step-label";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { failedTurnCause } from "../../shared/failed-turn";
import { isEngineLimitWords } from "../../shared/engine-limit-words";
import { preSendRefusalKind } from "../../shared/presend-refusal";
import { isClientCancellation, isStoppedTurnName } from "../../shared/client-cancel";

export { failedTurnCause };

type ActivityTool = NonNullable<Message["tool"]>;

/** Whether this engine is waiting on a sign-in: its setup card is the
 * sign-in. The one answer a failed turn's row (signedOutEngine) and a place's
 * "Sign in first" (src/lib/place-view.ts) both read. */
export function engineSignedOut(engine: InstanceInfo | undefined): boolean {
  return Boolean(engine?.snapshot) && offersSignIn(engine);
}

/** The engine a failed turn is waiting on a sign-in for, if any. A
 * signed-out engine's own words are an instruction for a terminal ("Please
 * run /login") nobody here can follow, so while it still reads signed out
 * and its card is the sign-in, the row says that in plain words instead. A
 * Claude update offer is not a sign-in: it replaces the setup card. Anything
 * else keeps the engine's words: they are the most precise cause there is. */
export function signedOutEngine(tool: ActivityTool, engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return tool.setup && !tool.claudeUpdate && engineSignedOut(engine) ? engine : undefined;
}

/** A failed turn refused by the engine account's usage limit or credit
 * (the maintainer, 2026-11-04): no card in the chat for it, new or already
 * stored. #3552: the conversation's one limit line says it (held for the
 * reset, or nothing held), never the composer. */
export function isEngineLimitFailure(tool: ActivityTool): boolean {
  const cause = failedTurnCause(tool.name);
  if (cause === null) return false;
  return tool.limitResetsAt !== undefined || isEngineLimitWords(cause);
}

/** #2013 (the maintainer, 2026-11-05): a failed turn the engine refused before any
 * prompt went out (not ready, a configuration conflict, a limit, credit, an
 * expired sign-in). A bot's chat draws no card for it, new or already
 * stored: the composer line says it with its action. A room, which has no
 * such line, words it quietly. A place row keeps its own card. */
export function isPreSendRefusal(tool: ActivityTool): boolean {
  if (tool.place) return false;
  const cause = failedTurnCause(tool.name);
  if (cause === null) return false;
  return preSendRefusalKind(cause, { setup: tool.setup, claudeUpdate: tool.claudeUpdate, limitResetsAt: tool.limitResetsAt }) !== null;
}

/** The engine a bot's turns run on — what its failed-turn row is about. */
export function botEngine(bot: Bot | undefined, instances: InstanceInfo[]): InstanceInfo | undefined {
  return bot && instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
}

/** One line for a list preview: a Data receipt its result's title, a
 * failed turn what its row says, minus the "below" a list has no room for;
 * any other activity row its name. */
/** A turn that only reacted ends on its react_to_message row: the sidebar
 * reads "Reacted to a message ✅", never the tool's id. */
function reactionPreview(tool: ActivityTool): string | undefined {
  if (tool.ok === false || !/(?:^|_)react_to_message$/.test(tool.name.trim())) return undefined;
  let emoji = "";
  try {
    const args = JSON.parse(tool.input ?? "{}") as { emoji?: unknown };
    if (typeof args.emoji === "string") emoji = args.emoji.trim().slice(0, 16);
  } catch { /* the label alone */ }
  return emoji ? `${stepLabel(tool)} ${emoji}` : stepLabel(tool);
}

export function activityPreview(tool: ActivityTool, engine: InstanceInfo | undefined, dataResult?: Message["dataResult"]): string {
  if (dataResult) return dataResult.title;
  if (tool.engineMove) return t("model.org.engineMoved", { from: tool.engineMove.from, to: tool.engineMove.to });
  if (tool.limitFailover) return limitFailoverRowText({ name: tool.name, limitFailover: tool.limitFailover });
  if (isStoppedTurnName(tool.name)) return t("chat.turnStopped");
  const cause = failedTurnCause(tool.name);
  if (cause !== null && isClientCancellation(cause)) return t("chat.turnStopped");
  if (cause === null) return reactionPreview(tool) ?? tool.name;
  const signedOut = signedOutEngine(tool, engine);
  const shown = localizedEngineCause(cause) ?? cause;
  return signedOut ? t("sidebar.preview.signedOut", { name: signedOut.displayName }) : plainErrorLine(shown) ?? shown;
}
