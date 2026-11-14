// The agents tools that draw a card in the chat: the Watcher's legacy options
// card and the two widget tools (agents-widget-tools.ts). They live here
// rather than in agents-call.ts, which is at its size ratchet; callTool hands
// these names over and returns the answer as it stands.
//
// All three post to the one internal card route. server/widgets/chat-widgets.ts
// (createAgentCard) tells them apart by the body's `tool` and is where a
// widget is stored; the checks here only save a round trip.
import { ASK_CHOICE_TOOL, parseAskChoiceInput, parseOptionsCardInput, WATCHER_OPTIONS_CARD_BOT_ID } from "../../shared/options-card.ts";
import { parsePageProposal } from "../../shared/published-pages.ts";
import { parseWidgetInput, widgetAdvice } from "../../shared/widget.ts";
import { parseAppInput } from "../../shared/app.ts";
import { PHONE_CALL_OWNER_TOOL, PLACE_PHONE_CALL_TOOL } from "../../shared/outbound-call.ts";
import { PHONE_LINE_CONTACT_TOOL } from "../../shared/phone-line-contacts.ts";
import { HANG_UP_TOOL, PLACE_CALL_TOOL, SEND_DTMF_TOOL, TRANSFER_CALL_TOOL } from "../../shared/phone-call-live.ts";
import { CHOOSE_PAGE_TARGET_TOOL } from "./agents-artifact-tools.ts";
import { pageTargetAutoResult, pageTargetCardResult, type PageTargetOffer } from "../../shared/page-targets.ts";

import type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
import type { Json } from "./agents-client.ts";

export const CARD_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_options_card", ASK_CHOICE_TOOL, CHOOSE_PAGE_TARGET_TOOL, "check_widget", "show_widget", "update_widget", "show_html", "update_html",
  "propose_page", "page_comments", PLACE_PHONE_CALL_TOOL, PHONE_CALL_OWNER_TOOL, PHONE_LINE_CONTACT_TOOL, PLACE_CALL_TOOL, SEND_DTMF_TOOL, TRANSFER_CALL_TOOL, HANG_UP_TOOL,
]);

const CARD_ROUTE = "/api/internal/options-card";
/** #3488: why a stored page source differs from what the bot gave. */
const PAGE_SOURCE_CHANGES: Record<string, string> = {
  secret_masked: "secret-shaped text was masked (never put a password, token or key in a page)",
  design_system_applied: "the design system was applied (kind design)",
};

export async function callCardTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { api, apiResponse } = context.client;
  if (name === CHOOSE_PAGE_TARGET_TOOL) {
    const intent = args?.intent === "page" || args?.intent === "artifact" || args?.intent === "any" ? args.intent : "any";
    const { ok, body } = await apiResponse(CARD_ROUTE, {
      method: "POST",
      body: JSON.stringify({ tool: CHOOSE_PAGE_TARGET_TOOL, intent }),
    });
    if (!ok) return { text: String(body.error ?? "Could not resolve a publish target."), isError: true };
    if (body.auto && typeof body.auto === "object") {
      const auto = body.auto as PageTargetOffer & { reason?: "single" | "default" };
      const reason = auto.reason === "default" || auto.reason === "single" ? auto.reason : "single";
      return { text: pageTargetAutoResult(auto, reason) };
    }
    if (body.waitsForPerson === true) {
      const offers = Array.isArray(body.targets) ? body.targets as PageTargetOffer[] : [];
      return { text: `${pageTargetCardResult(offers)} The card is waiting for the person (their notification, Approvals and this run's status). End your turn now.` };
    }
    const offers = Array.isArray(body.targets) ? body.targets as PageTargetOffer[] : [];
    return { text: pageTargetCardResult(offers) };
  }
  if (name === ASK_CHOICE_TOOL) {
    const parsed = parseAskChoiceInput(args);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const result = await api(CARD_ROUTE, { method: "POST", body: JSON.stringify({ tool: ASK_CHOICE_TOOL, ...args }) });
    // #1905: under Full access a may-I was answered with the recommended
    // option (server/widgets/chat-widgets.ts createChoiceCard); the turn goes on.
    const answered = result && typeof result === "object" && typeof (result as { answered?: { choice?: unknown } }).answered?.choice === "string"
      ? (result as { answered: { choice: string } }).answered.choice
      : null;
    if (answered) {
      return { text: `Full access answered this for the person: ${answered}. The person already authorized this work; continue in this same turn without waiting for a click, and do not ask again.` };
    }
    const body = (result && typeof result === "object" ? result : {}) as { waitsForPerson?: unknown; holds?: unknown; replaced?: unknown; retired?: unknown; turnEnds?: unknown; addressedTo?: unknown; people?: unknown; inRoom?: unknown; told?: unknown; note?: unknown; toPerson?: unknown; alreadyAnswered?: unknown };
    const key = typeof args?.key === "string" ? args.key.trim() : "";
    // #4238: a tell is a fact for the person, no card and no answer
    if (body.told === true) {
      return { text: body.toPerson === true
        ? "Recorded for the person: it reaches their own conversation with you as one line with this exchange's outcome. Go on with your work."
        : typeof body.note === "string" && body.note ? body.note : "Nothing was drawn; say it in your reply." };
    }
    // #4238: the person already answered this item: no second card
    if (typeof body.alreadyAnswered === "string") {
      return { text: body.alreadyAnswered
        ? `The person already answered this item: ${body.alreadyAnswered}. Their answer stands; no new card was raised. Go on with your work.`
        : "The person already put this item away. No new card was raised; do not raise it again. Go on with your work." };
    }
    // #4238: from another bot's request, the card went to the person's own
    // conversation with you; it holds nothing
    if (body.toPerson === true && args?.retire !== true) {
      return { text: `${body.replaced === true ? "The person's pending card for this item now asks this, in its place." : "The question card is waiting for the person in their own conversation with you."} It holds nothing: raise any other item for the person now with its own call, then answer the bot that asked you normally (without the person's items); each answer of the person arrives later as their own turn in that conversation, with the card's key.` };
    }
    // #4205: a retire closes the keyed card; nothing waits on it any more
    if (args?.retire === true) {
      return { text: body.retired ? `The card with key "${key}" is closed; an answer to it starts nothing.` : `No pending card has the key "${key}"; nothing to close.` };
    }
    const named = key ? ` (key "${key}"; the answer reaches you with this key and the chosen option)` : "";
    // #4219: a room card addressed to one person counts only their answer
    const to = typeof body.addressedTo === "string" && body.addressedTo ? body.addressedTo : "";
    const people = typeof body.people === "string" && body.people ? ` ${body.people}` : "";
    // #4219: an unaddressed room card waits on the room's people, any of them
    const waiting = to ? `${to} (the room's other people see it; only ${to}'s answer counts, and the answer names who answered)`
      : people ? "the room's people (any of them may answer; the answer names who answered)" : "the person";
    const placed = (body.replaced === true ? `Your pending card${named} now asks this, in its place${to ? `, addressed to ${waiting}` : ""}.` : `The question card${named} is waiting for ${waiting}.`) + people;
    // #4205: wait false holds nothing: the turn and the run go on
    if (body.holds === false) {
      // #4219: a routine run's card raised in its source room is answered
      // there: the answer is a turn in that room, not in this run
      const where = typeof body.inRoom === "string" && body.inRoom
        ? `in the room ${JSON.stringify(body.inRoom)} (this card is in that room, not in this run's conversation)`
        : "in this conversation";
      return { text: `${placed} It holds nothing: ask any other separate item with its own ask_choice call now, then finish your work and end normally; each answer arrives later as its own turn ${where}.` };
    }
    // #4205: on an engine that cannot take the answer live, a card that holds
    // ends this turn at the end of this call (card-turn-handoff.ts): no
    // further call runs, so the result never offers one
    if (body.turnEnds === true) {
      return { text: `${placed} It is on the person's screen with your options. This card holds your turn, and on this engine the turn ends with this call: no further tool call runs in it. Their click, or the answer they type under Other, arrives as their next message. To ask several separate items in one turn here, raise each with wait false.` };
    }
    const more = "If another separate item needs a decision, call ask_choice for it now (one card per item); then end your turn with no further text";
    // 2026-11-03: raised where the person is not watching (a routine run): the
    // card waits for them in Approvals and a notification, and the run with it.
    if (body.waitsForPerson === true) {
      return { text: `${placed} It shows in their notification, Approvals and this run's status. ${more}: this run waits, and their answer arrives as their next message.` };
    }
    return { text: `${placed} It is on the person's screen with your options. ${more}: their click, or the answer they type under Other, arrives as their next message.` };
  }
  if (name === "create_options_card") {
    if (context.botId !== WATCHER_OPTIONS_CARD_BOT_ID) {
      return { text: "create_options_card is not enabled for this bot.", isError: true };
    }
    const parsed = parseOptionsCardInput(args);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const result = await api(CARD_ROUTE, {
      method: "POST",
      body: JSON.stringify(parsed.value),
    });
    return {
      text: `Rendered the native options card in this Watcher thread (message ${String(result.messageId ?? "created")}). Wait for the person's click or custom response; the card itself authorizes no external action.`,
    };
  }

  // The ```widget self-check (server/widgets/widget-check.ts): the report as text,
  // the screenshot as an image beside it for the front ends that pass one on.
  if (name === "check_widget") {
    if (typeof args.html !== "string" || !args.html.trim()) return { text: "html: the widget's HTML, exactly as it goes in the ```widget fence.", isError: true };
    const { ok, body } = await apiResponse("/api/internal/widget-check", { method: "POST", body: JSON.stringify({ html: args.html }) });
    if (!ok) return { text: String(body.error ?? "The widget could not be checked; review it yourself, then show it."), isError: true };
    const text = String(body.text ?? "");
    const isError = body.isError === true;
    if (typeof body.screenshot !== "string") return { text, ...(isError ? { isError } : {}) };
    return {
      text,
      ...(isError ? { isError } : {}),
      passthrough: { content: [{ type: "text", text }, { type: "image", data: body.screenshot, mimeType: "image/jpeg" }], ...(isError ? { isError } : {}) },
    };
  }

  // place_phone_call / place_call / phone_call_owner (server/outbound/outbound-calls.ts):
  // consent once, then the request card (Ask) or Auto place; the harness builds every word.
  // phone_call_owner (#2194) resolves the person's verified number then places a conversation call.
  if (name === PLACE_PHONE_CALL_TOOL || name === PLACE_CALL_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "The call could not be prepared. Nothing was placed."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }
  if (name === PHONE_CALL_OWNER_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call/owner", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "The owner call could not be prepared. Nothing was placed."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }
  // phone_line_contact (#2194): persona and summary rules for an allowlisted SMS number.
  if (name === PHONE_LINE_CONTACT_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-line-contact", { method: "POST", body: JSON.stringify(args ?? {}) });
    if (!ok) return { text: String(body.error ?? "The phone-line contact could not be saved."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }
  if (name === SEND_DTMF_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call/dtmf", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "Could not send keys."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }
  if (name === TRANSFER_CALL_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call/transfer", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "Could not transfer."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }
  if (name === HANG_UP_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call/hangup", { method: "POST", body: JSON.stringify(args ?? {}) });
    if (!ok) return { text: String(body.error ?? "Could not hang up."), isError: true };
    return { text: String(body.text ?? ""), ...(body.isError === true ? { isError: true } : {}) };
  }

  // page_comments (2026-10-28): the page's annotations, read and answered
  // through the harness, which checks the page is this bot's for this person
  if (name === "page_comments") {
    const { ok, body } = await apiResponse("/api/internal/page-comments", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "Could not reach that page's comments."), isError: true };
    return { text: JSON.stringify(body) };
  }

  if (name === "propose_page") {
    const parsed = parsePageProposal(args);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const { ok, body } = await apiResponse(CARD_ROUTE, {
      method: "POST",
      body: JSON.stringify({ tool: "propose_page", ...args }),
    });
    if (!ok) return { text: String(body.error ?? "Could not propose that page."), isError: true };
    const pageId = String(body.pageId ?? "");
    // #3488: what was stored, to compare with a file without reading it back
    const stored = typeof body.sha256 === "string" ? ` Stored source: ${Number(body.bytes ?? 0)} bytes, sha256 ${body.sha256}.` : "";
    const given = body.given as { bytes?: unknown; sha256?: unknown } | undefined;
    const why = Array.isArray(body.changedBy) ? body.changedBy.map((cause) => PAGE_SOURCE_CHANGES[String(cause)] ?? String(cause)).join("; ") : "";
    const differs = given && typeof given.sha256 === "string"
      ? ` It differs from what you gave (${Number(given.bytes ?? 0)} bytes, sha256 ${given.sha256}) because ${why || "Sagax changed it before storing"}.`
      : "";
    return {
      text: `Proposed page ${pageId}, version ${Number(body.version ?? 1)}.${stored}${differs} It is NOT published: the person reviews it on its card and decides whether to publish it and who can see it. Do not say it is online. To revise it, call propose_page again with page_id "${pageId}".`,
    };
  }

  // Live apps (server/widgets/chat-apps.ts): the same internal card route, told apart
  // by `tool`. Checked here first so a malformed page costs no round trip.
  if (name === "show_html" || name === "update_html") {
    const parsed = parseAppInput(args);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const updating = name === "update_html";
    if (updating && (typeof args.app_id !== "string" || !args.app_id.trim())) {
      return { text: "app_id: is required, the id show_html returned.", isError: true };
    }
    const payload = updating
      ? { tool: "update_html", app_id: args.app_id, html: args.html, ...(typeof args.title === "string" ? { title: args.title } : {}) }
      : { tool: "show_html", html: args.html, ...(typeof args.title === "string" ? { title: args.title } : {}) };
    const { ok, body } = await apiResponse(CARD_ROUTE, { method: "POST", body: JSON.stringify(payload) });
    if (!ok) return { text: String(body.error ?? (updating ? "Could not update that app." : "Could not show that app.")), isError: true };
    const messageId = String(body.messageId ?? "");
    const masked = body.masked === true
      ? " Something in it read as a secret and was masked before it was stored. Never put a password, token or key in an app."
      : "";
    return {
      text: (updating
        ? `Updated live app ${messageId}.`
        : `Shown as a live app, id ${messageId}. It runs sandboxed with no network and cannot read anything outside its frame. To change what it shows, call update_html with app_id "${messageId}".`) + masked,
    };
  }

  // The harness normalises the tree again and is the one that stores it;
  // checking here first means a malformed widget costs the model no round
  // trip and reads the same sentence either way.
  const parsed = parseWidgetInput(args.widget);
  if (!parsed.ok) return { text: parsed.error, isError: true };
  const updating = name === "update_widget";
  if (updating && (typeof args.widget_id !== "string" || !args.widget_id.trim())) {
    return { text: "widget_id: is required, the id show_widget returned.", isError: true };
  }
  const { ok, body } = await apiResponse(CARD_ROUTE, {
    method: "POST",
    body: JSON.stringify(updating
      ? { tool: "update_widget", widget_id: args.widget_id, widget: args.widget }
      : { tool: "show_widget", widget: args.widget, ...(typeof args.fallback_text === "string" ? { fallback_text: args.fallback_text } : {}) }),
  });
  if (!ok) return { text: String(body.error ?? (updating ? "Could not update that widget." : "Could not show that widget.")), isError: true };
  const messageId = String(body.messageId ?? "");
  // Said only when it happened: the bot reads this back and can rename a field it called `key` for an id.
  const masked = body.masked === true
    ? " Something in it read as a secret and was masked before it was stored. Never put secrets in a widget, and name a payload field key, token or password only when it holds one."
    : "";
  // What parses but misleads: a list with nothing to choose, a time or a date to type.
  const advice = widgetAdvice(parsed.value);
  return {
    text: (updating
      ? `Updated widget ${messageId}.`
      : `Shown as widget ${messageId}. If it asks the person something, end your turn now: their press arrives as their next message. To change it later, call update_widget with widget_id "${messageId}".`) + masked + (advice ? ` ${advice}` : ""),
  };
}
