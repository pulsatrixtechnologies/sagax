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
} from "./turn-budget.ts";
import { lastPersonText, turnLanguage } from "../turns/turn-language.ts";
import { browserGuardSettings, createBrowserFailureGuard } from "./browser-failure-guard.ts";

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
  /** The conversation as it reads now (the person's last message sets the language, #2762). */
  messages(threadId: string): readonly { role?: string; kind?: string; text?: string }[];
  /** The person's own language setting, used when their last message is too short to tell. */
  preferredLanguage(threadId: string, bot: TurnBudgetBot | null): string | null | undefined;
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
  const language = (threadId: string) => turnLanguage(lastPersonText(host.messages(threadId)), host.preferredLanguage(threadId, host.botByThread(threadId) ?? null));
  const steer = async (threadId: string, note: string): Promise<SteerOutcome> => {
    const bot = host.botByThread(threadId);
    const send = bot ? host.steerer(bot.modelSelection.instanceId) : undefined;
    if (!send) return "refused";
    return send(threadId, note).catch((): "refused" => "refused");
  };
  const interrupt = async (threadId: string) => {
    const bot = host.botByThread(threadId);
    if (bot) await host.stopDirectThread(bot.id, threadId);
  };
  const post = (threadId: string, text: string) => {
    const bot = host.botByThread(threadId);
    host.appendMessage(threadId, {
      role: "bot", kind: "text", text,
      ...(bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {}),
    });
  };
  const budget = createTurnBudget({
    settings: (threadId) => turnBudgetSettings(host.config(), host.env ?? process.env, host.botByThread(threadId)?.id),
    live: busy,
    canSteer: busy,
    steer,
    interrupt,
    post,
    language,
    ...(host.log ? { log: host.log } : {}),
    ...(host.now ? { now: host.now } : {}),
    ...(host.setTimer ? { setTimer: host.setTimer } : {}),
    ...(host.clearTimer ? { clearTimer: host.clearTimer } : {}),
  });
  // QA 0.8.67 G4: the same direct conversations get the browser failure
  // guard, which ends a loop of failed web page calls well before the ceiling.
  const browser = createBrowserFailureGuard({
    settings: () => browserGuardSettings(host.env ?? process.env),
    live: busy,
    canSteer: busy,
    steer,
    interrupt,
    post,
    language,
    ...(host.log ? { log: host.log } : {}),
  });
  host.subscribe((event) => {
    if (host.ignore?.(event)) return;
    budget.onEvent(event);
    browser.onEvent(event);
  });
  return {
    ...budget,
    settle: (threadId) => {
      budget.settle(threadId);
      browser.settle(threadId);
    },
  };
}
