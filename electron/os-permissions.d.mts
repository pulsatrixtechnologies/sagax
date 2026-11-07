export type OsPermissionId = "microphone" | "screen" | "accessibility" | "notifications" | "speech" | "automation" | "fullDisk";
export type OsPermissionStatus = "granted" | "denied" | "not-determined" | "unknown";
export interface OsPermissionEntry {
  id: OsPermissionId;
  prompt: boolean;
  readable: boolean;
  pane: string;
  relaunch?: boolean;
}
export type OsPermissionActionKind = "none" | "prompt" | "settings" | "relaunch" | "reset";
export interface OsPermissionAction {
  kind: OsPermissionActionKind;
  url?: string;
  secondary?: { kind: "settings" | "relaunch"; url?: string };
}
export interface OsPermissionRun {
  asked?: boolean;
  openedSettings?: boolean;
  relaunched?: boolean;
  captureFailed?: boolean;
}
export const OS_PERMISSIONS: Readonly<Record<"darwin" | "win32", readonly OsPermissionEntry[]>>;
export function permissionsFor(platform: string): readonly OsPermissionEntry[];
export function permissionEntry(platform: string, id: string): OsPermissionEntry | null;
export function normalizePermissionStatus(raw: unknown): OsPermissionStatus;
export function permissionAction(id: string, platform: string, status: string, run?: OsPermissionRun): OsPermissionAction;
export function isPermissionSettingsUrl(url: unknown): boolean;
export interface OsPermissionView {
  id: OsPermissionId;
  status: OsPermissionStatus;
  action: OsPermissionAction;
}
export interface OsPermissionsAnswer {
  platform: string;
  permissions: OsPermissionView[];
}
