// @ts-nocheck
/** startScreenPoller (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartScreenPoller(getHost: () => Host): any {
function startScreenPoller(   botId: string,   threadId: string,   captures: { computer?: ScreenCapture; browser?: ScreenCapture },   { screenIsTheWork = false } = {}, ) {
  const host = getHost();

  if (!captures.computer && !captures.browser) return;
  if (host.screenPollers.has(threadId)) return;
  const owner = host.turnResourceOwners.get(threadId);
  const computer = host.turnComputerResources.get(threadId);
  const browserSession = host.currentBrowserSession(botId, host.botForThread(botId, threadId)?.browserProfile, threadId);
  const guarded = (capture: ScreenCapture | undefined, resource: string | undefined): ScreenCapture | undefined =>
    capture && owner && resource ? async () => {
      const isCurrent = () => host.turnResourceOwners.get(threadId)?.generation === owner.generation &&
        host.turnResources.owns(resource, owner) && Boolean(host.store.taskByThread(botId, threadId) || host.store.groupByThread(threadId));
      if (!isCurrent()) throw new Error("this thread does not own that screen");
      const frame = await capture();
      if (!isCurrent()) throw new Error("this thread no longer owns that screen");
      return frame;
    } : undefined;
  // Assign rather than spread: the source's last-frame getter deliberately
  // hides a stale frame as soon as the selected surface changes.
  const entry = Object.assign(host.createScreenFrameSource({
    captures: {
      computer: guarded(captures.computer, computer?.resource),
      browser: guarded(captures.browser, browserSession ? `browser:${browserSession}` : undefined)
    },
    control: () => ({
      held: host.botComputerControlSnapshot(botId, host.teamComputerTurns.get(threadId)?.computerId).held,
      revision: host.computerControlRevision.get(botId) ?? 0
    }),
    onFrame: (frame) => {
      host.broadcast({ kind: "screen", botId, threadId, ...frame });
      // The bot panel's Computer row shows this computer's newest frame
      // (server/computer/computer-thumbnails.ts); a browser frame is not it.
      const thumbnail = host.thumbnailComputerForResource?.(computer?.resource);
      const mime = host.thumbnailMime?.(frame.mime);
      if (thumbnail && mime && captures.computer && (entry.surface === "computer" || !captures.browser)) {
        void host.computerThumbnails?.record(botId, thumbnail, { bytes: Buffer.from(frame.png, "base64"), mime }).catch(host.reportBackgroundError);
      }
    },
    minGapMs: host.SCREEN_MIN_GAP_MS
  }), {
    timer: null as ReturnType<typeof setInterval> | null,
    botId,
    touched: screenIsTheWork
  });
  entry.timer = setInterval(() => void entry.capture().catch(host.reportBackgroundError), host.SCREEN_POLL_MS);
  host.screenPollers.set(threadId, entry);

}
  return startScreenPoller;
}
