// Claims: named leases a bot takes in Perspicax before shared work
// (`dispatch`, `routine:<name>`, `change:<repo>`), so agents of different
// harnesses do not run the same job at once. Perspicax keeps them (its
// `claim`, `claim_renew`, `claim_release` and `claim_list` MCP tools); a bot
// reaches them through its native agents tools of the same names
// (drivers/agents-catalog.ts, drivers/agents-call.ts), which post to
// POST /api/internal/perspicax/claims, which lands in runClaimTool below.
//
// Who holds a claim is decided on both sides, never by the model:
//   - Perspicax takes the user from the token it authenticates: the person
//     who speaks in this turn, through the turn's exchanged Perspicax token
//     (PerspicaxMcp.callTool);
//   - the harness pins the agent label to this bot (`sagax:<bot id>`), so two
//     bots of one person are two holders, and a model's `holder` argument is
//     dropped.
// This module reads no environment and holds no state.
import type { PerspicaxToolAnswer } from "./perspicax-mcp.ts";

export const CLAIM_TOOL_NAMES = ["claim", "claim_renew", "claim_release", "claim_list"] as const;
export type ClaimToolName = (typeof CLAIM_TOOL_NAMES)[number];
const NAMES: ReadonlySet<string> = new Set(CLAIM_TOOL_NAMES);

export function isClaimTool(name: string): name is ClaimToolName {
  return NAMES.has(name);
}

/** The arguments each tool forwards; anything else the model sent is left out. */
const FORWARDED: Record<ClaimToolName, readonly string[]> = {
  claim: ["name", "ttl_seconds", "purpose"],
  claim_renew: ["name", "ttl_seconds"],
  claim_release: ["name"],
  claim_list: [],
};

/** Perspicax's agent label rule: at most 64 of [A-Za-z0-9._:@/-]. */
const HOLDER_MAX = 64;

/** The agent label of a bot's claims: `sagax:<bot id>`, any other character
 * of the id written as `-`. */
export function claimHolder(botId: string): string {
  return `sagax:${botId.replace(/[^A-Za-z0-9._:@/-]/g, "-")}`.slice(0, HOLDER_MAX);
}

/** The arguments sent to Perspicax: the forwarded ones, and `holder` pinned
 * to the bot (never the model's). */
export function claimArguments(tool: ClaimToolName, args: Record<string, unknown>, botId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FORWARDED[tool]) if (args[key] !== undefined) out[key] = args[key];
  if (tool !== "claim_list") out.holder = claimHolder(botId);
  return out;
}

export interface ClaimRouteAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** The harness side of a native claim tool: forward it to Perspicax in the
 * speaker's name. 200 `{ result, isError }` with Perspicax's answer (a
 * refused claim is a result with `ok: false`, not an error); 400 for an
 * unknown tool; 409 when no Perspicax profile is mounted in this turn; 502
 * when Perspicax could not answer. */
export async function runClaimTool(
  mcp: { callTool(input: { threadId: string; generation: string; botId: string; name: string; args: Record<string, unknown> }): Promise<PerspicaxToolAnswer> } | null,
  input: { threadId: string; generation: string; botId: string; tool: unknown; args: unknown },
): Promise<ClaimRouteAnswer> {
  if (typeof input.tool !== "string" || !isClaimTool(input.tool)) {
    return { status: 400, body: { error: "unknown claim tool", code: "unknown_tool" } };
  }
  if (!mcp) {
    return { status: 409, body: { error: "Claims live in Perspicax, and this server is not linked to it.", code: "profile_not_mounted" } };
  }
  const args = input.args && typeof input.args === "object" && !Array.isArray(input.args) ? (input.args as Record<string, unknown>) : {};
  const answer = await mcp.callTool({
    threadId: input.threadId,
    generation: input.generation,
    botId: input.botId,
    name: input.tool,
    args: claimArguments(input.tool, args, input.botId),
  });
  if (!answer.ok) {
    if (answer.code === "profile_not_mounted") {
      return { status: 409, body: { error: "Claims need a Perspicax profile mounted in this turn; this bot has none for the person speaking.", code: answer.code } };
    }
    return { status: 502, body: { error: answer.error, code: answer.code } };
  }
  return { status: 200, body: { result: answer.value, isError: answer.isError } };
}

/** The agents integration with its claim-tools flag set from whether a
 * Perspicax profile is mounted now. A path that builds the agents tools before
 * it mounts the profile calls this once the mount is done. */
export function withClaimsFlag<T extends { env: Record<string, string> }>(agents: T, mounted: boolean): T {
  return { ...agents, env: { ...agents.env, SAGAX_CLAIMS: mounted ? "1" : "0" } };
}
