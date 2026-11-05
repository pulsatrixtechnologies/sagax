// An artifact in a window of its own (#1140; the only way an artifact opens
// since 2026-10-28): the page behind `/artifact-window#bot=<id>&artifact=<id>`,
// drawn by the desktop app in a separate BrowserWindow
// (electron/artifact-window.mjs) that can sit outside the app's frame, beside
// the work or on another monitor, or opened in a browser tab where there is no
// desktop app. It shows the widget, its status, Refresh now, Full screen and
// Close window, and has its own store, like any other tab of the app. Closing
// the window docks the artifact; Close window does the same.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LoaderCircle, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";

import { StoreProvider, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { setLocale, t } from "@/lib/i18n";
import { refreshArtifact, useArtifact, useArtifactWatch } from "@/lib/artifacts";
import { useOsFullscreen } from "@/hooks/use-os-fullscreen";
import { readPageWindowFitBridge, startPageWindowFit } from "@/lib/page-window-fit";
import { ArtifactFrame } from "./ArtifactFrame";
import { PageSurface } from "../PageViewer";
import { pageIdOfWindow } from "@/lib/page-windows";
import { ArtifactStatusLine } from "./ArtifactsSection";
import { dockArtifactWindow, type ArtifactWindowData } from "./artifact-windows";

const TOOL = "flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

/** One artifact's window body: its widget, its state, Refresh now, Full screen
 * and Close window. Mounted means visible, so it holds a watch lease. */
export function ArtifactWindowBody({ data }: { data: ArtifactWindowData }) {
  const { artifact, error } = useArtifact(data.botId, data.artifactId);
  useArtifactWatch(data.artifactId);
  const [refreshing, setRefreshing] = useState(false);
  const { fullscreen, toggle } = useOsFullscreen();
  const fullscreenLabel = fullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen");
  return (
    <div className="flex size-full flex-col" data-artifact-window={data.artifactId}>
      {/* Full screen lives in the chrome (#2043): never over the page content.
          The click asks the OS for full screen (setFullScreen / Fullscreen API). */}
      <div data-artifact-window-chrome className="flex shrink-0 items-center gap-1 border-b border-hairline/30 px-2 py-1">
        <span className="min-w-0 flex-1">{artifact && <ArtifactStatusLine artifact={{ ...artifact, ...(artifact.data ? { dataAt: artifact.data.at } : {}) }} />}</span>
        {artifact?.source && (
          <button
            type="button"
            className={TOOL}
            disabled={refreshing}
            aria-label={t("artifacts.refreshNow")}
            title={t("artifacts.refreshNow")}
            onClick={() => {
              setRefreshing(true);
              void refreshArtifact(data.botId, data.artifactId).catch(() => {}).finally(() => setRefreshing(false));
            }}
          >
            <RefreshCw size={13} aria-hidden="true" className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </button>
        )}
        {artifact && (
          <button
            type="button"
            className={TOOL}
            data-artifact-fullscreen
            aria-pressed={fullscreen}
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            onClick={() => toggle()}
          >
            {fullscreen
              ? <Minimize2 size={13} aria-hidden="true" />
              : <Maximize2 size={13} aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          className={TOOL}
          data-artifact-close-window
          aria-label={t("artifacts.closeWindow")}
          title={t("artifacts.closeWindow")}
          onClick={() => void dockArtifactWindow({ id: data.artifactId, botId: data.botId }).catch(() => {}).finally(() => window.close())}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {artifact ? (
          <ArtifactFrame artifact={artifact} fill bare />
        ) : error ? (
          <p role="alert" className="p-2 text-[12.5px] text-danger">{t("artifacts.error")}</p>
        ) : (
          <span role="status" className="flex items-center gap-2 p-2 text-[12.5px] text-ink-secondary">
            <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("artifacts.loading")}
          </span>
        )}
      </div>
    </div>
  );
}

const ID = /^[a-zA-Z0-9:_-]{1,128}$/;

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
const currentHash = () => location.hash;

/** The bot and artifact an own-window address names, or null. */
export function readArtifactWindowTarget(hash: string): { botId: string; artifactId: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const botId = params.get("bot") ?? "";
  const artifactId = params.get("artifact") ?? "";
  return ID.test(botId) && ID.test(artifactId) ? { botId, artifactId } : null;
}

function Title({ botId, artifactId }: { botId: string; artifactId: string }) {
  const { artifact } = useArtifact(botId, artifactId);
  useEffect(() => {
    if (artifact?.title) document.title = artifact.title;
  }, [artifact?.title]);
  return null;
}

function ArtifactStandaloneBody() {
  const { state } = useStore();
  const hash = useSyncExternalStore(subscribeHash, currentHash);
  const target = readArtifactWindowTarget(hash);
  const ready = state.hydrated === true && state.config != null;

  // This device's language, else the server's, as the main window does.
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || globalThis.navigator?.language);
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);

  if (!target || !ready) {
    return (
      <main className="flex h-dvh items-center justify-center bg-panel px-6 text-center text-[13px] text-ink-secondary" role="status">
        {target ? t("artifacts.loading") : t("artifacts.error")}
      </main>
    );
  }
  // a page's window (src/lib/page-windows.ts): the same surface as the page
  // open over its conversation; × closes the window
  const pageId = pageIdOfWindow(target.artifactId);
  if (pageId) {
    return <PageStandaloneFit pageId={pageId} />;
  }
  return (
    <main data-artifact-standalone={target.artifactId} className="flex h-dvh min-h-0 flex-col bg-panel text-ink">
      <Title botId={target.botId} artifactId={target.artifactId} />
      <ArtifactWindowBody data={target} />
    </main>
  );
}

/** A page in its own desktop window: measure the content and ask Electron to
 * size the BrowserWindow to it (#2051). In a browser tab the bridge is absent
 * and the page fills the viewport as before. */
function PageStandaloneFit({ pageId }: { pageId: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const bridge = readPageWindowFitBridge();
    if (!root || !bridge) return;
    return startPageWindowFit({
      root,
      getFrame: () => root.querySelector<HTMLIFrameElement>("[data-page-viewer-frame]"),
      bridge,
      onContentHeight: setContentHeight,
    });
  }, [pageId]);

  return (
    <main
      ref={rootRef}
      data-page-standalone={pageId}
      className={cn("flex min-h-0 flex-col bg-app text-ink", contentHeight == null && "h-dvh")}
      style={contentHeight != null ? { height: contentHeight } : undefined}
    >
      <PageSurface
        pageId={pageId}
        follow
        onClose={() => window.close()}
        onChange={(page) => { if (page.title) document.title = page.title; }}
      />
    </main>
  );
}

export function ArtifactStandaloneWindow() {
  return (
    <StoreProvider>
      <ArtifactStandaloneBody />
    </StoreProvider>
  );
}
