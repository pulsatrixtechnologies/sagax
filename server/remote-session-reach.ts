// The bot's Tailcat tools, named to the turn while a session is open
// (server/turn-reach.ts): Grok, which defers MCP tools behind search_tool,
// then offers remote_session_snapshot and remote_session_exec directly, so
// "check this computer" is one call. Owner-only (the contract in
// turn-reach.ts): the speaker is the bot's owner and pays for the turn, never
// in a room, and an unknown speaker gets nothing. Naming the tools grants
// nothing: the approval rule (server/remote-session-exec.ts) still decides.
import type { RemoteSessionOs } from "../shared/remote-session.ts";
import type { ReachContext, ReachContribution } from "./turn-reach.ts";

export const REMOTE_SESSION_REACH_TOOLS = ["agents__remote_session_snapshot", "agents__remote_session_exec"] as const;

const OS_LABEL: Record<RemoteSessionOs, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function remoteSessionReach(lookup: (input: { principalId: string; botId: string; threadId: string }) => { host: string; os: RemoteSessionOs; known: boolean } | null) {
  return (context: ReachContext): ReachContribution | null => {
    const speaker = context.speakerPrincipalId?.trim().toLowerCase();
    const owner = context.ownerPrincipalId?.trim().toLowerCase();
    const payer = context.payerPrincipalId?.trim().toLowerCase();
    if (!speaker || speaker !== owner || payer !== speaker || context.room || !context.botId || !context.threadId) return null;
    const session = lookup({ principalId: speaker, botId: context.botId, threadId: context.threadId });
    if (!session) return null;
    const os = session.known ? OS_LABEL[session.os] : "OS not known yet";
    return {
      line: `A Tailcat remote session is open on ${session.host} (${os}): remote_session_snapshot reads it in one call, remote_session_exec runs one command`,
      tools: [...REMOTE_SESSION_REACH_TOOLS],
    };
  };
}
