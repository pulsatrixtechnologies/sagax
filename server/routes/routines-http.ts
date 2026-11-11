import type { RoutineReadinessAnswer } from "../../shared/routine-readiness.ts";
/**
 * Public routines and routine-runs HTTP routes (#1388 wave 2 P2):
 * /api/routines*, /api/routine-runs*.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 */
import type { IncomingMessage } from "node:http";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { RunAsChooser, RunAsPerson } from "../routines/routine-run-as.ts";
import { runAsOptions } from "../routines/routine-run-as.ts";
import {
  redactRun,
  parseRoutineScopeQuery,
  routineRunClearable,
  routineRunsSeenAnswer,
  routineScopeRefusal,
  scopedRoutineListing,
  type RoutineScopeCaller,
  type RoutineScopeDeps,
} from "../routines/routine-scope.ts";
import { routineRunsFor } from "../routines/routine-run-window.ts";
import type { Routine, RoutineRun } from "../routines/routines.ts";
import {
  routineRunInFlightRefusal,
  routineRunReceipt,
} from "./routine-run-internal.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutinesHttpVisible {
  everything: boolean;
  bot(id: string): boolean;
  group(id: string): boolean;
}

export interface RoutinesHttpDeps {
  listRoutines(): Routine[];
  check?(routine: Routine): Promise<RoutineReadinessAnswer>;
  listRuns(from?: number, to?: number): RoutineRun[];
  /** #3581: a finished run's whole report (its task's last message), when
   * the run's record keeps only its start. */
  fullReport?(run: RoutineRun): string | undefined;
  listFolders(): Record<string, string[]>;
  create(
    body: unknown,
    request: undefined,
    opts: Record<string, unknown>,
  ): Routine;
  wakeHold(): { hold: boolean; reason?: "running" | "due"; at?: number };
  runNow(id: string, request: undefined, startedBy: "person"): RoutineRun | null;
  runStanding(runId: string): { status: string; reason?: string; position?: number; queuedForBot?: number } | null | undefined;
  markAllSeen(allow: (run: RoutineRun) => boolean): Array<Pick<RoutineRun, "id" | "seenAt">>;
  clearRuns(allow: (run: RoutineRun) => boolean): string[];
  cancelRun(id: string): Promise<RoutineRun | null>;
  markSeen(id: string): RoutineRun | null;
  routineBotId(routineId: string): string | undefined;
  inFlightRun(routineId: string): RoutineRun | undefined;
  visible(auth: RequestAuth, path: string): RoutinesHttpVisible;
  viewerId(auth: RequestAuth): string | undefined;
  scopeCaller(auth: RequestAuth, viewerId: string | undefined): RoutineScopeCaller;
  scopeDeps(auth: RequestAuth, visible: RoutinesHttpVisible, viewerId: string | undefined): RoutineScopeDeps<object>;
  needsRun(auth: RequestAuth, botId: unknown): boolean;
  needsRunBody: { error: string; code: string };
  /** #2622: a refusal when the bot's owner does not let collaborators
   * create routines and this caller is not its owner or manager. */
  createRefused?(auth: RequestAuth, botId: unknown): { error: string; code: string } | null;
  hiddenTarget(body: unknown, visible: RoutinesHttpVisible): string | null;
  resultsRefusal(auth: RequestAuth, body: unknown): string | null;
  runAsChoice(
    auth: RequestAuth,
    body: unknown,
  ): { runAs?: string } | { refusal: { status: number; error: string; code: string; permission?: string } };
  actorKey(auth: RequestAuth & { kind: "session" }): string;
  nobodyKey(): string;
  withWriter<T>(writer: string, work: () => T): T;
  routineActor(auth: RequestAuth): { actorPrincipalId: string } | undefined;
  isTriggerSchedule(schedule: unknown): boolean;
  bindOwnedTrigger(routine: Routine): void;
  auditRunAs(auth: RequestAuth, routine: Routine, before: string | undefined): void;
  onWire(routine: Routine): object;
  mayRunNow(auth: RequestAuth, routine: Routine): boolean;
  receiptFacts(routine: Pick<Routine, "botId" | "name">, run: RoutineRun): { botName: string; reportsTo: string };
  auditRunNow(auth: RequestAuth, routine: Routine, run: RoutineRun): void;
  routineVisible(routine: { botId?: unknown; groupId?: unknown }, visible: RoutinesHttpVisible): boolean;
  routineSeenBy(
    routine: { botId?: unknown; groupId?: unknown; runAs?: unknown; sourceThreadId?: unknown },
    viewerId: string,
  ): boolean;
  runAsChooser(auth: RequestAuth): RunAsChooser | null;
  runAsPeople(): RunAsPerson[];
  bot(id: string): { id: string; ownerUserId?: unknown } | null | undefined;
  botOwner(bot: { ownerUserId?: unknown }): string;
  principalMayRun(
    principalId: string,
    run: { botId: string; target?: string; groupId?: string },
  ): boolean;
  consentActive(principalId: string): boolean;
  principalName(principalId: string): { name?: string; login?: string } | null;
  patchAs(auth: RequestAuth, req: IncomingMessage, id: string, body: unknown): { status: number; body: unknown };
  deleteAs(auth: RequestAuth, id: string): { status: number; body: unknown };
  mayCancel(auth: RequestAuth, run: RoutineRun, routine: Routine | undefined): boolean;
  auditCleared(auth: RequestAuth, count: number): void;
  effectiveRunAs(routine: { runAs?: string; botId: string }): string | undefined;
}

export function createRoutinesHttpRoutes(deps: RoutinesHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (
      !path.startsWith("/api/routines")
      && !path.startsWith("/api/routine-runs")
    ) {
      return PASS;
    }
    // /api/routines/bulk and /api/routines/folders live in their own modules.
    if (path === "/api/routines/bulk" || path.startsWith("/api/routines/folders")) {
      return PASS;
    }

    if (path === "/api/routines" && method === "GET") {
      const query = parseRoutineScopeQuery(url.searchParams);
      if ("error" in query) return json(res, 400, query);
      const viewerId = deps.viewerId(auth);
      const visible = deps.visible(auth, path);
      const caller = deps.scopeCaller(auth, viewerId);
      const refusal = routineScopeRefusal(caller, query.scope);
      if (refusal) return json(res, 403, refusal);
      // listRuns deps may return raw journal rows (listRunsRaw): this handler
      // JSON.stringifies and drops them, so a full cloneRun pass is wasted CPU
      // on cold start when the client hydrates /api/routines with no window.
      // `since` loads the app's window; `from`/`to` a range; `thread` one conversation's runs.
      const runs = routineRunsFor((from, to) => deps.listRuns(from, to), url.searchParams);
      const listing = scopedRoutineListing(
        query,
        caller,
        deps.listRoutines(),
        runs,
        deps.scopeDeps(auth, visible, viewerId),
      );
      // #3581: the single-run read (the run window) carries the whole report
      // as `report`; the record's `output` keeps its 2,000 characters.
      if (url.searchParams.get("run") && deps.fullReport) {
        listing.runs = listing.runs.map((run) => {
          if ("redacted" in run && run.redacted) return run;
          const report = deps.fullReport!(run);
          return report ? { ...run, report } : run;
        });
      }
      const listedBots = new Set(listing.routines.map((row) => row.bot.id));
      const folders = Object.fromEntries(Object.entries(deps.listFolders()).filter(([botId]) =>
        (visible.everything || visible.bot(botId)) && (listedBots.has(botId) || !deps.needsRun(auth, botId))));
      return json(res, 200, { ...listing, folders });
    }

    if (path === "/api/routines" && method === "POST") {
      const body = await readBody(req);
      const visible = deps.visible(auth, path);
      const hidden = deps.hiddenTarget(body, visible);
      if (hidden) return json(res, 404, { error: hidden });
      if (deps.needsRun(auth, (body as { botId?: unknown } | null)?.botId)) {
        return json(res, 403, deps.needsRunBody);
      }
      const refused = deps.createRefused?.(auth, (body as { botId?: unknown } | null)?.botId);
      if (refused) return json(res, 403, refused);
      const notYours = deps.resultsRefusal(auth, body);
      if (notYours) return json(res, 403, { error: notYours });
      const runAsChoice = deps.runAsChoice(auth, body);
      if ("refusal" in runAsChoice) {
        return json(res, runAsChoice.refusal.status, {
          error: runAsChoice.refusal.error,
          code: runAsChoice.refusal.code,
          ...(runAsChoice.refusal.permission ? { permission: runAsChoice.refusal.permission } : {}),
        });
      }
      const writer = auth.kind === "session" ? deps.actorKey(auth) : deps.nobodyKey();
      const routine = deps.withWriter(writer, () =>
        deps.create(body, undefined, { ...deps.routineActor(auth), ...runAsChoice }));
      if (deps.isTriggerSchedule(routine.schedule)) deps.bindOwnedTrigger(routine);
      deps.auditRunAs(auth, routine, deps.routineActor(auth)?.actorPrincipalId);
      return json(res, 201, { routine: deps.onWire(routine) });
    }

    if (path === "/api/routines/wake" && method === "GET") {
      return json(res, 200, deps.wakeHold());
    }

    let routineMatch = path.match(/^\/api\/routines\/([\w-]+)\/run$/);
    if (routineMatch && method === "POST") {
      if (deps.needsRun(auth, deps.routineBotId(routineMatch[1]!))) {
        return json(res, 403, deps.needsRunBody);
      }
      const target = deps.listRoutines().find((candidate) => candidate.id === routineMatch![1]);
      if (target && !deps.mayRunNow(auth, target)) {
        return json(res, 403, {
          error: "Only the bot's owner, the person this routine runs as or an admin can run it now.",
          code: "run_now_not_allowed",
          permission: "routines.runNowAny",
        });
      }
      const body = await readBody(req) as { action?: unknown; check?: unknown } | null;
      if (body?.action === "check" || body?.check === true) {
        if (!target) return json(res, 404, { error: "no such routine" });
        if (!deps.check) return json(res, 503, { error: "Routine checks are unavailable" });
        return json(res, 200, await deps.check(target));
      }
      const current = target ? deps.inFlightRun(target.id) : undefined;
      if (target && current) {
        const standing = deps.runStanding(current.id);
        return json(res, 409, routineRunInFlightRefusal({
          routineName: target.name || current.routineName,
          runId: current.id,
          ...deps.receiptFacts(target, current),
          standing: standing ?? undefined,
        }));
      }
      const run = deps.runNow(routineMatch[1]!, undefined, "person");
      if (run && target) deps.auditRunNow(auth, target, run);
      if (!run) return json(res, 404, { error: "no such routine" });
      const standing = deps.runStanding(run.id);
      const message = routineRunReceipt({
        routineName: target?.name || run.routineName,
        runId: run.id,
        ...(target ? deps.receiptFacts(target, run) : {}),
        standing: standing ?? undefined,
      });
      return json(res, 201, { run, standing, message });
    }

    if (path === "/api/routines/run-as-options" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      const visible = deps.visible(auth, path);
      const viewerId = deps.viewerId(auth);
      const routineId = url.searchParams.get("routineId") ?? "";
      const existing = routineId ? deps.listRoutines().find((row) => row.id === routineId) : undefined;
      if (
        routineId
        && (!existing || !deps.routineVisible(existing, visible) || (viewerId && !deps.routineSeenBy(existing, viewerId)))
      ) {
        return json(res, 404, { error: "no such routine" });
      }
      const botId = url.searchParams.get("botId") || existing?.botId || "";
      if (deps.hiddenTarget({ botId }, visible)) return json(res, 404, { error: "no such bot" });
      const bot = deps.bot(botId);
      const chooser = deps.runAsChooser(auth);
      if (!bot || !chooser) return json(res, 200, { canChoose: false, people: [] });
      const target = url.searchParams.get("target") || existing?.target;
      const groupId = url.searchParams.get("groupId") || existing?.groupId;
      const options = runAsOptions({
        chooser,
        people: deps.runAsPeople(),
        botOwnerId: deps.botOwner(bot) || undefined,
        mayRun: (principalId) => deps.principalMayRun(principalId, {
          botId,
          ...(target ? { target } : {}),
          ...(groupId ? { groupId } : {}),
        }),
        delegated: (principalId) => deps.consentActive(principalId),
      });
      const currentId = existing ? deps.effectiveRunAs(existing) : chooser.principalId;
      const currentPerson = currentId ? deps.principalName(currentId) : null;
      return json(res, 200, {
        ...options,
        ...(currentId ? {
          current: {
            principalId: currentId,
            name: currentPerson?.name || currentPerson?.login || "",
            ...(deps.consentActive(currentId) ? {} : { pending: true }),
          },
        } : {}),
      });
    }

    const checkMatch = path.match(/^\/api\/routines\/([\w-]+)\/check$/);
    const detailMatch = path.match(/^\/api\/routines\/([\w-]+)$/);
    if ((checkMatch && method === "POST") || (detailMatch && method === "GET")) {
      const id = (checkMatch ?? detailMatch)![1]!;
      const target = deps.listRoutines().find(candidate => candidate.id === id);
      const visible = deps.visible(auth, path);
      const viewerId = deps.viewerId(auth);
      if (!target || !deps.routineVisible(target, visible) || (viewerId && !deps.routineSeenBy(target, viewerId))) return json(res, 404, { error: "no such routine" });
      if (checkMatch) {
        if (deps.needsRun(auth, target.botId)) return json(res, 403, deps.needsRunBody);
        if (!deps.mayRunNow(auth, target)) return json(res, 403, { error: "Only the bot's owner, the person this routine runs as or an admin can check it.", code: "run_now_not_allowed", permission: "routines.runNowAny" });
        if (!deps.check) return json(res, 503, { error: "Routine checks are unavailable" });
        res.setHeader("cache-control", "no-store");
        return json(res, 200, await deps.check(target));
      }
      const latest = deps.listRuns().filter(run => run.routineId === target.id).sort((a, b) => b.createdAt - a.createdAt)[0];
      const scope = deps.scopeDeps(auth, visible, viewerId);
      const lastRun = latest && (scope.mine(latest) ? latest : redactRun(latest));
      return json(res, 200, { routine: deps.onWire(target), lastRun, readiness: lastRun?.readiness });
    }

    routineMatch = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (routineMatch && method === "PATCH") {
      const done = deps.patchAs(auth, req, routineMatch[1]!, await readBody(req));
      return json(res, done.status, done.body);
    }
    if (routineMatch && method === "DELETE") {
      const done = deps.deleteAs(auth, routineMatch[1]!);
      return json(res, done.status, done.body);
    }

    if (path === "/api/routine-runs/seen-all" && method === "POST") {
      const viewerId = deps.viewerId(auth);
      const visible = deps.visible(auth, path);
      const scope = deps.scopeDeps(auth, visible, viewerId);
      const stamped = deps.markAllSeen((run) => scope.mine(run));
      return json(res, 200, routineRunsSeenAnswer(stamped));
    }

    if (path === "/api/routine-runs" && method === "DELETE") {
      const query = parseRoutineScopeQuery(url.searchParams);
      if ("error" in query) return json(res, 400, query);
      const viewerId = deps.viewerId(auth);
      const visible = deps.visible(auth, path);
      const caller = deps.scopeCaller(auth, viewerId);
      const refusal = routineScopeRefusal(caller, query.scope);
      if (refusal) return json(res, 403, refusal);
      const scope = deps.scopeDeps(auth, visible, viewerId);
      const removed = deps.clearRuns(routineRunClearable(query, caller, deps.listRoutines(), scope));
      if (removed.length) deps.auditCleared(auth, removed.length);
      return json(res, 200, { ok: true, removed });
    }

    const runMatch = path.match(/^\/api\/routine-runs\/([\w-]+)\/(cancel|seen)$/);
    if (runMatch && method === "POST") {
      if (runMatch[2] === "cancel") {
        const existing = deps.listRuns().find((candidate) => candidate.id === runMatch[1]);
        if (existing) {
          if (deps.needsRun(auth, existing.botId)) return json(res, 403, deps.needsRunBody);
          const target = deps.listRoutines().find((candidate) => candidate.id === existing.routineId);
          if (!deps.mayCancel(auth, existing, target)) {
            return json(res, 403, {
              error: "Only the bot's owner, the person this routine runs as or an admin can stop this run.",
              code: "run_now_not_allowed",
              permission: "routines.runNowAny",
            });
          }
        }
      }
      if (runMatch[2] === "seen") {
        const viewerId = deps.viewerId(auth);
        const visible = deps.visible(auth, path);
        const target = deps.listRuns().find((candidate) => candidate.id === runMatch[1]);
        if (!target || !deps.scopeDeps(auth, visible, viewerId).mine(target)) {
          return json(res, 404, { error: "no such run" });
        }
      }
      const run = runMatch[2] === "cancel"
        ? await deps.cancelRun(runMatch[1]!)
        : deps.markSeen(runMatch[1]!);
      return run ? json(res, 200, { run }) : json(res, 404, { error: "no such active run" });
    }

    return PASS;
  };
}
