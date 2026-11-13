// Landing on a message: after a search hit, scroll the row into view and
// flash it. Rows are wrapped in `display: contents` (no box of their own),
// so the wrapper carries data-mid and its last child — the bubble/chip,
// after any day separator — is what gets scrolled and highlighted.
import { useEffect } from "react";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { api, openBot, openBotThread, type Action, type AppState } from "@/state/store";
import { isEarlierSegment } from "@/lib/single-stream";
import type { SearchHit } from "@/lib/search-hit";
import { scrollMotion } from "@/lib/motion";

const FLASH_CLASSES = ["ring-2", "ring-accent/70", "rounded-2xl", "transition-shadow"];

/** Select and prepare the exact conversation represented by a search hit. */
export async function landOnSearchHit(
  hit: SearchHit,
  state: Pick<AppState, "bots" | "groups">,
  dispatch: React.Dispatch<Action>,
  threadsShown: boolean,
): Promise<void> {
  const ownerId = hit.botId ?? hit.groupId;
  const bot = hit.botId ? state.bots.find((candidate) => candidate.id === hit.botId) : undefined;
  const group = hit.groupId ? state.groups.find((candidate) => candidate.id === hit.groupId) : undefined;
  if (!ownerId || (!bot && !group)) throw new Error("That conversation is no longer available.");

  // With threads hidden, another of a bot's threads opens as every way into
  // one does (openBotThread): by the switch alone, so the thread the bot was
  // on keeps its unread mark. Last, so it loads the hit's version of the
  // thread, and whole: the hit can be older than a page.
  // The single stream: a hit in an older segment opens the stream at its
  // newest segment, which loads back to the hit (StreamEarlierTopics).
  const inStream = bot && !threadsShown && isEarlierSegment(bot.tasks, hit.threadId, bot.threadId) ? bot : undefined;
  const switchAlone = bot && !inStream && bot.threadId !== hit.threadId && !threadsShown ? bot : undefined;
  if (inStream) openBot(dispatch, inStream, false);
  else if (!switchAlone) dispatch({ type: "select", id: ownerId });
  if (bot && bot.threadId !== hit.threadId && !switchAlone && !inStream) {
    const result = await api(`/api/bots/${bot.id}/tasks/${hit.threadId}`, { method: "POST" });
    if (result?.bot) dispatch({ type: "taskSwitched", bot: result.bot });
  }
  if (group && group.threadId !== hit.threadId) {
    const result = await api(`/api/groups/${group.id}/tasks/${hit.threadId}`, { method: "POST" });
    if (result?.group) dispatch({ type: "groupPatched", group: result.group });
  }
  if (bot && !hit.onActivePath) {
    const branch = await api(`/api/bots/${bot.id}/active-branch`, {
      method: "POST",
      body: JSON.stringify({ messageId: hit.messageId, threadId: hit.threadId }),
    });
    if (branch?.activeLeafId) {
      dispatch({ type: "threadActive", threadId: hit.threadId, activeLeafId: branch.activeLeafId });
    }
  }
  // a hit in a thread outside the stream (a job, a run, a confidential
  // thread) opens it beside the conversation: the one-conversation gate
  if (switchAlone) openBotThread(dispatch, switchAlone, hit.threadId, false);
  dispatch({
    type: "focusMessage",
    threadId: hit.threadId,
    messageId: hit.messageId,
    matchText: hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength),
  });
}

function matchRange(root: HTMLElement, text: string): Range | null {
  const needle = text.trim();
  if (!needle) return null;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let rendered = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    rendered += node.data;
  }
  const pattern = needle.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern, "iu").exec(rendered);
  if (!match) return null;
  const range = document.createRange();
  let offset = 0;
  for (const node of nodes) {
    const end = offset + node.length;
    if (match.index >= offset && match.index < end) range.setStart(node, match.index - offset);
    if (match.index + match[0].length <= end) {
      range.setEnd(node, match.index + match[0].length - offset);
      return range;
    }
    offset = end;
  }
  return null;
}

export function useFocusMessage(threadId: string, ready: boolean) {
  const dispatch = useStoreDispatch();
  const focus = useStoreSelector((current) => current.focusMessage?.threadId === threadId ? current.focusMessage : null);
  useEffect(() => {
    // a segment focus scrolls to a topic's start (StreamEarlierTopics)
    if (!focus || focus.consumed || focus.segment || focus.threadId !== threadId || !ready) return;
    // messages may land a tick after the task switch; try briefly
    let tries = 0;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollFrame: number | null = null;
    let target: HTMLElement | null = null;
    let highlight: Highlight | null = null;
    let observer: MutationObserver | null = null;
    const locate = () => {
      const wrapper = document.querySelector<HTMLElement>(`[data-mid="${CSS.escape(focus.messageId)}"]`);
      const row = wrapper?.lastElementChild as HTMLElement | null;
      return focus.matchText ? row?.querySelector<HTMLElement>("[data-chat-bubble]") ?? row : row;
    };
    const markMatch = (root: HTMLElement) => {
      const textRoots = root.querySelectorAll<HTMLElement>(".chat-md, .chat-text");
      const range = matchRange(textRoots.item(textRoots.length - 1) ?? root, focus.matchText ?? "");
      if (!range) return null;
      if (highlight && CSS.highlights.get("search-result-text") === highlight) CSS.highlights.delete("search-result-text");
      highlight = new Highlight(range);
      CSS.highlights.set("search-result-text", highlight);
      return range;
    };
    // A re-render of the message (a streamed chunk, a store update right after
    // the switch) replaces the text nodes the range points into, and a range
    // into removed nodes collapses: the highlight stays set but empty. Rebuild
    // it on the message as it is now, for as long as this focus lasts.
    const keepMarked = (range: Range) => {
      let marked = range;
      let shown = marked.toString();
      observer = new MutationObserver(() => {
        if (marked.startContainer.isConnected && marked.endContainer.isConnected && marked.toString() === shown) return;
        const root = locate();
        const fresh = root ? markMatch(root) : null;
        if (!fresh) return;
        marked = fresh;
        shown = fresh.toString();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    const attempt = () => {
      if (cancelled) return;
      target = locate() ?? null;
      if (!target) {
        if (tries++ < 20) retryTimer = setTimeout(attempt, 100);
        return;
      }
      target.scrollIntoView({ block: "center", behavior: scrollMotion() });
      target.classList.add(...FLASH_CLASSES);
      const range = CSS.highlights ? markMatch(target) : null;
      if (range) {
        if (typeof MutationObserver !== "undefined") keepMarked(range);
        scrollFrame = requestAnimationFrame(() => {
          const scroller = target?.closest<HTMLElement>(".overflow-y-auto");
          if (!scroller) return;
          const match = range.getBoundingClientRect();
          const viewport = scroller.getBoundingClientRect();
          scroller.scrollTop += match.top + match.height / 2 - viewport.top - viewport.height / 2;
        });
      }
      // Consume only after the target is mounted and the flash has begun.
      // `consumed` is intentionally not an effect dependency, so this active
      // flash survives the bookkeeping update while future remounts ignore it.
      dispatch({ type: "focusMessageConsumed", nonce: focus.nonce });
      flashTimer = setTimeout(() => target?.classList.remove(...FLASH_CLASSES), 1800);
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (flashTimer) clearTimeout(flashTimer);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      observer?.disconnect();
      target?.classList.remove(...FLASH_CLASSES);
      if (highlight && CSS.highlights.get("search-result-text") === highlight) CSS.highlights.delete("search-result-text");
    };
  }, [dispatch, focus?.nonce, focus?.threadId, focus?.messageId, threadId, ready]);
}
