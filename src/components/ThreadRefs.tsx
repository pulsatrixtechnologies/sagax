// Every thread the person can see, as link targets for "#Title" mentions
// in chat text. One memoized list for the whole app: bubbles inside the
// memoized transcript subscribe to this context, not to the store, so a
// stream delta or an unrelated bot patch never re-renders their markdown —
// only a new, renamed or removed thread does.
import { useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { equalRows } from "@/state/view-slices";
import { MentionText } from "./MentionText";
import type { MentionPeer } from "@/lib/mentions";
import { createContext, Fragment, useContext, useMemo, type ReactNode } from "react";
import { botOpensTo, openBot, openThread, type Action, type AppState, type Bot, type Group, type ThreadTarget } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { parseBotRefUrl, parseThreadRefUrl, resolveThreadRefAddress, splitThreadRefsForDisplay, type ThreadRefCandidate } from "@/lib/thread-refs";

export interface ThreadRefsValue {
  threads: ThreadRefCandidate[];
  /** the bot whose chat is open; its own thread wins a shared title */
  currentBotId?: string;
}

export const ThreadRefsContext = createContext<ThreadRefsValue>({ threads: [] });

export function useThreadRefs(): ThreadRefsValue {
  return useContext(ThreadRefsContext);
}

/** Bot threads newest first (the order the store keeps them), then room
 * threads. A room is its own "bot" here: opening its thread goes through
 * the same openThread lookup, which finds rooms by thread id. */
export function collectThreadRefs(
  bots: ReadonlyArray<Pick<Bot, "id" | "name" | "tasks">>,
  groups: ReadonlyArray<Pick<Group, "id" | "name" | "tasks" | "dm">>,
): ThreadRefCandidate[] {
  const refs: ThreadRefCandidate[] = [];
  for (const bot of bots) {
    for (const task of bot.tasks ?? []) {
      refs.push({ botId: bot.id, botName: bot.name, threadId: task.threadId, title: task.title, activeAt: task.createdAt });
    }
  }
  for (const group of groups) {
    if (group.dm) continue;
    for (const task of group.tasks ?? []) {
      refs.push({ botId: group.id, botName: group.name, threadId: task.threadId, title: task.title, activeAt: task.createdAt });
    }
  }
  return refs;
}

export function ThreadRefsProvider({ children }: { children: ReactNode }) {
  const threads = useStoreSelector((current) => collectThreadRefs(current.bots, current.groups), equalRows);
  const currentBotId = useStoreSelector((current) => current.selectedId);
  const value = useMemo(() => ({ threads, currentBotId }), [threads, currentBotId]);
  return <ThreadRefsContext.Provider value={value}>{children}</ThreadRefsContext.Provider>;
}

export interface ThreadLinkTarget extends ThreadTarget {
  title: string;
  botName: string;
}

/** A "#Title" mention. A button, not an anchor: there is no URL, and it
 * must work from the keyboard. Looks like the links around it. */
export function ThreadLink({ target, ambiguous, children }: { target: ThreadLinkTarget; ambiguous: boolean; children?: ReactNode }) {
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  return (
    <button
      type="button"
      data-thread-link={target.threadId}
      onClick={() => openThread(dispatch, target, getState(), showThreads)}
      title={ambiguous ? t("chat.openThreadOn", { title: target.title, name: target.botName }) : t("chat.openThread", { title: target.title })}
      className="inline break-words text-start text-accent underline decoration-accent/40 hover:decoration-accent"
    >
      {children}
    </button>
  );
}

/** Open a chat link that came from outside the app (a browser or a
 * dashboard): the canonical sagax://thread/<id>?bot=<id> a chat's Copy
 * link makes, or sagax://bot/<id> for a bot's (or a room's) current
 * conversation, which a bot's row would open (openBot). Only navigates. A
 * chat that is not here, or not the named owner's, opens nothing and says
 * so where the person can see it. */
export function openChatLink(dispatch: (action: Action) => void, link: string, state: AppState, threadsShown: boolean): boolean {
  /** The bot, or room, a link names, opened as itself; its thread. */
  const openOwner = (id: string) => {
    const bot = state.bots.find((candidate) => candidate.id === id);
    if (bot) {
      openBot(dispatch, bot, threadsShown);
      return { name: bot.name, threadId: botOpensTo(bot, threadsShown) };
    }
    const room = state.groups.find((group) => group.id === id && !group.dm);
    // Opening it shows its current conversation; nothing is switched.
    if (room) dispatch({ type: "select", id: room.id });
    return room && { name: room.name, threadId: room.threadId };
  };
  const ownerAddress = parseBotRefUrl(link);
  if (ownerAddress) {
    const owner = openOwner(ownerAddress.botId);
    if (owner) {
      if (owner.threadId) dispatch({ type: "revealThread", threadId: owner.threadId });
      return true;
    }
    showLinkNotice(dispatch, state, { kind: "bot-gone", botName: null });
    return false;
  }
  const address = parseThreadRefUrl(link);
  const ref = address ? resolveThreadRefAddress(collectThreadRefs(state.bots, state.groups), address) : null;
  if (ref) return openThread(dispatch, ref, state, threadsShown);
  const owner = address?.botId ? openOwner(address.botId) : undefined;
  if (owner) {
    dispatch({ type: "notice", notice: { kind: "thread-gone", botName: owner.name } });
  } else {
    showLinkNotice(dispatch, state, { kind: "thread-gone", botName: null });
  }
  return false;
}

/** A dead link's notice lives in the chat column, so a link opened from the
 * team map or the routines page returns to the open chat to show it. */
function showLinkNotice(dispatch: (action: Action) => void, state: AppState, notice: NonNullable<AppState["notice"]>) {
  if (state.activeView !== "chat" && state.selectedId) dispatch({ type: "select", id: state.selectedId });
  dispatch({ type: "notice", notice });
}

/** The markdown `span` component's props when the remark plugin produced
 * a thread link; null for any other span. */
export function threadLinkFromProps(props: Record<string, unknown>): { target: ThreadLinkTarget; ambiguous: boolean } | null {
  const threadId = props["data-thread-id"];
  if (typeof threadId !== "string") return null;
  const text = (key: string) => {
    const value = props[key];
    return typeof value === "string" ? value : "";
  };
  return {
    target: { threadId, botId: text("data-thread-bot"), title: text("data-thread-title"), botName: text("data-thread-bot-name") },
    ambiguous: props["data-thread-ambiguous"] === "true",
  };
}

/** Plain text with its thread references linked — the person's own
 * messages, whose sends carry resolvable "#Title" runs and pasted links
 * as canonical markdown. When `peers` is given the plain
 * runs also carry the @mention highlight, so a line like "@Scout look at
 * #QA PR 245" gets both decorations, each from its own resolver. */
export function ThreadRefText({ text, peers, everyone = false }: {
  text: string; peers?: readonly MentionPeer[]; everyone?: boolean;
}) {
  const { threads, currentBotId } = useThreadRefs();
  const spans = useMemo(() => splitThreadRefsForDisplay(text, threads, currentBotId), [text, threads, currentBotId]);
  const plain = (run: string, key: number) =>
    peers ? <MentionText key={key} text={run} peers={peers} everyone={everyone} /> : <Fragment key={key}>{run}</Fragment>;
  if (!spans.some((span) => span.ref)) return plain(text, 0);
  return (
    <>
      {spans.map((span, index) => (span.ref
        ? <ThreadLink key={index} target={span.ref} ambiguous={span.ref.ambiguous}>{span.text}</ThreadLink>
        : plain(span.text, index)))}
    </>
  );
}
