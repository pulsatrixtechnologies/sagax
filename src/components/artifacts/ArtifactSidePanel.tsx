// Docked right panel for one artifact beside the chat: same shell as person
// / settings (`app-docked-panel`, shared width key). Detach opens the system
// window and closes the panel; Agrandir uses the existing full-screen layer.
// Its round controls draw the chat header's glyph (CIRCLE_ICON, M-20261127-179).
import { useState } from "react";
import { AppWindow, LoaderCircle, Maximize2, RefreshCw, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";
import { t } from "@/lib/i18n";
import { refreshArtifact, useArtifact, useArtifactWatch } from "@/lib/artifacts";
import { useStore } from "@/state/store";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "../DockedPanelResize";
import { SCREEN_PANEL_TITLE } from "../ScreenPanelChrome";
import { ArtifactFrame, openArtifactFullscreen } from "./ArtifactFrame";
import { ArtifactStatusLine } from "./ArtifactsSection";
import { canOpenArtifactInOwnWindow, openArtifactInOwnWindow } from "./artifact-windows";

export function ArtifactSidePanel({ botId, artifactId, title }: { botId: string; artifactId: string; title: string }) {
  const { dispatch } = useStore();
  const dockedPanel = useDockedPanelWidth();
  const { artifact, error } = useArtifact(botId, artifactId);
  useArtifactWatch(artifactId);
  const [refreshing, setRefreshing] = useState(false);
  const shownTitle = artifact?.title || title;

  const close = () => dispatch({ type: "openArtifactPanel", panel: null });
  const detach = () => {
    void openArtifactInOwnWindow({
      id: artifactId,
      botId,
      title: shownTitle,
      ...(artifact?.bounds ? { bounds: artifact.bounds } : {}),
    }).finally(() => close());
  };
  const enlarge = () => {
    if (!artifact) return;
    openArtifactFullscreen(artifact);
  };

  return (
    <aside
      role="dialog"
      aria-label={t("artifacts.sidePanelAria", { title: shownTitle })}
      data-artifact-side-panel={artifactId}
      style={{ width: dockedPanel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-pane-edge bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [role=menu]")) return;
        close();
      }}
    >
      <DockedPanelResizeHandle label={t("computer.resizeAria")} panel={dockedPanel} />
      <div data-artifact-side-panel-header="" className="content-topbar flex min-h-[52px] shrink-0 items-center gap-2 px-3 py-2.5">
        <span dir="auto" className={SCREEN_PANEL_TITLE}>{shownTitle}</span>
        {artifact?.source && (
          <button
            type="button"
            className={CIRCLE_BUTTON}
            disabled={refreshing}
            aria-label={t("artifacts.refreshNow")}
            title={t("artifacts.refreshNow")}
            onClick={() => {
              setRefreshing(true);
              void refreshArtifact(botId, artifactId).catch(() => {}).finally(() => setRefreshing(false));
            }}
          >
            <RefreshCw {...CIRCLE_ICON} aria-hidden="true" className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </button>
        )}
        {canOpenArtifactInOwnWindow() && (
          <button
            type="button"
            data-artifact-detach=""
            onClick={detach}
            aria-label={t("artifacts.detach")}
            title={t("artifacts.detach")}
            className={CIRCLE_BUTTON}
          >
            <AppWindow {...CIRCLE_ICON} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          data-artifact-enlarge=""
          disabled={!artifact}
          onClick={enlarge}
          aria-label={t("artifact.fullscreen")}
          title={t("artifact.fullscreen")}
          className={CIRCLE_BUTTON}
        >
          <Maximize2 {...CIRCLE_ICON} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-artifact-side-panel-close=""
          onClick={close}
          aria-label={t("artifacts.closePanel")}
          title={t("artifacts.closePanel")}
          className={CIRCLE_BUTTON}
        >
          <X {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      </div>
      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-hidden">
        {artifact && (
          <div className="shrink-0 px-3 pb-2 pt-2">
            <ArtifactStatusLine artifact={{ ...artifact, ...(artifact.data ? { dataAt: artifact.data.at } : {}) }} />
          </div>
        )}
        <div data-artifact-side-panel-body="" className="relative flex min-h-0 flex-1 flex-col px-3 pb-3">
          {artifact ? (
            <ArtifactFrame artifact={artifact} fill bare className="min-h-0 flex-1 overflow-hidden rounded-lg border border-hairline/40" />
          ) : error ? (
            <p role="alert" className="p-2 text-[12.5px] text-danger">{t("artifacts.error")}</p>
          ) : (
            <span role="status" className="flex items-center gap-2 p-2 text-[12.5px] text-ink-secondary">
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("artifacts.loading")}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
