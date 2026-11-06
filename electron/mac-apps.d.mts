export type MacAppId = "messages" | "mail" | "calendar" | "contacts" | "reminders" | "notes";
export type MacAppPermission = "granted" | "denied" | "unknown" | "notAsked" | "unsupported";

export interface MacAppInfo {
  id: MacAppId;
  name: string;
  bundleId: string;
  fullDiskAccess: boolean;
}

export interface MacAppTool {
  name: string;
  app: MacAppId;
  write: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MacAppToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface MacAppExecFile {
  (file: string, args: string[], options: Record<string, unknown>): Promise<{ stdout: string; stderr?: string }>;
}

export interface MacAppRunDeps {
  platform?: string;
  execFile?: MacAppExecFile;
  messagesDir?: string;
  readMessages?: (dir: string, op: Record<string, unknown>) => Promise<unknown[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MacAppStatusRow {
  id: MacAppId;
  enabled: boolean;
  permissions: { automation: MacAppPermission; fullDiskAccess?: MacAppPermission };
}

export interface MacAppsStatus {
  available: boolean;
  onThisMac: boolean;
  reason?: string;
  apps: MacAppStatusRow[];
}

export interface MacAppTestResult {
  ok: boolean;
  error?: string;
  count: number;
  names: string[];
}

export const MAC_APPS: MacAppInfo[];
export const MAC_APP_IDS: MacAppId[];
export const MAC_APP_TOOLS: MacAppTool[];
export const MAC_APP_SCRIPTS: Record<string, string>;
export const MAC_APP_TEST_SCRIPTS: Record<MacAppId, string>;
export function isMacAppTool(name: unknown): boolean;
export function macAppOfTool(name: string): MacAppId | null;
export function macAppToolWrites(name: string): boolean;
export function macAppInfo(id: string): MacAppInfo | null;
export function macAppOperation(name: string, args: unknown): Record<string, unknown>;
export function macAppTarget(name: string, args: Record<string, unknown> | undefined): string;
export function macAppArgv(script: string, args: unknown): string[];
export function macAppErrorText(appId: string, error: unknown): { denied: boolean; message: string };
export function messagesDir(home?: string): string;
export function probeMessagesAccess(dir?: string): MacAppPermission;
export function readMessages(dir: string, op: Record<string, unknown>, deps?: { open?: (file: string) => Promise<unknown> }): Promise<unknown[]>;
export function runMacAppCall(name: string, args: unknown, deps?: MacAppRunDeps): Promise<MacAppToolResult>;
export function readMacAppSettings(dir: string): Record<MacAppId, { enabled: boolean; automation: MacAppPermission }>;
export function writeMacAppSettings(dir: string, appId: string, patch: { enabled?: boolean; automation?: MacAppPermission }): Record<MacAppId, { enabled: boolean; automation: MacAppPermission }>;
export function macAppEnabled(dir: string, appId: string): boolean;
export function appleDate(raw: unknown): string | null;
export function messagesReadErrorText(error: unknown): string;
export function automationHelperPath(deps?: { env?: Record<string, string | undefined>; resourcesPath?: string; exists?: (file: string) => boolean }): string | null;
export function automationStateOf(output: unknown): "granted" | "denied" | "notAsked" | null;
export interface MacAppAutomationDeps { platform?: string; execFile?: MacAppExecFile; helper?: string | null }
export function probeMacAppAutomation(appId: string, deps?: MacAppAutomationDeps): Promise<"granted" | "denied" | "notAsked" | null>;
export function requestMacAppAutomation(dir: string, appId: string, deps?: MacAppAutomationDeps): Promise<MacAppPermission>;
export function macAppsStatusLive(dir: string, deps?: MacAppAutomationDeps & { messagesAccess?: () => MacAppPermission }): Promise<MacAppsStatus>;
export function macAppsStatus(dir: string, deps?: { platform?: string; messagesAccess?: () => MacAppPermission }): MacAppsStatus;
export function testMacApp(dir: string, appId: string, deps?: MacAppRunDeps): Promise<MacAppTestResult>;
