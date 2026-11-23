/** The page a headless browser opens on, before a panel asks for its own size. */
export const BROWSER_STANDARD_VIEWPORT = { width: 1280, height: 720 } as const;

const READABLE = 320;
const LONGEST = 1440;
const LAID_OUT = 120;
const SERVER_MIN = 240;
const SERVER_MAX = 1600;

/**
 * The remote page size for a live browser panel's stage (#5021).
 * A tall narrow panel becomes a tall narrow page, so the picture fills the
 * stage instead of a wide page letterboxed in the middle. Null when the
 * stage has not been laid out.
 */
export function panelBrowserViewport(stage: { width: number; height: number }): { width: number; height: number } | null {
  if (!Number.isFinite(stage.width) || !Number.isFinite(stage.height)) return null;
  let width = Math.floor(stage.width);
  let height = Math.floor(stage.height);
  if (width < LAID_OUT || height < LAID_OUT) return null;
  const short = Math.min(width, height);
  if (short < READABLE) {
    const lift = READABLE / short;
    width = Math.round(width * lift);
    height = Math.round(height * lift);
  }
  const long = Math.max(width, height);
  if (long > LONGEST) {
    const shrink = LONGEST / long;
    width = Math.round(width * shrink);
    height = Math.round(height * shrink);
  }
  return {
    width: Math.max(SERVER_MIN, Math.min(SERVER_MAX, width)),
    height: Math.max(SERVER_MIN, Math.min(SERVER_MAX, height)),
  };
}

/** A resize of only a few pixels is the same page. The first size always applies. */
export function viewportResizeNeeded(current: { width: number; height: number } | null, next: { width: number; height: number }, slack = 24): boolean {
  if (!current) return true;
  return Math.abs(current.width - next.width) > slack || Math.abs(current.height - next.height) > slack;
}

type StageReport = (size: { width: number; height: number } | null) => void;
let stageReport: StageReport = () => {};

/** The latest live panel. Set during render so the stage ref stays one function. */
export function setPanelStageReport(report: StageReport): void {
  stageReport = report;
}

/** Watch the stage. A null report asks for the standard page again. */
export function panelStageRef(node: HTMLElement | null): (() => void) | void {
  if (!node || typeof ResizeObserver === "undefined") return;
  let last: { width: number; height: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const measure = () => {
    const box = node.getBoundingClientRect();
    const next = panelBrowserViewport(box);
    if (!next || !viewportResizeNeeded(last, next)) return;
    last = next;
    stageReport(next);
  };
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(measure, last ? 300 : 0);
  });
  observer.observe(node);
  measure();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
    if (last && viewportResizeNeeded(BROWSER_STANDARD_VIEWPORT, last, 0)) stageReport(null);
  };
}
