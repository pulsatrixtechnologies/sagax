// @ts-nocheck
/** resolveLiveProposal (#1388). Pure move from server/index.ts. */
import { personKey } from "../request-speaker.ts";
export type Host = Record<string, any>;

export function createResolveLiveProposal(getHost: () => Host): any {
async function resolveLiveProposal(auth: RequestAuth, bot: BotRecord, threadId: string, requestId: string, behavior: "allow" | "deny"): Promise<CardRespondResult> {
  const host = getHost();
  const { res, reply } = host.capturedReply();
  const args = { botId: bot.id, botName: bot.name, threadId, requestId, behavior };
  const handled = await host.resolveAndSendTeamSetup(res, args, host.teamSetupApplyRefusal(auth, { headers: {} } as IncomingMessage))
    || host.resolveAndSendRoutine(res, { ...args, ...host.routineActor(auth) }, auth.kind === "session" && host.cloudOwnerSession(auth), host.routineKeyReveal(auth))
    || host.resolveAndSendProfile(res, args)
    || host.resolveAndSendModel(res, args)
    || host.resolveAndSendRule(res, { ...args, personId: auth.kind === "session" ? personKey(auth.session) : undefined })
    || await host.resolveAndSendMeeting(res, auth, threadId, requestId, behavior)
    || host.resolveAndSendPhoneCallConsent(res, auth, threadId, requestId, behavior);
  const answered = reply();
  if (!handled || !answered) return { ok: false, status: 409, error: "The request is no longer open." };
  if (answered.status >= 400) return { ok: false, status: answered.status, error: typeof answered.body.error === "string" ? answered.body.error : "The request is no longer open." };
  return { ok: true };
}
  return resolveLiveProposal;
}
