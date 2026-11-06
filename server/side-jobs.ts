// Small writing jobs: the one-off, tool-free text calls the harness makes
// around a bot's turns. Three jobs ask here for whoever writes theirs:
//   - the compaction summary (server/context/compaction-summary.ts), while a turn
//     waits for it;
//   - memory upkeep's capture, organize and contradiction steps
//     (server/memory/memory-upkeep.ts), in the background;
//   - the automatic skill review (when Sagax has that job), in the background.
//     Sagax has no createSkillReview wire yet; the job name stays for the
//     resolver and tests so a later port can hook it without reshaping this.
//
// The bot's own engine writes whenever it can, as it did before this module
// existed: Claude and the chat-completion engines through `generateText`,
// Codex and the ACP engines through `generateMemoryText` for the two
// background jobs (never for the summary: that call starts a whole agent
// process, and a turn is waiting). Those calls are made, bounded and booked
// exactly as before.
//
// An engine that cannot write a job (Pi and Muse Code have no one-off call;
// Codex and the ACP engines have none for the summary) used to mean the
// job's mechanical fallback: an excerpt summary, no capture, no review. The
// optional helper model fills that gap: one connected provider instance,
// named in config.json or the environment (helperSelection below), whose
// `generateText` writes for those bots. It is unset by default, because it
// sends their conversation text to a second provider (docs/memory.md). The
// order never reverses: the helper is not asked while the bot's own engine
// can write.
//
// The helper is skipped, and the job falls back as it does with no helper,
// when the bot's own engine is missing or disallowed, when the bot is
// switched to never use it (WireBot.helperModel: only an absent switch or a
// strict true allows the helper), or when the helper instance is not
// connected, switched off, disallowed by the organisation, not assigned on a
// hosted workspace, or has no `generateText` of its own. Looking the helper
// up never throws at a job: whatever goes wrong on the way reads as no
// helper. A helper call that fails, hangs or meets the spend limit is an
// ordinary failed call to the job, which already bounds it and falls back.
//
// The bot's switch covers that bot's own three jobs and nothing else. What a
// bot says in a room or to a teammate is part of those bots' conversations,
// read by their engines and by whatever writes their jobs, the helper
// included (docs/memory.md).
//
// A helper call is its own usage row: the bot it wrote for, the helper's
// instance and model, and the trigger `helper` (server/usage/usage-ledger.ts), so
// what the helper costs is read apart from the bot's own turns.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { helperModelAllowed } from "../shared/wire.ts";
import type { ProviderAdapter, ProviderInstance, TextGenerationOptions } from "./contracts.ts";
import type { UsageRow, UsageTrigger } from "./usage/usage-ledger.ts";

/** The `helper` section of config.json: which connected provider instance,
 * and optionally which of its models, is the helper model. Unset by default.
 * server/config.ts adds it to the stored config only, so the file and the
 * environment can name a helper and a settings request cannot. The file is
 * written by hand: a mistyped entry reads as no helper rather than costing
 * the whole config. */
export const helperStoredShape = {
  helper: z.object({
    instanceId: z.string().trim().max(200).optional(),
    model: z.string().trim().max(500).optional(),
  }).optional().catch(undefined),
};
export interface HelperConfig {
  helper?: { instanceId?: string; model?: string };
}

/** A model id as a CLI's argument list can carry it: it starts with a letter
 * or a digit, never a dash, and holds no space or control character. */
const HELPER_MODEL_ID = /^[A-Za-z0-9][\x21-\x7e]*$/;

/** The helper model, or null while none is set (the default).
 * SAGAX_HELPER_INSTANCE and SAGAX_HELPER_MODEL win over the file, and an empty
 * SAGAX_HELPER_INSTANCE switches a saved helper off. An instance is required;
 * a model is optional and the instance's own choice for quick calls is used
 * without one. A model that could not be a model id switches the helper off
 * altogether: the person named a model, and quietly writing with another is
 * not theirs to find out from a bill. */
export function helperSelection(cfg: HelperConfig, env: Record<string, string | undefined> = process.env): { instanceId: string; model?: string } | null {
  const instanceId = (env.SAGAX_HELPER_INSTANCE ?? cfg.helper?.instanceId)?.trim();
  if (!instanceId) return null;
  const model = (env.SAGAX_HELPER_MODEL ?? cfg.helper?.model)?.trim();
  if (!model) return { instanceId };
  return HELPER_MODEL_ID.test(model) ? { instanceId, model } : null;
}

export type SideJob = "compaction" | "memory" | "skill-review";

/** What a job needs to know of a provider instance. */
export type SideJobInstance = Pick<ProviderInstance, "instanceId" | "driverKind" | "enabled" | "generateText" | "generateMemoryText"> & {
  adapter: { capabilities: Pick<ProviderAdapter["capabilities"], "agentsMcp"> };
};

export interface SideJobBot {
  id: string;
  name: string;
  /** The bot's main conversation, where a spend alert a call raises is shown. */
  threadId: string;
  modelSelection: { instanceId: string };
  /** The bot's own switch (WireBot.helperModel): only absent or true lets
   * the helper model write for it. */
  helperModel?: boolean;
}

export interface SideJobText {
  /** Who writes: the bot's own engine, or the helper instance. */
  via: "engine" | "helper";
  generateText: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;
}

export interface SideJobsDeps {
  bot: (botId: string) => SideJobBot | null | undefined;
  /** A connected provider instance, or null. */
  instance: (instanceId: string) => SideJobInstance | null | undefined;
  /** Why the organisation refuses this instance for bots, or undefined. */
  refusal: (instance: SideJobInstance) => string | undefined;
  /** The helper setting, or null while none is set. */
  helper: () => { instanceId: string; model?: string } | null;
  /** A hosted workspace only: whether this instance may run this model.
   * Absent everywhere else, where any model the instance has may be named. */
  modelAllowed?: (selection: { instanceId: string; model: string }) => boolean;
  /** Throws once the workspace is at its monthly spend limit. */
  assertWithinBudget: () => void;
  /** Write one call to the usage ledger (bookTurnUsage in server/index.ts). */
  book: (row: Omit<UsageRow, "at" | "costSource">, tokensReported: boolean, notificationThreadId: string) => void;
  log?: (line: string) => void;
}

export interface SideJobs {
  /** Whoever writes this job for this bot now, or null when nobody can and
   * the job keeps its fallback. `at.instance` is the engine a conversation
   * is running on, when that is not the bot's default (the summary). Asked
   * again before every call: the answer follows the setting and the engines. */
  text(job: SideJob, botId: string, at?: { instance?: SideJobInstance }): SideJobText | null;
}

type TextCall = (prompt: string, options?: TextGenerationOptions) => Promise<string>;

/** The bot's own one-off call for a job, when its engine has one. */
function ownCall(job: SideJob, instance: SideJobInstance): TextCall | undefined {
  // generateMemoryText is the ACP engines' and Codex's one-shot for
  // background work only, on their own provider (server/contracts.ts): never
  // the summary a turn is waiting on.
  const call = job === "compaction" ? instance.generateText : instance.generateText ?? instance.generateMemoryText;
  return call?.bind(instance);
}

export function createSideJobs(deps: SideJobsDeps): SideJobs {
  // What was last said about the helper, so the log says where the text
  // goes, or why it does not, once per change and not once per call.
  let said: string | null = null;
  const say = (line: string | null) => {
    if (line && line !== said) deps.log?.(`helper model: ${line}`);
    said = line;
  };

  /** One call, checked against the spend limit first and booked when the
   * engine reports its usage. Every call checks: one upkeep pass makes
   * several in a row. Each gets a thread id of its own, so two calls in one
   * millisecond are still two rows. */
  const booked = (job: SideJob, bot: SideJobBot, instance: SideJobInstance, call: TextCall, trigger: UsageTrigger, model?: string): SideJobText["generateText"] =>
    async (prompt, options) => {
      deps.assertWithinBudget();
      const threadId = `${job}-${randomUUID()}`;
      return call(prompt, {
        ...options,
        ...(model ? { model } : {}),
        onUsage: (usage) => deps.book({
          botId: bot.id,
          botName: bot.name,
          threadId,
          instanceId: instance.instanceId,
          driverKind: instance.driverKind,
          model: usage.model,
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          ...(usage.cachedInput !== undefined ? { cachedInput: usage.cachedInput } : {}),
          costUsd: usage.costUsd ?? null,
          trigger,
        }, usage.input !== undefined && usage.output !== undefined, bot.threadId),
      });
    };

  /** The helper instance when it may write now, and with which model. A
   * helper never fails a job or the turn that waits for one, and that holds
   * for looking it up too: the setting, the registry and the policy are read
   * here, and whatever one of them throws reads as no helper. */
  function usableHelper(): { instance: SideJobInstance; call: TextCall; model?: string } | null {
    try {
      return findHelper();
    } catch (error) {
      // a JSON error can quote the text it failed on, so it is named, not printed
      const why = error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "unknown";
      say(`the helper could not be looked up (${why}), so bots whose engine has no one-off text call keep their fallback`);
      return null;
    }
  }

  function findHelper(): { instance: SideJobInstance; call: TextCall; model?: string } | null {
    const helper = deps.helper();
    if (!helper) {
      say(null);
      return null;
    }
    const name = JSON.stringify(helper.instanceId);
    const unused = (why: string) => {
      say(`${why}, so bots whose engine has no one-off text call keep their fallback`);
      return null;
    };
    const instance = deps.instance(helper.instanceId);
    if (!instance) return unused(`the helper instance ${name} is not connected`);
    if (!instance.enabled) return unused(`the helper instance ${name} is switched off`);
    // Only `generateText`: Codex's or an ACP engine's background call starts
    // a whole agent process per call and serves that engine's own bots only.
    if (!instance.generateText) return unused(`the helper instance ${name} cannot make a one-off text call`);
    // The helper is an engine like any other: one the organisation disallows
    // never receives a bot's text, and a hosted workspace's models stay the
    // ones it was assigned.
    const refusal = deps.refusal(instance);
    if (refusal) return unused(`the helper instance ${name} is not used (${refusal})`);
    if (helper.model && deps.modelAllowed && !deps.modelAllowed({ instanceId: helper.instanceId, model: helper.model })) {
      return unused(`the helper model ${JSON.stringify(helper.model)} is not assigned to this workspace`);
    }
    say(`small writing jobs for bots whose engine has no one-off text call are written by ${name}${helper.model ? ` (${helper.model})` : ""}`);
    return { instance, call: instance.generateText.bind(instance), ...(helper.model ? { model: helper.model } : {}) };
  }

  return {
    text(job, botId, at = {}) {
      const bot = deps.bot(botId);
      const own = at.instance ?? (bot ? deps.instance(bot.modelSelection.instanceId) : null);
      // A bot without an engine, or on one the organisation disallows, gets no
      // model step at all. That holds for the helper too: it stands in for an
      // engine that cannot write, never for one that may not be used.
      if (!bot || !own || deps.refusal(own)) return null;
      // The review's changes are written with the bot's own skill tools,
      // whoever read the conversation: an engine that cannot mount them is
      // not reviewed (server/index.ts, the skill review's gates).
      if (job === "skill-review" && own.adapter.capabilities.agentsMcp !== true) return null;
      const call = ownCall(job, own);
      if (call) {
        // The summary is part of a turn that already passed the spend limit,
        // and is not booked on its own (docs/verification/context-compaction.md).
        if (job === "compaction") return { via: "engine", generateText: call };
        return { via: "engine", generateText: booked(job, bot, own, call, { kind: "bot", botId: bot.id }) };
      }
      // The bot's own switch, read closed: unless it is absent or a strict
      // true, the helper never writes this bot's jobs, and the answer is the
      // one a server with no helper gives.
      if (!helperModelAllowed(bot)) return null;
      const helper = usableHelper();
      if (!helper) return null;
      return { via: "helper", generateText: booked(job, bot, helper.instance, helper.call, { kind: "helper", botId: bot.id, job }, helper.model) };
    },
  };
}
