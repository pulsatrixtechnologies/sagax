// What a bot can reach on this turn, said once, so "what connectors do you
// have?" is answered from the context with zero tool calls.
//
// 2026-10-21: the reference design asked "what connector do you have access to
// (mcp)" made 25 search_tool and use_tool calls before answering. The
// servers, the computer and the browser a turn mounted are already known to
// the server when it builds the prompt: one short line names them.
//
// Other features add what they open for a conversation (a remote session,
// for example) through registerReachProvider: a line for this summary, and
// the tools that come with it, which an engine that defers its MCP tools
// (Grok's search_tool and use_tool) offers directly (drivers/acp/grok.ts).
// Names only: never an argument, a result or a secret.

/** Who the turn is for. Contract for every provider: contribute only what
 * the person speaking on this turn may use themselves, paid by themselves
 * (payer == speaker), and nothing in a room unless the feature is meant for
 * every member there. An owner-only feature (a remote session the owner
 * opened, the owner's own account) checks `speakerPrincipalId ===
 * ownerPrincipalId`, `payerPrincipalId === speakerPrincipalId` and
 * `!room`; an unknown speaker or payer (undefined) gets nothing. Naming a
 * tool here grants nothing (approvals and grants still decide every call),
 * but it must not tell one person about another person's access. */
export interface ReachContext {
  botId?: string;
  threadId?: string;
  /** the bot's owner */
  ownerPrincipalId?: string;
  /** the person this turn speaks for; undefined for an operator, a routine
   * with no person, or an unknown speaker */
  speakerPrincipalId?: string;
  /** whose account pays for this turn's engine */
  payerPrincipalId?: string;
  /** a room (group) turn: several people read the reply */
  room?: boolean;
}

/** What one provider adds for a turn. */
export interface ReachContribution {
  /** one short line for the summary ("Remote session open on MAC-01") */
  line?: string;
  /** tools that come with it, as `<server>__<tool>` */
  tools?: string[];
}

export type ReachProvider = (context: ReachContext) => ReachContribution | null | undefined;

const providers = new Map<string, ReachProvider>();

/** Registers (or replaces) a provider; returns its removal. */
export function registerReachProvider(id: string, provider: ReachProvider): () => void {
  providers.set(id, provider);
  return () => {
    if (providers.get(id) === provider) providers.delete(id);
  };
}

const LINE_MAX = 160;
const LINES_MAX = 6;
const TOOLS_MAX = 24;
const TOOL_NAME = /^[A-Za-z0-9][\w.-]{0,63}__[A-Za-z0-9][\w.-]{0,63}$/;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LINE_MAX ? `${flat.slice(0, LINE_MAX - 1).trimEnd()}…` : flat;
}

/** Every provider's contribution for this turn, bounded. A provider that
 * throws or answers nonsense adds nothing. */
export function reachContributions(context: ReachContext): { lines: string[]; tools: string[] } {
  const lines: string[] = [];
  const tools = new Set<string>();
  for (const provider of providers.values()) {
    let contribution: ReachContribution | null | undefined;
    try {
      contribution = provider(context);
    } catch {
      continue;
    }
    if (!contribution) continue;
    if (typeof contribution.line === "string" && contribution.line.trim() && lines.length < LINES_MAX) lines.push(oneLine(contribution.line));
    for (const name of contribution.tools ?? []) {
      if (typeof name === "string" && TOOL_NAME.test(name.trim()) && tools.size < TOOLS_MAX) tools.add(name.trim());
    }
  }
  return { lines, tools: [...tools].sort((a, b) => a.localeCompare(b)) };
}

export interface ReachSummaryInput {
  /** MCP servers this turn mounted, by name (custom, Perspicax) */
  servers: readonly string[];
  /** built-in places: "the browser", "the computer", "data", … */
  builtins: readonly string[];
  /** the speaker's own claude.ai connectors ride this turn (payer is speaker) */
  claudeAi?: boolean;
  /** the speaker's own grok.com connectors ride this turn (payer is speaker) */
  grokCloud?: boolean;
  /** provider lines (reachContributions) */
  lines?: readonly string[];
}

const SERVERS_MAX = 24;

/** The section text, or "" when the turn reaches nothing worth naming. */
export function reachSummaryPrompt(input: ReachSummaryInput): string {
  const servers = [...new Set(input.servers.map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = servers.slice(0, SERVERS_MAX);
  const parts: string[] = [];
  if (shown.length) parts.push(`MCP servers ${shown.join(", ")}${servers.length > shown.length ? ` and ${servers.length - shown.length} more` : ""}`);
  if (input.builtins.length) parts.push(input.builtins.join(", "));
  if (input.claudeAi) parts.push("the speaker's own claude.ai connectors (their account, their access)");
  if (input.grokCloud) parts.push("the speaker's own grok.com connectors (their account, their access)");
  const lines = (input.lines ?? []).filter(Boolean);
  if (!parts.length && !lines.length) return "";
  return "\nWhat you can reach on this turn: " + (parts.length ? `${parts.join("; ")}.` : "") +
    (lines.length ? ` ${lines.map((line) => (/[.!?]$/.test(line) ? line : `${line}.`)).join(" ")}` : "") +
    " Answer a question about your connectors, tools or access from this, without calling a tool to find out; nothing else is connected unless your engine lists it." +
    " When several reads are independent, call them together in one step.";
}

// The direct turn's contributions, computed once by the server with the
// whole context above, kept per thread for the engine driver (Grok offers
// the tools directly, drivers/acp/grok.ts). A driver never calls the
// providers itself: it would not know who speaks. A room turn forgets them.
const TURNS_MAX = 512;
const byThread = new Map<string, { lines: string[]; tools: string[] }>();

export function noteTurnReach(threadId: string, reach: { lines: string[]; tools: string[] }): void {
  byThread.delete(threadId);
  if (!reach.lines.length && !reach.tools.length) return;
  byThread.set(threadId, { lines: [...reach.lines], tools: [...reach.tools] });
  while (byThread.size > TURNS_MAX) byThread.delete(byThread.keys().next().value!);
}

export function turnReachFor(threadId: string | undefined): { lines: string[]; tools: string[] } | undefined {
  return threadId ? byThread.get(threadId) : undefined;
}

export function forgetTurnReach(threadId: string): void {
  byThread.delete(threadId);
}

/** Test seam. */
export function resetReachProviders(): void {
  providers.clear();
  byThread.clear();
}
