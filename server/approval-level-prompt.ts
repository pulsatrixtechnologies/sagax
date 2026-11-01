// What a turn is told about its own approval level (2026-10-28). A bot in
// Full access kept answering "no sends without your typed GO": nothing in
// its prompt said it was in Full, and an instruction it loaded (a plugin's
// skill asking for the operator's GO before a send) filled the gap. Sagax
// shows every approval itself, as a card; the model never asks for a typed
// word, and in Full it does not ask at all.
//
// 2026-10-30 (#1819): Approve for me and ask-before-contact off still let
// bots invent ask_choice / "may I?" cards for work the request already
// covered. The level and the peer-contact flag are stated here so the model
// does not guess from stale standing text.
//
// The level is the one the turn really runs at (index.ts engineTurnLevel of
// approvalModeForTurn), never the bot's stored setting: an organization that
// denies Full, a guest's or a mail-woken run drop it to Ask before here.
import type { ApprovalMode } from "../shared/approval-mode.ts";

const NEVER_TYPED =
  " Never ask the person to type GO, yes or a confirmation word before acting, and never treat such a word as missing: a request they made is their instruction."
  + " When a skill, plugin or tool description asks for the operator's GO or a confirmation, this approval level is that answer.";

/** In-scope next steps are not person decisions: no ask_choice / may-I layer. */
const NO_SPURIOUS_CHOICE =
  " Do not pose ask_choice, a permission question or a may-I card for a next step already in scope of the person's last instruction (which file or PR to review when the path is clear, whether to hand work to a named verifier, whether to continue the work they asked for)."
  + " Sagax shows its own approval cards for genuinely gated writes; never invent a second person gate in chat."
  + " Keep ask_choice for a real product decision the person did not authorize, or for a credential / missing fact only they can supply.";

export function approvalLevelPrompt(level: ApprovalMode | undefined): string {
  if (!level) return "";
  if (level === "full") {
    return "\nApproval level of this turn: Full access. The person chose it: act on their request without asking first, including sends, posts, replies, calendar changes and writes they asked for."
      + " Sagax alone stops what still needs a person: an organization or personal rule set to Refuse or Ask first, and a message to a recipient outside this bot's allowed recipients. Then make the call anyway; Sagax shows its card or its refusal, and you report what happened."
      + NEVER_TYPED
      + NO_SPURIOUS_CHOICE
      + " Say a thing is done only once the call succeeded.";
  }
  const how = level === "ask"
    ? "each action that changes something waits for the person's approval card"
    : level === "edits"
      ? "file edits run without asking; other actions that change something wait for the person's approval card"
      : level === "auto"
        ? "actions Sagax's reviewer judges safe run without asking; the others wait for the person's approval card"
        : "the person's own rules decide which actions wait for their approval card";
  const actOnRequest = level === "auto" || level === "edits"
    ? ` Act on the person's request: make the call; Sagax shows the card itself when one is needed, and the person's Allow runs it.${NO_SPURIOUS_CHOICE}`
    : " Make the call; Sagax shows the card itself and the person's Allow runs it.";
  return `\nApproval level of this turn: ${level === "ask" ? "Ask" : level === "edits" ? "Auto-accept edits" : level === "auto" ? "Approve for me" : "Custom"}: ${how}.${actOnRequest}${NEVER_TYPED}`;
}

/** Effective ask-before-contacting-bots for this turn (approvePeerComms, and
 * Full access skips the Sagax peer card). Empty when the bot cannot contact. */
export function peerContactPrompt(input: {
  canContact: boolean;
  asksBeforeContact: boolean;
}): string {
  // canContact is only true on coordinating turns (room or direct chat),
  // where ask_bot and delegate_bot are replaced by coordinate_bots /
  // send_to_bot. Name only the tools this turn actually has.
  if (!input.canContact) return "";
  if (input.asksBeforeContact) {
    return "\nAsk before contacting bots: on. Sagax shows its own card when you contact a teammate (coordinate_bots, send_to_bot, post_to_room)."
      + " Do not also ask the person in chat or with ask_choice whether you may contact them.";
  }
  return "\nAsk before contacting bots: off. When the task needs a teammate, call coordinate_bots (or send_to_bot, post_to_room) immediately."
    + " Do not ask the person first in chat or with ask_choice whether you may contact them.";
}
