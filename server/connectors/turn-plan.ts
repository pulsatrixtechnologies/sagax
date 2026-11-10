// One connector plan per turn (lot L2 of docs/design/connectors-across-engines.md).
//
// "Which connectors does this turn have, and whose" used to be computed
// again by every reader (the dispatch of a direct turn and of a room turn,
// the connectors section of the prompt, the reach line, the Connectors
// record, the capabilities page, the setup card, the command listing, the
// old relay), each from slightly different inputs. Each fix changed the rule
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
  // #3356 (L13): a run_with_engine part is a turn like any other; the
  // exception of #3174 is retired, since every bot reaches the person's
  // connectors through the connector hub (call_connector) from its own
  // engine. Someone else's sign-in never loads them.
  // Only the Grok CLI (grokAgent) loads them: the xAI API engine ("grok",
  // drivers/grok.ts chat-completions) has no use_tool and no grok.com MCP.
  return input.grokAccountConnectors === true && input.driver === GROK_CLI_DRIVER && accountConnectorsForTurn(input) === "own";
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
  /** The person's own sign-ins with their connectors, from the registry,
   * read on first use (a read may start a background refresh, so a turn
   * that never asks starts none). Empty for nobody. */
  accounts(): readonly ConnectorAccount[];
}

/** The turn facts the plan needs beside the account input. */
export interface ConnectorPlanTurn {
  toolSelection?: boolean;
  guestConfined?: boolean;
  /** The engine withholds host tools (an organization turn needs it for
   * the Grok gateway). */
  withholdsHostTools?: boolean;
  accounts?: (principal: string) => readonly ConnectorAccount[];
}

/** The plan from its facts. Pure: the one place the rules are read. */
export function connectorPlanFrom(input: ClaudeAiTurnInput, turn: ConnectorPlanTurn = {}): ConnectorTurnPlan {
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
    toolSelection,
    guestConfined,
    claudeAi,
    claudeAiMounted: claudeAi && !guestConfined && !toolSelection,
    grokCloud,
    grokCloudOnTurn: grokCloud && !toolSelection && (input.identity !== "perspicax" || turn.withholdsHostTools === true),
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
 * one turn. The thread does not change the plan (#3356: a run_with_engine
 * part is planned like any turn); it stays in the signature for callers. A turn computes it once in setup; `at(via)` gives the same plan
 * for the access its dispatch materialized (itself when that is the access
 * the plan already read). */
export function createConnectorPlanForTurn<Bot extends PlanBot, Instance extends PlanInstance>(deps: ConnectorPlanDeps<Bot, Instance>): ConnectorPlanForTurn<Bot, Instance> {
  const planFor: ConnectorPlanForTurn<Bot, Instance> = (bot, instance, speaker, _threadId, via, options = {}) => {
    const input = deps.accountConnectorInput(bot, instance, speaker, via, options.slot);
    const plan = connectorPlanFrom(input, {
      toolSelection: options.toolSelection ?? bot.toolScope !== undefined,
      guestConfined: options.guestConfined === true,
      withholdsHostTools: deps.withholdHostToolsFor(instance),
      ...(deps.accounts ? { accounts: deps.accounts } : {}),
    });
    const turnPlan: ReturnType<typeof planFor> = Object.assign(plan, {
      at: (next: AccessVia | undefined) => next === undefined || next === plan.input.via ? turnPlan : planFor(bot, instance, speaker, undefined, next, options),
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

/** #3349 (L6): per thread, whether the turn last dispatched there mounted
 * the speaker's own claude.ai connectors (plan.claudeAi). The bus reads it to
 * give a native `claude_ai_` ask the connector facts a hub call carries.
 * #3351 (L8): and whether it loaded the Grok gateway (plan.grokCloudOnTurn),
 * which the Grok catalog section reads, so it says what the one list says.
 * Bounded: the oldest threads are forgotten first. */
const DISPATCHED_MAX = 5_000;
const dispatchedByThread = new Map<string, { claudeAi: boolean; grokCloudOnTurn: boolean }>();

/** The plan a dispatch materialized (connectorPlanAt), remembered for its
 * thread. */
export function dispatchedConnectorPlan(threadId: string, plan: ConnectorTurnPlan & { at?(via: AccessVia | undefined): ConnectorTurnPlan }, via: AccessVia | undefined): ConnectorTurnPlan {
  const at = connectorPlanAt(plan, via);
  dispatchedByThread.delete(threadId);
  dispatchedByThread.set(threadId, { claudeAi: at.claudeAi === true, grokCloudOnTurn: at.grokCloudOnTurn === true });
  while (dispatchedByThread.size > DISPATCHED_MAX) {
    const oldest = dispatchedByThread.keys().next().value;
    if (oldest === undefined) break;
    dispatchedByThread.delete(oldest);
  }
  return at;
}

/** The turn on this thread mounted the speaker's own claude.ai connectors. */
export function claudeAiConnectorsOwn(threadId: string): boolean {
  return dispatchedByThread.get(threadId)?.claudeAi === true;
}

/** Whether the turn dispatched on this thread loads the Grok gateway;
 * undefined when no turn was dispatched there by this process. */
export function grokGatewayOnTurn(threadId: string): boolean | undefined {
  return dispatchedByThread.get(threadId)?.grokCloudOnTurn;
}
