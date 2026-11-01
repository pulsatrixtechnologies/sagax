/**
 * Shape avatar generate (v2.1): ask the bot's text model for a validated
 * geometry definition JSON. Public editor route and internal tool route.
 *
 *   POST /api/bots/:id/shape-avatar/generate   { direction } -> { def, source }
 *   POST /api/internal/shape-avatar/generate   { direction, botId? } -> { def, source }
 *
 * Never calls a real provider from unit tests: deps.generate is injected
 * (fake engine / FAKE_CLAUDE_TEXT_ROUTES in e2e). On missing engine or
 * invalid model answers (retry once), falls back to the preset mapping.
 */
import { z } from "zod";

import {
  generateShapeAvatarDefWithModel,
  SHAPE_AVATAR_DIRECTION_MAX,
  type ShapeTextEngine,
} from "../../shared/shape-avatar-generate.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Generate = NonNullable<ShapeTextEngine["generateText"]>;

const PUBLIC_PATH = /^\/api\/bots\/([\w-]{1,128})\/shape-avatar\/generate$/;
const INTERNAL_PATH = "/api/internal/shape-avatar/generate";

const bodySchema = z.object({
  direction: z.string().min(1).max(SHAPE_AVATAR_DIRECTION_MAX),
}).strict();

const internalBodySchema = z.object({
  direction: z.string().min(1).max(SHAPE_AVATAR_DIRECTION_MAX),
  botId: z.string().min(1).max(128).optional(),
}).strict();

export interface ShapeAvatarGenerateRouteDeps {
  bot(id: string): { id: string } | undefined;
  /** Whether this caller may change that bot's look (owner / admin). */
  mayChange(auth: RequestAuth, botId: string): boolean;
  /** Bot one-shot when its model may be asked now; null otherwise. */
  generate(botId: string): Generate | null;
  timeoutMs?: number;
}

export interface ShapeAvatarGenerateInternalDeps {
  /** Capability bot's one-shot, or a named botId when the body supplies one. */
  generate(botId: string): Generate | null;
  timeoutMs?: number;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timed out"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runGenerate(
  direction: string,
  generate: Generate | null,
  timeoutMs: number,
): Promise<{ def: unknown; source: "model" | "fallback" }> {
  const engine: ShapeTextEngine | null = generate
    ? {
        generateText: (prompt, options) =>
          withTimeout((signal) => generate(prompt, { ...options, signal }), timeoutMs),
      }
    : null;
  const result = await generateShapeAvatarDefWithModel(direction, engine);
  return { def: result.def, source: result.source };
}

/** Editor / person: POST /api/bots/:id/shape-avatar/generate */
export function createShapeAvatarGenerateRoutes(deps: ShapeAvatarGenerateRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = PUBLIC_PATH.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST" });
    const botId = match[1]!;
    const bot = deps.bot(botId);
    if (!bot) return json(res, 404, { error: "bot not found" });
    if (!deps.mayChange(auth, botId)) return json(res, 403, { error: "not allowed" });
    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return json(res, 400, { error: `send { direction } (1..${SHAPE_AVATAR_DIRECTION_MAX} chars)` });
    }
    const out = await runGenerate(parsed.data.direction, deps.generate(botId), deps.timeoutMs ?? 45_000);
    return json(res, 200, out);
  };
}

/** Bot tool proxy: POST /api/internal/shape-avatar/generate */
export function createShapeAvatarGenerateInternalRoutes(deps: ShapeAvatarGenerateInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== INTERNAL_PATH) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const parsed = internalBodySchema.safeParse(await readBody());
    if (!parsed.success) {
      return json(res, 400, { error: `send { direction } (1..${SHAPE_AVATAR_DIRECTION_MAX} chars)` });
    }
    // A bot generates with its own model only: never another bot's provider account.
    const botId = capability.botId;
    const out = await runGenerate(parsed.data.direction, deps.generate(botId), deps.timeoutMs ?? 45_000);
    return json(res, 200, out);
  };
}
