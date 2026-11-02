// Routines and Approvals (console design 4.4, 4.5 and section 5): every
// routine across members with its last run and failures, a routine's run
// history, Run now and Pause; the organization's whole approval queue and
// the decided cards. Never a routine prompt, a run's output or a message.
import type { DecisionRow } from "./decision-log.ts";
import type { AdminApproval, AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  enumParam,
  fail,
  isAnswer,
  matchesQuery,
  notFound,
  objectBody,
  ok,
  onlyKeys,
  pageOf,
  parsePage,
  type ConsoleContext,
  type ConsoleLocale,
  type ConsoleRoute,
} from "./org-admin-console.ts";
import { problemReason, reasonLabel } from "./org-problem-log.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import type { UsageRow } from "./usage-ledger.ts";

const DAY_MS = 24 * 60 * 60_000;
export const APPROVAL_HISTORY_DAYS = 90;

export type RunStatus = "ok" | "failed" | "skipped" | "running";

export function runStatus(status: RoutineRun["status"]): RunStatus {
  if (status === "completed") return "ok";
  if (status === "failed" || status === "blocked") return "failed";
  if (status === "cancelled" || status === "missed" || status === "nothing_to_report") return "skipped";
  return "running";
}

/** The reason code and readable words of a run that did not complete. */
export function runReason(run: Pick<RoutineRun, "status" | "error">, locale: ConsoleLocale): { reason: string | null; label: string | null } {
  if (run.status === "failed" || run.status === "blocked") {
    const reason = problemReason("routine-failed", run.error ?? "");
    return { reason, label: reasonLabel(reason, locale) };
  }
  if (run.status === "cancelled") return { reason: "cancelled", label: locale === "fr" ? "Exécution annulée" : "The run was cancelled" };
  if (run.status === "missed") return { reason: "missed", label: locale === "fr" ? "Exécution manquée (serveur arrêté ou occupé)" : "The run was missed (server stopped or busy)" };
  if (run.status === "nothing_to_report") return { reason: "nothing_to_report", label: locale === "fr" ? "Rien à signaler" : "Nothing to report" };
  return { reason: null, label: null };
}

export interface RoutinesDeps {
  routines(): Routine[];
  runs(from?: number): RoutineRun[];
  bot(botId: string): { id: string; name: string; ownerPrincipalId: string } | null;
  /** The principal a routine runs as (its runAs, else its bot's owner). */
  runAs(routine: Routine): string | null;
  person(principalId: string): AdminPerson;
  scheduleLabel(routine: Routine): string;
  usageRows(range: { from: Date; to: Date }): UsageRow[];
  /** A run in flight (queued, running, waiting). */
  inFlight(routineId: string): boolean;
  runNow(routineId: string, adminPrincipalId: string): RoutineRun | null;
  setEnabled(routineId: string, enabled: boolean, adminPrincipalId: string): Routine | null;
  /** Approvals: every pending card of the organization, as `viewer` may decide them. */
  orgApprovals(viewer: { principalId: string; orgAdmin: boolean }): AdminApproval[];
  decisions(range: { from: Date; to: Date }): DecisionRow[];
  /** A decision's actor as a person (a console or Sagax session). */
  decisionPerson(actor: DecisionRow["actor"]): AdminPerson | null;
}

function row(ctx: ConsoleContext, deps: RoutinesDeps, routine: Routine, runs: readonly RoutineRun[]) {
  const bot = deps.bot(routine.botId);
  const runAs = deps.runAs(routine);
  const own = runs.filter((run) => run.routineId === routine.id);
  const last = own.reduce<RoutineRun | null>((latest, run) => (!latest || runAt(run) > runAt(latest) ? run : latest), null);
  const since = ctx.now() - 7 * DAY_MS;
  return {
    id: routine.id,
    name: routine.name,
    botId: routine.botId,
    botName: bot?.name ?? routine.botId,
    owner: deps.person(bot?.ownerPrincipalId ?? ""),
    runAs: runAs ? deps.person(runAs) : null,
    schedule: deps.scheduleLabel(routine),
    enabled: routine.enabled,
    ...(routine.suspended ? { suspended: routine.suspended.reason } : {}),
    nextRunAt: routine.enabled ? routine.nextRunAt : null,
    lastRun: last ? { at: runAt(last), status: runStatus(last.status), ...runReason(last, ctx.locale) } : null,
    failures7d: own.filter((run) => run.status === "failed" && runAt(run) >= since).length,
  };
}

const runAt = (run: RoutineRun) => run.startedAt ?? run.scheduledFor ?? run.createdAt;

function visible(ctx: ConsoleContext, deps: RoutinesDeps, routine: Routine): boolean {
  const bot = deps.bot(routine.botId);
  // Under the `own-routine` grant: a routine of the person's own bot only.
  if (ctx.ownOnly) return !!bot && bot.ownerPrincipalId === ctx.viewer.principalId;
  if (!ctx.reach) return true;
  return ctx.inReach(bot?.ownerPrincipalId) || ctx.inReach(deps.runAs(routine));
}

function findRoutine(ctx: ConsoleContext, deps: RoutinesDeps, id: string): Routine | null {
  const routine = deps.routines().find((candidate) => candidate.id === id) ?? null;
  return routine && visible(ctx, deps, routine) ? routine : null;
}

export function routinesRoutes(deps: RoutinesDeps): ConsoleRoute[] {
  return [
    {
      method: "GET",
      path: "routines",
      min: "manager",
      ownerGrant: "own-routine",
      handle(ctx) {
        const params = ctx.url.searchParams;
        const page = parsePage(params);
        if (isAnswer(page)) return page;
        const status = enumParam(params, "status", ["enabled", "paused", "failing"] as const);
        if (isAnswer(status)) return status;
        const bot = params.get("bot") || null;
        const owner = params.get("owner") || null;
        const runs = deps.runs(ctx.now() - 30 * DAY_MS);
        const rows = deps.routines()
          .filter((routine) => visible(ctx, deps, routine))
          .map((routine) => row(ctx, deps, routine, runs))
          .filter((item) => (!status || (status === "enabled" ? item.enabled : status === "paused" ? !item.enabled : item.lastRun?.status === "failed"))
            && (!bot || item.botId === bot)
            && (!owner || item.owner.principalId === owner || item.owner.sub === owner)
            && matchesQuery(page.q, item.name, item.botName, item.owner.name, item.runAs?.name))
          .sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id.localeCompare(b.id));
        return ok(pageOf(rows, page));
      },
    },
    {
      method: "GET",
      path: "routines/{id}",
      min: "manager",
      ownerGrant: "own-routine",
      handle(ctx) {
        const routine = findRoutine(ctx, deps, ctx.params.id!);
        if (!routine) return notFound("No such routine.");
        return ok({ routine: row(ctx, deps, routine, deps.runs(ctx.now() - 30 * DAY_MS)) });
      },
    },
    {
      method: "GET",
      path: "routines/{id}/runs",
      min: "manager",
      ownerGrant: "own-routine",
      handle(ctx) {
        const page = parsePage(ctx.url.searchParams);
        if (isAnswer(page)) return page;
        const routine = findRoutine(ctx, deps, ctx.params.id!);
        if (!routine) return notFound("No such routine.");
        const runs = deps.runs().filter((run) => run.routineId === routine.id).sort((a, b) => runAt(b) - runAt(a) || b.id.localeCompare(a.id));
        const paged = pageOf(runs, page);
        // Turns and cost from the usage ledger, for the runs of this page.
        const starts = paged.items.map(runAt);
        const usage = new Map<string, { turns: number; cost: number | null }>();
        if (starts.length) {
          const from = Math.min(...starts);
          const to = Math.max(...paged.items.map((run) => run.finishedAt ?? ctx.now())) + 60 * 60_000;
          for (const entry of deps.usageRows({ from: new Date(from), to: new Date(Math.min(to, ctx.now())) })) {
            if (entry.trigger.kind !== "routine" || entry.trigger.routineId !== routine.id) continue;
            const tally = usage.get(entry.threadId) ?? { turns: 0, cost: null };
            tally.turns += 1;
            if (typeof entry.costUsd === "number") tally.cost = (tally.cost ?? 0) + entry.costUsd;
            usage.set(entry.threadId, tally);
          }
        }
        return ok({
          items: paged.items.map((run) => {
            const tally = run.threadId ? usage.get(run.threadId) : undefined;
            return {
              id: run.id,
              startedAt: runAt(run),
              endedAt: run.finishedAt ?? null,
              status: runStatus(run.status),
              ...runReason(run, ctx.locale),
              threadId: run.threadId ?? null,
              turns: tally?.turns ?? 0,
              costUsd: typeof run.cost === "number" ? run.cost : tally?.cost ?? null,
            };
          }),
          next: paged.next,
        });
      },
    },
    {
      method: "POST",
      path: "routines/{id}/run",
      min: "manager",
      ownerGrant: "own-routine",
      handle(ctx) {
        const body = objectBody(ctx.body ?? {});
        if (!body || onlyKeys(body, [])) return badRequest("Send {}.");
        const routine = findRoutine(ctx, deps, ctx.params.id!);
        if (!routine) return notFound("No such routine.");
        if (deps.inFlight(routine.id)) return fail(409, "already_running", "A run of this routine is already in progress.");
        const run = deps.runNow(routine.id, ctx.viewer.principalId);
        if (!run) return notFound("No such routine.");
        ctx.record({ category: "bot", action: "routine.run_now", target: { kind: "routine", id: routine.id, name: routine.name }, after: { runId: run.id, trigger: "manual" } });
        return ok({ run: { id: run.id, startedAt: run.startedAt ?? run.createdAt, status: "running" } });
      },
    },
    {
      method: "POST",
      path: "routines/{id}/pause",
      min: "manager",
      ownerGrant: "own-routine",
      handle(ctx) {
        const body = objectBody(ctx.body);
        if (!body || onlyKeys(body, ["paused"]) || typeof body.paused !== "boolean") return badRequest("Send { \"paused\": true or false }.");
        const routine = findRoutine(ctx, deps, ctx.params.id!);
        if (!routine) return notFound("No such routine.");
        if (routine.enabled === !body.paused) return ok({ routine: row(ctx, deps, routine, deps.runs(ctx.now() - 30 * DAY_MS)) });
        const wasEnabled = routine.enabled;
        const updated = deps.setEnabled(routine.id, !body.paused, ctx.viewer.principalId);
        if (!updated) return notFound("No such routine.");
        ctx.record({
          category: "bot", action: body.paused ? "routine.pause" : "routine.resume", target: { kind: "routine", id: routine.id, name: routine.name },
          changed: ["enabled"], before: { enabled: wasEnabled }, after: { enabled: updated.enabled },
        });
        return ok({ routine: row(ctx, deps, updated, deps.runs(ctx.now() - 30 * DAY_MS)) });
      },
    },
    {
      method: "GET",
      path: "approvals?scope=org",
      min: "admin",
      handle(ctx) {
        return ok({ approvals: deps.orgApprovals({ principalId: ctx.viewer.principalId, orgAdmin: ctx.viewer.orgAdmin }) });
      },
    },
    {
      method: "GET",
      path: "approvals/history",
      min: "admin",
      handle(ctx) {
        const page = parsePage(ctx.url.searchParams);
        if (isAnswer(page)) return page;
        const now = ctx.now();
        const items = deps.decisions({ from: new Date(now - APPROVAL_HISTORY_DAYS * DAY_MS), to: new Date(now) })
          // 2026-10-11: a card whose own timeout passed is `expired`, by nobody
          .filter((decision) => decision.requestId && (
            (decision.source === "user" && (decision.decision === "user-approved" || decision.decision === "user-denied")) ||
            decision.decision === "expired"))
          .map((decision) => ({
            botId: decision.botId ?? null,
            botName: decision.botName ?? null,
            threadId: decision.threadId,
            requestId: decision.requestId!,
            type: decision.tool ? "tool" : "other",
            tool: decision.tool ?? null,
            summary: decision.summary ?? null,
            decision: decision.decision === "user-approved" ? "allow" as const : decision.decision === "expired" ? "expired" as const : "deny" as const,
            by: decision.decision === "expired" ? null : deps.decisionPerson(decision.actor),
            at: Date.parse(decision.at),
          }))
          .filter((item) => matchesQuery(page.q, item.botName, item.tool, item.summary, item.by?.name))
          .sort((a, b) => b.at - a.at);
        return ok(pageOf(items, page));
      },
    },
  ];
}
