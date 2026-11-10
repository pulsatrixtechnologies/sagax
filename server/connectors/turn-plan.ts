// One connector plan per turn (lot L2 of docs/design/connectors-across-engines.md).
//
// "Which connectors does this turn have, and whose" used to be computed
// again by every reader (the dispatch of a direct turn and of a room turn,
// the connectors section of the prompt, the reach line, the Connectors
// record, the capabilities page, the setup card, the command listing, the
// relay), each from slightly different inputs. Each fix changed the rule
// and only some of the readers (cause A of the design).
//
// Now the rule lives here only, and a turn computes its plan once, in turn
// setup (server/turns/start-turn-setup.ts for a direct turn,
// server/turns/group-member-turn-launch-tools.ts for a room turn). Every
// reader reads that plan, or, outside a turn, calls connectorPlanForTurn.
// server/connectors/one-source.guard.test.ts fails when another file names
// the predicates or the provider switches.
//
// The flags are today's rules, unchanged (server/harness-connectors.ts keeps
// connectorPrincipalFor and accountConnectorsForTurn, which this reads).
import { accountConnectorsForTurn, connectorPrincipalFor, type ClaudeAiTurnInput } from "../harness-connectors.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";
import type { AccessVia } from "../engines/engine-credentials.ts";
import type { ConnectorAccount } from "./types.ts";

/** The one Grok driver that can reach grok.com connectors (the CLI). */
const GROK_CLI_DRIVER = "grokAgent";

/** Whether a Claude turn keeps the claude.ai connectors of the account it
 * runs on: only when that account is the speaker's own. */
export function claudeAiConnectorsForTurn(input: ClaudeAiTurnInput): boolean {
  return input.driver === "claudeAgent" && accountConnectorsForTurn(input) === "own";
}

/** Whether a Grok turn may load the cloud connectors of the xAI account it
 * runs on: the person's own grok.com sign-in only, on an organization turn
 * and, since 2026-10-30, on a solo server (the operator's own sign-in). The
 * driver adds no tool selection (grokCloudConnectorEnv) and keeps a card on
 * every write (grok.ts spawnArgs: never Grok's own auto or bypass mode). */
export function grokCloudConnectorsForTurn(input: ClaudeAiTurnInput): boolean {
  // #2747 (QA of #2816): xAI's managed gateway serves every connector of the
  // grok.com account, the account's own third-party MCP connectors included.
  // A bot sees only the tools Sagax mounts for it, so no bot turn loads the
  // account's managed MCP unless the bot opted in (grokAccountConnectors,
  // a bot setting off by default), and then only on the person's own sign-in.
  // A run_with_engine part is the exception (2026-11-09): that part exists
  // to reach this person's Outlook, Teams and SharePoint, so it loads the
  // gateway without the opt-in. Someone else's sign-in still never does.
  // Only the Grok CLI (grokAgent) loads them: the xAI API engine ("grok",
  // drivers/grok.ts chat-completions) has no use_tool and no grok.com MCP.
  const load = input.grokAccountConnectors === true || input.engineRelay === true;
  return load && input.driver === GROK_CLI_DRIVER && accountConnectorsForTurn(input) === "own";
}

/** #3344: whether a turn loads the account connectors of the sign-in it runs
 * on (claude.ai, or the Grok gateway). A turn that does not may hand a part to
 * that same sign-in with run_with_engine: the part loads them (engineRelay). */
export function turnLoadsAccountConnectors(input: ClaudeAiTurnInput): boolean {
  return claudeAiConnectorsForTurn(input) || grokCloudConnectorsForTurn(input);
}

/** #3344: whether a run_with_engine part on the turn's own sign-in (same
 * engine, model and account) would load account connectors the turn itself
 * does not. Only a Grok CLI turn without the bot opt-in, on the person's own
 * sign-in: its part loads the gateway (engineRelay). Every other turn (Codex,
 * pi, Gemini, a chat engine, the xAI API, Claude on a key or on someone
 * else's sign-in) loads nothing more there, so that part is no relay. */
export function relayAddsAccountConnectors(input: ClaudeAiTurnInput): boolean {
  return !turnLoadsAccountConnectors(input) && grokCloudConnectorsForTurn({ ...input, engineRelay: true });
}

/** The connectors of one turn: whose they are, what the turn's own engine
 * loads natively, and the person's sign-ins from the registry. */
export interface ConnectorTurnPlan {
  /** The person whose connectors the turn uses ("" for nobody):
   * connectorPrincipalFor, never read from tool arguments. */
  principal: string;
  /** Whose account the turn runs on, as far as connectors go. */
  account: "own" | "foreign" | "none";
  /** The facts the rules were read from (the access as planned, or as the
   * dispatch materialized it, see connectorPlanAt). */
  input: ClaudeAiTurnInput;
  /** The turn is a run_with_engine part (engineRelay). */
  relayPart: boolean;
  /** The turn has a tool selection (the bot's, or the room's). */
  toolSelection: boolean;
  /** A guest's confined turn. */
  guestConfined: boolean;
  /** Claude: the claude.ai connectors of the account (the driver's
   * claudeAiConnectors flag). */
  claudeAi: boolean;
  /** Claude: whether the driver mounts them on this turn (no guest
   * confinement, no tool selection: turn-prepare-args.ts). */
  claudeAiMounted: boolean;
  /** Grok CLI: the grok.com connectors of the account (the driver's
   * grokCloudConnectors flag; the driver then drops them on a tool
   * selection). */
  grokCloud: boolean;
  /** Grok CLI: whether this turn loads the gateway: no tool selection, and
   * on an organization server an engine that withholds host tools. */
  grokCloudOnTurn: boolean;
  /** A run_with_engine part on this same sign-in would load the gateway the
   * turn itself does not (relayAddsAccountConnectors). */
  relayAdds: boolean;
  /** What a run_with_engine part on this sign-in would load (the gateway
   * with engineRelay), for the relay list of another turn. */
  relayLoads: boolean;
  /** The person's own sign-ins with their connectors, from the registry,
   * read on first use (a read may start a background refresh, so a turn
   * that never asks starts none). Empty for nobody. */
  accounts(): readonly ConnectorAccount[];
}

/** The turn facts the plan needs beside the account input. */
export interface ConnectorPlanTurn {
  relayPart?: boolean;
  toolSelection?: boolean;
  guestConfined?: boolean;
  /** The engine withholds host tools (an organization turn needs it for
   * the Grok gateway). */
  withholdsHostTools?: boolean;
  accounts?: (principal: string) => readonly ConnectorAccount[];
}

/** The plan from its facts. Pure: the one place the rules are read. */
export function connectorPlanFrom(base: ClaudeAiTurnInput, turn: ConnectorPlanTurn = {}): ConnectorTurnPlan {
  const relayPart = turn.relayPart === true;
  const { engineRelay: _relay, ...plain } = base;
  const input: ClaudeAiTurnInput = relayPart ? { ...plain, engineRelay: true } : plain;
  const toolSelection = turn.toolSelection === true;
  const guestConfined = turn.guestConfined === true;
  const principal = connectorPrincipalFor(input);
  const claudeAi = claudeAiConnectorsForTurn(input);
  const grokCloud = grokCloudConnectorsForTurn(input);
  let read: readonly ConnectorAccount[] | undefined;
  return {
    principal,
    account: accountConnectorsForTurn(input),
    input,
    relayPart,
    toolSelection,
    guestConfined,
    claudeAi,
    claudeAiMounted: claudeAi && !guestConfined && !toolSelection,
    grokCloud,
    grokCloudOnTurn: grokCloud && !toolSelection && (input.identity !== "perspicax" || turn.withholdsHostTools === true),
    relayAdds: relayAddsAccountConnectors(input),
    relayLoads: grokCloudConnectorsForTurn({ ...plain, engineRelay: true }),
    accounts: () => {
      read ??= principal && turn.accounts ? turn.accounts(principal) : [];
      return read;
    },
  };
}

type PlanBot = { toolScope?: unknown };
type PlanInstance = { instanceId: string; driverKind: string };
type LoginSlot = "primary" | "second";

/** What the server gives the plan. */
export interface ConnectorPlanDeps<Bot extends PlanBot = PlanBot, Instance extends PlanInstance = PlanInstance> {
  /** The account facts of a turn (index-leaves/accountConnectorInput.ts). */
  accountConnectorInput(bot: Bot, instance: Instance, speaker: TurnSpeaker, via?: AccessVia, slot?: LoginSlot): ClaudeAiTurnInput;
  /** A run_with_engine part's thread. */
  isRelayPart?(threadId: string): boolean;
  withholdHostToolsFor(instance: Instance): boolean;
  /** The person's sign-ins (ConnectorRegistry.accounts). */
  accounts?(principal: string): readonly ConnectorAccount[];
}

export interface ConnectorPlanOptions {
  /** A sign-in other than the turn's own (the second Grok account). */
  slot?: LoginSlot;
  /** Overrides the bot's tool selection (a room turn's own). */
  toolSelection?: boolean;
  guestConfined?: boolean;
}

export type ConnectorPlanForTurn<Bot extends PlanBot = PlanBot, Instance extends PlanInstance = PlanInstance> = (
  bot: Bot,
  instance: Instance,
  speaker: TurnSpeaker,
  threadId?: string,
  via?: AccessVia,
  options?: ConnectorPlanOptions,
) => ConnectorTurnPlan & { at(via: AccessVia | undefined): ConnectorTurnPlan };

/** connectorPlanForTurn(bot, instance, speaker, threadId, via): the plan of
 * one turn. A turn computes it once in setup; `at(via)` gives the same plan
 * for the access its dispatch materialized (itself when that is the access
 * the plan already read). */
export function createConnectorPlanForTurn<Bot extends PlanBot, Instance extends PlanInstance>(deps: ConnectorPlanDeps<Bot, Instance>): ConnectorPlanForTurn<Bot, Instance> {
  const planFor: ConnectorPlanForTurn<Bot, Instance> = (bot, instance, speaker, threadId, via, options = {}) => {
    const input = deps.accountConnectorInput(bot, instance, speaker, via, options.slot);
    const plan = connectorPlanFrom(input, {
      relayPart: threadId ? deps.isRelayPart?.(threadId) === true : false,
      toolSelection: options.toolSelection ?? bot.toolScope !== undefined,
      guestConfined: options.guestConfined === true,
      withholdsHostTools: deps.withholdHostToolsFor(instance),
      ...(deps.accounts ? { accounts: deps.accounts } : {}),
    });
    const turnPlan: ReturnType<typeof planFor> = Object.assign(plan, {
      at: (next: AccessVia | undefined) => next === undefined || next === plan.input.via ? turnPlan : planFor(bot, instance, speaker, threadId, next, options),
    });
    return turnPlan;
  };
  return planFor;
}

/** The plan for the access a dispatch materialized: the setup plan itself
 * when nothing changed. */
export function connectorPlanAt(plan: ConnectorTurnPlan & { at?(via: AccessVia | undefined): ConnectorTurnPlan }, via: AccessVia | undefined): ConnectorTurnPlan {
  return plan.at ? plan.at(via) : plan;
}
