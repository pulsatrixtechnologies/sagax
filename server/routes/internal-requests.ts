import type { EffortLevel } from "../../shared/model-selection.ts";
// Internal harness routes for routine / profile / model / rule proposals,
// team-setup and bot-deletion requests (#1388 I3). Behind the agents
// capability checked in server/index.ts before dispatchInternalRoutes.
import { z } from "zod";
import { resolveRoutineById } from "../../shared/routine-by-id.ts";
import { pageRoutines } from "../../shared/routine-listing.ts";
import { routineAutoPauseAfter } from "../../shared/routine-auto-pause.ts";
import { RuleRequestError } from "../rules/rule-requests.ts";
import { redactSecretsInText } from "../redact.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

const ROUTINE_WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const routineRequestSourceSchema = {
  fromBotId: z.string().min(1).max(128),
  fromThreadId: z.string().min(1).max(128),
  // 2026-10-20: the person's words, when they asked their Primary Bot now
  quote: z.string().max(600).optional(),
};

const routineRequestEnvelopeSchema = z.discriminatedUnion("action", [
  z.object({ ...routineRequestSourceSchema, action: z.literal("create"), routine: z.unknown(), forBotId: z.unknown().optional() }).strict(),
  z.object({
    ...routineRequestSourceSchema,
    action: z.literal("update"),
    routineId: z.unknown(),
    changes: z.unknown(),
    forBotId: z.unknown().optional(),
  }).strict(),
  ...(["pause", "resume", "run_now", "delete", "rotate_webhook_key"] as const).map((action) =>
    z.object({ ...routineRequestSourceSchema, action: z.literal(action), routineId: z.unknown(), forBotId: z.unknown().optional() }).strict()
  ),
]);

export interface InternalRequestsBot {
  id: string;
  name: string;
  color?: string;
  title?: string;
  section?: string;
  chiefOfStaff?: boolean;
  hidden?: boolean;
  /** Present on temporary agents; shape varies by store. */
  temporary?: unknown;
  modelSelection?: { instanceId?: string; model?: string } | null;
  ownerUserId?: unknown;
  [key: string]: unknown;
}

export interface InternalRequestsRoutine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  folder?: string;
  /** 2026-11-04: the routine's model (shared/routine-model.ts). */
  model?: string;
  /** #2038: the model its runs' sub-agents use (Claude). */
  subagentModel?: string;
  /** 2026-11-05: the routine's "Au nom de" role (shared/routine-act-as.ts). */
  actAs?: string;
  effort?: EffortLevel;
  enabled: boolean;
  runOn: string;
  durationMinutes: number;
  timeoutMinutes?: number;
  nextRunAt: number | null;
  continuity?: boolean;
  overlap?: string;
  skippedRuns?: number;
  lastSkippedAt?: number;
  failureStreak?: number;
  autoPaused?: { at: number; failures: number };
  schedule: {
    type: string;
    at?: number | null;
    everyMinutes?: number;
    anchorAt?: number;
    weekdays?: number[];
    window?: unknown;
    endsAt?: number;
    expression?: string;
    time?: string;
    engine?: string;
    repeat?: unknown;
  } & Record<string, unknown>;
  autoPauseAfter?: number | null;
}

export interface InternalRequestsRun {
  id: string;
  botId: string;
  routineId: string;
  status: string;
  triggerSource?: string;
  manual?: boolean;
  scheduledFor?: number;
  startedAt?: number;
  finishedAt?: number;
  attention?: string | null;
  output?: string | null;
  error?: string | null;
  threadId?: string | null;
}

export interface InternalRequestsWebhook {
  id: string;
  botId: string;
  routineId?: string;
  name?: string;
  enabled?: boolean;
  source?: { type: string };
}

export interface InternalRequestsThreadOwner {
  group?: { id: string; name: string } | undefined;
}

export interface InternalRequestsProposed {
  requestId: string;
  messageId?: string;
  state: string;
  summary?: string;
  detail?: string;
  appliedBy?: string;
}

export interface InternalRequestsInstance {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: { state: string };
  models: unknown;
  capabilities?: { effortLevels?: unknown };
}

type Persistence =
  | { ok: true }
  | { ok: false; status: number; error: string };

type SafetyEffect =
  | { kind: "allow" }
  | { kind: "stop"; message: string }
  | { kind: "hold"; fingerprint: string; classKey?: string }
  | null;

type AskedProof =
  | { botName: string; messageId: string; person: string; quote: string }
  | string;

export interface InternalRequestsDeps {
  bot(id: string): InternalRequestsBot | undefined;
  bots(): readonly InternalRequestsBot[];
  ownsThread(botId: string, threadId: string): InternalRequestsThreadOwner | null;
  messagesFor(threadId: string): readonly { id: string; card?: { tool?: string; subtitle?: string } | undefined }[];
  listRoutines(): readonly InternalRequestsRoutine[];
  listRuns(): readonly InternalRequestsRun[];
  listWebhooks(): readonly InternalRequestsWebhook[];
  timeZone(): string;
  canReachPeer(from: InternalRequestsBot, target: InternalRequestsBot): boolean;
  primaryBotSameOwner(from: InternalRequestsBot, target: InternalRequestsBot): boolean;
  peerAccessHelp: string;
  proposalPersistence(botId: string, threadId: string, opensCard: boolean): Persistence;
  safetyPrincipal(threadId: string): { principalId?: string; triage: boolean };
  safetyPermissionEffect(input: {
    text: string;
    surface: "routine" | string;
    tool: string;
    known: boolean;
    triage: boolean;
    principalId?: string;
    threadId: string;
    botId: string;
  }): SafetyEffect;
  primaryAskedProposal(input: {
    botId: string;
    threadId: string;
    generation: string;
    quote: unknown;
    targetBotId: string;
    key: string;
    value?: unknown;
    routineName?: string;
    valueNames?: string[];
  }): AskedProof;
  journalRefusedQuote(botId: string, targetBotId: string, kind: string, reason: string): void;
  withPrimaryAsked<T>(
    proof: AskedProof,
    scope: { botId: string; threadId: string; targetBotId: string; kind: string },
    submit: (primaryAsked: boolean) => T | Promise<T>,
  ): Promise<T>;
  settleProposalByRule(
    bot: InternalRequestsBot,
    threadId: string,
    proposed: { requestId: string; messageId: string },
    resolve: (args: { botId: string; threadId: string; requestId: string; behavior: "allow" }) => { claimed: boolean; state?: string; targetBotId?: string },
  ): { result: { claimed: boolean; state?: string; targetBotId?: string } } | undefined;
  safetyArm(requestId: string, row: { principalId?: string; threadId: string; fingerprint: string; classKey?: string }): void;
  appendDecision(row: Record<string, unknown>): void;
  submitRoutine(input: Record<string, unknown>): Promise<InternalRequestsProposed> | InternalRequestsProposed;
  resolveRoutine(args: { botId: string; threadId: string; requestId: string; behavior: "allow" }): { claimed: boolean; state?: string };
  submitProfile(input: Record<string, unknown>): Promise<InternalRequestsProposed> | InternalRequestsProposed;
  resolveProfile(args: { botId: string; threadId: string; requestId: string; behavior: "allow" }): { claimed: boolean; state: string; targetBotId: string };
  submitModel(input: Record<string, unknown>): Promise<InternalRequestsProposed> | InternalRequestsProposed;
  resolveModel(args: { botId: string; threadId: string; requestId: string; behavior: "allow" }): { claimed: boolean; state: string; targetBotId: string };
  engineDisplayName(instanceId: string): string | undefined;
  primaryTurnGate(
    botId: string,
    threadId: string,
    generation: string,
    purpose: "cards" | "settings",
  ): { error: string } | { message: { id: string; text: string }; person: string; botName: string };
  checkPersonQuote(input: { quote: unknown; message: string; intent: "setting" }): { ok: true } | { ok: false; reason: string };
  effectiveBotOwner(bot: InternalRequestsBot): string;
  customRuleWhen(ownerId: string, ruleId: string): string | undefined;
  askedChange(
    message: string,
    key: string,
    value: unknown,
    botName: string | undefined,
    speakingBot: boolean,
    ruleText: string | undefined,
    quote: string,
    speakingName: string | undefined,
  ): true | string;
  submitRule(input: Record<string, unknown>): InternalRequestsProposed;
  resolveRule(args: { botId: string; threadId: string; requestId: string; behavior: "allow"; personId: string }): { claimed: boolean; state: string };
  appendAdminAction(row: Record<string, unknown>): void;
  identityKind(): string;
  /** True while the turn's capability is still live. */
  isActive(capability: InternalCapabilityView): boolean;
  requireActive(capability: InternalCapabilityView): void;
  describeInstances(): Promise<readonly InternalRequestsInstance[]>;
  canAccessBot(from: InternalRequestsBot, target: InternalRequestsBot): boolean;
  peerAllowed(from: InternalRequestsBot, target: InternalRequestsBot): boolean;
  peerInScope(from: InternalRequestsBot, target: InternalRequestsBot): boolean;
  archivedAgent(bot: InternalRequestsBot): boolean;
  teamSetupTeams(): string[];
  canAccessTeam(bot: InternalRequestsBot, name: string): boolean;
  orgOfferedEngines<T extends { instanceId: string }>(instances: readonly T[], person?: string | null): readonly T[];
  consoleEngineAllowed(instanceId: string): boolean;
  orgOwnAccountsOutsideList(): boolean;
  personPaysEngine(principalId: string, instanceId: string): boolean;
  ownerBotsReadOnly(bot: InternalRequestsBot): boolean;
  botsReadOnlyBody: { error: string; message: string };
  submitTeamSetup(input: Record<string, unknown>): Promise<InternalRequestsProposed> | InternalRequestsProposed;
  submitBotDeletion(input: Record<string, unknown>): Promise<InternalRequestsProposed> | InternalRequestsProposed;
  fullAccessForSource(botId: string, threadId: string): boolean;
  broadcastBot(bot: InternalRequestsBot): void;
}

const routineTimestamp = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : null;

function agentRoutine(routine: InternalRequestsRoutine, latestRun?: InternalRequestsRun) {
  // Routines created in the calendar predate chat-card redaction and may
  // contain a credential in their instructions. The list result is handed
  // back to the model, so scrub the complete value before taking its preview.
  const safeInstructions = redactSecretsInText(routine.prompt);
  const safeName = redactSecretsInText(routine.name);
  return {
    id: routine.id,
    name: safeName,
    ...(routine.folder ? { folder: redactSecretsInText(routine.folder) } : {}),
    ...(routine.model ? { model: routine.model } : {}),
    ...(routine.subagentModel ? { subagentModel: routine.subagentModel } : {}),
    ...(routine.actAs !== undefined ? { actAs: routine.actAs } : {}),
    ...(routine.effort ? { effort: routine.effort } : {}),
    instructions: safeInstructions.slice(0, 2_000),
    instructionsTruncated: safeInstructions.length > 2_000,
    continuity: routine.continuity === true,
    overlap: routine.overlap ?? "skip",
    skippedRuns: routine.skippedRuns ?? 0,
    lastSkippedAt: routineTimestamp(routine.lastSkippedAt),
    failureStreak: routine.failureStreak ?? 0,
    autoPauseAfter: routineAutoPauseAfter(routine),
    ...(routine.autoPaused ? { autoPaused: { at: new Date(routine.autoPaused.at).toISOString(), failures: routine.autoPaused.failures } } : {}),
    enabled: routine.enabled,
    runOn: routine.runOn,
    durationMinutes: routine.durationMinutes,
    ...(routine.timeoutMinutes === undefined ? {} : { timeoutMinutes: routine.timeoutMinutes }),
    schedule: routine.schedule.type === "once"
      ? { type: "once" as const, at: new Date(routine.schedule.at as number).toISOString() }
      : routine.schedule.type === "interval"
        ? {
            type: "interval" as const,
            everyMinutes: routine.schedule.everyMinutes,
            anchorAt: new Date(routine.schedule.anchorAt as number).toISOString(),
            ...(routine.schedule.weekdays === undefined
              ? {}
              : { weekdays: routine.schedule.weekdays.map((day) => ROUTINE_WEEKDAY_NAMES[day]) }),
            ...(routine.schedule.window === undefined ? {} : { window: { ...(routine.schedule.window as object) } }),
            ...(routine.schedule.endsAt === undefined
              ? {}
              : { endsAt: new Date(routine.schedule.endsAt).toISOString() }),
          }
        : routine.schedule.type === "cron"
          ? { ...routine.schedule }
          : routine.schedule.type === "webhook"
            ? { type: "webhook" as const }
            : routine.schedule.type === "event"
              ? { type: "event" as const, source: "email" as const }
              : routine.schedule.type === "limit_reset"
                ? {
                    type: "limit_reset" as const,
                    engine: routine.schedule.engine,
                    repeat: routine.schedule.repeat,
                    at: routine.schedule.at === null || routine.schedule.at === undefined
                      ? null
                      : new Date(routine.schedule.at).toISOString(),
                  }
                : {
                    type: "weekly" as const,
                    time: routine.schedule.time,
                    weekdays: (routine.schedule.weekdays ?? []).map((day: number) => ROUTINE_WEEKDAY_NAMES[day]),
                  },
    nextRunAt: routine.nextRunAt === null ? null : new Date(routine.nextRunAt).toISOString(),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          triggerSource: latestRun.triggerSource ?? (latestRun.manual ? "manual" : "schedule"),
          scheduledFor: routineTimestamp(latestRun.scheduledFor),
          startedAt: routineTimestamp(latestRun.startedAt),
          finishedAt: routineTimestamp(latestRun.finishedAt),
          attention: latestRun.attention ? redactSecretsInText(latestRun.attention).slice(0, 500) : null,
          output: latestRun.output ? redactSecretsInText(latestRun.output).slice(0, 1_000) : null,
          error: latestRun.error ? redactSecretsInText(latestRun.error).slice(0, 500) : null,
          executionThreadId: latestRun.threadId ?? null,
        }
      : null,
  };
}

/** Factory for the I3 request routes. Literal paths in original file order. */
export function createInternalRequestsRoutes(deps: InternalRequestsDeps): InternalRouteHandler {
  return async (ctx) => {
    const { res, path, method, json, capability, readBody, url } = ctx;
    const search = url?.searchParams;

    if (method === "GET" && path === "/api/internal/routines") {
      const from = deps.bot(capability.botId);
      if (!from) return json(res, 401, { error: "unauthorized" });
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const latestRuns = new Map<string, InternalRequestsRun>();
      // listRuns is newest-first. Keep the first receipt per definition so
      // the agent can answer "did it run?" from scheduler truth rather
      // than guessing from conversation history.
      for (const run of deps.listRuns()) {
        if (run.botId === from.id && !latestRuns.has(run.routineId)) latestRuns.set(run.routineId, run);
      }
      // 2026-10-29 (a bot read back 3 of its 23 routines): a page of short
      // rows (shared/routine-listing.ts), or one routine in full by its id
      const own = deps.listRoutines().filter((routine) => routine.botId === from.id);
      const routineId = search?.get("routineId") ?? null;
      if (routineId) {
        // 2026-11-01 (#1891): Automations / Webhooks list ids are not always
        // routine.id on this bot. An owned webhook's id differs from its
        // routine id; Mine also lists sibling bots of the same person.
        const reachableBotIds = deps.bots()
          .filter((bot) => bot.id !== from.id && !bot.hidden
            && (deps.canReachPeer(from, bot) || (from.chiefOfStaff && deps.primaryBotSameOwner(from, bot))))
          .map((bot) => bot.id);
        const resolved = resolveRoutineById({
          routineId,
          botId: from.id,
          routines: deps.listRoutines(),
          webhooks: deps.listWebhooks().map((hook) => ({
            id: hook.id,
            botId: hook.botId,
            ...(hook.routineId ? { routineId: hook.routineId } : {}),
            name: hook.name,
            enabled: hook.enabled,
            ...(hook.source ? { source: { type: hook.source.type } } : {}),
          })),
          reachableBotIds,
        });
        if (resolved.kind === "missing") {
          return json(res, 404, { error: "This bot has no routine with that id. Call list_routines for the ids." });
        }
        const one = deps.listRoutines().find((routine) => routine.id === resolved.routine.id);
        if (!one) return json(res, 404, { error: "This bot has no routine with that id. Call list_routines for the ids." });
        // Latest run for that routine's bot (own or a reachable sibling).
        if (one.botId !== from.id) {
          for (const run of deps.listRuns()) {
            if (run.botId === one.botId && !latestRuns.has(run.routineId)) latestRuns.set(run.routineId, run);
          }
        }
        const ownedHook = deps.listWebhooks().find((hook) => hook.routineId === one.id);
        return json(res, 200, {
          now: new Date().toISOString(),
          timeZone: deps.timeZone(),
          routine: {
            ...agentRoutine(one, latestRuns.get(one.id)),
            ...(ownedHook ? { webhookId: ownedHook.id } : {}),
            ...(one.botId !== from.id ? { botId: one.botId } : {}),
          },
        });
      }
      const hookIdByRoutine = new Map(
        deps.listWebhooks().flatMap((hook) => hook.routineId ? [[hook.routineId, hook.id] as const] : []),
      );
      const page = pageRoutines(own.map((routine) => {
        const row = agentRoutine(routine, latestRuns.get(routine.id));
        const webhookId = hookIdByRoutine.get(routine.id);
        return webhookId ? { ...row, webhookId } : row;
      }), {
        offset: search?.get("offset") ?? undefined,
        limit: search?.get("limit") ?? undefined,
        folder: search?.get("folder") ?? undefined,
      });
      return json(res, 200, { now: new Date().toISOString(), timeZone: deps.timeZone(), ...page });
    }

    if (method === "POST" && path === "/api/internal/routine-requests") {
      const parsed = routineRequestEnvelopeSchema.safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "invalid routine proposal" });
      const body = parsed.data;
      const from = deps.bot(capability.botId);
      if (!from) return json(res, 401, { error: "unauthorized" });
      const fromThreadId = capability.threadId;
      const owner = deps.ownsThread(from.id, fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      // "Make a routine for @B" / "pause @B's routine": resolve the target
      // up front so the model gets a teaching error now, not a mis-bound
      // routine later. Omitted (or the sender's own id) keeps the
      // own-routine path unchanged.
      let forBot: { botId: string; name: string } | undefined;
      if (body.forBotId !== undefined) {
        const parsedForBotId = z.string().max(128).safeParse(body.forBotId);
        const forBotId = parsedForBotId.success ? parsedForBotId.data.trim() : "";
        if (!forBotId) {
          return json(res, 400, { error: 'for_bot_id must be a bot id from list_bots, e.g. { "for_bot_id": "bot-abc123" }' });
        }
        if (forBotId !== from.id) {
          const target = deps.bot(forBotId);
          if (!target) {
            return json(res, 404, { error: "no bot with that id — call list_bots and copy the exact id from the result" });
          }
          // 2026-10-20: a Primary Bot reaches every bot of its person
          if (!deps.canReachPeer(from, target) && !(from.chiefOfStaff && deps.primaryBotSameOwner(from, target))) {
            return json(res, 403, { error: `that bot belongs to a different section or is unavailable. ${deps.peerAccessHelp}` });
          }
          forBot = { botId: target.id, name: target.name };
        }
      }
      // Sender and conversation only: the service checks the open-card
      // budget once it knows whether this change opens a card at all.
      const persistence = deps.proposalPersistence(from.id, fromThreadId, false);
      if (!persistence.ok) {
        return json(res, persistence.status, { error: persistence.error });
      }
      // limit_reset with no engine: wait for this bot's own engine (propose_routine omit).
      const createRoutine = body.action === "create" && body.routine && typeof body.routine === "object"
        ? (() => {
            const routine = { ...(body.routine as Record<string, unknown>) };
            const schedule = routine.schedule && typeof routine.schedule === "object"
              ? { ...(routine.schedule as Record<string, unknown>) }
              : null;
            if (schedule?.type === "limit_reset" && (schedule.engine == null || schedule.engine === "")) {
              const target = forBot ? deps.bot(forBot.botId) : from;
              const engine = target?.modelSelection?.instanceId;
              if (engine) schedule.engine = engine;
              routine.schedule = schedule;
            }
            return routine;
          })()
        : body.action === "create" ? body.routine : undefined;
      const proposedInput = body.action === "create"
        ? { action: body.action, routine: createRoutine, forBot }
        : body.action === "update"
          ? { action: body.action, routineId: body.routineId, changes: body.changes, forBot }
          : { action: body.action, routineId: body.routineId, forBot };
      // Whether the routine a change is for is the owner's, and whether this
      // turn acts for the owner (their own conversation, or a run of a
      // routine that is theirs), both before the change.
      const routineWho = deps.safetyPrincipal(fromThreadId);
      // full-access: safety-review
      const routineSafety = deps.safetyPermissionEffect({
        text: JSON.stringify(body),
        surface: "routine",
        tool: "propose_routine",
        known: true,
        triage: routineWho.triage,
        ...(routineWho.principalId ? { principalId: routineWho.principalId } : {}),
        threadId: fromThreadId,
        botId: from.id,
      });
      if (routineSafety?.kind === "stop") return json(res, 409, { error: routineSafety.message });
      // 2026-10-20: asked now by the person, it applies without a card
      const routineTarget = forBot?.botId ?? from.id;
      // an existing routine's own name (never one the bot chose for a new one)
      const routineName = proposedInput.action === "create" ? undefined
        : deps.listRoutines().find((routine) => routine.id === proposedInput.routineId)?.name;
      const askedProof = body.quote === undefined ? "no quote" : deps.primaryAskedProposal({
        botId: from.id,
        threadId: fromThreadId,
        generation: capability.generation,
        quote: body.quote,
        targetBotId: routineTarget,
        key: proposedInput.action === "delete" ? "routine.delete" : `routine.${proposedInput.action}`,
        ...(routineName ? { routineName } : {}),
      });
      // V4: a quote that did not prove the ask still becomes a card (200
      // non-isError), never a red 403. The journal keeps the refused quote.
      if (body.quote !== undefined && typeof askedProof === "string") {
        deps.journalRefusedQuote(from.id, routineTarget, `routine.${proposedInput.action}`, askedProof);
      }
      const proposed = await deps.withPrimaryAsked(
        routineSafety?.kind === "hold" ? "safety hold" : askedProof,
        { botId: from.id, threadId: fromThreadId, targetBotId: routineTarget, kind: `routine.${proposedInput.action}` },
        (primaryAsked) => deps.submitRoutine({
          primaryAsked,
          botId: from.id,
          threadId: fromThreadId,
          proposal: proposedInput,
          from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
          canCommit: () => deps.isActive(capability),
          // a hold, or a quote that did not prove the ask (V4: a card, never an apply)
          ...(routineSafety?.kind === "hold" || (body.quote !== undefined && typeof askedProof === "string") ? { explicitConfirm: true } : {}),
        }),
      );
      if (routineSafety?.kind === "hold") {
        deps.safetyArm(proposed.requestId, {
          ...(routineWho.principalId ? { principalId: routineWho.principalId } : {}),
          threadId: fromThreadId,
          fingerprint: routineSafety.fingerprint,
          ...(routineSafety.classKey ? { classKey: routineSafety.classKey } : {}),
        });
      }
      // 2026-10-19 ("Toujours permettre" on every card): never under a
      // safety hold; otherwise the person's kept rule settles the card
      const byRule = proposed.state !== "applied" && proposed.messageId && routineSafety?.kind !== "hold"
        ? deps.settleProposalByRule(from, fromThreadId, { requestId: proposed.requestId, messageId: proposed.messageId }, (args) => deps.resolveRoutine(args))
        : undefined;
      if (byRule) {
        return json(res, 201, {
          ...proposed,
          state: byRule.result.claimed && "state" in byRule.result && byRule.result.state === "applied" ? "applied" : proposed.state,
          result: byRule.result,
          appliedBy: "rule",
        });
      }
      const proposedCard = proposed.messageId
        ? deps.messagesFor(fromThreadId).find((message) => message.id === proposed.messageId)?.card
        : undefined;
      // Applied at once in a Full-access conversation. In the owner's own (one
      // only they provably wrote in) it is theirs, as if they had approved
      // the card. From anywhere else, a routine it created or changed is no
      // longer the owner's, like anyone else's edit (the routine PATCH).
      deps.appendDecision({
        threadId: fromThreadId,
        requestId: proposed.requestId,
        botId: from.id,
        botName: from.name,
        tool: proposedCard?.tool,
        // Audit what the human was actually shown, not the shorter tool
        // response returned to the model.
        summary: proposedCard?.subtitle ?? proposed.summary,
        decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
        source: proposed.state === "applied" ? proposed.appliedBy ?? "full-access" : "routine",
      });
      return json(res, 201, proposed);
    }

    if (method === "POST" && path === "/api/internal/profile-requests") {
      const parsed = z.object({
        fromBotId: z.string().min(1).max(128),
        fromThreadId: z.string().min(1).max(128),
        forBotId: z.string().max(128).optional(),
        changes: z.unknown(),
        reason: z.unknown(),
        quote: z.string().max(600).optional(),
      }).strict().safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "invalid profile proposal" });
      const body = parsed.data;
      const from = deps.bot(body.fromBotId);
      if (!from) return json(res, 403, { error: "unknown sender" });
      const owner = deps.ownsThread(from.id, body.fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      const targetBotId = body.forBotId?.trim() || from.id;
      // 2026-10-20: asked now by the person, it applies without a card
      const profileKeys: Record<string, string> = {
        name: "bot.name",
        title: "bot.title",
        description: "bot.description",
        soul: "bot.persona",
        cwd: "bot.cwd",
        notifications: "bot.notifications",
        speakReplies: "bot.speakReplies",
      };
      const changed = body.changes && typeof body.changes === "object" ? Object.entries(body.changes as Record<string, unknown>) : [];
      let askedProof: AskedProof = "no quote";
      if (body.quote !== undefined) {
        for (const [field, value] of changed.length ? changed : [["soul", undefined] as [string, unknown]]) {
          askedProof = deps.primaryAskedProposal({
            botId: from.id,
            threadId: body.fromThreadId,
            generation: capability.generation,
            quote: body.quote,
            targetBotId,
            key: profileKeys[field] ?? "bot.persona",
            value,
          });
          if (typeof askedProof === "string") break;
        }
      }
      // V4: failed quote -> card for the person (200 non-isError), not a red 403.
      if (body.quote !== undefined && typeof askedProof === "string") {
        deps.journalRefusedQuote(from.id, targetBotId, "bot.profile", askedProof);
      }
      const quoteRefused = body.quote !== undefined && typeof askedProof === "string";
      const proposed = await deps.withPrimaryAsked(askedProof, { botId: from.id, threadId: body.fromThreadId, targetBotId, kind: "bot.profile" }, (primaryAsked) => deps.submitProfile({
        primaryAsked,
        quoteRefused,
        botId: from.id,
        threadId: body.fromThreadId,
        targetBotId,
        changes: body.changes,
        reason: body.reason,
        from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
      }));
      const byRule = proposed.state !== "applied" && proposed.messageId
        ? deps.settleProposalByRule(from, body.fromThreadId, { requestId: proposed.requestId, messageId: proposed.messageId }, (args) => deps.resolveProfile(args))
        : undefined;
      if (byRule) {
        if (byRule.result.state === "applied" && byRule.result.targetBotId) {
          const target = deps.bot(byRule.result.targetBotId);
          if (target) deps.broadcastBot(target);
        }
        return json(res, 201, { ...proposed, state: byRule.result.state === "applied" ? "applied" : proposed.state, result: byRule.result, appliedBy: "rule" });
      }
      deps.appendDecision({
        threadId: body.fromThreadId,
        requestId: proposed.requestId,
        botId: from.id,
        botName: from.name,
        tool: "update_profile",
        summary: proposed.detail,
        decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
        source: proposed.state === "applied" ? proposed.appliedBy ?? "full-access" : "profile",
      });
      return json(res, 201, proposed);
    }

    if (method === "POST" && path === "/api/internal/model-requests") {
      const parsed = z.object({
        fromBotId: z.string().min(1).max(128),
        fromThreadId: z.string().min(1).max(128),
        forBotId: z.string().max(128).optional(),
        modelSelection: z.unknown(),
        reason: z.unknown(),
        quote: z.string().max(600).optional(),
      }).strict().safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "invalid model proposal" });
      const body = parsed.data;
      const from = deps.bot(body.fromBotId);
      if (!from) return json(res, 403, { error: "unknown sender" });
      const owner = deps.ownsThread(from.id, body.fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      const targetBotId = body.forBotId?.trim() || from.id;
      // 2026-10-20: asked now by the person, it applies without a card;
      // their words name the bot and the new engine or model
      const selection = body.modelSelection && typeof body.modelSelection === "object" ? body.modelSelection as Record<string, unknown> : {};
      const instanceId = typeof selection.instanceId === "string" ? selection.instanceId : "";
      const askedProof = body.quote === undefined ? "no quote" : deps.primaryAskedProposal({
        botId: from.id,
        threadId: body.fromThreadId,
        generation: capability.generation,
        quote: body.quote,
        targetBotId,
        key: "bot.model",
        value: body.modelSelection,
        valueNames: [instanceId, deps.engineDisplayName(instanceId) ?? "", typeof selection.model === "string" ? selection.model : ""].filter(Boolean),
      });
      // V4: failed quote -> card for the person (200 non-isError), not a red 403.
      if (body.quote !== undefined && typeof askedProof === "string") {
        deps.journalRefusedQuote(from.id, targetBotId, "bot.model", askedProof);
      }
      const quoteRefused = body.quote !== undefined && typeof askedProof === "string";
      const proposed = await deps.withPrimaryAsked(askedProof, { botId: from.id, threadId: body.fromThreadId, targetBotId, kind: "bot.model" }, (primaryAsked) => deps.submitModel({
        primaryAsked,
        quoteRefused,
        botId: from.id,
        threadId: body.fromThreadId,
        targetBotId,
        selection: body.modelSelection,
        reason: body.reason,
        from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
      }));
      const byRule = proposed.state !== "applied" && proposed.messageId
        ? deps.settleProposalByRule(from, body.fromThreadId, { requestId: proposed.requestId, messageId: proposed.messageId }, (args) => deps.resolveModel(args))
        : undefined;
      if (byRule) {
        if (byRule.result.state === "applied" && byRule.result.targetBotId) {
          const target = deps.bot(byRule.result.targetBotId);
          if (target) deps.broadcastBot(target);
        }
        return json(res, 201, { ...proposed, state: byRule.result.state === "applied" ? "applied" : proposed.state, result: byRule.result, appliedBy: "rule" });
      }
      deps.appendDecision({
        threadId: body.fromThreadId,
        requestId: proposed.requestId,
        botId: from.id,
        botName: from.name,
        tool: "update_model",
        summary: proposed.detail,
        decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
        source: proposed.state === "applied" ? proposed.appliedBy ?? "full-access" : "model",
      });
      return json(res, 201, proposed);
    }

    if (method === "POST" && path === "/api/internal/rule-requests") {
      const parsed = z.object({
        fromBotId: z.string().min(1).max(128),
        fromThreadId: z.string().min(1).max(128),
        action: z.enum(["add", "change", "remove"]),
        when: z.unknown().optional(),
        behavior: z.unknown().optional(),
        ruleId: z.unknown().optional(),
        scopeBotId: z.union([z.string().max(128), z.null()]).optional(),
        riskScope: z.unknown().optional(),
        changes: z.unknown().optional(),
        reason: z.unknown(),
        quote: z.string().max(600).optional(),
      }).strict().safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "invalid approval-rule proposal" });
      const body = parsed.data;
      const from = deps.bot(body.fromBotId);
      if (!from) return json(res, 403, { error: "unknown sender" });
      const owner = deps.ownsThread(from.id, body.fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      const scopeTarget = body.scopeBotId === null ? from.id : (typeof body.scopeBotId === "string" && body.scopeBotId.trim() ? body.scopeBotId.trim() : from.id);
      const ruleValue = body.action === "add"
        ? { when: body.when, behavior: body.behavior ?? "allow", botId: body.scopeBotId === undefined ? from.id : body.scopeBotId }
        : body.action === "change"
          ? { ...(typeof body.changes === "object" && body.changes ? body.changes as Record<string, unknown> : {}), ruleId: body.ruleId }
          : { ruleId: body.ruleId };
      const ruleKey = body.action === "add" ? "rules.custom" : body.action === "change" ? "rules.customUpdate" : "rules.customDelete";
      // Rules use askedChange (PERSON_ASKED_KEYS), not askedBotChange / KEY_WORDS.
      let primaryAsked = false;
      if (body.quote !== undefined) {
        const gate = deps.primaryTurnGate(from.id, body.fromThreadId, capability.generation, "settings");
        if ("error" in gate) {
          deps.journalRefusedQuote(from.id, scopeTarget, ruleKey, gate.error);
          return json(res, 403, { error: `Not applied at once: ${gate.error}. Without quote it becomes a card for the person.` });
        }
        const check = deps.checkPersonQuote({ quote: body.quote, message: gate.message.text, intent: "setting" });
        if (!check.ok) {
          deps.journalRefusedQuote(from.id, scopeTarget, ruleKey, check.reason);
          return json(res, 403, { error: `Not applied at once: ${check.reason}. Without quote it becomes a card for the person.` });
        }
        const ownerId = deps.effectiveBotOwner(from);
        const existingText = typeof body.ruleId === "string" && ownerId
          ? deps.customRuleWhen(ownerId, body.ruleId.trim())
          : undefined;
        const asked = deps.askedChange(
          gate.message.text, ruleKey, ruleValue, from.name, true, existingText, body.quote, from.name,
        );
        if (asked !== true) {
          deps.journalRefusedQuote(from.id, scopeTarget, ruleKey, asked);
          return json(res, 403, { error: `Not applied at once: ${asked}. Without quote it becomes a card for the person.` });
        }
        primaryAsked = true;
      }
      let proposed: InternalRequestsProposed;
      try {
        proposed = deps.submitRule({
          primaryAsked,
          botId: from.id,
          threadId: body.fromThreadId,
          action: body.action,
          when: body.when,
          behavior: body.behavior,
          ruleId: body.ruleId,
          scopeBotId: body.scopeBotId,
          riskScope: body.riskScope,
          changes: body.changes,
          reason: body.reason,
          from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
        });
        if (primaryAsked && proposed.state === "applied") {
          const gate = deps.primaryTurnGate(from.id, body.fromThreadId, capability.generation, "settings");
          if (!("error" in gate)) {
            deps.appendAdminAction({
              category: "setting",
              action: "setting.change",
              target: { kind: "bot", id: scopeTarget },
              changed: [ruleKey],
              after: {
                how: "run",
                bot: from.id,
                via: "primary-bot",
                viaBot: gate.botName,
                messageId: gate.message.id,
                quote: String(body.quote).slice(0, 200),
              },
              actor: deps.identityKind() === "perspicax"
                ? { kind: "person", principalId: gate.person, via: "sagax" }
                : { kind: "loopback" },
            });
          }
        }
      } catch (error) {
        if (error instanceof RuleRequestError) {
          return json(res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
        }
        throw error;
      }
      const byRule = proposed.state !== "applied" && proposed.messageId
        ? deps.settleProposalByRule(from, body.fromThreadId, { requestId: proposed.requestId, messageId: proposed.messageId }, (args) => deps.resolveRule({
          ...args,
          personId: deps.effectiveBotOwner(from),
        }))
        : undefined;
      if (byRule) {
        return json(res, 201, { ...proposed, state: byRule.result.state === "applied" ? "applied" : proposed.state, result: byRule.result, appliedBy: "rule" });
      }
      deps.appendDecision({
        threadId: body.fromThreadId,
        requestId: proposed.requestId,
        botId: from.id,
        botName: from.name,
        tool: "propose_rule",
        summary: proposed.detail,
        decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
        source: proposed.state === "applied" ? proposed.appliedBy ?? "full-access" : "rule",
      });
      return json(res, 201, proposed);
    }

    if (method === "GET" && path === "/api/internal/team-setup-catalog") {
      let chief = deps.bot(capability.botId);
      if (!chief || !chief.chiefOfStaff || chief.hidden) return json(res, 403, { error: "Only an active Primary Bot may plan team setup" });
      const instances = await deps.describeInstances();
      deps.requireActive(capability);
      chief = deps.bot(capability.botId);
      if (!chief || !chief.chiefOfStaff || chief.hidden) return json(res, 403, { error: "Only an active Primary Bot may plan team setup" });
      const covered = deps.bots().filter((bot) => !bot.hidden && !deps.archivedAgent(bot) && (bot.id === chief!.id || (deps.canAccessBot(chief!, bot) && deps.peerAllowed(chief!, bot) && deps.peerInScope(chief!, bot))));
      const setupBots = covered.map((bot) => ({
        id: bot.id,
        name: bot.name,
        title: bot.title,
        section: bot.section ?? "",
        modelSelection: bot.modelSelection,
        chiefOfStaff: Boolean(bot.chiefOfStaff),
        ...(bot.temporary ? { temporary: true } : {}),
      }));
      const coveredTeams = new Set(covered.map((bot) => bot.section?.trim() || ""));
      const ownerId = deps.effectiveBotOwner(chief);
      return json(res, 200, {
        teams: deps.teamSetupTeams().filter((name) => deps.canAccessTeam(chief!, name) || coveredTeams.has(name.trim())),
        // 2026-10-20: every bot of the person (canAccessBot), whatever its
        // team; an archived bot or temporary agent is not listed
        bots: setupBots,
        instances: deps.orgOfferedEngines(instances, ownerId).filter((instance) =>
          deps.consoleEngineAllowed(instance.instanceId)
          || (deps.orgOwnAccountsOutsideList() && deps.personPaysEngine(ownerId, instance.instanceId))
        ).map((instance) => ({
          instanceId: instance.instanceId,
          driverKind: instance.driverKind,
          displayName: instance.displayName,
          state: instance.snapshot.state,
          models: instance.models,
          effortLevels: instance.capabilities?.effortLevels ?? [],
        })),
        scope: "Every bot of the person is listed, whatever its team. A new default model: threads following the bot (main, routines) move at their next turn. Full Access applies requested team setup immediately; Approve for me applies it too when the person asked in their own message and every bot it touches is theirs; other modes, and a suggestion, return a review card.",
      });
    }

    if (method === "POST" && path === "/api/internal/team-setup-requests") {
      const parsed = z.object({ fromBotId: z.string().optional(), fromThreadId: z.string().optional(), plan: z.unknown() }).strict().safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "Invalid team setup request" });
      const chief = deps.bot(capability.botId);
      if (!chief) return json(res, 401, { error: "unauthorized" });
      if (deps.ownerBotsReadOnly(chief)) return json(res, 403, deps.botsReadOnlyBody);
      const owner = deps.ownsThread(chief.id, capability.threadId);
      if (!owner) return json(res, 403, { error: "Source conversation no longer belongs to the Primary Bot" });
      const proposed = await deps.submitTeamSetup({
        botId: chief.id,
        threadId: capability.threadId,
        plan: parsed.data.plan,
        canCommit: () => deps.isActive(capability),
        ...(owner.group ? { from: { botId: chief.id, name: chief.name, color: chief.color } } : {}),
      });
      if (proposed.state === "applied" || proposed.state === "pending") {
        deps.appendDecision({
          threadId: capability.threadId,
          requestId: proposed.requestId,
          botId: chief.id,
          tool: "set_up_team",
          summary: proposed.detail,
          decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
          source: proposed.state === "pending" ? "profile" : deps.fullAccessForSource(chief.id, capability.threadId) ? "full-access" : "owner-auto",
        });
      }
      return json(res, 201, proposed);
    }

    if (method === "POST" && path === "/api/internal/bot-deletion-requests") {
      const parsed = z.object({
        fromBotId: z.string().optional(),
        fromThreadId: z.string().optional(),
        targetBotId: z.string().min(1),
        reason: z.string().trim().min(1).max(500),
      }).strict().safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "An exact bot id and deletion reason are required" });
      const chief = deps.bot(capability.botId);
      if (!chief) return json(res, 401, { error: "unauthorized" });
      if (deps.ownerBotsReadOnly(chief)) return json(res, 403, deps.botsReadOnlyBody);
      const owner = deps.ownsThread(chief.id, capability.threadId);
      if (!owner) return json(res, 403, { error: "Source conversation no longer belongs to the Primary Bot" });
      const proposed = await deps.submitBotDeletion({
        botId: chief.id,
        threadId: capability.threadId,
        targetBotId: parsed.data.targetBotId,
        reason: parsed.data.reason,
        canCommit: () => deps.isActive(capability),
        ...(owner.group ? { from: { botId: chief.id, name: chief.name, color: chief.color } } : {}),
      });
      if (proposed.state === "applied" || proposed.state === "pending") {
        deps.appendDecision({
          threadId: capability.threadId,
          requestId: proposed.requestId,
          botId: chief.id,
          tool: "delete_bot",
          summary: proposed.detail,
          decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
          source: proposed.state === "pending" ? "profile" : deps.fullAccessForSource(chief.id, capability.threadId) ? "full-access" : "owner-auto",
        });
      }
      return json(res, 201, proposed);
    }

    return PASS;
  };
}
