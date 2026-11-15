// @ts-nocheck
/** resolveImessageCard (#1388). Pure move from server/index.ts. */
import { messagesOnBotMac } from "../../shared/imessage.ts";
import { json } from "../harness/http.ts";
import { takeImessageSend } from "../imessage/imessage-cards.ts";
import { macAppOfTool, runMacAppCall } from "../../electron/mac-apps.mjs";
import { relayMacAppCall } from "../desktop/desktop-bridge-tools.ts";
import { macAppRelayFiles } from "../imessage/mac-app-files.ts";
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
    const result = await relayMacAppCall((operation) => host.desktopBridges.request(person, operation, () => true), pending.macApp.tool, pending.macApp.args, macAppRelayFiles(null));
    host.bridgeAudit?.record?.({ person, botId: pending.botId, threadId, target: "user-desktop", kind: "tool", detail: `mac_app ${pending.macApp.tool}`, ok: !result.isError });
    const detail = result.isError ? String(result.content[0]?.text ?? "It did not work.").slice(0, 300) : `Done: ${pending.to}.`;
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: detail } });
    json(res, 200, { ok: true, outcome: "allowed-once", ...(result.isError ? { send: "failed" } : {}) });
    return true;
  }
  // An Apple app write the person allowed (a Messages send included).
  const app = macAppOfTool(pending.macApp.tool);
  if (!macCheck.ok || !app || !host.soloMacAppEnabled(app)) {
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
  return resolveImessageCard;
}
