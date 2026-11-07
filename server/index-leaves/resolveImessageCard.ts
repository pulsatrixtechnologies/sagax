// @ts-nocheck
/** resolveImessageCard (#1388). Pure move from server/index.ts. */
import { messagesOnBotMac } from "../../shared/imessage.ts";
import { DATA_DIR } from "../config.ts";
import { json } from "../harness/http.ts";
import { takeImessageSend } from "../imessage/imessage-cards.ts";
import { fileInsideRoots } from "../imessage/imessage-db.ts";
import { readMessagesSettings } from "../imessage/imessage-settings.ts";
import { workspaceDir, TASK_WORKSPACES_DIR } from "../workspace/workspace.ts";
import { join } from "node:path";
import { macAppEnabled, macAppOfTool, runMacAppCall } from "../../electron/mac-apps.mjs";
import { relayMacAppCall } from "../desktop/desktop-bridge-tools.ts";
export type Host = Record<string, any>;

export function createResolveImessageCard(getHost: () => Host): any {
async function resolveImessageCard(res: ServerResponse, threadId: string, requestId: string, behavior: string): Promise<boolean> {
  const host = getHost();
  if (!requestId.startsWith("imsg-")) return false;
  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  if (card.answered || card.dismissed || card.expired) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  const pending = takeImessageSend(requestId, threadId);
  if (behavior !== "allow" || !pending) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: pending ? card.subtitle : "This send expired. Nothing was sent." } });
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  const macCheck = messagesOnBotMac({ platform: process.platform, identityKind: host.IDENTITY.kind, bridgeAction: false });
  if (pending.macApp?.person && !macCheck.ok) {
    // Organization server: the write runs on the person's own Mac, through
    // their desktop app; offline, the card says so and nothing is done.
    const person = pending.macApp.person;
    const result = await relayMacAppCall((operation) => host.desktopBridges.request(person, operation, () => true), pending.macApp.tool, pending.macApp.args);
    host.bridgeAudit?.record?.({ person, botId: pending.botId, threadId, target: "user-desktop", kind: "tool", detail: `mac_app ${pending.macApp.tool}`, ok: !result.isError });
    const detail = result.isError ? String(result.content[0]?.text ?? "It did not work.").slice(0, 300) : `Done: ${pending.to}.`;
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: detail } });
    json(res, 200, { ok: true, outcome: "allowed-once", ...(result.isError ? { send: "failed" } : {}) });
    return true;
  }
  if (pending.macApp) {
    // An Apple app write the person allowed (Mail, Calendar, Reminders, Notes).
    const app = macAppOfTool(pending.macApp.tool);
    if (!macCheck.ok || !app || !macAppEnabled(DATA_DIR, app)) {
      host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: "That app is off or not on this Mac. Nothing was done." } });
      json(res, 409, { error: "That Apple app is not available on this Mac.", code: "mac_apps_not_on_this_mac" });
      return true;
    }
    const result = await runMacAppCall(pending.macApp.tool, pending.macApp.args);
    const detail = result.isError ? String(result.content[0]?.text ?? "It did not work.").slice(0, 300) : `Done: ${pending.to}.`;
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: detail } });
    json(res, 200, { ok: true, outcome: "allowed-once", ...(result.isError ? { send: "failed" } : {}) });
    return true;
  }
  if (!macCheck.ok || !readMessagesSettings(DATA_DIR).useMessages) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: "Messages is not available on this Mac. Nothing was sent." } });
    json(res, 409, { error: "Messages is not available on this Mac.", code: "messages_not_on_this_mac" });
    return true;
  }
  let file = pending.file;
  if (file) {
    const inside = fileInsideRoots([workspaceDir(pending.botId), join(TASK_WORKSPACES_DIR, pending.botId, pending.threadId)], file);
    if (!inside) {
      host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: "That file is not in this bot's folder. Nothing was sent." } });
      json(res, 409, { error: "That file is not in this bot's folder.", code: "messages_file_outside" });
      return true;
    }
    file = inside;
  }
  try {
    await host.imessageSender.send({ to: pending.to, text: pending.text, service: pending.service, ...(file ? { file } : {}) });
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: `Sent to ${pending.to}.` } });
    json(res, 200, { ok: true, outcome: "allowed-once" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Messages did not send.";
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: detail } });
    json(res, 200, { ok: true, outcome: "allowed-once", send: "failed" });
  }
  return true;
}
  return resolveImessageCard;
}
