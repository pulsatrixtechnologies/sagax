// The split view (#1504, src/lib/split-view.ts): the window's content laid
// out as sections side by side and stacked. One section is the main chat
// (`main`, unchanged: the sidebar selection drives it); every other one is a
// bot's or a group's conversation in its compact form (ChatView's `side`,
// GroupView's `pane`) over its own copy of the thread (useSideTranscript),
// with its own composer, header (Open in the main chat, Close) and a handle
// to resize it against its neighbour. Not split, this renders `main` alone.
//
// A sidebar row dragged over the content shows where it lands: near an edge
// of the window, a new section along that whole edge; near an edge of a
// section, a new section beside that one; in a section's middle, that
// section shows it instead (the main chat's middle opens it there).
// Below the md breakpoint only the main chat shows; the layout stays.
//
// Every section's header, a bot's or a group's, carries the main chat's
// pill (mascot or member faces, name, chevron), centered at the top of the
// section as in a normal chat; Open in main and Close stay in the corner.
// Its click opens that bot's or group's panel, always at the window's right
// edge. One panel at a time (AppState.panelOwner): opening one closes the
// other, and closing the section, or showing another conversation in it,
// closes its panel. A group's panel portals into App's panel slot.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Maximize2, X } from "lucide-react";
import { PanelSlotProvider, usePanelSlot } from "./panel-slot";
import { api, openBotThread, peopleDmReadTarget, useStore, type Bot, type Group } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import {
  dragTarget,
  edgeAt,
  ensureSection,
  MAIN_LEAF_ID,
  parseSplitDrag,
  removeSection,
  replaceSection,
  resizeSplit,
  SPLIT_DRAG_TYPE,
  splitLeaves,
  updateSplitLayout,
  useSplitLayout,
  useSplitLeafFocus,
  type SplitBranch,
  type SplitEdge,
  type SplitLeaf,
  type SplitNode,
  type SplitTarget,
} from "@/lib/split-view";
import { useSideTranscript } from "@/lib/use-side-transcript";
import { groupMemberBots } from "@/lib/group-members";
import { BotAvatar } from "./Avatar";
import { BotHeaderPill, botPillActions } from "./BotHeaderPill";
import { ChatView } from "./ChatView";
import { GroupView } from "./GroupView";
import { GroupAvatarStack } from "./GroupPanel";

/** Within this many pixels of the window's edge, a drop splits the whole window. */
const WINDOW_EDGE_PX = 36;
const KEY_STEP = 0.04;

type DropZone = {
  /** The node the new section goes beside: null for the whole window. */
  anchorId: string | null;
  /** null: the section's middle (replace, or open in the main chat). */
  edge: SplitEdge | null;
  leafId: string | null;
  rect: { left: number; top: number; width: number; height: number };
};

const containsMain = (node: SplitNode): boolean => splitLeaves(node).some((leaf) => leaf.id === MAIN_LEAF_ID);

/** The part of `box` a new section on `edge` would take, `share` of it. */
function edgeRect(box: DropZone["rect"], edge: SplitEdge | null, share: number): DropZone["rect"] {
  if (edge === null) return box;
  if (edge === "left") return { ...box, width: box.width * share };
  if (edge === "right") return { ...box, left: box.left + box.width * (1 - share), width: box.width * share };
  if (edge === "top") return { ...box, height: box.height * share };
  return { ...box, top: box.top + box.height * (1 - share), height: box.height * share };
}


export function SplitWorkspace({ main, panelSlot = null }: { main: ReactNode; panelSlot?: HTMLElement | null }) {
  const layout = useSplitLayout();
  const { state, dispatch } = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<DropZone | null>(null);
  const showThreads = useShowThreads();

  // A section's panel goes with its section: closed, or showing another
  // conversation, the panel closes too.
  const owner = state.panelOwner;
  useEffect(() => {
    if (!owner) return;
    const target = splitLeaves(layout).find((candidate) => candidate.id === owner.leafId)?.target;
    if (target?.kind === "bot" && target.botId === owner.botId) return;
    if (target?.kind === "group" && target.groupId === owner.groupId) return;
    for (const action of botPillActions(true)) dispatch(action);
  }, [owner, layout, dispatch]);

  // A drag that ends anywhere (dropped elsewhere, Escape) clears the marker.
  useEffect(() => {
    if (!zone) return;
    const clear = () => setZone(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [zone]);

  const zoneAt = (event: React.DragEvent<HTMLDivElement>): DropZone | null => {
    const root = rootRef.current;
    if (!root) return null;
    const outer = root.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    const local = (rect: DOMRect | DropZone["rect"]) => ({ left: rect.left - outer.left, top: rect.top - outer.top, width: rect.width, height: rect.height });
    const whole = local(outer);
    // The window's own edges: a thin band all around.
    const nearWindow = edgeAt(point, outer, Math.min(0.5, WINDOW_EDGE_PX / Math.max(1, Math.min(outer.width, outer.height))));
    if (nearWindow && layout.type === "split") {
      const sameDir = layout.dir === (nearWindow === "left" || nearWindow === "right" ? "row" : "column");
      return { anchorId: null, edge: nearWindow, leafId: null, rect: edgeRect(whole, nearWindow, sameDir ? 1 / (layout.children.length + 1) : 0.5) };
    }
    const leafEl = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-split-leaf]") : null;
    const leafId = leafEl?.dataset.splitLeaf ?? MAIN_LEAF_ID;
    const box = (leafEl ?? root).getBoundingClientRect();
    const edge = edgeAt(point, box);
    return { anchorId: leafId, edge, leafId, rect: edgeRect(local(box), edge, 0.5) };
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const next = zoneAt(event);
    setZone((previous) => (previous && next && previous.anchorId === next.anchorId && previous.edge === next.edge && previous.rect.width === next.rect.width && previous.rect.height === next.rect.height ? previous : next));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(SPLIT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const at = zoneAt(event);
    setZone(null);
    const drag = parseSplitDrag(event.dataTransfer.getData(SPLIT_DRAG_TYPE));
    const target = drag ? dragTarget(drag, state) : null;
    if (!at || !target) return;
    if (at.edge === null) {
      if (at.leafId && at.leafId !== MAIN_LEAF_ID) {
        updateSplitLayout((current) => replaceSection(current, at.leafId!, target));
        return;
      }
      // The main chat's middle: open it there, as a click on the row would.
      openInMain(dispatch, target, state.bots, showThreads);
      return;
    }
    // Already in the split: focus that section instead of opening a copy (#1781).
    ensureSection(target, at.edge, at.anchorId);
  };

  return (
    <PanelSlotProvider slot={panelSlot}>
    <div
      ref={rootRef}
      data-split-workspace={layout.type === "split" ? "split" : ""}
      className="relative flex h-full min-h-0 min-w-0 flex-1"
      onDragOverCapture={onDragOver}
      onDropCapture={onDrop}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !rootRef.current?.contains(next)) setZone(null);
      }}
    >
      {layout.type === "leaf" ? main : <SplitNodeView node={layout} main={main} />}
      {zone && (
        <div
          aria-hidden
          data-split-drop={zone.edge ?? "center"}
          className="pointer-events-none absolute z-50 rounded-lg border-2 border-accent/70 bg-accent/15 transition-[left,top,width,height] duration-100"
          style={{ left: zone.rect.left + 4, top: zone.rect.top + 4, width: Math.max(0, zone.rect.width - 8), height: Math.max(0, zone.rect.height - 8) }}
        />
      )}
    </div>
    </PanelSlotProvider>
  );
}

/** Whose bot panel App.tsx draws at the window's right edge: the main
 * chat's bot, or the bot of the section whose pill opened it (panelOwner).
 * undefined while a group section holds the one panel. */
export function useBotPanelBot(mainBot: Bot | undefined): Bot | undefined {
  const { state } = useStore();
  const owner = state.panelOwner;
  if (!owner) return mainBot;
  return owner.botId === undefined ? undefined : state.bots.find((candidate) => candidate.id === owner.botId);
}

/** A section's pill: open when this section owns the one panel; a click
 * closes it, or opens it for this section's bot or group. */
function useSectionPanel(leafId: string, owner: { botId: string } | { groupId: string }) {
  const { state, dispatch } = useStore();
  const open = (state.settingsOpen || state.computerOpen) && state.panelOwner?.leafId === leafId;
  const onToggle = () => {
    if (open) for (const action of botPillActions(true)) dispatch(action);
    else dispatch({ type: "toggleSettings", open: true, owner: { leafId, ...owner } });
  };
  return { open, onToggle, slot: usePanelSlot() };
}

/** Opens a section's conversation in the main chat. A bot's thread goes
 * through openBotThread, the one gate of the single stream
 * (shared/single-stream.ts): an earlier topic opens the conversation, a
 * thread outside the stream opens beside it. */
function openInMain(dispatch: ReturnType<typeof useStore>["dispatch"], target: SplitTarget, bots: readonly Bot[], threadsShown: boolean) {
  if (target.kind === "bot") {
    const bot = bots.find((candidate) => candidate.id === target.botId);
    if (bot && target.threadId) {
      openBotThread(dispatch, bot, target.threadId, threadsShown);
      return;
    }
    dispatch({ type: "select", id: target.botId });
    return;
  }
  dispatch({ type: "select", id: target.groupId });
  if (target.threadId) dispatch({ type: "switchGroupTask", groupId: target.groupId, threadId: target.threadId });
}

/** Scrolls a section into view and flashes it when menu/drop focuses it. */
function useFocusFlash(leafId: string, ref: React.RefObject<HTMLElement | null>) {
  const focus = useSplitLeafFocus();
  useEffect(() => {
    if (focus.leafId !== leafId || focus.nonce === 0) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.dataset.splitFocus = "";
    const timer = window.setTimeout(() => {
      delete el.dataset.splitFocus;
    }, 1200);
    return () => {
      window.clearTimeout(timer);
      delete el.dataset.splitFocus;
    };
  }, [focus.leafId, focus.nonce, leafId, ref]);
}

function SplitNodeView({ node, main }: { node: SplitNode; main: ReactNode }) {
  if (node.type === "leaf") {
    if (node.id === MAIN_LEAF_ID) {
      return <MainLeaf main={main} />;
    }
    return <SplitPane leaf={node} />;
  }
  return <SplitBranchView node={node} main={main} />;
}

function MainLeaf({ main }: { main: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusFlash(MAIN_LEAF_ID, ref);
  return <div ref={ref} data-split-leaf={MAIN_LEAF_ID} className="relative flex h-full min-h-0 min-w-0 flex-1 ring-inset data-[split-focus]:ring-2 data-[split-focus]:ring-accent/70">{main}</div>;
}

function SplitBranchView({ node, main }: { node: SplitBranch; main: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const row = node.dir === "row";
  return (
    <div ref={ref} data-split-branch={node.dir} className={cn("flex h-full min-h-0 w-full min-w-0", row ? "flex-row" : "flex-col")}>
      {node.children.map((child, index) => (
        <ChildSlot key={child.id} node={child} share={node.sizes[index] ?? 0} row={row} main={main}>
          {index > 0 && <SplitHandle branch={node} index={index - 1} row={row} containerRef={ref} hideNarrow={!containsMain(child) || !containsMain(node.children[index - 1]!)} />}
        </ChildSlot>
      ))}
    </div>
  );
}

function ChildSlot({ node, share, row, main, children }: { node: SplitNode; share: number; row: boolean; main: ReactNode; children: ReactNode }) {
  const hasMain = containsMain(node);
  return (
    <>
      {children}
      <div
        className={cn("relative flex min-h-0 min-w-0", !hasMain && "max-md:hidden", hasMain && "max-md:!flex-[1_1_0px]")}
        style={{ flex: `${share} 1 0px`, ...(row ? { minWidth: 240 } : { minHeight: 160 }) }}
      >
        <SplitNodeView node={node} main={main} />
      </div>
    </>
  );
}

function SplitHandle({ branch, index, row, containerRef, hideNarrow }: { branch: SplitBranch; index: number; row: boolean; containerRef: React.RefObject<HTMLDivElement | null>; hideNarrow: boolean }) {
  const drag = useRef<{ at: number; length: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const share = branch.sizes[index] ?? 0;
  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label={t("splitView.resize")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      data-split-handle={branch.dir}
      data-resizing={resizing ? "" : undefined}
      onPointerDown={(event) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        drag.current = { at: row ? event.clientX : event.clientY, length: row ? box.width : box.height };
        setResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from || from.length <= 0) return;
        const now = row ? event.clientX : event.clientY;
        const delta = (now - from.at) / from.length;
        if (delta === 0) return;
        drag.current = { ...from, at: now };
        updateSplitLayout((layout) => resizeSplit(layout, branch.id, index, delta));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        const back = row ? "ArrowLeft" : "ArrowUp";
        const forward = row ? "ArrowRight" : "ArrowDown";
        const delta = event.key === back ? -KEY_STEP : event.key === forward ? KEY_STEP : 0;
        if (!delta) return;
        event.preventDefault();
        updateSplitLayout((layout) => resizeSplit(layout, branch.id, index, delta));
      }}
      className={cn(
        "group/split-handle relative z-10 shrink-0 bg-hairline-weak outline-none",
        row ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        hideNarrow && "max-md:hidden",
      )}
    >
      {/* the hit area, wider than the hairline it draws */}
      <span
        aria-hidden
        className={cn(
          "absolute bg-transparent transition-colors duration-[120ms] group-hover/split-handle:bg-accent/55 group-focus-visible/split-handle:bg-accent/55 group-data-[resizing]/split-handle:bg-accent/55",
          row ? "inset-y-0 -left-[3px] w-[7px]" : "inset-x-0 -top-[3px] h-[7px]",
        )}
      />
    </div>
  );
}

/** One section other than the main chat. */
function SplitPane({ leaf }: { leaf: SplitLeaf }) {
  const { state } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useFocusFlash(leaf.id, ref);
  const target = leaf.target;
  const close = () => updateSplitLayout((layout) => removeSection(layout, leaf.id));
  const bot = target?.kind === "bot" ? state.bots.find((candidate) => candidate.id === target.botId) : undefined;
  const group = target?.kind === "group" ? state.groups.find((candidate) => candidate.id === target.groupId) : undefined;
  let body: ReactNode;
  if (target && bot) {
    const threadId = target.threadId ?? bot.threadId;
    body = <BotPane key={`bot:${bot.id}:${threadId}`} leafId={leaf.id} bot={bot} threadId={threadId} target={target} onClose={close} />;
  } else if (target && group) {
    const threadId = target.threadId ?? group.threadId;
    body = <GroupPane key={`group:${group.id}:${threadId}`} leafId={leaf.id} group={group} threadId={threadId} target={target} onClose={close} />;
  } else {
    // Its bot or group is gone (or not loaded yet): say so, with Close.
    body = (
      <div className="flex h-full w-full flex-col bg-app">
        <PaneHeader title={state.connected ? t("splitView.gone") : t("splitView.loading")} onClose={close} />
        <div className="flex flex-1 items-center justify-center px-6 pt-14 text-center text-[13px] text-ink-secondary">
          {state.connected ? t("splitView.gone") : <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} data-split-leaf={leaf.id} className="relative flex h-full min-h-0 w-full min-w-0 flex-col ring-inset data-[split-focus]:ring-2 data-[split-focus]:ring-accent/70">
      {body}
    </div>
  );
}

/** A section's header. A bot's floats over its transcript (the chat view
 * pads for it); a group's sits in the flow, above its own banners. The
 * pill sits centered as in a normal chat; a pinned thread's title stays
 * on its left, Open in main and Close in the corner. */
function PaneHeader({ pill, title, subtitle, onOpenMain, onClose, inFlow = false }: { pill?: ReactNode; title: string; subtitle?: string; onOpenMain?: () => void; onClose: () => void; inFlow?: boolean }) {
  return (
    <div data-split-pane-header className={cn("content-topbar z-[3] flex min-h-[52px] items-center gap-2 px-3 py-2.5", inFlow ? "relative shrink-0" : "absolute inset-x-0 top-0")}>
      {pill ? (
        <>
          <span dir="auto" className="min-w-0 max-w-[calc(25%-1rem)] truncate text-[12.5px] leading-5 text-ink-secondary">{subtitle ? title : ""}</span>
          <div data-split-pane-pill="" className="absolute left-1/2 top-1/2 flex max-w-[50%] -translate-x-1/2 -translate-y-1/2 items-center">{pill}</div>
          <span aria-hidden className="flex-1" />
        </>
      ) : (
        <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-ink">{title}</span>
      )}
      {onOpenMain && (
        <button type="button" data-split-open-main onClick={onOpenMain} aria-label={t("splitView.openInMain")} title={t("splitView.openInMain")} className={CIRCLE_BUTTON}>
          <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <button type="button" data-split-close onClick={onClose} aria-label={t("splitView.close")} title={t("splitView.close")} className={CIRCLE_BUTTON}>
        <X size={17} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

function PaneLoading({ header, failed }: { header: ReactNode; failed: boolean }) {
  return (
    <>
      {header}
      {failed
        ? <div role="alert" className="flex flex-1 items-center justify-center px-6 pt-14 text-center text-[13px] text-ink-secondary">{t("sideThread.loadFailed")}</div>
        : <div role="status" className="flex flex-1 items-center justify-center pt-14 text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-hidden="true" /><span className="sr-only">{t("sideThread.loading")}</span></div>}
    </>
  );
}

function BotPane({ leafId, bot, threadId, target, onClose }: { leafId: string; bot: Bot; threadId: string; target: SplitTarget; onClose: () => void }) {
  const { state, dispatch } = useStore();
  // This section's pill opens this bot's panel at the window's right edge.
  const panel = useSectionPanel(leafId, { botId: bot.id });
  const showThreads = useShowThreads();
  const transcript = useSideTranscript(threadId);
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  // On screen in a section is read, as in the main chat.
  const unread = task ? task.unread === true : threadId === bot.threadId && bot.unread === true;
  useEffect(() => {
    if (unread) api(`/api/bots/${bot.id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
  }, [unread, bot.id, threadId]);
  // The chat view reads the bot on this section's thread, with this
  // section's messages; the rest (busy state, approvals, model) stays live.
  // hasMore and loadOlder stay on this section's transcript: the store only
  // pages the selected thread.
  const paneBot = useMemo<Bot>(() => ({
    ...bot,
    threadId,
    messages: transcript.messages,
    activeLeafId: transcript.activeLeafId,
    hasMore: transcript.hasMore,
  }), [bot, threadId, transcript.messages, transcript.activeLeafId, transcript.hasMore]);
  const title = target.threadId ? task?.title?.trim() || t("task.newShort") : bot.name;
  const label = t("splitView.aria", { name: bot.name });
  const header = (pill: ReactNode) => (
    <PaneHeader
      pill={pill}
      title={title}
      {...(target.threadId ? { subtitle: bot.name } : {})}
      onOpenMain={() => { onClose(); openInMain(dispatch, target.threadId ? { kind: "bot", botId: bot.id, threadId } : { kind: "bot", botId: bot.id }, state.bots, showThreads); }}
      onClose={onClose}
    />
  );
  // Until the thread loads, the same pill with a still mascot.
  const loadingPill = <BotHeaderPill name={bot.name} panelOpen={panel.open} onToggle={panel.onToggle} avatar={<BotAvatar bot={bot} state="idle" size={24} animated={false} />} />;
  return (
    <section aria-label={label} data-split-pane={`bot:${bot.id}`} className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-app">
      {transcript.loaded ? <ChatView bot={paneBot} side={{ header, label, panel, loadOlder: transcript.loadOlder, loadingOlder: transcript.loadingOlder }} /> : <PaneLoading header={header(loadingPill)} failed={transcript.failed} />}
    </section>
  );
}

function GroupPane({ leafId, group, threadId, target, onClose }: { leafId: string; group: Group; threadId: string; target: SplitTarget; onClose: () => void }) {
  const { state, dispatch } = useStore();
  // This section's pill opens this group's panel at the window's right edge.
  const panel = useSectionPanel(leafId, { groupId: group.id });
  const showThreads = useShowThreads();
  const transcript = useSideTranscript(threadId);
  // On screen in a section is read, as in the main chat (a person's
  // conversation per thread, a group as a whole).
  const unread = threadId === group.threadId && group.unread === true;
  const readTarget = unread ? (group.peopleDm ? peopleDmReadTarget(group) : {}) : null;
  const readBody = readTarget && Object.keys(readTarget).length > 0 ? JSON.stringify(readTarget) : readTarget ? "" : null;
  useEffect(() => {
    if (readBody === null) return;
    api(`/api/groups/${group.id}/read`, { method: "POST", ...(readBody ? { body: readBody } : {}) }).catch(() => {});
  }, [readBody, group.id]);
  const paneGroup = useMemo<Group>(() => ({
    ...group,
    threadId,
    messages: transcript.messages,
    hasMore: transcript.hasMore,
  }), [group, threadId, transcript.messages, transcript.hasMore]);
  const members = useMemo(() => groupMemberBots(group, state.bots), [group, state.bots]);
  const task = group.tasks?.find((candidate) => candidate.threadId === threadId);
  const title = target.threadId && task ? task.title?.trim() || t("task.newShort") : group.name;
  const label = t("splitView.aria", { name: group.name });
  const header = (pill: ReactNode) => (
    <PaneHeader
      pill={pill}
      title={title}
      {...(target.threadId && task ? { subtitle: group.name } : {})}
      inFlow
      onOpenMain={() => { onClose(); openInMain(dispatch, target.threadId ? { kind: "group", groupId: group.id, threadId } : { kind: "group", groupId: group.id }, state.bots, showThreads); }}
      onClose={onClose}
    />
  );
  // Until the thread loads, the same pill. A one-to-one room (dm) has no
  // panel: its pill is the plain chip, as in the main chat.
  const loadingPill = group.dm ? null : <BotHeaderPill name={group.name} panelOpen={panel.open} onToggle={panel.onToggle} avatar={<GroupAvatarStack members={members} size={24} />} />;
  return (
    <section aria-label={label} data-split-pane={`group:${group.id}`} className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-app">
      {transcript.loaded ? <GroupView group={paneGroup} pane={{ header, label, panel, loadOlder: transcript.loadOlder, loadingOlder: transcript.loadingOlder }} /> : <PaneLoading header={header(loadingPill)} failed={transcript.failed} />}
    </section>
  );
}
