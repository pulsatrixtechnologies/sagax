// @ts-nocheck
/** botCapabilitiesFor (#1388). Pure move from server/index.ts. */
import { toolKeepEngine, toolKeepPersonFor, toolKeepView } from "../tools/tool-keep-person.ts";
export type Host = Record<string, any>;

export function createBotCapabilitiesFor(getHost: () => Host): any {
function botCapabilitiesFor(auth: RequestAuth, botId: string, engineId: string | undefined) {
  const host = getHost();
  const { sessionPrincipal } = host;

  const bot = host.store.bot(botId);
  const level = bot ? host.viewerBotLevel(auth, bot) : null;
  if (!bot || (level === null && !host.orgAdminCaller(auth))) return { ok: false, status: 404, error: "no such bot", code: "not_found" };
  const principal = host.IDENTITY.kind === "perspicax" ? sessionPrincipal(auth)?.trim().toLowerCase() || undefined : undefined;
  const mayChange = host.IDENTITY.kind !== "perspicax"
    ? auth.kind !== "session" || auth.scopes.includes("admin")
    : level === "owner" || level === "manage" || host.orgAdminCaller(auth);
  const answer = host.botCapabilitiesAs(bot, engineId, { ...(principal ? { principal } : {}), mayChange, marketplace: host.marketplaceViewer(auth) });
  // #4527 lot E: the reader's own left out tools for this bot, never another person's
  const person = toolKeepPersonFor({ organization: host.IDENTITY.kind === "perspicax", sessionPrincipal, effectiveBotOwner: host.effectiveBotOwner }, auth, bot);
  // what THIS bot's engine really leaves out of its list up front
  const engine = toolKeepEngine(bot, host.registry?.get(engineId ?? bot.modelSelection?.instanceId)?.driverKind);
  const withKeep = (result: any) => result?.ok && person ? { ...result, capabilities: { ...result.capabilities, toolKeep: toolKeepView(bot.id, person, engine) } } : result;
  return typeof answer?.then === "function" ? answer.then(withKeep) : withKeep(answer);

}
  return botCapabilitiesFor;
}
