// The window event the store fires when the server says a bot's artifacts
// changed (frame `artifacts`, ids only). Its own module so the store and
// src/lib/artifacts.ts do not import each other.
export const ARTIFACTS_EVENT = "sagax-artifacts";

export interface ArtifactsEventDetail {
  botId: string;
  artifactId?: string;
  deleted: boolean;
}

/** Asks the app-wide artifact host (ArtifactsHost.tsx) to show one artifact
 * beside the chat (docked right panel). Palette, Outputs and Library primary
 * click use this. */
export const OPEN_ARTIFACT_EVENT = "sagax-open-artifact";

/** Same host: open the artifact in its own system window (or a browser tab). */
export const OPEN_ARTIFACT_WINDOW_EVENT = "sagax-open-artifact-window";

export interface OpenArtifactDetail {
  botId: string;
  artifactId: string;
  title: string;
}

/** Cross-window: a detached artifact window asks the main window to dock it
 * beside the chat (BroadcastChannel, with a localStorage fallback). */
export const ARTIFACT_REATTACH_CHANNEL = "sagax-artifact-reattach";
export const ARTIFACT_REATTACH_STORAGE_KEY = "sagax-artifact-reattach";

export function openArtifact(detail: OpenArtifactDetail): void {
  window.dispatchEvent(new CustomEvent<OpenArtifactDetail>(OPEN_ARTIFACT_EVENT, { detail }));
}

export function openArtifactWindow(detail: OpenArtifactDetail): void {
  window.dispatchEvent(new CustomEvent<OpenArtifactDetail>(OPEN_ARTIFACT_WINDOW_EVENT, { detail }));
}

/** Signal the main window to open the side panel and dock this artifact. */
export function signalArtifactReattach(detail: OpenArtifactDetail): void {
  try {
    const channel = new BroadcastChannel(ARTIFACT_REATTACH_CHANNEL);
    channel.postMessage(detail);
    channel.close();
  } catch { /* BroadcastChannel missing */ }
  try {
    localStorage.setItem(ARTIFACT_REATTACH_STORAGE_KEY, JSON.stringify({ ...detail, at: Date.now() }));
    localStorage.removeItem(ARTIFACT_REATTACH_STORAGE_KEY);
  } catch { /* private mode */ }
}

function readReattach(raw: unknown): OpenArtifactDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const detail = raw as Partial<OpenArtifactDetail>;
  if (typeof detail.botId !== "string" || typeof detail.artifactId !== "string" || typeof detail.title !== "string") return null;
  if (!detail.botId || !detail.artifactId) return null;
  return { botId: detail.botId, artifactId: detail.artifactId, title: detail.title };
}

/** Main window: call `onReattach` when a detached window asks to dock. */
export function listenArtifactReattach(onReattach: (detail: OpenArtifactDetail) => void): () => void {
  let channel: BroadcastChannel | null = null;
  const fromChannel = (event: MessageEvent) => {
    const detail = readReattach(event.data);
    if (detail) onReattach(detail);
  };
  try {
    channel = new BroadcastChannel(ARTIFACT_REATTACH_CHANNEL);
    channel.addEventListener("message", fromChannel);
  } catch { /* BroadcastChannel missing */ }
  const fromStorage = (event: StorageEvent) => {
    if (event.key !== ARTIFACT_REATTACH_STORAGE_KEY || !event.newValue) return;
    try {
      const detail = readReattach(JSON.parse(event.newValue) as unknown);
      if (detail) onReattach(detail);
    } catch { /* bad payload */ }
  };
  window.addEventListener("storage", fromStorage);
  return () => {
    channel?.removeEventListener("message", fromChannel);
    channel?.close();
    window.removeEventListener("storage", fromStorage);
  };
}
