// The one connector list in the prompt (#3351, connectors across engines L8;
// design docs/design/connectors-across-engines.md, part P6).
//
// Every turn is told the same thing about the person's connectors, whatever
// engine it runs on and whatever kind of turn it is (a direct turn, a room
// turn, a peer hop, a routine): one line per connector of the person's own
// accounts, from the registry the turn's plan reads (server/connectors/
// turn-plan.ts), with its account, its state and how to reach it from this
// turn. Sorted, with no count or time that drifts, so an unchanged registry
// gives the same bytes and the prompt stays cached.
//
// How a connector is reached:
//   - call_connector, from any engine, when its provider has a host
//     (server/connectors/hub.ts). The person's approval settings decide each
//     call as they decide a native one.
//   - its direct tools, when this turn also mounts it natively (Claude's
//     claude.ai connectors on the person's own subscription, the Grok
//     gateway on the person's own Grok sign-in), under today's rules.
//   - neither yet (a provider whose host is a later lot): the line says so,
//     and a direct turn that has run_with_engine is pointed at that account.
//   - a connector that needs a sign-in: open_connector_setup.
//
// Only the turn's connector principal's own accounts are listed (never
// another person's); a guest's confined turn and a turn for nobody get none.
import { claudeAiServerName } from "../../shared/connector-call.ts";
import type { ConnectorAccount, ConnectorAccountSlot, ConnectorEntry, ConnectorProvider, ConnectorState } from "./types.ts";

/** A provider's sign-in this turn mounts natively. */
export interface NativeConnectorMount {
  provider: ConnectorProvider;
  /** the engine instance the turn runs on (an added account has its own) */
  instanceId?: string;
  slot?: ConnectorAccountSlot;
}

export interface ConnectorListPromptInput {
  /** The turn's connector principal ("" for nobody). */
  principal: string;
  /** A guest's confined turn: no connectors, as on every other path. */
  confined?: boolean;
  /** The turn runs on someone else's sign-in: that account's own connectors
   * are not this person's, and are not used. */
  foreign?: boolean;
  /** The person's own sign-ins with their connectors (plan.accounts()). */
  accounts: readonly ConnectorAccount[];
  /** What this turn mounts natively (plan.claudeAiMounted, plan.grokCloudOnTurn). */
  native?: readonly NativeConnectorMount[];
  /** A host runs this provider's calls (hub.callable). */
  callable(provider: ConnectorProvider): boolean;
  /** call_connector is offered on this turn (the agents server is mounted
   * and the tool selection keeps it). */
  callTool: boolean;
  /** The turn runs in Full access. */
  full?: boolean;
  /** run_with_engine is offered on this turn (a person's own direct turn). */
  relay?: boolean;
}

const OUTWARD_ACTS = "Sending, forwarding or replying to mail, an automatic reply, posting or replying in Teams, starting a Teams chat, creating, changing or cancelling a calendar event (it mails the attendees), answering an invitation, and any SharePoint or OneDrive write";

/** What an outward act through a connector does at this turn's level
 * (2026-10-28: a Full access turn was never told it was one). The same on
 * every engine and for every path (native or call_connector). */
export function connectorOutwardRule(full: boolean): string {
  return full
    ? ` This turn runs in Full access: ${OUTWARD_ACTS.charAt(0).toLowerCase()}${OUTWARD_ACTS.slice(1)} go out when the person asked for them, with no confirmation and no typed GO; only a Refuse or Ask first rule, or a recipient outside the bot's allowed recipients, stops one, and Sagax shows that itself. Make the call with the exact recipients, subject, time and attendees, and say it is done only once the call succeeded. Reads, drafts and reply drafts do not ask.`
    : ` ${OUTWARD_ACTS} wait for the person's approval card: make the call with the exact recipients, subject, time and attendees (Sagax shows the card; never ask for a typed GO), and say it is done only once the call succeeded. Reads, drafts and reply drafts do not ask.`;
}

/** #1943: the person's own mail and calendar stay on /me. */
export const CONNECTOR_ME_RULE = " For this person's own mail and calendar, omit userId and user_id (or pass \"me\") so the call stays on /me with their credentials; never target another UPN or a bot inbound address.";

const SETUP = "open_connector_setup (agents__open_connector_setup)";
const CALL = "call_connector (agents__call_connector)";

const STATE_TEXT: Readonly<Record<ConnectorState, string>> = {
  connected: "connected",
  "needs-sign-in": "needs a new sign-in",
  failed: "failed when last read",
  unknown: "state not read yet",
};

/** The mount names the registry's own instance id of the sign-in (an
 * added account keeps its id; the main one is the registry's default), so a
 * turn on one account never claims another account's tools as direct. */
function mountedNatively(account: ConnectorAccount, native: readonly NativeConnectorMount[]): boolean {
  return native.some((mount) =>
    mount.provider === account.provider
    && (mount.instanceId === undefined || mount.instanceId === account.instanceId)
    && (mount.slot ?? "primary") === account.slot);
}

function directTools(provider: ConnectorProvider, entry?: ConnectorEntry): string {
  if (provider === "claude-ai") return entry ? `its direct tools mcp__${claudeAiServerName(entry.name)}__*` : "its direct tools mcp__claude_ai_*";
  if (provider === "grok-com") return "its direct tools through use_tool (search_tool finds them)";
  return "its direct tools";
}

const PROVIDER_LABEL: Readonly<Record<ConnectorProvider, string>> = { "claude-ai": "Claude", "grok-com": "Grok", "chatgpt-apps": "ChatGPT" };

/** The registry has not read this sign-in yet (it answers at once and reads
 * it in the background): its connectors are not known, not absent. */
function notReadYet(account: ConnectorAccount): boolean {
  return account.auth === "unknown" || (account.at === 0 && !account.connectors.length);
}

function quote(text: string): string {
  return `"${text.replace(/["\\]/g, "")}"`;
}

function line(account: ConnectorAccount, entry: ConnectorEntry, input: ConnectorListPromptInput, native: readonly NativeConnectorMount[]): string {
  const head = `- ${entry.name} (${account.label}): ${STATE_TEXT[entry.state]}.`;
  if (entry.state === "needs-sign-in") return `${head} Call ${SETUP} for it.`;
  const ways: string[] = [];
  if (mountedNatively(account, native)) ways.push(directTools(account.provider, entry));
  if (input.callTool && input.callable(account.provider)) ways.push(`call_connector with connector ${quote(entry.name)}`);
  if (ways.length) return `${head} Use ${ways.join(", or ")}.`;
  if (input.relay) return `${head} Not callable from this turn yet: call run_with_engine with engine ${quote(account.label)} and the complete request.`;
  return `${head} Not callable from this turn yet.`;
}

/** One line for a sign-in whose connectors are not listed: not read yet,
 * or read with none while this turn mounts it natively. */
function accountLine(label: string, provider: ConnectorProvider, unread: boolean, mounted: boolean, input: ConnectorListPromptInput): string {
  const head = `- ${label}: ${unread ? "connectors not read yet" : "no connector listed when last read"}.`;
  const ways: string[] = [];
  if (mounted) ways.push(directTools(provider));
  if (input.callTool && input.callable(provider)) ways.push("call_connector with a connector name the connectors tool lists for it");
  if (ways.length) return `${head} Use ${ways.join(", or ")}.`;
  if (input.relay) return `${head} Not callable from this turn yet: call run_with_engine with engine ${quote(label)} and the complete request.`;
  return `${head} Not callable from this turn yet.`;
}

/** The connectors section of a turn's system prompt. */
export function connectorListPrompt(input: ConnectorListPromptInput): string {
  const outward = connectorOutwardRule(input.full === true);
  if (!input.principal.trim() || input.confined) {
    return "\nNo person's connectors serve this turn. If asked for mail, calendar, Microsoft Teams, files or another connector, say so plainly and do not claim anything was read or sent.";
  }
  const foreign = input.foreign
    ? " This turn runs on an engine account that is not this person's own (the bot owner's or another person's sign-in): that account's own connectors belong to someone else and are never used for this person; only the person's own connectors below are."
    : "";
  const native = input.native ?? [];
  const rows = input.accounts
    .flatMap((account) => account.connectors.map((entry) => ({ account, entry })))
    .sort((a, b) =>
      a.entry.name.localeCompare(b.entry.name, "en")
      || a.account.label.localeCompare(b.account.label, "en")
      || a.account.key.localeCompare(b.account.key, "en"))
    .map(({ account, entry }) => line(account, entry, input, native));
  // An account with no known connector still gets a line when its
  // connectors are not read yet, or when this turn mounts it natively: the
  // bot reaches them all the same, and is never told the person has none.
  const accountRows = input.accounts
    .filter((account) => !account.connectors.length && (notReadYet(account) || mountedNatively(account, native)))
    .sort((a, b) => a.label.localeCompare(b.label, "en") || a.key.localeCompare(b.key, "en"))
    .map((account) => accountLine(account.label, account.provider, notReadYet(account), mountedNatively(account, native), input));
  // A native mount the registry has no account for yet (a sign-in it has
  // not seen): its connectors are reachable on this turn all the same.
  const unmatched = native
    .filter((mount, index) => native.findIndex((other) => other.provider === mount.provider) === index)
    .filter((mount) => !input.accounts.some((account) => mountedNatively(account, [mount])))
    .map((mount) => accountLine(PROVIDER_LABEL[mount.provider], mount.provider, true, true, input));
  rows.push(...accountRows, ...unmatched);
  const setup = ` To add a connector, or when the person asks to connect one, call ${SETUP} once: it posts the card for their own account, or says why there is none; then answer in one short sentence.`;
  if (!rows.length) {
    return `\nThis person has no connector on any account of theirs in Sagax yet.${foreign} If asked for mail, calendar, Microsoft Teams, files or another connector, say so plainly and do not claim anything was read or sent.${setup}`;
  }
  const how = input.callTool
    ? ` ${CALL} takes connector (the name as written here), tool (one of its tools: connectors with connector and query finds them, with their input) and arguments; it returns the tool's own result. Where Sagax tools are reached through use_tool, pass tool_name agents__call_connector.`
    : "";
  return [
    `\nThis person's connectors, on every account of theirs in Sagax, whatever engine this bot runs on. They act as this person, with this person's access: use them for this person's own mail, calendar, messages, files and work when asked, never for anyone else.${foreign}`,
    ...rows,
    `${how}${CONNECTOR_ME_RULE}${outward}${setup}`.trimStart(),
  ].join("\n");
}

/** The plan's native mounts, for the list. `accountInstance` names the
 * turn's instance as the registry does (ConnectorRegistry.accountInstanceOf);
 * `slot` is the sign-in the turn runs on (the second Grok account). */
export function nativeConnectorMounts(
  plan: { claudeAiMounted: boolean; grokCloudOnTurn: boolean; input: { instanceId?: string } },
  options: { slot?: ConnectorAccountSlot; accountInstance?: (provider: ConnectorProvider, instanceId: string) => string } = {},
): NativeConnectorMount[] {
  const mount = (provider: ConnectorProvider): NativeConnectorMount => {
    const instanceId = plan.input.instanceId;
    return {
      provider,
      ...(instanceId ? { instanceId: options.accountInstance ? options.accountInstance(provider, instanceId) : instanceId } : {}),
      ...(options.slot ? { slot: options.slot } : {}),
    };
  };
  return [
    ...(plan.claudeAiMounted ? [mount("claude-ai")] : []),
    ...(plan.grokCloudOnTurn ? [mount("grok-com")] : []),
  ];
}
