export type MacAppId = "messages" | "mail" | "calendar" | "contacts" | "reminders" | "notes" | "photos";
export type MacAppPermission = "granted" | "denied" | "unknown" | "notAsked" | "unsupported";

export interface MacAppInfo {
  id: MacAppId;
  name: string;
  bundleId: string;
  fullDiskAccess: boolean;
}

/** A tool's class: read, write, delete, or send to someone. */
export type MacAppToolKind = "read" | "write" | "delete" | "send";
/** The permission a tool needs on the Mac. */
export type MacAppNeed = "automation" | "fullDiskAccess";

export interface MacAppTool {
  name: string;
  app: MacAppId;
  kind: MacAppToolKind;
  needs: MacAppNeed;
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
  readMessages?: (dir: string, op: Record<string, unknown>) => Promise<{ messages: unknown[]; next?: string }>;
  listChats?: (dir: string, op: Record<string, unknown>) => Promise<unknown[]>;
  readMessageAttachment?: (dir: string, op: Record<string, unknown>, saveDir: string) => Promise<unknown>;
  /** Where a read_attachment tool saves the file (the conversation's folder). */
  saveDir?: string;
  /** Desktop app: files to attach are names staged in this folder. */
  filesDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MacAppStatusRow {
  id: MacAppId;
  enabled: boolean;
  permissions: { automation: MacAppPermission; fullDiskAccess?: MacAppPermission };
  /** What bots can do with the app on this Mac (empty off a Mac). */
  actions: MacAppAction[];
}

export interface MacAppAction {
  tool: string;
  kind: MacAppToolKind;
  needs: MacAppNeed;
  granted: boolean;
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
export const MAC_APP_LEGACY_TOOLS: Array<Pick<MacAppTool, "name" | "app" | "description" | "inputSchema">>;
export const MAC_APP_UPDATE_DESKTOP: string;
export function macAppToolsFor(reported: readonly string[] | null | undefined): Array<Pick<MacAppTool, "name" | "app" | "description" | "inputSchema">>;
export function macAppLegacyCall(name: string, args: unknown): boolean;
export function calendarRef(id: string): { uid: string; occurrence?: string };
export function calendarOccurrenceId(uid: string, start: string | Date): string;
export function occurrences(rule: string, start: Date | string, from: Date | string, to: Date | string, max: number, excluded?: Array<Date | string>): Date[] | null;
export const MAC_APP_SCRIPTS: Record<string, string>;
export const MAC_APP_BUDGET_MS: number;
export const PHOTO_EXPORT_MAX_SIZE: number;
export const PHOTOS_EXPORT_TIMEOUT_MS: number;
export function exportPhotos(op: Record<string, unknown>, deps?: MacAppRunDeps): Promise<{ files: Array<{ id: string; path: string; name: string; mime: string; bytes: number }>; failed: Array<{ id: string; name?: string; error: string }>; next?: string }>;
export const MAC_APP_SCRIPT_TIMEOUT_MS: number;
export const MAC_APP_TEST_SCRIPTS: Record<MacAppId, string>;
export function isMacAppTool(name: unknown): boolean;
export function macAppOfTool(name: string): MacAppId | null;
export function macAppToolWrites(name: string): boolean;
export function macAppInfo(id: string): MacAppInfo | null;
/** A tool that saves files into the conversation's folder (an attachment, exported photos). */
export function macAppSavesFiles(name: unknown): boolean;
export function macAppOperation(name: string, args: unknown): Record<string, unknown>;
export function macAppTarget(name: string, args: Record<string, unknown> | undefined): string;
export function macAppScriptArgs(name: string, op: Record<string, unknown>): Record<string, unknown>;
export function mailId(account: string, mailbox: string, n: number): string;
export function parseMailId(value: unknown): { account: string; mailbox: string; n: number } | { n: number } | null;
export function macAppArgv(script: string, args: unknown): string[];
export function macAppErrorText(appId: string, error: unknown): { denied: boolean; message: string };
export function messagesDir(home?: string): string;
export function probeMessagesAccess(dir?: string): MacAppPermission;
/** A saved or staged file's name: a random prefix, then its base name made safe. */
export function macAppFileName(name: string): string;
export function readMessages(dir: string, op: Record<string, unknown>, deps?: { open?: (file: string) => Promise<unknown> }): Promise<{ messages: unknown[]; next?: string }>;
export function readMessageAttachment(dir: string, op: Record<string, unknown>, saveDir: string, deps?: { open?: (file: string) => Promise<unknown> }): Promise<{ path: string; name: string; mime: string | null; bytes: number }>;
export function listChats(dir: string, op: Record<string, unknown>, deps?: { open?: (file: string) => Promise<unknown> }): Promise<unknown[]>;
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
