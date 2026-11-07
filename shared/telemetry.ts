/** OpenTelemetry export settings (#2609), as the settings page sees them.
 * Header values are write-only: only their names ever come back. */
export interface TelemetrySettingsView {
  /** OTLP/HTTP collector base URL; null while export is off. */
  endpoint: string | null;
  /** Names of the saved headers (values never leave the server). */
  headerNames: string[];
  serviceName: string | null;
  /** Export is on: an endpoint is saved. */
  enabled: boolean;
}

export const TELEMETRY_PATH = "/api/telemetry";
