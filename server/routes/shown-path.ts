// A path shown once (shared/shown-path.ts): preview, save as a disabled
// skill, or refuse. A name the bot already has is not replaced unless
// `replace` is true. Other skills, including uploaded ones, are not touched.
//
//   POST /api/bots/:id/shown-path
//   { mode: "preview" | "save" | "refuse", title, description?, steps, recordedAt?, replace?, replay? }
//   replay ("background" | "my-chrome"): a path shown in the person's own
//   Chrome (server/browser/my-chrome/recorder.ts), and where it is replayed.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { planShownPath, type ShownPathMode } from "../../shared/shown-path.ts";
import type { TeachStep, TeachStepKind } from "../../shared/teach-recording.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BODY_MAX = 256 * 1024;
const KINDS = ["open", "click", "type", "press", "back", "forward", "reload", "tab", "note"] as const satisfies readonly TeachStepKind[];

const stepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.enum(KINDS),
  url: z.string().max(2_000).optional(),
  text: z.string().max(500).optional(),
  secret: z.boolean().optional(),
  key: z.string().max(20).optional(),
  screen: z.boolean().optional(),
  window: z.string().max(120).optional(),
  point: z.object({ x: z.number(), y: z.number() }).optional(),
  target: z.object({
    role: z.string().max(40),
    name: z.string().max(120),
    tag: z.string().max(20),
    selector: z.string().max(200).optional(),
  }).optional(),
}).strict();

const bodySchema = z.object({
  mode: z.enum(["preview", "save", "refuse"]),
  title: z.string().max(80).default(""),
  description: z.string().max(300).optional(),
  steps: z.array(stepSchema).max(200).default([]),
  recordedAt: z.string().max(40).optional(),
  replace: z.boolean().optional(),
  replay: z.enum(["background", "my-chrome"]).optional(),
}).strict();

export interface ShownPathDeps {
  bot(id: string): { id: string } | null | undefined;
  refusal(auth: RequestAuth, botId: string): { status: number; body: Record<string, unknown> } | null;
  existingNames(botId: string): string[];
  install(botId: string, source: string, files: Array<{ path: string; content: string }>): { name: string } | { error: string };
  /** Removes that one skill. Called only after the person agreed to replace it. */
  remove(botId: string, name: string): { removed: true } | { error: string };
  audit?(auth: RequestAuth, req: IncomingMessage, row: { botId: string; name: string; replaced: boolean }): void;
}

export function createShownPathRoutes(deps: ShownPathDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = /^\/api\/bots\/([\w-]+)\/shown-path$/.exec(path);
    if (!match || method !== "POST") return PASS;
    const botId = match[1]!;
    if (!deps.bot(botId)) return json(res, 404, { error: "no such bot" });
    const refused = deps.refusal(auth, botId);
    if (refused) return json(res, refused.status, refused.body);
    let raw: unknown;
    try {
      raw = await readBody(req, BODY_MAX);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 413) return json(res, 413, { error: "A shown path is at most 256 KB.", code: "too-large" });
      throw error;
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json(res, 400, { error: "send { mode: preview, save or refuse, title, steps }" });
    const body = parsed.data;
    const plan = planShownPath({
      title: body.title,
      description: body.description,
      steps: body.steps as TeachStep[],
      recordedAt: body.recordedAt,
      replace: body.replace,
      ...(body.replay ? { replay: body.replay } : {}),
    }, body.mode as ShownPathMode, new Set(deps.existingNames(botId)));
    if (plan.action === "invalid") return json(res, 400, { error: plan.error, code: "invalid" });
    if (plan.action === "refused") return json(res, 200, { ok: true, refused: true });
    if (plan.action === "preview") return json(res, 200, { ok: true, name: plan.name, markdown: plan.markdown, exists: plan.exists });
    if (plan.action === "needs-agreement") return json(res, 200, { ok: false, code: "exists", name: plan.name });
    if (plan.replace) {
      const removed = deps.remove(botId, plan.name);
      if ("error" in removed) return json(res, 422, { error: removed.error, code: "replace" });
    }
    const installed = deps.install(botId, "shown-path", [{ path: "SKILL.md", content: plan.markdown }]);
    if ("error" in installed) return json(res, 422, { error: installed.error, code: "install" });
    try {
      deps.audit?.(auth, req, { botId, name: installed.name, replaced: plan.replace });
    } catch {
      // an audit row never undoes the skill it records
    }
    return json(res, 201, { ok: true, installed: installed.name, replaced: plan.replace });
  };
}
