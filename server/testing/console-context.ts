// A console route context for unit tests of the org admin areas
// (server/org/org-admin-*.ts): the viewer, the reach, the body, the records.
import type { ConsoleAuditEntry, ConsoleContext, ConsoleRoute } from "../org/org-admin-console.ts";
import { compileRoutes, ConsoleRefusal, matchRoutes } from "../org/org-admin-console.ts";
import type { ConsoleRole } from "../org/org-admin-routes.ts";

export interface FakeConsole {
  call(method: "GET" | "POST", path: string, input?: { role?: ConsoleRole; principalId?: string; reach?: string[] | null; body?: unknown; locale?: "en" | "fr"; request?: unknown; headers?: Record<string, string>; teams?: ConsoleContext["viewer"]["teams"]; ownOnly?: boolean }): Promise<{ status: number; body: any; raw?: Buffer; headers?: Record<string, string> }>;
  records: ConsoleAuditEntry[];
}

export function fakeConsole(routes: ConsoleRoute[], now = () => Date.now()): FakeConsole {
  const compiled = compileRoutes(routes);
  const records: ConsoleAuditEntry[] = [];
  return {
    records,
    async call(method, path, input = {}) {
      const url = new URL(`http://x/api/org/admin/${path}`);
      const sub = url.pathname.slice("/api/org/admin/".length);
      const hit = matchRoutes(compiled, url.searchParams.get("scope") === "org" && sub === "approvals" ? "approvals?scope=org" : sub).find((candidate) => candidate.route.method === method);
      if (!hit) return { status: 404, body: { code: "not_found" } };
      const reach = input.reach === undefined ? null : input.reach ? new Set(input.reach) : null;
      const principalId = input.principalId ?? "pr_admin";
      const ctx: ConsoleContext = {
        viewer: { principalId, sub: "sub", name: "Viewer", role: input.role ?? "admin", orgAdmin: (input.role ?? "admin") === "admin", teams: input.teams ?? [] },
        locale: input.locale ?? "en",
        url,
        params: hit.params,
        ...(input.headers ? { headers: input.headers } : {}),
        body: input.body ?? null,
        ...(input.request ? { request: input.request as ConsoleContext["request"] } : {}),
        reach,
        managedTeams: new Set((input.teams ?? []).filter((team) => team.manager).map((team) => team.id)),
        inReach: (id) => !reach || (id ? reach.has(id) : false),
        botVisible: (facts) => !reach || reach.has(facts.ownerPrincipalId) || facts.grantTargets.some((target) => target.startsWith("user:") && reach.has(target.slice(5))),
        record: (entry) => records.push(entry),
        now,
        ...(input.ownOnly ? { ownOnly: true } : {}),
      };
      try {
        const answer = await hit.route.handle(ctx);
        if (answer.stream) {
          const chunks: Buffer[] = [];
          await answer.stream(async (chunk) => { chunks.push(chunk); });
          return { status: answer.status, body: answer.body as any, raw: Buffer.concat(chunks) };
        }
        if (answer.raw !== undefined) return { status: answer.status, body: answer.body as any, raw: Buffer.from(answer.raw), ...(answer.headers ? { headers: answer.headers } : {}) };
        return { status: answer.status, body: answer.body as any, ...(answer.headers ? { headers: answer.headers } : {}) };
      } catch (error) {
        // as server/org/org-admin-routes.ts answers a thrown refusal
        if (error instanceof ConsoleRefusal) return { status: error.status, body: { code: error.code, message: error.message, reason: error.message } };
        throw error;
      }
    },
  };
}
