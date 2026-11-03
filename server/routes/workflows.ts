// YAML workflows for the signed-in person. No admin right. Steps do not
// start a model turn. A send step posts a bot message in the conversation.
// An approval stays waiting until this person answers.
import type { RequestAuth } from "../auth/request-auth.ts";
import { advanceWorkflow, parseWorkflowYaml, WORKFLOW_CLOCK_BACKOFF_MS, workflowScopeKey, type WorkflowEffects, type WorkflowScope, type WorkflowStore } from "../workflows.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const WORKFLOWS_PATH = "/api/me/workflows";

export interface WorkflowRouteDeps {
  store: WorkflowStore;
  scope(auth: RequestAuth): WorkflowScope | null;
  /** The thread belongs to a bot this person owns. */
  owns(auth: RequestAuth, bot: string, thread: string): boolean;
  deliver(bot: string, thread: string, text: string): void;
  now(): number;
}

export function createWorkflowRoutes(deps: WorkflowRouteDeps): RouteHandler {
  const effects = (): WorkflowEffects => ({
    now: deps.now,
    deliver(bot, thread, text) { deps.deliver(bot, thread, text); },
  });
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== WORKFLOWS_PATH && !path.startsWith(`${WORKFLOWS_PATH}/`)) return PASS;
    res.setHeader("cache-control", "no-store");
    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "A workflow belongs to one person: sign in first." });
    const rest = path.slice(WORKFLOWS_PATH.length);
    if (rest === "" && method === "GET") return json(res, 200, { workflows: deps.store.list(scope) });
    if (rest === "" && method === "PUT") {
      const body = await readBody(req).catch(() => null);
      const yaml = body && typeof body === "object" ? (body as { yaml?: unknown }).yaml : undefined;
      if (typeof yaml !== "string") return json(res, 400, { error: "Send { yaml }." });
      const parsed = parseWorkflowYaml(yaml);
      if (typeof parsed === "string") return json(res, 400, { error: parsed });
      for (const step of parsed.steps) {
        if ((step.kind === "send" || step.kind === "approve") && step.bot && step.thread && !deps.owns(auth, step.bot, step.thread)) {
          return json(res, 403, { error: "A step names a conversation that is not yours." });
        }
      }
      const saved = deps.store.save(scope, yaml);
      if (typeof saved === "string") return json(res, 400, { error: saved });
      return json(res, 200, { name: saved.name, steps: saved.steps.length });
    }
    const runMatch = /^\/runs\/(wf_[a-f0-9]{16})(?:\/answer)?$/.exec(rest);
    if (runMatch && method === "GET" && !rest.endsWith("/answer")) {
      const run = deps.store.getRun(runMatch[1]!);
      if (!run || run.scopeKey !== workflowScopeKey(scope)) return json(res, 404, { error: "No workflow run with that id." });
      return json(res, 200, publicRun(run));
    }
    if (runMatch && method === "POST" && rest.endsWith("/answer")) {
      const runId = runMatch[1]!;
      const body = await readBody(req).catch(() => null);
      const decision = body && typeof body === "object" ? (body as { decision?: unknown }).decision : undefined;
      if (decision !== "yes" && decision !== "no") return json(res, 400, { error: "Send { decision: \"yes\" } or { decision: \"no\" }." });
      // Re-read after the body, under a per-run lock. The second concurrent
      // answer waits, re-reads, sees the step index / approval already moved,
      // and gets 409 before it can deliver again.
      return await deps.store.withRunLock(runId, async () => {
        const run = deps.store.getRun(runId);
        if (!run || run.scopeKey !== workflowScopeKey(scope)) return json(res, 404, { error: "No workflow run with that id." });
        if (!run.approval || run.status !== "waiting") {
          return json(res, 409, { error: "This run is not waiting for an answer." });
        }
        try {
          const advanced = advanceWorkflow(run, guarded(effects(), auth, deps.owns), decision);
          deps.store.writeRun(advanced);
          return json(res, 200, publicRun(advanced));
        } catch (error) {
          return json(res, 403, { error: error instanceof Error ? error.message : "The step was refused." });
        }
      });
    }
    const fileMatch = /^\/([a-z][a-z0-9-]{0,40})(\/run)?$/.exec(rest);
    if (!fileMatch) return PASS;
    const name = fileMatch[1]!;
    if (method === "DELETE" && !fileMatch[2]) {
      const removed = deps.store.forget(scope, name);
      return json(res, removed ? 200 : 404, removed ? { ok: true } : { error: "No workflow with that name." });
    }
    if (method === "POST" && fileMatch[2] === "/run") {
      const started = deps.store.start(scope, name, deps.now());
      if (typeof started === "string") return json(res, 404, { error: started });
      try {
        const advanced = advanceWorkflow(started, guarded(effects(), auth, deps.owns));
        deps.store.writeRun(advanced);
        return json(res, 200, publicRun(advanced));
      } catch (error) {
        const stopped = { ...started, status: "stopped" as const, error: "send_failed" };
        deps.store.writeRun(stopped);
        return json(res, 403, { error: error instanceof Error ? error.message : "The step was refused." });
      }
    }
    return PASS;
  };
}

function guarded(effects: WorkflowEffects, auth: RequestAuth, owns: WorkflowRouteDeps["owns"]): WorkflowEffects {
  return {
    now: effects.now,
    deliver(bot, thread, text) {
      if (!owns(auth, bot, thread)) throw new Error("A step names a conversation that is not yours.");
      effects.deliver(bot, thread, text);
    },
  };
}

function publicRun(run: { id: string; name: string; status: string; index: number; approval?: { prompt: string }; waitUntil?: number }) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    index: run.index,
    ...(run.approval ? { approval: run.approval } : {}),
    ...(run.waitUntil !== undefined ? { waitUntil: run.waitUntil } : {}),
  };
}

/** Resume waits whose clock has passed. Approvals stay until the person answers.
 * One failed run is logged and stopped (or backed off) so it does not repost
 * every tick; the rest of the due list still runs. `effectsFor` may close over
 * the run (for example its scope key when posting). */
export function resumeDueWorkflows(
  store: WorkflowStore,
  now: () => number,
  effectsFor: (run: { id: string; scopeKey: string }) => WorkflowEffects,
  ownsRun: (runScopeKey: string) => boolean,
  log: (line: string) => void = (line) => console.warn(line),
): void {
  for (const run of store.due(now())) {
    if (!ownsRun(run.scopeKey)) continue;
    const effects = effectsFor(run);
    try {
      store.writeRun(advanceWorkflow(run, effects));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`workflows: run ${run.id} failed (${detail})`);
      try {
        store.writeRun({
          ...run,
          status: "stopped",
          error: "clock_failed",
          updatedAt: now(),
        });
      } catch (stopError) {
        const stopDetail = stopError instanceof Error ? stopError.message : String(stopError);
        log(`workflows: run ${run.id} could not be stopped after failure (${stopDetail})`);
        store.suppressDue(run.id, now() + WORKFLOW_CLOCK_BACKOFF_MS);
      }
    }
  }
}
