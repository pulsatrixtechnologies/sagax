// OpenTelemetry export settings (server/routes/telemetry.ts, #2609). Header
// values go up once; what comes back only names the saved headers.
import { TELEMETRY_PATH, type TelemetrySettingsView } from "../../shared/telemetry.ts";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface TelemetryStats {
  queued: number;
  dropped: number;
  exported: number;
  failed: number;
}

export type TelemetryAnswer = TelemetrySettingsView & { stats?: TelemetryStats };

export interface TelemetryInput {
  endpoint: string;
  /** name: value; an empty value keeps the saved one. */
  headers?: Record<string, string>;
  serviceName?: string | null;
}

export async function loadTelemetry(api: Api): Promise<TelemetryAnswer> {
  return api<TelemetryAnswer>(TELEMETRY_PATH);
}

export async function saveTelemetry(api: Api, input: TelemetryInput): Promise<TelemetryAnswer> {
  return api<TelemetryAnswer>(TELEMETRY_PATH, { method: "PUT", body: JSON.stringify(input) });
}

export async function removeTelemetry(api: Api): Promise<TelemetryAnswer> {
  return api<TelemetryAnswer>(TELEMETRY_PATH, { method: "DELETE" });
}

/** One test span to the typed collector, or to the saved one when none is given. */
export async function testTelemetry(api: Api, input?: { endpoint: string; headers?: Record<string, string> }): Promise<{ ok: boolean }> {
  return api(`${TELEMETRY_PATH}/test`, { method: "POST", body: JSON.stringify(input ?? {}) });
}
