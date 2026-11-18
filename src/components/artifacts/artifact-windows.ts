// Artifacts open in a window of their own, never inside Sagax's window
// (docs/superpowers/specs/2026-10-16-artifacts-design.md, 2026-10-28).
//
// In the desktop app, opening an artifact (the Library, its menu, the palette)
// opens it in a real system window (electron/artifact-window.mjs): one window
// per artifact, asking again brings it forward, its place is kept by the
// desktop app and it can sit on another screen. In a browser, it opens the
// same page (`/artifact-window#bot=…&artifact=…`) in a new tab or window.
// There is no floating panel drawn inside the app for an artifact any more.
//
// Whether an artifact is open in its window is the server's (`popped`: the
// bot may set it, Open sets it, closing the window clears it). reconcile()
// makes the desktop windows match the server: a popped artifact gets its
// window back when Sagax starts (without taking the focus), a docked or
// deleted one loses it.
//
// Other system windows ride the same desktop bridge: a page window has an
// `artifactId` that starts with `page:` (isPageWindowId). This module never
// treats those as artifacts: no artifact call when one closes, never closed
// by reconcile.
import { floatingWindows, type FloatingWindows } from "@/lib/floating-windows";
import { setArtifactFlags } from "@/lib/artifacts";
import type { ArtifactBounds, ArtifactSummary } from "../../../shared/artifacts";

export interface ArtifactWindowData {
  botId: string;
  artifactId: string;
}

/** Ids of the page windows another feature opens through the same bridge. */
export const PAGE_WINDOW_PREFIX = "page:";

/** Ids of a bot's own chat window (`chat:<botId>`, src/lib/chat-windows.ts). */
export const CHAT_WINDOW_PREFIX = "chat:";

/** Whether a desktop window id is a window of another kind than an artifact:
 * a page window (`page:<pageId>`) or a bot's chat window (`chat:<botId>`).
 * This module never treats those as artifacts. */
export function isPageWindowId(id: string): boolean {
  return typeof id === "string" && (id.startsWith(PAGE_WINDOW_PREFIX) || id.startsWith(CHAT_WINDOW_PREFIX));
}

/** The app's address that draws one artifact on its own. */
export function artifactWindowPath(botId: string, artifactId: string): string {
  return `/artifact-window#${new URLSearchParams({ bot: botId, artifact: artifactId }).toString()}`;
}

/** Before 2026-10-28: the floating panels' kind, and the list of artifacts
 * kept in a window of their own on this device. Only cleaned up now. */
export const LEGACY_ARTIFACT_WINDOW_KIND = "artifact";
export const LEGACY_OWN_WINDOWS_STORAGE_KEY = "omb.artifactOwnWindows.v1";
const LEGACY_PANEL_PREFIX = "artifact:";

/** Desktop windows asked for and answered in this session. */
const shown = new Set<string>();
/** Asked for and not answered yet: a list from before the ask must not close it. */
const pending = new Set<string>();
/** Closed by the person, the dock not confirmed by a list yet: a stale list
 * that still says popped must not open it again. */
const docking = new Set<string>();

/** Tests: forget this session's windows. */
export function resetArtifactWindows(): void {
  shown.clear();
  pending.clear();
  docking.clear();
}

function bridge() {
  return typeof window !== "undefined" ? window.ogb?.artifactWindow : undefined;
}

/** Whether this page opens artifacts in desktop windows (the desktop app). */
export function canOpenArtifactInOwnWindow(): boolean {
  return typeof bridge()?.open === "function";
}

type Openable = { id: string; botId: string; title: string; popped?: boolean; bounds?: ArtifactBounds };

function sizeOf(artifact: Openable): { width?: number; height?: number } {
  return artifact.bounds ? { width: artifact.bounds.width, height: artifact.bounds.height } : {};
}

/** Open an artifact in its window (or bring that window forward). Desktop:
 * popped out on the server first, so it comes back after a restart, then the
 * desktop app opens it; resolves false (and changes nothing) when it refuses.
 * Browser: a new tab or window on the artifact's page. */
export async function openArtifactInOwnWindow(artifact: Openable): Promise<boolean> {
  const desktop = bridge();
  if (!desktop) return openInBrowser(artifact);
  if (pending.has(artifact.id)) return true;
  docking.delete(artifact.id);
  if (shown.has(artifact.id)) {
    // one window per artifact: asking again brings it forward
    const result = await desktop.open({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title }).catch(() => "refused" as const);
    if (result !== "refused") return true;
    shown.delete(artifact.id);
  }
  pending.add(artifact.id);
  const flag = artifact.popped !== true;
  if (flag) {
    const flagged = await setArtifactFlags(artifact.botId, artifact.id, { popped: true }).then(() => true, () => false);
    if (!flagged) {
      pending.delete(artifact.id);
      return false;
    }
  }
  const result = await desktop.open({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title, ...sizeOf(artifact) })
    .catch(() => "refused" as const);
  pending.delete(artifact.id);
  if (result === "refused") {
    // back as it was, docked
    if (flag) void setArtifactFlags(artifact.botId, artifact.id, { popped: false }).catch(() => {});
    return false;
  }
  shown.add(artifact.id);
  return true;
}

function openInBrowser(artifact: Openable): boolean {
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  window.open(artifactWindowPath(artifact.botId, artifact.id), "_blank", "noopener");
  return true;
}

/** The desktop app says the person closed one of its windows (event
 * artifact-window:closed). An artifact's is docked; a page window's
 * (`page:…`) is not this module's and is ignored. */
export function ownArtifactWindowClosed(data: ArtifactWindowData): void {
  if (isPageWindowId(data.artifactId)) return;
  shown.delete(data.artifactId);
  pending.delete(data.artifactId);
  docking.add(data.artifactId);
  dockArtifact(data);
}

/** Make the desktop windows match the server's list of artifacts: a popped
 * one gets its window (without taking the focus), a docked or deleted one
 * loses it. In a browser nothing opens by itself. */
export function reconcileArtifactWindows(list: readonly ArtifactSummary[]): void {
  const popped = new Set(list.filter((artifact) => artifact.popped).map((artifact) => artifact.id));
  for (const artifactId of docking) if (!popped.has(artifactId)) docking.delete(artifactId);
  const desktop = bridge();
  for (const artifactId of shown) {
    if (isPageWindowId(artifactId) || popped.has(artifactId) || pending.has(artifactId)) continue;
    shown.delete(artifactId);
    void desktop?.close(artifactId).catch(() => {});
  }
  if (!desktop) return;
  for (const artifact of list) {
    if (!artifact.popped || isPageWindowId(artifact.id) || shown.has(artifact.id) || pending.has(artifact.id) || docking.has(artifact.id)) continue;
    pending.add(artifact.id);
    void desktop.open({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title, ...sizeOf(artifact), focus: false })
      .catch(() => "refused" as const)
      .then((result) => {
        pending.delete(artifact.id);
        if (result !== "refused") shown.add(artifact.id);
      });
  }
}

/** Closing an artifact's window docks it: it does not reopen next start. */
export function dockArtifact(data: ArtifactWindowData): void {
  void setArtifactFlags(data.botId, data.artifactId, { popped: false }).catch(() => {});
}

/** Close an artifact's window from anywhere (the Library's menu, the
 * window's own Close button): docked on the server, its desktop window goes. */
export function dockArtifactWindow(artifact: { id: string; botId: string }): Promise<void> {
  const wasShown = shown.delete(artifact.id);
  pending.delete(artifact.id);
  docking.add(artifact.id);
  if (wasShown) void bridge()?.close(artifact.id).catch(() => {});
  return setArtifactFlags(artifact.botId, artifact.id, { popped: false }).then(() => undefined);
}

function defaultStorage(): Pick<Storage, "removeItem"> | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Once per start: the floating panels an older Sagax restored for popped
 * artifacts are dropped with their remembered place, and the old list of own
 * windows is erased. The server's `popped` flag is what reopens them, now in
 * their system window (reconcile). */
export function migrateLegacyArtifactPanels(manager: FloatingWindows = floatingWindows(), storage: Pick<Storage, "removeItem"> | undefined = defaultStorage()): void {
  for (const entry of manager.snapshot().windows) {
    if (entry.kind === LEGACY_ARTIFACT_WINDOW_KIND) manager.forget(entry.id);
  }
  manager.forgetWhere((id) => id.startsWith(LEGACY_PANEL_PREFIX));
  try {
    storage?.removeItem(LEGACY_OWN_WINDOWS_STORAGE_KEY);
  } catch {
    /* private mode: nothing was saved */
  }
}
