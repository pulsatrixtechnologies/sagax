// The Approvals screen's data on the client (shared/approvals-inbox.ts for
// the shape, server/routes/approvals-inbox.ts for the routes): the list,
// kept fresh while the screen is open, the bulk answer, the arrival chime,
// and the plain words a row reads as. Never an id on screen.
import { useCallback, useEffect, useRef, useState } from "react";

import { inboxKey, type InboxApproval, type InboxPayload } from "../../shared/approvals-inbox";
import type { PersonAttentionCard } from "../../shared/person-attention";
import { approvalAction } from "@/lib/approval-describe";
import { t } from "@/lib/i18n";
import { questionCardTitle } from "@/lib/question-card-title";
import { approvalChime } from "@/lib/notification-preferences";
import { api, type Message } from "@/state/store";
import { readableError } from "./plain-error";
import { webAudioAllowed } from "./audio-gate";

/** Where a card was raised, in words: its room, else its routine (a
 * routine run's hidden task, 2026-11-04), else its conversation's title. */
export function inboxWhere(entry: Pick<InboxApproval, "roomName" | "routineName" | "threadTitle">): string {
  if (entry.roomName) return entry.roomName;
  if (entry.routineName) return t("routines.post.routine", { name: entry.routineName });
  return entry.threadTitle ?? "";
}

export async function loadInbox(history: boolean): Promise<InboxPayload> {
  return api<InboxPayload>(`/api/approvals${history ? "?history=1" : ""}`);
}

export interface BulkAnswer {
  decision: "allow" | "deny";
  answered: number;
  results: Array<{ key: string; ok: boolean; code?: string; message?: string }>;
}

export async function bulkAnswer(decision: "allow" | "deny", entries: readonly Pick<InboxApproval, "threadId" | "requestId">[], always = false): Promise<BulkAnswer> {
  return api<BulkAnswer>("/api/approvals/bulk", {
    method: "POST",
    body: JSON.stringify({ decision, items: entries.map((entry) => ({ threadId: entry.threadId, requestId: entry.requestId })), ...(always && decision === "allow" ? { rule: "allow" } : {}) }),
  });
}

/** #2689: a bot's "needs you" card leaves the Today box. */
export async function markHandled(entry: Pick<InboxApproval, "botId" | "threadId" | "requestId">): Promise<void> {
  const messageId = entry.requestId.startsWith("attention:") ? entry.requestId.slice("attention:".length) : "";
  await api("/api/approvals/handled", { method: "POST", body: JSON.stringify({ botId: entry.botId, threadId: entry.threadId, messageId }) });
}

/** #2689: a proactive proposal answered from the Today box. */
export async function answerProactive(entry: Pick<InboxApproval, "botId" | "proactiveId">, accept: boolean): Promise<void> {
  if (!entry.proactiveId) return;
  await api(`/api/bots/${encodeURIComponent(entry.botId)}/proactive/${encodeURIComponent(entry.proactiveId)}`, { method: "POST", body: JSON.stringify({ accept }) });
}

const POLL_MS = 6_000;
/** The History reads 30 days of the decision log: polled far less often. */
const HISTORY_POLL_MS = 60_000;

/** The list while the screen is open: loaded at once, again every few
 * seconds while the window is visible, and whenever `signal` changes (the
 * store's own count of conversations waiting on the person). `arrived`
 * names the cards that were not there on the previous load. */
export function useInbox(history: boolean, signal: string): {
  data: InboxPayload | null;
  error: string | null;
  refresh: () => Promise<void>;
  arrived: ReadonlySet<string>;
} {
  const [data, setData] = useState<InboxPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;

  const refresh = useCallback(async () => {
    try {
      const next = await loadInbox(historyRef.current);
      const keys = new Set(next.pending.map((entry) => entry.key));
      const fresh = known.current ? [...keys].filter((key) => !known.current!.has(key)) : [];
      known.current = keys;
      if (fresh.length) {
        setArrived(new Set(fresh));
        playApprovalChime();
      }
      setData((previous) => (historyRef.current || !previous ? next : { ...next, history: previous.history }));
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, history, signal]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, history ? HISTORY_POLL_MS : POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, history]);

  return { data, error, refresh, arrived };
}

let audio: AudioContext | null = null;

/** Two soft notes, quiet and short. Off in Settings > Notifications
 * (approvalChime), and never while the window is hidden. */
export function playApprovalChime(): void {
  if (!approvalChime.enabled()) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const Context = typeof window !== "undefined"
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;
  if (!Context || (!audio && !webAudioAllowed())) return;
  try {
    audio ??= new Context();
    const start = audio.currentTime + 0.01;
    for (const [index, frequency] of [880, 1318.5].entries()) {
      const at = start + index * 0.09;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = "sine";
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.06, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.34);
    }
  } catch {
    // no sound is fine
  }
}

// ── words ───────────────────────────────────────────────────────────────

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const PREFIXED_ID = /\b(?:pr|thr|req|msg|bot)_[A-Za-z0-9-]{8,}\b/g;

/** A line with every raw identifier taken out (a UUID, a hash, a prefixed
 * id): the screen never shows one. */
export function withoutIds(text: string): string {
  return text.replace(UUID, "…").replace(LONG_HEX, "…").replace(PREFIXED_ID, "…").replace(/\s+/g, " ").trim();
}

function capital(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function cardOf(entry: InboxApproval): NonNullable<Message["card"]> | undefined {
  return (entry.message as Message | undefined)?.card ?? undefined;
}

/** A bot's "needs you" card on a Today row (#2689). */
export function attentionOf(entry: InboxApproval): PersonAttentionCard | undefined {
  return entry.kind === "attention" ? (entry.message as Message | undefined)?.attention ?? undefined : undefined;
}

/** The row's title: the question, the proposal's own title, or what the
 * bot wants to do, in the reader's language. */
export function inboxTitle(entry: InboxApproval): string {
  const attention = attentionOf(entry);
  if (entry.kind === "attention") {
    const first = attention?.items[0]?.text.replace(/\*\*|__|`/g, "") ?? "";
    return first.trim() ? withoutIds(first).slice(0, 240) : t("approvals.kind.attention");
  }
  const card = cardOf(entry);
  if (entry.kind === "question") {
    const question = card?.questionRequest?.questions?.[0]?.question ?? (card ? questionCardTitle(card) : undefined);
    return question?.trim() ? withoutIds(question) : t("approvals.kind.question");
  }
  if (entry.kind === "proposal") {
    return card?.title?.trim() ? withoutIds(card.title) : t("approvals.kind.proposal");
  }
  const tool = card?.mcpTool ?? card?.tool ?? entry.tool;
  return capital(withoutIds(approvalAction(tool, card?.toolInput ?? card?.subtitle, card?.toolHints ?? entry.toolHints)));
}

/** One line under the title: the command, the choices, or the change. */
/** A row's one line under its title. #2936: `code` only for a real
 * command excerpt (a Run command card), drawn in the mono font; the bot's
 * own words and a question's choices are prose, drawn in the text font. */
export interface InboxPreview {
  text: string;
  code: boolean;
}

export function inboxPreview(entry: InboxApproval): InboxPreview {
  const prose = (text: string): InboxPreview => ({ text, code: false });
  if (entry.kind === "attention") {
    const rest = attentionOf(entry)?.items.slice(1).map((item) => item.text.replace(/\*\*|__|`/g, "")) ?? [];
    return prose(withoutIds(rest.join(" · ")).slice(0, 240));
  }
  const card = cardOf(entry);
  if (!card) return prose("");
  if (entry.kind === "question") {
    const options = card.questionRequest?.questions?.[0]?.options?.map((option) => option.label) ?? [];
    return prose(withoutIds(options.join(" · ")));
  }
  const command = card.commandAllowlist?.command;
  if (command) return { text: withoutIds(command), code: true };
  const first = (card.subtitle ?? "").split("\n").find((line) => line.trim()) ?? "";
  if (!first || /^\s*[{[]/.test(first)) return prose("");
  return prose(withoutIds(first).slice(0, 240));
}

/** #2936 (unified chat, never a thread): where "Open {bot}'s chat" goes,
 * the bot's chat on the card's own message, as a notification's tap. */
export function inboxChatTarget(entry: Pick<InboxApproval, "botId" | "threadId" | "messageId" | "message">): { botId: string; threadId: string; cardId?: string } {
  const cardId = entry.messageId ?? (entry.message as Message | undefined)?.id;
  return { botId: entry.botId, threadId: entry.threadId, ...(cardId ? { cardId } : {}) };
}

export { inboxKey };
