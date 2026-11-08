// Turn budget wiring (#2764): the ceiling of #2737 bound to the server's own
// parts, out of server/index.ts so it is tested. It covers every direct
// conversation of a bot: the person's chat, a conversation an AI client
// opened through send_prompt (a hidden task of the bot) and a conversation
// another bot opened. Rooms keep their own ceiling.
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import {
  createTurnBudget,
  turnBudgetSettings,
  type TurnBudget,
  type TurnBudgetConfig,
  type TurnBudgetLanguage,
} from "./turn-budget.ts";

export interface TurnBudgetBot {
  id: string;
  name: string;
  color: string;
  modelSelection: { instanceId: string };
}

export interface TurnBudgetHost {
  config(): { turnBudget?: TurnBudgetConfig };
  env?: NodeJS.ProcessEnv;
  /** The bot whose conversation (chat or task thread) this is. */
  botByThread(threadId: string): TurnBudgetBot | null | undefined;
  threadBusy(botId: string, threadId: string): boolean;
  steerer(instanceId: string): ((threadId: string, note: string) => Promise<SteerOutcome>) | undefined;
  stopDirectThread(botId: string, threadId: string): Promise<unknown>;
  appendMessage(threadId: string, message: { role: "bot"; kind: "text"; text: string; from?: { botId: string; name: string; color: string } }): void;
  language(threadId: string, bot: TurnBudgetBot | null): TurnBudgetLanguage;
  subscribe(listener: (event: RuntimeEvent) => void): unknown;
  ignore?(event: RuntimeEvent): boolean;
  log?(line: string): void;
  now?(): number;
  setTimer?(fire: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

export function wireTurnBudget(host: TurnBudgetHost): TurnBudget {
  const busy = (threadId: string) => {
    const bot = host.botByThread(threadId);
    return Boolean(bot && host.threadBusy(bot.id, threadId));
  };
  const budget = createTurnBudget({
    settings: (threadId) => turnBudgetSettings(host.config(), host.env ?? process.env, host.botByThread(threadId)?.id),
    live: busy,
    canSteer: busy,
    steer: async (threadId, note) => {
      const bot = host.botByThread(threadId);
      const steer = bot ? host.steerer(bot.modelSelection.instanceId) : undefined;
      if (!steer) return "refused";
      return steer(threadId, note).catch((): "refused" => "refused");
    },
    interrupt: async (threadId) => {
      const bot = host.botByThread(threadId);
      if (bot) await host.stopDirectThread(bot.id, threadId);
    },
    post: (threadId, text) => {
      const bot = host.botByThread(threadId);
      host.appendMessage(threadId, {
        role: "bot", kind: "text", text,
        ...(bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
      });
    },
    language: (threadId) => host.language(threadId, host.botByThread(threadId) ?? null),
    ...(host.log ? { log: host.log } : {}),
    ...(host.now ? { now: host.now } : {}),
    ...(host.setTimer ? { setTimer: host.setTimer } : {}),
    ...(host.clearTimer ? { clearTimer: host.clearTimer } : {}),
  });
  host.subscribe((event) => {
    if (!host.ignore?.(event)) budget.onEvent(event);
  });
  return budget;
}
