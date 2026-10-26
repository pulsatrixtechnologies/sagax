// Teach by demonstration on the bot's whole computer (server/computer-teach.ts).
//
//   GET  /api/bots/:id/computer/teach  -> { recording, steps }
//   POST /api/bots/:id/computer/teach  { action: "start" }   -> { recording: true }
//                                      { action: "event", event } -> { ok, steps }
//                                      { action: "stop" }    -> { steps, recordedAt } | { expired: true }
//                                      { action: "discard" } -> { ok }
//
// event: { kind: "click", x, y } (fractions of the screen), { kind: "key",
// key: "Enter" | "Tab" | "Escape" } or { kind: "typing" }. Typed characters
// have no field to travel in. The bot's owner or an admin, while they hold
// control of its computer (start and events); 404 no_computer for a bot
// without a desktop. Same backends as the phone's input
// (routes/computer-input.ts). Admin scope for sessions.
import { z } from "zod";

import { FOCUSED_WINDOW_COMMAND, type ComputerTeachRecordings } from "../computer-teach.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { ComputerShell, ControlState } from "./computer-input.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerTeachRouteDeps<B> {
  bot: (id: string) => B | undefined;
  mayDrive: (auth: RequestAuth, bot: B) => boolean;
  control: (bot: B, controlLeaseId: string | undefined) => ControlState;
  shell: (bot: B) => ComputerShell | null;
  recordings: ComputerTeachRecordings;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/teach$/;
const fraction = z.number().finite().min(0).max(1);
const eventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: fraction, y: fraction }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Tab", "Escape"]) }).strict(),
  z.object({ kind: z.literal("typing") }).strict(),
]);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["start", "stop", "discard"]), controlLeaseId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal("event"), event: eventSchema, controlLeaseId: z.string().min(1).max(200).optional() }).strict(),
]);

/** One person: their session, or the computer's own person at loopback. */
function ownerOf(auth: RequestAuth): string {
  return auth.kind === "session" ? `session:${auth.session.id}` : "local-owner";
}

async function focusedWindow(shell: ComputerShell): Promise<string> {
  try {
    const out = await shell.run(FOCUSED_WINDOW_COMMAND);
    return out.ok ? out.stdout.split("\n", 1)[0] ?? "" : "";
  } catch {
    return "";
  }
}

export function createComputerTeachRoutes<B extends { id: string }>(deps: ComputerTeachRouteDeps<B>): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m) return PASS;
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "GET or POST only" });
    if (method === "POST" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    res.setHeader("cache-control", "private, no-store");
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (!deps.mayDrive(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can teach on its computer" });
    const owner = ownerOf(auth);

    if (method === "GET") {
      const recorder = deps.recordings.get(owner, bot.id);
      // control went back to the bot (or to someone else): the recording ends, unkept
      if (recorder && deps.control(bot, undefined) !== "held") {
        deps.recordings.discard(owner, bot.id);
        return json(res, 200, { recording: false, steps: 0, ended: "control_lost" });
      }
      return json(res, 200, { recording: Boolean(recorder), steps: recorder?.count ?? 0 });
    }

    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return json(res, 400, { error: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`, code: "invalid_teach" });
    }
    const body = parsed.data;
    if (body.action === "stop") {
      const done = deps.recordings.stop(owner, bot.id);
      return json(res, 200, done ?? { expired: true });
    }
    if (body.action === "discard") {
      deps.recordings.discard(owner, bot.id);
      return json(res, 200, { ok: true });
    }

    const shell = deps.shell(bot);
    if (!shell) return json(res, 404, { error: "This bot has no computer to teach on.", code: "no_computer" });
    const control = deps.control(bot, body.controlLeaseId);

    if (body.action !== "event") {
      if (control === "free") return json(res, 409, { error: "Take control of this computer first.", code: "no_control" });
      if (control === "other") return json(res, 409, { error: "Someone else holds control of this computer.", code: "control_lease" });
      deps.recordings.start(owner, bot.id);
      return json(res, 200, { recording: true });
    }
    const recorder = deps.recordings.get(owner, bot.id);
    if (!recorder) return json(res, 409, { error: "No recording is running.", code: "not_recording" });
    if (control !== "held") {
      deps.recordings.discard(owner, bot.id);
      return json(res, 409, { error: "Control of the computer went back to the bot: the recording ended.", code: "control_lost" });
    }
    if (!recorder.allowEvent()) return json(res, 429, { error: "Too many events at once.", code: "teach_rate" });
    if (recorder.full) return json(res, 200, { ok: true, steps: recorder.count, full: true });
    const event = body.event;
    if (event.kind === "click") {
      const window = recorder.takeWindowLookup() ? await focusedWindow(shell) : null;
      recorder.click({ x: event.x, y: event.y }, window);
    } else if (event.kind === "key") recorder.press(event.key);
    else recorder.typed();
    return json(res, 200, { ok: true, steps: recorder.count });
  };
}
