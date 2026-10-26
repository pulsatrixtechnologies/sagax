export interface WebhookMessageView {
  task: string;
  payload?: string;
}

/** Convert the model-safe webhook prompt into the smaller view shown in chat.
 * The stored message stays untouched, preserving the trust boundary for model
 * context and follow-up turns. */
export function webhookMessageView(text: string): WebhookMessageView | null {
  // Newer prompts carry a random boundary on both markers; older ones none.
  const open = /\[UNTRUSTED WEBHOOK EVENT DATA(?: ([0-9a-f]{12,64}))?\]\n/.exec(text);
  if (!open) return null;
  const eventStart = open.index;
  const boundary = open[1];
  const trustedPrefix = text.slice(0, eventStart);
  const markers = [
    "AUTHENTICATED WEBHOOK TASK",
    "USER-CONFIGURED WEBHOOK INSTRUCTIONS",
    "DEFAULT WEBHOOK INSTRUCTIONS",
  ];
  let task = "";
  for (const marker of markers) {
    const match = trustedPrefix.match(new RegExp(`\\[${marker}\\]\\n([\\s\\S]*?)\\n\\[\\/${marker}\\]`));
    const candidate = match?.[1]?.trim();
    if (candidate) {
      task = candidate;
      break;
    }
  }

  const bodyStart = eventStart + open[0].length;
  const closing = `\n[/UNTRUSTED WEBHOOK EVENT DATA${boundary ? ` ${boundary}` : ""}]`;
  const bodyEnd = text.indexOf(closing, bodyStart);
  const eventData = bodyEnd >= 0 ? text.slice(bodyStart, bodyEnd) : undefined;
  if (!task || !eventData) return null;

  const splitAt = eventData.indexOf("\n\n");
  const payload = (splitAt >= 0 ? eventData.slice(splitAt + 2) : "").trim();
  return { task, payload: payload || undefined };
}
