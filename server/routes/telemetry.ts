// OpenTelemetry export settings (#2609), Settings > General > Telemetry.
// Admin scope (server/auth/request-auth.ts: a route not opened to clients):
// the export sends the whole server's traces to one collector.
//
//   GET    /api/telemetry        { endpoint, headerNames, serviceName, enabled, stats }
//   PUT    /api/telemetry        { endpoint, headers?, serviceName? }: headers omitted keep
//                                the saved ones; a header sent with "" keeps its saved value
//   DELETE /api/telemetry        export off (the local span files stay)
//   POST   /api/telemetry/test   { endpoint?, headers? }: one test span, typed values or saved
//
// Header values are write-only: never in an answer, never logged.
import { TELEMETRY_PATH } from "../../shared/telemetry.ts";
import type { OtlpTarget, Tracer } from "../telemetry/otel.ts";
import { normalizeEndpoint, normalizeHeaders, TelemetrySettingsError, type TelemetrySettingsStore } from "../telemetry/settings-store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const TEST_PATH = `${TELEMETRY_PATH}/test`;

export interface TelemetryRouteDeps {
  store: TelemetrySettingsStore;
  tracer: Pick<Tracer, "test" | "stats">;
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function headersOf(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TelemetrySettingsError("headers must be an object of name: value.");
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, raw]) => [name, typeof raw === "string" ? raw : ""]));
}

export function createTelemetryRoutes(deps: TelemetryRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== TELEMETRY_PATH && path !== TEST_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    try {
      if (path === TEST_PATH) {
        if (method !== "POST") return PASS;
        const body = bodyObject(await readBody(req).catch(() => ({}))) ?? {};
        const saved = deps.store.target();
        let target: OtlpTarget | null = saved;
        if (typeof body.endpoint === "string" && body.endpoint.trim()) {
          const typed = headersOf(body.headers) ?? {};
          // A header left empty is the saved one, when the address is the same.
          const merged = Object.fromEntries(Object.entries(typed).map(([name, value]) => [name, value || saved?.headers?.[name] || ""]).filter(([, value]) => value));
          target = { endpoint: normalizeEndpoint(body.endpoint), headers: body.headers === undefined ? saved?.headers ?? {} : normalizeHeaders(merged) };
        }
        if (!target) return json(res, 400, { error: "Enter the collector address first." });
        try {
          await deps.tracer.test(target);
        } catch (error) {
          return json(res, 502, { error: `The collector did not accept the test span: ${error instanceof Error ? error.message : String(error)}` });
        }
        return json(res, 200, { ok: true });
      }
      if (method === "GET") return json(res, 200, { ...deps.store.view(), stats: deps.tracer.stats() });
      if (method === "DELETE") {
        deps.store.remove();
        return json(res, 200, { ...deps.store.view(), stats: deps.tracer.stats() });
      }
      if (method === "PUT") {
        const body = bodyObject(await readBody(req).catch(() => undefined));
        if (!body || typeof body.endpoint !== "string") return json(res, 400, { error: "Send { endpoint, headers, serviceName }." });
        if (body.serviceName !== undefined && body.serviceName !== null && typeof body.serviceName !== "string") return json(res, 400, { error: "serviceName must be a string." });
        const view = deps.store.save({ endpoint: body.endpoint, ...(body.headers !== undefined ? { headers: headersOf(body.headers)! } : {}), ...(body.serviceName !== undefined ? { serviceName: body.serviceName as string | null } : {}) });
        return json(res, 200, { ...view, stats: deps.tracer.stats() });
      }
      return PASS;
    } catch (error) {
      if (error instanceof TelemetrySettingsError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
