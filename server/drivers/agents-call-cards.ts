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
import { PLACE_PHONE_CALL_TOOL } from "../../shared/outbound-call.ts";
import { HANG_UP_TOOL, PLACE_CALL_TOOL, SEND_DTMF_TOOL, TRANSFER_CALL_TOOL } from "../../shared/phone-call-live.ts";

import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const CARD_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_options_card", ASK_CHOICE_TOOL, "check_widget", "show_widget", "update_widget", "show_html", "update_html",
  "propose_page", "page_comments", PLACE_PHONE_CALL_TOOL, PLACE_CALL_TOOL, SEND_DTMF_TOOL, TRANSFER_CALL_TOOL, HANG_UP_TOOL,
]);

const CARD_ROUTE = "/api/internal/options-card";

export async function callCardTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { api, apiResponse } = context.client;
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
    // 2026-11-03: raised where the person is not watching (a routine run): the
    // card waits for them in Approvals and a notification, and the run with it.
    if (result && typeof result === "object" && (result as { waitsForPerson?: unknown }).waitsForPerson === true) {
      return { text: "The question card is waiting for the person (their notification, Approvals and this run's status). End your turn now with no further text: this run waits, and their answer arrives as their next message." };
    }
    return { text: "The question card is on the person's screen with your options. End your turn now with no further text: their click, or the answer they type under Other, arrives as their next message." };
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

  // place_phone_call / place_call (server/outbound/outbound-calls.ts): consent once,
  // then the request card (Ask) or Auto place; the harness builds every word.
  if (name === PLACE_PHONE_CALL_TOOL || name === PLACE_CALL_TOOL) {
    const { ok, body } = await apiResponse("/api/internal/phone-call", { method: "POST", body: JSON.stringify(args) });
    if (!ok) return { text: String(body.error ?? "The call could not be prepared. Nothing was placed."), isError: true };
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
    return {
      text: `Proposed page ${pageId}, version ${Number(body.version ?? 1)}. It is NOT published: the person reviews it on its card and decides whether to publish it and who can see it. Do not say it is online. To revise it, call propose_page again with page_id "${pageId}".`,
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
