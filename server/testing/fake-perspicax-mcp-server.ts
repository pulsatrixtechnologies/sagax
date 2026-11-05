// Fake Perspicax MCP for the Sagax routine smoke suite (#2006).
// Streamable HTTP on loopback. Implements tools/list per role,
// identity_switch, and flow / flow_run with the Flow server-mode contract:
// run.init by name + server_profiles, plan with inline JSON, read allowlist,
// run.finish, and one live lease per routine (keyed by bot from clientInfo).
// Neutral sample names only (Osprey, Wren).
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type PerspicaxRole = "dispatch" | "invoices" | "meetings" | "interactive";

export interface FakePerspicaxRoutine {
  /** Perspicax profile slugs allowed to run this routine (server_profiles). */
  server_profiles: string[];
  /** Read tools the plan must name when check is set; missing → missing_reads. */
  read_allowlist?: string[];
}

export interface FakePerspicaxProfile {
  id: string;
  slug: string;
  name: string;
  role: PerspicaxRole;
  /** Extra tool names beyond the role defaults. */
  tools?: string[];
}

export interface FakePerspicaxMcpOptions {
  profiles?: FakePerspicaxProfile[];
  routines?: Record<string, FakePerspicaxRoutine>;
  /** Next run.init answers already_running (once). */
  alreadyRunningOnce?: boolean;
  /** Plan answers this failure (every plan until cleared). */
  planError?: { code: string; message: string } | null;
  /** Named write tools that answer HTTP-style 403 structured content. */
  writeForbidden?: Record<string, string>;
  /** Refuse identity_switch for this slug. */
  identityRefuse?: string;
}

export interface FlowCall {
  profile: string;
  botId: string | null;
  command: string;
  args: Record<string, unknown>;
  at: number;
}

export interface FakePerspicaxLease {
  runId: string;
  routine: string;
  profile: string;
  botId: string | null;
  shadow: boolean;
  until: number;
}

const ROLE_TOOLS: Record<PerspicaxRole, string[]> = {
  dispatch: ["identity_switch", "flow", "flow_run", "api_list", "cw_psa_query"],
  invoices: ["identity_switch", "flow", "flow_run", "api_list", "cw_psa_finance_invoices_query", "cw_psa_finance_invoices_write"],
  meetings: ["identity_switch", "flow", "flow_run", "api_list", "calendar_events_query", "calendar_events_write"],
  interactive: ["identity_switch", "flow", "flow_run", "api_list", "ask_choice"],
};

const DEFAULT_PROFILES: FakePerspicaxProfile[] = [
  { id: "pf-dispatch", slug: "dispatch-agent", name: "Dispatch", role: "dispatch" },
  { id: "pf-invoices", slug: "invoices-agent", name: "Invoices", role: "invoices" },
  { id: "pf-meetings", slug: "meetings-agent", name: "Meetings", role: "meetings" },
];

const DEFAULT_ROUTINES: Record<string, FakePerspicaxRoutine> = {
  "morning-dispatch": { server_profiles: ["dispatch-agent"], read_allowlist: ["cw_psa_query"] },
  "invoice-status-watch": { server_profiles: ["invoices-agent"], read_allowlist: ["cw_psa_finance_invoices_query"] },
  "meetings-close": { server_profiles: ["meetings-agent"], read_allowlist: ["calendar_events_query"] },
};

interface Session {
  id: string;
  profile: string;
  botId: string | null;
  identity: string | null;
}

function botFromClientInfo(info: unknown): string | null {
  if (!info || typeof info !== "object") return null;
  const name = (info as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  // Business turn: "Pulsa Bot (osprey)". Readiness probe (#1991):
  // "Sagax Flow check (osprey; morning-dispatch; <uuid>)".
  const business = /^Pulsa Bot \((.+)\)$/.exec(name);
  if (business?.[1]) return business[1];
  const check = /^Sagax Flow check \(([^;]+);/.exec(name);
  return check?.[1]?.trim() || null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toolSchema(name: string): Record<string, unknown> {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    ...(name === "identity_switch" || name === "flow" || name.endsWith("_query") || name === "api_list"
      ? { annotations: { readOnlyHint: true } }
      : {}),
  };
}

export interface FakePerspicaxMcp {
  url: string;
  calls: FlowCall[];
  toolCalls: Array<{ name: string; args: Record<string, unknown>; profile: string; botId: string | null }>;
  leases: () => FakePerspicaxLease[];
  setPlanError(error: { code: string; message: string } | null): void;
  setAlreadyRunningOnce(value: boolean): void;
  setWriteForbidden(map: Record<string, string>): void;
  close(): Promise<void>;
}

export async function startFakePerspicaxMcp(options: FakePerspicaxMcpOptions = {}): Promise<FakePerspicaxMcp> {
  const profiles = new Map((options.profiles ?? DEFAULT_PROFILES).map((p) => [p.id, p] as const));
  const bySlug = new Map([...profiles.values()].map((p) => [p.slug, p] as const));
  const routines = { ...DEFAULT_ROUTINES, ...options.routines };
  let planError = options.planError ?? null;
  let alreadyRunningOnce = options.alreadyRunningOnce === true;
  let writeForbidden = { ...options.writeForbidden };
  const identityRefuse = options.identityRefuse;
  const sessions = new Map<string, Session>();
  const leases = new Map<string, FakePerspicaxLease>();
  const calls: FlowCall[] = [];
  const toolCalls: FakePerspicaxMcp["toolCalls"] = [];
  let serial = 0;

  const toolsFor = (profile: FakePerspicaxProfile): string[] =>
    [...new Set([...(ROLE_TOOLS[profile.role] ?? []), ...(profile.tools ?? [])])];

  const leaseKey = (routine: string) => `routine:${routine}`;

  const answerFlow = (session: Session, command: string, args: Record<string, unknown>): { value: unknown; isError?: boolean } => {
    const profile = profiles.get(session.profile) ?? bySlug.get(session.profile);
    const slug = profile?.slug ?? session.profile;
    calls.push({ profile: slug, botId: session.botId, command, args, at: Date.now() });

    if (command === "run.init") {
      const routine = typeof args.routine === "string" ? args.routine : undefined;
      const shadow = args.shadow === true;
      if (!routine) {
        return { value: { status: "failed", output: { ok: false, error: "routine_required", message: "name the routine in args.routine" } }, isError: true };
      }
      const declared = routines[routine];
      if (!declared) {
        return { value: { status: "failed", output: { ok: false, error: "routine_not_in_pack", message: `the routine ${routine} is not in the pack` } }, isError: true };
      }
      // Shadow readiness uses the account's main MCP connection (#1991): it
      // never selects a bot profile, so server_profiles is not checked there.
      // A business run.init still requires the profile in server_profiles.
      const accountSession = session.profile === "account" || shadow;
      if (!accountSession && !declared.server_profiles.includes(slug)) {
        return {
          value: {
            status: "failed",
            output: {
              ok: false,
              error: "routine_not_for_profile",
              message: `the routine ${routine} of the pack does not declare this profile in server_profiles`,
            },
          },
          isError: true,
        };
      }
      if (alreadyRunningOnce) {
        alreadyRunningOnce = false;
        const live = [...leases.values()][0];
        return { value: { status: "blocked", reason: "already_running", run: { run_id: live?.runId ?? "live-run" } } };
      }
      const key = leaseKey(routine);
      const held = leases.get(key);
      if (held && held.until > Date.now()) {
        return { value: { status: "blocked", reason: "already_running", run: { run_id: held.runId } } };
      }
      const runId = `run-${++serial}-${randomBytes(3).toString("hex")}`;
      leases.set(key, {
        runId,
        routine,
        profile: slug,
        botId: session.botId,
        shadow,
        until: Date.now() + 5 * 60_000,
      });
      return { value: { status: "ok", run_id: runId, ok: true } };
    }

    if (command === "plan") {
      const runId = typeof args.run_id === "string" ? args.run_id : undefined;
      const held = [...leases.values()].find((lease) => lease.runId === runId) ?? [...leases.values()][0];
      if (!held) {
        return { value: { status: "failed", output: { ok: false, error: "no_run", message: "no live run for plan" } }, isError: true };
      }
      held.until = Date.now() + 5 * 60_000;
      if (planError) {
        return { value: { status: "failed", output: { ok: false, error: planError.code, message: planError.message } }, isError: true };
      }
      const declared = routines[held.routine];
      const reads = declared?.read_allowlist ?? [];
      if (reads.length && args.check === true) {
        const named = Array.isArray(args.reads) ? args.reads.map(String) : [];
        const missing = reads.filter((name) => !named.includes(name));
        if (missing.length) {
          return {
            value: { status: "failed", output: { ok: false, error: "missing_reads", message: `Read the selected units first: ${missing.join(", ")}` } },
            isError: true,
          };
        }
      }
      return { value: { status: "ok", ok: true, units: args.units ?? [] } };
    }

    // `release` frees a shadow readiness lease without Flow's business close
    // (probeFlowReadiness). `run.finish` / `run.close` end a business run.
    if (command === "run.finish" || command === "run.close" || command === "release") {
      const runId = typeof args.run_id === "string" ? args.run_id : undefined;
      const routine = typeof args.routine === "string" ? args.routine : undefined;
      for (const [key, lease] of leases) {
        if (runId && lease.runId !== runId) continue;
        if (routine && lease.routine !== routine) continue;
        if (!runId && !routine && command === "release") continue;
        leases.delete(key);
        return { value: { status: "ok", ok: true } };
      }
      if (command === "release") {
        return { value: { status: "failed", reason: "run_not_yours", detail: "Nothing was released." }, isError: true };
      }
      return { value: { status: "failed", output: { ok: false, error: "pass_missing", message: "A pass line is missing." } }, isError: true };
    }

    if (command === "renew" || command === "status") {
      const held = [...leases.values()][0];
      if (!held) return { value: { status: "ok", ok: true, live: false } };
      held.until = Date.now() + 5 * 60_000;
      return { value: { status: "ok", ok: true, live: true, run_id: held.runId, routine: held.routine } };
    }

    return { value: { status: "ok", ok: true, command } };
  };

  const answerTool = (session: Session, name: string, args: Record<string, unknown>): { result: unknown; isError?: boolean } => {
    toolCalls.push({ name, args, profile: session.profile, botId: session.botId });
    if (name === "identity_switch") {
      if (args.clear === true) {
        session.identity = null;
        return { result: { content: [{ type: "text", text: "cleared" }], structuredContent: { cleared: true } } };
      }
      if (typeof args.profile === "string") {
        if (identityRefuse && args.profile === identityRefuse) {
          return { result: { isError: true, content: [{ type: "text", text: "switch_not_consented" }], structuredContent: { error: "switch_not_consented" } }, isError: true };
        }
        session.identity = args.profile;
        return {
          result: {
            content: [{ type: "text", text: JSON.stringify({ acting_as: { slug: args.profile } }) }],
            structuredContent: { acting_as: { slug: args.profile, token: { expires_at: new Date(Date.now() + 5 * 60_000).toISOString() } } },
          },
        };
      }
      // List held identities.
      return {
        result: {
          content: [{ type: "text", text: "profiles" }],
          structuredContent: { profiles: [...bySlug.values()].map((p) => ({ slug: p.slug, name: p.name })) },
        },
      };
    }
    if (name === "flow_run" || name === "flow") {
      const command = typeof args.command === "string" ? args.command : "";
      const callArgs = isObject(args.args) ? args.args : {};
      const answered = answerFlow(session, command, callArgs);
      return {
        result: {
          ...(answered.isError ? { isError: true } : {}),
          content: [{ type: "text", text: JSON.stringify(answered.value) }],
          structuredContent: answered.value,
        },
        isError: answered.isError,
      };
    }
    if (writeForbidden[name]) {
      return {
        result: {
          isError: true,
          content: [{ type: "text", text: writeForbidden[name] }],
          structuredContent: { ok: false, error: "forbidden", status: 403, message: writeForbidden[name] },
        },
        isError: true,
      };
    }
    if (name.endsWith("_query") || name === "api_list" || name === "cw_psa_query") {
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true, items: [{ id: 42, subject: "Osprey review" }] }) }],
          structuredContent: { ok: true, items: [{ id: 42, subject: "Osprey review" }] },
        },
      };
    }
    if (name.endsWith("_write")) {
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true, written: true }) }],
          structuredContent: { ok: true, written: true },
        },
      };
    }
    return { result: { content: [{ type: "text", text: `ok:${name}` }] } };
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => resolve(raw));
      req.on("error", reject);
    });

  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"];
        if (typeof sessionId === "string") sessions.delete(sessionId);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const raw = await readBody(req);
      let frame: Record<string, unknown> = {};
      try {
        frame = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not JSON" }));
        return;
      }
      const method = typeof frame.method === "string" ? frame.method : "";
      const id = frame.id;
      const sessionHeader = req.headers["mcp-session-id"];
      let session = typeof sessionHeader === "string" ? sessions.get(sessionHeader) : undefined;

      if (method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }

      if (method === "initialize") {
        const profileHeader = req.headers["x-perspicax-profile"];
        // "account": the person's main Perspicax connection (readiness, #1991).
        const profileId = typeof profileHeader === "string" && (profileHeader === "account" || profiles.has(profileHeader))
          ? profileHeader
          : [...profiles.keys()][0]!;
        const sessionId = `sess-${randomBytes(6).toString("hex")}`;
        session = {
          id: sessionId,
          profile: profileId,
          botId: botFromClientInfo(isObject(frame.params) ? frame.params.clientInfo : undefined),
          identity: null,
        };
        sessions.set(sessionId, session);
        const result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-perspicax", version: "1" },
        };
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": sessionId });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        return;
      }

      if (!session) {
        // Accept a bearer-only call by minting a session from Authorization profile hint.
        const auth = req.headers.authorization ?? "";
        const profileMatch = /profile=([a-zA-Z0-9_-]+)/.exec(auth);
        const profileId = (profileMatch && profiles.has(profileMatch[1]!) ? profileMatch[1]! : [...profiles.keys()][0])!;
        const sessionId = typeof sessionHeader === "string" ? sessionHeader : `sess-${randomBytes(6).toString("hex")}`;
        session = sessions.get(sessionId) ?? { id: sessionId, profile: profileId, botId: null, identity: null };
        sessions.set(sessionId, session);
      }

      const accountTools = ["identity_switch", "flow", "flow_run", "api_list"];
      const profile = profiles.get(session.profile);
      let result: unknown = {};
      if (method === "tools/list") {
        const names = session.profile === "account" || !profile
          ? accountTools
          : toolsFor(profile);
        result = { tools: names.map(toolSchema) };
      } else if (method === "tools/call") {
        const params = isObject(frame.params) ? frame.params : {};
        const name = typeof params.name === "string" ? params.name : "";
        const args = isObject(params.arguments) ? params.arguments : {};
        const answered = answerTool(session, name, args);
        result = answered.result;
      }

      const headers: Record<string, string> = { "content-type": "application/json", "mcp-session-id": session.id };
      res.writeHead(200, headers);
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "error" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/mcp`;

  return {
    url,
    calls,
    toolCalls,
    leases: () => [...leases.values()],
    setPlanError: (error) => {
      planError = error;
    },
    setAlreadyRunningOnce: (value) => {
      alreadyRunningOnce = value;
    },
    setWriteForbidden: (map) => {
      writeForbidden = { ...map };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
    },
  };
}

/** Direct JSON-RPC client against the fake (no PerspicaxMcp). */
export async function callFakePerspicax(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  session?: { id?: string; profileId?: string; botId?: string },
): Promise<{ result?: unknown; error?: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer fixture-mcp",
  };
  if (session?.id) headers["mcp-session-id"] = session.id;
  if (session?.profileId) headers["x-perspicax-profile"] = session.profileId;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (method !== "notifications/initialized") body.id = `client-${Date.now()}`;
  if (method === "initialize") {
    body.params = {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: session?.botId ? `Pulsa Bot (${session.botId})` : "Pulsa Bot (osprey)", version: "0.0.0-smoke" },
      ...params,
    };
  }
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const sessionId = response.headers.get("mcp-session-id");
  if (method === "notifications/initialized") return { sessionId };
  const text = await response.text();
  const parsed = JSON.parse(text.includes("data: ") ? text.trim().split("data: ").at(-1)! : text) as { result?: unknown; error?: unknown };
  return { ...parsed, sessionId };
}
