// The bot's own email address (B21, contract C of 2026-10-21):
// GET /api/bots/:id/inbound-mail answers { available, address, enabled },
// from the Perspicax relay (server/bot-mail-addresses.ts). Nothing is shown
// while it loads, on a solo server, or when the read fails.
import { useEffect, useState } from "react";

import { api } from "@/state/store";

export interface BotInboundMail {
  available: boolean;
  address: string | null;
  /** false: waiting for the administrator (off by default, JC decision 1). */
  enabled: boolean;
  /** The person viewing owns the bot and may change the address (v2). */
  canChange?: boolean;
}

export const NO_BOT_MAIL: BotInboundMail = { available: false, address: null, enabled: false };

/** The owner's new local part (v2): the format Sagax checks before asking. */
export const BOT_MAIL_LOCAL_PART = /^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$/;
const ADDRESS = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/** The answer when it is the contract's and names an address, else none. */
export function botInboundMailFrom(response: unknown): BotInboundMail {
  if (!response || typeof response !== "object" || Array.isArray(response)) return NO_BOT_MAIL;
  const { available, address, enabled, canChange } = response as Record<string, unknown>;
  if (available !== true || typeof address !== "string" || address.length > 320 || !ADDRESS.test(address)) return NO_BOT_MAIL;
  return { available: true, address, enabled: enabled === true, canChange: canChange === true };
}

/** Null while loading (and for no bot); a late answer for another bot is dropped. */
export function useBotInboundMail(botId: string | null | undefined): BotInboundMail | null {
  return useBotInboundMailState(botId)[0];
}

/** The address and a setter, for the owner's change (BotEmailAddress). */
export function useBotInboundMailState(botId: string | null | undefined): [BotInboundMail | null, (mail: BotInboundMail) => void] {
  const [loaded, setLoaded] = useState<{ botId: string; mail: BotInboundMail } | null>(null);
  useEffect(() => {
    if (!botId) return;
    const controller = new AbortController();
    void api(`/api/bots/${encodeURIComponent(botId)}/inbound-mail`, { signal: controller.signal, timeoutMs: 10_000 })
      .then((response: unknown) => {
        if (!controller.signal.aborted) setLoaded({ botId, mail: botInboundMailFrom(response) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ botId, mail: NO_BOT_MAIL });
      });
    return () => controller.abort();
  }, [botId]);
  const set = (mail: BotInboundMail) => {
    if (botId) setLoaded({ botId, mail });
  };
  return [botId && loaded?.botId === botId ? loaded.mail : null, set];
}

/** PUT /api/bots/:id/inbound-mail: the new address, or the refusal's code. */
export async function changeBotLocalPart(botId: string, localPart: string): Promise<{ ok: true; mail: BotInboundMail } | { ok: false; error: string }> {
  try {
    const response = await api(`/api/bots/${encodeURIComponent(botId)}/inbound-mail`, { method: "PUT", body: JSON.stringify({ localPart }), timeoutMs: 15_000 });
    const mail = botInboundMailFrom(response);
    return mail.available ? { ok: true, mail } : { ok: false, error: "unavailable" };
  } catch (cause) {
    const code = (cause as { body?: { error?: unknown } } | null)?.body?.error;
    return { ok: false, error: typeof code === "string" ? code : "unavailable" };
  }
}
