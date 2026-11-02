// Shared-computers HTTP (#1388 wave 4): desktop lease control and outbound
// lending connector. Post-gate only (ROUTES). Feature-off falls through so a
// probe cannot tell a disabled feature from a missing build.
//
//   POST /api/desktop/shared-computer-control
//   GET  /api/shared-computers
//   POST /api/shared-computers/connect|copy|:id/(poll|lease|result|disconnect)
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import { sharedComputerRegistration } from "../shared-computers.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface SharedComputersRouteDeps {
  lendingEnabled(): boolean;
  sharedComputersEnabled(): boolean;
  desktopManaged: boolean;
  environmentId: string;
  dataDir: string;
  identityKind: () => string;
  sessionsIsLive(sessionId: string): boolean;
  sessionLendingPrincipal(auth: RequestAuth): string | null;
  personKey(session: { email?: string; principalId?: string; userId?: string }): string;
  computerRefusal(kind: "thisComputer"): string | undefined;
  sharedComputerControl: {
    acquire(id: string): void;
    release(id: string): void;
    renew(id: string): boolean;
  };
  sharedComputers: {
    status(person: string | null): unknown;
    register(
      registration: z.infer<typeof sharedComputerRegistration>,
      owner: { session: string; person: string },
      secret: string,
    ): void;
    poll(id: string, sessionId: string, secret: string): Promise<unknown>;
    liveJob(id: string, sessionId: string, secret: string, jobId: string): unknown;
    complete(id: string, sessionId: string, secret: string, jobId: string, result: unknown): void;
    disconnect(id: string, sessionId: string, secret: string): void;
  };
  publishPersonalCopy(
    dataDir: string,
    input: {
      person: string;
      kind: "chrome" | "folder";
      name: string;
      at: number;
      files: Array<{ path: string; text: string }>;
    },
  ): Record<string, unknown>;
}

export function createSharedComputersRoutes(deps: SharedComputersRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "POST" && path === "/api/desktop/shared-computer-control" && (deps.sharedComputersEnabled() || deps.desktopManaged)) {
      if (auth.kind !== "loopback") return json(res, 403, { error: "Local desktop only" });
      const body = await readBody(req, 1024);
      if (!deps.sharedComputersEnabled() && !deps.desktopManaged) return json(res, 404, { error: `no route: ${method} ${path}` });
      if (!z.string().uuid().safeParse(body?.id).success || !["acquire", "release", "renew"].includes(body?.action)) {
        return json(res, 400, { error: "Invalid computer lease" });
      }
      if (body.action === "release") deps.sharedComputerControl.release(body.id);
      else if (body.action === "renew") return json(res, 200, { ok: true, renewed: deps.sharedComputerControl.renew(body.id) });
      else {
        const refusal = deps.computerRefusal("thisComputer");
        if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
        try {
          deps.sharedComputerControl.acquire(body.id);
        } catch (error) {
          const refused = error as Error & { status?: number; code?: string; holder?: string };
          if (refused.status !== 409) throw error;
          return json(res, 409, { error: refused.message, code: refused.code, ...(refused.holder ? { holder: refused.holder } : {}) });
        }
      }
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/shared-computers" && deps.lendingEnabled()) {
      return json(res, 200, { computers: deps.sharedComputers.status(deps.sessionLendingPrincipal(auth)) });
    }

    if (method === "POST" && path.startsWith("/api/shared-computers/") && deps.lendingEnabled()) {
      if (auth.kind !== "session") return json(res, 403, { error: "Pair this desktop first" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "JSON required" });
      const body = await readBody(req, 4_000_000);
      if (!deps.lendingEnabled()) return json(res, 404, { error: `no route: ${method} ${path}` });
      if (!deps.sessionsIsLive(auth.session.id)) return json(res, 401, { error: "Session ended" });
      const secret = String(req.headers["x-omb-computer-secret"] ?? "");
      if (path === "/api/shared-computers/connect") {
        const parsed = sharedComputerRegistration.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Invalid computer registration" });
        const registration = parsed.data;
        if (registration.environmentId !== deps.environmentId) {
          return json(res, 409, { error: "Workspace identity changed. Pair again before sharing this computer." });
        }
        if (deps.identityKind() === "perspicax" && !auth.session.principalId) {
          return json(res, 403, { error: "Sign in as a person to share your computer" });
        }
        deps.sharedComputers.register(registration, { session: auth.session.id, person: deps.personKey(auth.session) }, secret);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/shared-computers/copy") {
        const person = deps.personKey(auth.session);
        const kind = body?.kind;
        const name = body?.name;
        const incoming = Array.isArray(body?.files) ? body.files : null;
        if ((kind !== "chrome" && kind !== "folder") || typeof name !== "string" || !incoming) {
          return json(res, 400, { error: "Send kind, name, and files." });
        }
        try {
          const saved = deps.publishPersonalCopy(deps.dataDir, {
            person,
            kind,
            name,
            at: Date.now(),
            files: incoming.map((file: { path?: unknown; text?: unknown }) => ({
              path: String(file?.path ?? ""),
              text: String(file?.text ?? ""),
            })),
          });
          return json(res, 200, { ok: true, ...saved });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "The copy was refused." });
        }
      }
      const route = /^\/api\/shared-computers\/([\w-]+)\/(poll|lease|result|disconnect)$/.exec(path);
      if (!route) return json(res, 404, { error: "not found" });
      const [, id, action] = route;
      if (action === "poll") return json(res, 200, { job: await deps.sharedComputers.poll(id, auth.session.id, secret) });
      if (action === "lease") return json(res, 200, { active: deps.sharedComputers.liveJob(id, auth.session.id, secret, String(body?.jobId)) });
      if (action === "result") deps.sharedComputers.complete(id, auth.session.id, secret, String(body?.jobId), body?.result);
      if (action === "disconnect") deps.sharedComputers.disconnect(id, auth.session.id, secret);
      return json(res, 200, { ok: true });
    }

    return PASS;
  };
}
