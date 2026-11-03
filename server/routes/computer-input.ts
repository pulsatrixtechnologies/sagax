// The phone drives a bot's computer while the person holds control
// (server/computer/computer-input.ts has the event model and the commands).
//
//   POST /api/bots/:id/computer/input      { events: [...], controlLeaseId? } -> { ok, applied }
//   GET  /api/bots/:id/computer/clipboard  ?controlLeaseId=                   -> { text }
//   PUT  /api/bots/:id/computer/clipboard  { text, controlLeaseId? }          -> { ok }
//
// The bot's owner or an admin only (the owner at this computer, the paired
// phone included), and only while they hold control (POST .../computer/control
// take): 409 `no_control` otherwise, or `control_lease` when someone else's
// lease holds it. 404 `no_computer` when the bot has no desktop to drive.
// Admin scope for sessions (request-auth.ts lists none of these for clients);
// the companion lists them behind the per-phone desktop capability. Each
// batch is audited as counts by event type, never the typed text.
import type { IncomingMessage } from "node:http";

import {
  batchCommands,
  clipboardBodySchema,
  clipboardWriteCommands,
  CLIPBOARD_READ_COMMAND,
  computerInputBodySchema,
  decodeClipboard,
  inputCommands,
  inputSummary,
} from "../computer/computer-input.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerShellResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
}

export interface ComputerShell {
  /** cloud, team, vps or vm: for the audit and errors. */
  kind: string;
  /** Run one script on the desktop's X11 session, as its desktop user. */
  run: (script: string) => Promise<ComputerShellResult>;
  /** Longest script the backend takes in one call. */
  maxScript: number;
}

export type ControlState = "held" | "free" | "other";

export interface ComputerInputRouteDeps<B> {
  bot: (id: string) => B | undefined;
  mayDrive: (auth: RequestAuth, bot: B) => boolean;
  /** Whether the person holds control of this bot's computer, with this lease when one is given. */
  control: (bot: B, controlLeaseId: string | undefined) => ControlState;
  /** The desktop to drive, or null when the bot has none. */
  shell: (bot: B) => ComputerShell | null;
  audit: (auth: RequestAuth, req: IncomingMessage, bot: B, action: "input" | "clipboard.read" | "clipboard.write", detail: Record<string, unknown>) => void;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/(input|clipboard)$/;

function failure(error: unknown): { status: number; body: Record<string, unknown> } {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof status === "number" && status >= 400 && status < 500) return { status, body: { error: message } };
  return { status: 502, body: { error: `The computer did not take the input: ${message}`.slice(0, 300), code: "computer_unavailable" } };
}

export function createComputerInputRoutes<B>(deps: ComputerInputRouteDeps<B>): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m) return PASS;
    const [, botId, action] = m;
    const allowed = action === "input" ? ["POST"] : ["GET", "PUT"];
    if (!allowed.includes(method)) return json(res, 405, { error: `${allowed.join(" or ")} only` });
    // JSON only, like every other computer mutation: a form cannot post it.
    if (method !== "GET" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    res.setHeader("cache-control", "private, no-store");
    const bot = deps.bot(botId!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (!deps.mayDrive(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can control its computer", code: "bot_computer_control_owner_only" });

    let body: Record<string, unknown> = {};
    if (method !== "GET") {
      const raw = await readBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(res, 400, { error: "body must be a JSON object" });
      body = raw as Record<string, unknown>;
    }
    const parsedInput = action === "input" ? computerInputBodySchema.safeParse(body) : null;
    const parsedClipboard = action === "clipboard" && method === "PUT" ? clipboardBodySchema.safeParse(body) : null;
    const invalid = parsedInput && !parsedInput.success ? parsedInput.error : parsedClipboard && !parsedClipboard.success ? parsedClipboard.error : null;
    if (invalid) {
      const issue = invalid.issues[0];
      return json(res, 400, { error: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`, code: "invalid_input" });
    }
    const leaseId = parsedInput?.data?.controlLeaseId ?? parsedClipboard?.data?.controlLeaseId ?? (url.searchParams.get("controlLeaseId") || undefined);

    const shell = deps.shell(bot);
    if (!shell) return json(res, 404, { error: "This bot has no computer to control.", code: "no_computer" });
    const control = deps.control(bot, leaseId);
    if (control === "free") return json(res, 409, { error: "Take control of this computer first.", code: "no_control" });
    if (control === "other") return json(res, 409, { error: "Someone else holds control of this computer.", code: "control_lease" });

    try {
      if (parsedInput?.success) {
        const built = inputCommands(parsedInput.data.events);
        if (!built.ok) return json(res, 400, { error: built.error, code: "invalid_input" });
        for (const script of batchCommands(built.commands, shell.maxScript)) {
          const out = await shell.run(script);
          if (!out.ok) return json(res, 502, { error: "The computer did not take the input.", code: "input_failed" });
        }
        deps.audit(auth, req, bot, "input", { computer: shell.kind, events: inputSummary(parsedInput.data.events) });
        return json(res, 200, { ok: true, applied: parsedInput.data.events.length });
      }
      if (method === "GET") {
        const out = await shell.run(CLIPBOARD_READ_COMMAND);
        if (!out.ok) return json(res, 502, { error: "The computer's clipboard could not be read.", code: "clipboard_failed" });
        const text = decodeClipboard(out.stdout);
        deps.audit(auth, req, bot, "clipboard.read", { computer: shell.kind, bytes: Buffer.byteLength(text, "utf8") });
        return json(res, 200, { text });
      }
      const text = parsedClipboard!.data!.text;
      for (const script of batchCommands(clipboardWriteCommands(text), shell.maxScript)) {
        const out = await shell.run(script);
        if (!out.ok) return json(res, 502, { error: "The computer's clipboard could not be set.", code: "clipboard_failed" });
      }
      deps.audit(auth, req, bot, "clipboard.write", { computer: shell.kind, bytes: Buffer.byteLength(text, "utf8") });
      return json(res, 200, { ok: true });
    } catch (error) {
      const failed = failure(error);
      return json(res, failed.status, failed.body);
    }
  };
}

// ── screenshots of a Local VM bot ─────────────────────────────────────────
// POST /api/bots/:id/computer/screenshot answers for cloud computers further
// down (server/index.ts). A bot whose computer is the Local VM gets its frame
// here, in the same `{ png, format }` shape, so the phone's viewer can refresh
// the picture while the person drives it. Every other bot passes through.

export interface VmScreenshotRouteDeps<B> {
  bot: (id: string) => B | undefined;
  /** True when this bot's computer is a Local VM this server may show. */
  isLocalVm: (bot: B) => boolean;
  mayDrive: (auth: RequestAuth, bot: B) => boolean;
  /** The organization-server refusal, when this server never runs a VM. */
  refusal: () => string | undefined;
  frame: (bot: B) => Promise<{ png: string; format: string }>;
}

const SCREENSHOT_ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/screenshot$/;

export function createVmScreenshotRoute<B>(deps: VmScreenshotRouteDeps<B>): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    const m = SCREENSHOT_ROUTE.exec(path);
    if (!m || method !== "POST") return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot || !deps.isLocalVm(bot)) return PASS;
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    if (!deps.mayDrive(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can see its computer", code: "bot_computer_view_owner_only" });
    const refusal = deps.refusal();
    if (refusal) return json(res, 404, { error: refusal, code: "no_computer" });
    res.setHeader("cache-control", "private, no-store");
    try {
      return json(res, 200, await deps.frame(bot));
    } catch (error) {
      const failed = failure(error);
      return json(res, failed.status, failed.body);
    }
  };
}
