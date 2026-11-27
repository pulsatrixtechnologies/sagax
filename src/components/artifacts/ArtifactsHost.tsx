// App-wide artifacts (docs/superpowers/specs/2026-10-16-artifacts-design.md):
// the system windows of popped-out artifacts, kept matching the server
// (artifact-windows.ts), the docked side panel, and the artifact the palette
// asked for (opens beside the chat). Full-screen view for Agrandir.
import { useCallback, useEffect } from "react";

import {
  listenArtifactReattach,
  OPEN_ARTIFACT_EVENT,
  OPEN_ARTIFACT_WINDOW_EVENT,
  type OpenArtifactDetail,
} from "@/lib/artifact-events";
import { useAllArtifacts } from "@/lib/artifacts";
import { useStore } from "@/state/store";
import { ArtifactFullscreenHost } from "./ArtifactFrame";
import {
  dockArtifactWindow,
  migrateLegacyArtifactPanels,
  openArtifactInOwnWindow,
  ownArtifactWindowClosed,
  reconcileArtifactWindows,
} from "./artifact-windows";

export function ArtifactsHost() {
  const { dispatch } = useStore();
  // Every artifact this viewer sees, kept current by the server's frames:
  // the popped ones are the windows that should be open.
  const { artifacts } = useAllArtifacts(true);
  // Floating panels an older Sagax restored for artifacts: dropped.
  useEffect(() => migrateLegacyArtifactPanels(), []);
  // Only a list the server answered decides: offline, open windows stay.
  useEffect(() => {
    if (artifacts) reconcileArtifactWindows(artifacts);
  }, [artifacts]);
  // The person closed a system window: an artifact's is docked, a page's
  // (`page:…`) is ignored (ownArtifactWindowClosed).
  useEffect(() => window.ogb?.artifactWindow?.onClosed(ownArtifactWindowClosed), []);

  const openBeside = useCallback((detail: OpenArtifactDetail) => {
    if (!detail?.botId || !detail.artifactId) return;
    const known = artifacts?.find((artifact) => artifact.id === detail.artifactId);
    if (known?.popped) void dockArtifactWindow({ id: detail.artifactId, botId: detail.botId }).catch(() => {});
    dispatch({
      type: "openArtifactPanel",
      panel: { botId: detail.botId, artifactId: detail.artifactId, title: detail.title },
    });
  }, [artifacts, dispatch]);

  const openWindow = useCallback((detail: OpenArtifactDetail) => {
    if (!detail?.botId || !detail.artifactId) return;
    const known = artifacts?.find((artifact) => artifact.id === detail.artifactId);
    dispatch({ type: "openArtifactPanel", panel: null });
    void openArtifactInOwnWindow({
      id: detail.artifactId,
      botId: detail.botId,
      title: detail.title,
      ...(known ? { popped: known.popped } : {}),
      ...(known?.bounds ? { bounds: known.bounds } : {}),
    });
  }, [artifacts, dispatch]);

  const onOpenBeside = useCallback((event: Event) => {
    openBeside((event as CustomEvent<OpenArtifactDetail>).detail);
  }, [openBeside]);
  const onOpenWindow = useCallback((event: Event) => {
    openWindow((event as CustomEvent<OpenArtifactDetail>).detail);
  }, [openWindow]);

  useEffect(() => {
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpenBeside);
    window.addEventListener(OPEN_ARTIFACT_WINDOW_EVENT, onOpenWindow);
    return () => {
      window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpenBeside);
      window.removeEventListener(OPEN_ARTIFACT_WINDOW_EVENT, onOpenWindow);
    };
  }, [onOpenBeside, onOpenWindow]);

  useEffect(() => listenArtifactReattach((detail) => {
    void dockArtifactWindow({ id: detail.artifactId, botId: detail.botId }).catch(() => {});
    dispatch({
      type: "openArtifactPanel",
      panel: { botId: detail.botId, artifactId: detail.artifactId, title: detail.title },
    });
  }), [dispatch]);

  return <ArtifactFullscreenHost />;
}
