import { createContext, useContext, useRef, type Dispatch } from "react";
import type { Action, AppState, Bot, ConfigStatus, Message } from "@/state/store";
import type { ExchangeRun } from "@/lib/bot-exchange";
import type { GotoGroup } from "@/lib/goto-lines";
import type { MessagedLineItem } from "@/lib/messaged-line";
import type { TranscriptItem } from "@/lib/activity-runs";

export const USER_COLLAPSE_CHARS = 600;
export const USER_COLLAPSE_LINES = 8;

export type ListedItem =
  | TranscriptItem
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "voiceCall"; callId: string; messages: Message[] }
  | GotoGroup
  | MessagedLineItem;

/** What every row of the open chat reads besides its own message. The value
 * changes only when one of these does, so the memoized rows skip store
 * events that are not theirs: another bot's frame, a tool chip elsewhere in
 * the thread. The rosters keep their identity until a field a row draws
 * changes, the way ThreadRefsProvider keeps the thread list. */
export interface ChatRows {
  botId: string;
  threadId: string;
  botName: string;
  /** The person's own name, for the Hibou 98 skin's log author line. */
  viewerName?: string;
  voiceId?: string;
  /** Speech settings, for the read-aloud button. */
  tts: ConfigStatus["tts"];
  /** A paired Mac reads aloud with its own voices. That choice lives on the
   * device, not in the store, so it is read here once per store event. */
  localVoice: boolean;
  /** Tool activity ids that belong to the live turn (not historical receipts). */
  liveTools: ReadonlySet<string>;
  /** Editing, regenerating and switching versions wait for the turn. */
  busy: boolean;
  /** Older messages remain on the server, beyond the page the thread holds. */
  hasMore: boolean;
  /** Every bot, for who wrote a relayed line or sits across a bot⇄bot chip. */
  bots: readonly Bot[];
  /** Every other bot, for @mentions. */
  mentionPeers: readonly Bot[];
  /** A search hit or jump target in this thread. */
  focus: AppState["focusMessage"];
  showToolCalls: boolean;
  /** Rows show catalog strings, so a language change re-renders them. */
  locale: string;
  /** Set when the person's messages take this bot's color. Absent leaves the skin bubble. */
  bubbleStyle?: ReturnType<typeof import("@/lib/user-bubble-tone").userBubbleStyle>;
  dispatch: Dispatch<Action>;
  /** Whether a message is on the branch shown now (citation links). */
  onBranch: (messageId: string) => boolean;
  /** Who "I" am on a reaction chip (src/lib/reactions.ts). */
  reactionSelf: readonly string[];
  /** Bot-to-bot channel ids. A Messaged chip targeting one stays here. */
  botDmIds: ReadonlySet<string>;
}

export const ChatRowsContext = createContext<ChatRows | null>(null);

export function useChatRows(): ChatRows {
  const rows = useContext(ChatRowsContext);
  if (!rows) throw new Error("a chat row outside ChatView");
  return rows;
}

/** The fields of a bot that rows draw: its name and colour for @mentions,
 * its avatar for relayed lines and bot⇄bot chips. */
const drawnBot = (bot: Bot) =>
  [bot.id, bot.name, bot.hidden, bot.color, bot.mascotBody, bot.mascotExpression, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

/** `bots`, holding the same array until a drawn field of one of them changes. */
export function useDrawnBots(bots: readonly Bot[]): readonly Bot[] {
  const signature = bots.map(drawnBot).join("\u0002");
  const cache = useRef({ signature, bots });
  if (cache.current.signature !== signature) cache.current = { signature, bots };
  return cache.current.bots;
}

/** The fields of a bot its "Seen" face draws. */
const seenFaceKey = (bot: Bot) =>
  [bot.id, bot.name, bot.color, bot.mascotLook, bot.mascotSkin, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

/** `bot`, holding the same object until a field its Seen face draws changes,
 * so the caption is not rebuilt on every bot frame. */
export function useSeenFaceBot(bot: Bot): Bot {
  const key = seenFaceKey(bot);
  const cache = useRef({ key, bot });
  if (cache.current.key !== key) cache.current = { key, bot };
  return cache.current.bot;
}

