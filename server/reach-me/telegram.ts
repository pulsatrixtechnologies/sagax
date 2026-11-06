// "Me joindre" by Telegram (2026-10-26), with the person's OWN bot: they
// create it with BotFather, paste its token on the bot page, then open the
// t.me link Sagax shows and press Start. No account of ours, no webhook to
// expose: Sagax asks Telegram for new messages (getUpdates) only while
// something waits (a link to finish, a card sent there), and stops after.
//
// - Link: the token is checked with getMe (the bot's @username, shown) and
//   sealed (./secrets.ts). The /start code is one-time, 15 minutes. The
//   first private chat that sends `/start <code>` is the person's; any other
//   chat is ignored, before and after.
// - Out: sendMessage to that chat (free).
// - Back: a message of that chat goes to `onReply` (the reach-me service
//   answers the card when it starts with an open code) and the person gets a
//   short acknowledgement. Messages of any other chat are dropped unread.
// - The token is never logged, never in an answer, an audit row or a prompt.
import { randomBytes } from "node:crypto";

import { composeReachText, reachAckText, type ReachChannel, type ReachOutbound, type ReachSendResult } from "./channel.ts";
import type { ReachMeSecrets } from "./secrets.ts";
import type { ReachReplyOutcome } from "./service.ts";
import type { ReachMeStore, ReachTelegramLink } from "./store.ts";
import { reportBackgroundError } from "../background-error.ts";

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_LINK_TTL_MS = 15 * 60_000;
/** How often the poller asks while something waits. */
export const TELEGRAM_POLL_MS = 4_000;

export interface ReachTelegramDeps {
  settings: ReachMeStore;
  secrets: Pick<ReachMeSecrets, "telegramToken" | "setTelegramToken">;
  /** Whether a card sent through Telegram is still open for this person and bot. */
  waiting(person: string, botId: string): boolean;
  onReply(person: string, text: string): Promise<{ handled: boolean; outcome: ReachReplyOutcome }>;
  language(person: string): "fr" | "en";
  fetch?: typeof fetch;
  now?(): number;
  log?(line: string): void;
  /** setInterval by default; tests drive `poll` by hand. */
  schedule?(run: () => void, ms: number): () => void;
}

type TelegramUpdate = {
  update_id: number;
  message?: { chat?: { id?: number; type?: string }; text?: string };
};

export type TelegramConnect = { ok: true; username: string; link: string } | { ok: false; error: string; status: number };

export class ReachTelegram {
  private readonly deps: ReachTelegramDeps;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** Next update id per person and bot (in memory: Telegram keeps the rest for a day). */
  private readonly offsets = new Map<string, number>();
  private stop: (() => void) | null = null;
  private polling = false;

  constructor(deps: ReachTelegramDeps) {
    this.deps = deps;
    this.fetcher = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((line) => console.log(line));
  }

  private async call(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; status: number }> {
    try {
      const response = await this.fetcher(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const parsed = await response.json().catch(() => ({})) as { ok?: boolean; result?: unknown };
      return { ok: response.ok && parsed.ok === true, result: parsed.result, status: response.status };
    } catch {
      return { ok: false, status: 502 };
    }
  }

  /** The person pastes their bot's token: checked, sealed, and a /start link to open. */
  async connect(person: string, botId: string, token: string): Promise<TelegramConnect> {
    const trimmed = token.trim();
    const me = await this.call(trimmed, "getMe", {});
    if (!me.ok) return { ok: false, status: me.status === 401 || me.status === 404 ? 400 : 502, error: me.status === 401 || me.status === 404 ? "Telegram refused this token. Copy it again from BotFather." : "Telegram could not be reached. Try again." };
    const username = typeof (me.result as { username?: unknown })?.username === "string" ? (me.result as { username: string }).username : "";
    if (!username) return { ok: false, status: 502, error: "Telegram did not name the bot." };
    try {
      this.deps.secrets.setTelegramToken(person, botId, trimmed);
    } catch (error) {
      return { ok: false, status: (error as { status?: number }).status ?? 500, error: error instanceof Error ? error.message : "The token could not be saved." };
    }
    const linkCode = randomBytes(9).toString("base64url");
    this.deps.settings.setTelegram(person, botId, { username, linkCode, linkExpiresAt: this.now() + TELEGRAM_LINK_TTL_MS });
    this.offsets.delete(`${person}\u0000${botId}`);
    this.ensurePolling();
    return { ok: true, username, link: `https://t.me/${username}?start=${linkCode}` };
  }

  /** The person disconnects Telegram for this bot: token and chat forgotten. */
  disconnect(person: string, botId: string): void {
    try { this.deps.secrets.setTelegramToken(person, botId, undefined); } catch { /* already gone */ }
    this.deps.settings.setTelegram(person, botId, undefined);
  }

  /** What the screen shows: the bot's @username and whether the chat is linked. */
  view(person: string, botId: string): { connected: boolean; username?: string; linking: boolean } {
    const link = this.deps.settings.telegram(person, botId);
    const token = this.deps.secrets.telegramToken(person, botId);
    if (!link || !token) return { connected: false, linking: false };
    return { connected: link.chatId !== undefined, username: link.username, linking: link.chatId === undefined && Boolean(link.linkCode) && (link.linkExpiresAt ?? 0) > this.now() };
  }

  channel(): ReachChannel {
    return {
      id: "telegram",
      status: (person, botId) => {
        const view = this.view(person, botId);
        if (view.connected) return { ready: true };
        return { ready: false, reason: view.linking ? "Open the Telegram link and press Start to finish." : "Connect your own Telegram bot first." };
      },
      send: async (out: ReachOutbound): Promise<ReachSendResult> => {
        const link = this.deps.settings.telegram(out.person, out.botId);
        const token = this.deps.secrets.telegramToken(out.person, out.botId);
        if (!link?.chatId || !token) return { ok: false, reason: "Telegram is not connected" };
        const sent = await this.call(token, "sendMessage", { chat_id: link.chatId, text: composeReachText(out) });
        if (!sent.ok) return { ok: false, reason: `Telegram refused the message (${sent.status})` };
        this.ensurePolling();
        return { ok: true };
      },
    };
  }

  /** Starts the poller when something waits; it stops itself when nothing does. */
  ensurePolling(): void {
    if (this.stop) return;
    const schedule = this.deps.schedule ?? ((run: () => void, ms: number) => {
      const timer = setInterval(run, ms);
      timer.unref?.();
      return () => clearInterval(timer);
    });
    this.stop = schedule(() => void this.poll().catch(reportBackgroundError), TELEGRAM_POLL_MS);
  }

  /** What waits on Telegram right now: links to finish and chats with an open card. */
  private watched(): Array<{ person: string; botId: string; link: ReachTelegramLink; token: string }> {
    const at = this.now();
    const out: Array<{ person: string; botId: string; link: ReachTelegramLink; token: string }> = [];
    for (const { person, botId, link } of this.deps.settings.telegramLinks()) {
      const linking = link.chatId === undefined && Boolean(link.linkCode) && (link.linkExpiresAt ?? 0) > at;
      if (!linking && !(link.chatId !== undefined && this.deps.waiting(person, botId))) continue;
      const token = this.deps.secrets.telegramToken(person, botId);
      if (token) out.push({ person, botId, link, token });
    }
    return out;
  }

  /** One pass: new messages of every watched bot. Never throws. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const watched = this.watched();
      if (!watched.length) {
        this.stop?.();
        this.stop = null;
        return;
      }
      for (const entry of watched) await this.pollOne(entry);
    } catch (error) {
      this.log(`reach-me: Telegram poll failed (${error instanceof Error ? error.name : "error"})`);
    } finally {
      this.polling = false;
    }
  }

  private async pollOne(entry: { person: string; botId: string; link: ReachTelegramLink; token: string }): Promise<void> {
    const key = `${entry.person}\u0000${entry.botId}`;
    const offset = this.offsets.get(key);
    const answer = await this.call(entry.token, "getUpdates", { timeout: 0, allowed_updates: ["message"], ...(offset !== undefined ? { offset } : {}) });
    if (!answer.ok || !Array.isArray(answer.result)) return;
    for (const update of answer.result as TelegramUpdate[]) {
      if (typeof update?.update_id !== "number") continue;
      this.offsets.set(key, update.update_id + 1);
      const chat = update.message?.chat;
      const text = typeof update.message?.text === "string" ? update.message.text : "";
      if (!chat || typeof chat.id !== "number" || chat.type !== "private" || !text) continue;
      const link = this.deps.settings.telegram(entry.person, entry.botId);
      if (!link) return;
      if (link.chatId === undefined) {
        // only `/start <the one-time code>` links a chat, and only before it expires
        const start = /^\/start\s+([A-Za-z0-9_-]{6,64})\s*$/.exec(text.trim());
        if (start && link.linkCode && start[1] === link.linkCode && (link.linkExpiresAt ?? 0) > this.now()) {
          this.deps.settings.setTelegram(entry.person, entry.botId, { username: link.username, chatId: chat.id });
          const fr = this.deps.language(entry.person) === "fr";
          await this.call(entry.token, "sendMessage", { chat_id: chat.id, text: fr ? "Connecté à Sagax. Les questions et approbations de ce bot arriveront ici." : "Connected to Sagax. This bot's questions and approvals will arrive here." });
        }
        continue;
      }
      // anyone else who finds the bot is not the person
      if (chat.id !== link.chatId) continue;
      const result = await this.deps.onReply(entry.person, text);
      const outcome = result.handled ? result.outcome : "unknown_code";
      await this.call(entry.token, "sendMessage", { chat_id: chat.id, text: reachAckText(outcome === "no_code" ? "unknown_code" : outcome, this.deps.language(entry.person)) });
    }
  }

  close(): void {
    this.stop?.();
    this.stop = null;
  }
}
